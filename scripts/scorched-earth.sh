#!/usr/bin/env bash
# scorched-earth.sh — Complete destruction of ALL epcubegraph Azure resources
#
# Deletes EVERYTHING:
#   1. All epcubegraph resource groups (production, staging, bootstrap)
#   2. All DNS records in the shared devsbx.xyz zone
#   3. All TXT verification records in the shared zone
#   4. All Terraform state blobs (via runner VM)
#   5. All soft-deleted Key Vaults
#   6. All Entra ID app registrations
#
# Does NOT delete:
#   - tfstate-rg (storage account, runner VM, VNet, private endpoints)
#   - devsbx-shared resource group (DNS zone itself)
#   - devsbx-common.tfstate (shared DNS zone state)
#
# Usage:
#   ./scripts/scorched-earth.sh

set -euo pipefail

info()    { echo -e "\033[0;36m  ℹ $*\033[0m"; }
success() { echo -e "\033[0;32m  ✓ $*\033[0m"; }
fail()    { echo -e "\033[0;31m  ✗ $*\033[0m"; exit 1; }
header()  { echo -e "\n\033[1;31m── $* ──\033[0m"; }

az account show -o none 2>/dev/null || fail "Not logged in to Azure CLI"

echo ""
echo "  This will destroy ALL epcubegraph Azure resources."
echo ""
read -rp "  Continue? (yes/no): " confirm
[[ "$confirm" == "yes" ]] || { echo "Aborted."; exit 0; }

# ── 1. Delete all epcubegraph resource groups ──

header "Deleting resource groups"

RGS=$(az group list --query "[?starts_with(name, 'epcubegraph')].name" -o tsv 2>/dev/null)
if [[ -n "$RGS" ]]; then
  for rg in $RGS; do
    az group delete --name "$rg" --yes --no-wait
    info "Deletion started: $rg"
  done
  # Wait for all to finish
  for rg in $RGS; do
    while az group show --name "$rg" -o none 2>/dev/null; do
      echo "  Waiting for $rg..."
      sleep 15
    done
    success "$rg deleted"
  done
else
  info "No epcubegraph resource groups found"
fi

# ── 2. Delete all DNS records in devsbx.xyz ──

header "Cleaning DNS records in devsbx.xyz"

ZONE="devsbx.xyz"
ZONE_RG="devsbx-shared"

# CNAME records
CNAMES=$(az network dns record-set cname list --zone-name "$ZONE" --resource-group "$ZONE_RG" --query "[?contains(name, 'epcube')].name" -o tsv 2>/dev/null)
for name in $CNAMES; do
  az network dns record-set cname delete --zone-name "$ZONE" --resource-group "$ZONE_RG" --name "$name" --yes
  success "Deleted CNAME $name"
done

# TXT records
TXTS=$(az network dns record-set txt list --zone-name "$ZONE" --resource-group "$ZONE_RG" --query "[?contains(name, 'epcube')].name" -o tsv 2>/dev/null)
for name in $TXTS; do
  az network dns record-set txt delete --zone-name "$ZONE" --resource-group "$ZONE_RG" --name "$name" --yes
  success "Deleted TXT $name"
done

[[ -z "$CNAMES" && -z "$TXTS" ]] && info "No DNS records to clean"

# ── 3. Delete all state blobs (via runner VM) ──

header "Deleting Terraform state blobs"

az vm run-command create \
  --name scorched-earth-state \
  --vm-name github-runner-01 \
  --resource-group tfstate-rg \
  --location centralus \
  --script 'az login --identity --output none
BLOBS=$(az storage blob list --account-name tfstateepcubegraph --container-name tfstate --auth-mode login --query "[?name != '\''devsbx-common.tfstate'\''].name" -o tsv)
for blob in $BLOBS; do
  az storage blob lease break --account-name tfstateepcubegraph --container-name tfstate --blob-name "$blob" --auth-mode login --output none 2>/dev/null
  az storage blob delete --account-name tfstateepcubegraph --container-name tfstate --name "$blob" --auth-mode login --output none
  echo "Deleted $blob"
done
echo "---REMAINING---"
az storage blob list --account-name tfstateepcubegraph --container-name tfstate --auth-mode login --query "[].name" -o tsv' \
  --async-execution false \
  --query "instanceView.{output:output, error:error}" -o json 2>&1

success "State blobs cleaned"

# ── 4. Purge soft-deleted Key Vaults ──

header "Purging soft-deleted Key Vaults"

DELETED_KVS=$(az keyvault list-deleted --resource-type vault --query "[?contains(name, 'epcubegraph')].{name:name, location:properties.location}" -o tsv 2>/dev/null)
if [[ -n "$DELETED_KVS" ]]; then
  while IFS=$'\t' read -r name location; do
    az keyvault purge --name "$name" --location "$location"
    success "Purged $name"
  done <<< "$DELETED_KVS"
else
  info "No soft-deleted Key Vaults"
fi

# ── 5. Delete Entra ID app registrations ──

header "Deleting Entra ID app registrations"

APP_IDS=$(az ad app list --filter "startswith(displayName, 'EP Cube Graph')" --query "[].id" -o tsv 2>/dev/null)
if [[ -n "$APP_IDS" ]]; then
  for id in $APP_IDS; do
    NAME=$(az ad app show --id "$id" --query "displayName" -o tsv)
    az ad app delete --id "$id"
    success "Deleted app: $NAME"
  done
else
  info "No Entra ID apps to delete"
fi

# ── 6. Verify ──

header "Verification"

REMAINING_RGS=$(az group list --query "[?starts_with(name, 'epcubegraph')].name" -o tsv 2>/dev/null)
REMAINING_CNAMES=$(az network dns record-set cname list --zone-name "$ZONE" --resource-group "$ZONE_RG" --query "[?contains(name, 'epcube')].name" -o tsv 2>/dev/null)
REMAINING_KVS=$(az keyvault list-deleted --resource-type vault --query "[?contains(name, 'epcubegraph')].name" -o tsv 2>/dev/null)

[[ -n "$REMAINING_RGS" ]] && echo "  ✗ Resource groups remain: $REMAINING_RGS"
[[ -n "$REMAINING_CNAMES" ]] && echo "  ✗ DNS records remain: $REMAINING_CNAMES"
[[ -n "$REMAINING_KVS" ]] && echo "  ✗ Soft-deleted KVs remain: $REMAINING_KVS"

if [[ -z "$REMAINING_RGS" && -z "$REMAINING_CNAMES" && -z "$REMAINING_KVS" ]]; then
  success "All epcubegraph resources destroyed"
else
  echo ""
  echo "  Some resources may still be purging. Check again in a few minutes."
fi

echo ""
echo "  To redeploy: gh workflow run cd.yml --ref main -f environment=production"
