#!/usr/bin/env bash
# teardown-runner.sh — Unregister and delete the self-hosted GitHub Actions runner
#
# Removes the runner registration from GitHub, then deletes all Azure resources:
# VM, NIC, NSG, disks, VNet, subnets, private endpoints, DNS zones.
# Does NOT delete the tfstate storage account or state blobs.
#
# Idempotent — safe to run if resources are already partially or fully deleted.
#
# Prerequisites:
#   - Azure CLI logged in
#   - GitHub fine-grained PAT with Administration:Read+Write on the repo
#
# Usage:
#   ./scripts/teardown-runner.sh --pat <GITHUB_PAT>

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────

RG="tfstate-rg"
VM_NAME="github-runner-01"
VNET_NAME="github-runner-vnet"
STORAGE="tfstateepcubegraph"
BLOB_DNS_ZONE="privatelink.blob.core.windows.net"
VAULT_DNS_ZONE="privatelink.vaultcore.azure.net"
GITHUB_OWNER="sstjean"
GITHUB_REPO="epcubegraph"

# ── Argument Parsing ──────────────────────────────────────────────────────────

PAT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pat) PAT="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Helpers ────────────────────────────────────────────────────────────────────

info()    { echo -e "\033[0;36m  ℹ $*\033[0m"; }
success() { echo -e "\033[0;32m  ✓ $*\033[0m"; }
fail()    { echo -e "\033[0;31m  ✗ $*\033[0m"; exit 1; }
header()  { echo -e "\n\033[1;35m── $* ──\033[0m"; }

# ── Validation ─────────────────────────────────────────────────────────────────

[[ -n "$PAT" ]] || fail "GitHub PAT required: --pat <token>"
az account show -o none 2>/dev/null || fail "Not logged in to Azure CLI"

# ── Unregister runner from GitHub ──────────────────────────────────────────────

header "Unregistering runner from GitHub"

RUNNER_ID=$(curl -sf \
  -H "Authorization: token $PAT" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/actions/runners" \
  | jq -r ".runners[] | select(.name == \"$VM_NAME\") | .id") || true

if [[ -n "$RUNNER_ID" && "$RUNNER_ID" != "null" ]]; then
  curl -sf -X DELETE \
    -H "Authorization: token $PAT" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/actions/runners/$RUNNER_ID" \
    || true
  success "Runner '$VM_NAME' (ID: $RUNNER_ID) removed from GitHub"
else
  info "Runner '$VM_NAME' not found in GitHub — already removed or never registered"
fi

# ── Delete Azure resources ─────────────────────────────────────────────────────

header "Deleting Azure resources"

# VM first — block until fully deleted before touching dependent resources
if az vm show --name "$VM_NAME" --resource-group "$RG" -o none 2>/dev/null; then
  info "Deleting VM '$VM_NAME' (this may take a few minutes)..."
  az vm delete --name "$VM_NAME" --resource-group "$RG" --yes
  if az vm show --name "$VM_NAME" --resource-group "$RG" -o none 2>/dev/null; then
    fail "VM '$VM_NAME' still exists after delete"
  fi
  success "VM deleted"
else
  info "VM '$VM_NAME' not found — already deleted"
fi

# NIC, NSG, disks — only deletable after VM is gone
if az network nic show --name "${VM_NAME}VMNic" --resource-group "$RG" -o none 2>/dev/null; then
  az network nic delete --name "${VM_NAME}VMNic" --resource-group "$RG"
  success "NIC deleted"
fi
if az network nsg show --name "${VM_NAME}NSG" --resource-group "$RG" -o none 2>/dev/null; then
  az network nsg delete --name "${VM_NAME}NSG" --resource-group "$RG"
  success "NSG deleted"
fi
DISKS=$(az disk list --resource-group "$RG" --query "[?starts_with(name, '${VM_NAME}')].name" -o tsv 2>/dev/null) || true
for disk in $DISKS; do
  az disk delete --name "$disk" --resource-group "$RG" --yes
  success "Disk '$disk' deleted"
done
success "VM resources cleaned up"

# Private endpoint — must be removed before VNet
if az network private-endpoint show --name "${STORAGE}-blob-pe" --resource-group "$RG" -o none 2>/dev/null; then
  az network private-endpoint delete --name "${STORAGE}-blob-pe" --resource-group "$RG"
  success "Blob private endpoint deleted"
fi

# DNS zones — remove VNet links first, then zones
for ZONE in "$BLOB_DNS_ZONE" "$VAULT_DNS_ZONE"; do
  LINK_NAME="${ZONE//./-}-link"
  if az network private-dns link vnet show --name "$LINK_NAME" --zone-name "$ZONE" --resource-group "$RG" -o none 2>/dev/null; then
    az network private-dns link vnet delete --name "$LINK_NAME" --zone-name "$ZONE" --resource-group "$RG" --yes
    success "VNet link '$LINK_NAME' deleted"
  fi
  if az network private-dns zone show --name "$ZONE" --resource-group "$RG" -o none 2>/dev/null; then
    az network private-dns zone delete --name "$ZONE" --resource-group "$RG" --yes
    success "DNS zone '$ZONE' deleted"
  fi
done

# VNet last
if az network vnet show --name "$VNET_NAME" --resource-group "$RG" -o none 2>/dev/null; then
  az network vnet delete --name "$VNET_NAME" --resource-group "$RG"
  success "VNet deleted"
fi

# Verify clean — fail if anything survived
LEFTOVER=false
az vm show --name "$VM_NAME" --resource-group "$RG" -o none 2>/dev/null && { echo "  ✗ VM still exists"; LEFTOVER=true; }
az network vnet show --name "$VNET_NAME" --resource-group "$RG" -o none 2>/dev/null && { echo "  ✗ VNet still exists"; LEFTOVER=true; }
az network private-endpoint show --name "${STORAGE}-blob-pe" --resource-group "$RG" -o none 2>/dev/null && { echo "  ✗ Blob PE still exists"; LEFTOVER=true; }
az network private-dns zone show --name "$BLOB_DNS_ZONE" --resource-group "$RG" -o none 2>/dev/null && { echo "  ✗ Blob DNS zone still exists"; LEFTOVER=true; }
az network private-dns zone show --name "$VAULT_DNS_ZONE" --resource-group "$RG" -o none 2>/dev/null && { echo "  ✗ Vault DNS zone still exists"; LEFTOVER=true; }
if $LEFTOVER; then
  fail "Teardown incomplete — some resources could not be deleted"
fi
success "All resources verified deleted"

header "Teardown Complete"
echo ""
echo "  GitHub runner: unregistered"
echo "  Azure resources: deleted"
echo "  Storage account + state blobs: preserved"
echo ""
echo "  Next: ./scripts/create-runner.sh --pat <PAT>"
