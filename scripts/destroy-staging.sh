#!/usr/bin/env bash
# destroy-staging.sh — Destroy a specific staging environment
#
# Cleans up ALL Azure resources for a given staging environment:
#   1. Resource groups (main + bootstrap)
#   2. Terraform state blobs (via runner VM)
#   3. Entra ID app registrations
#   4. Soft-deleted Key Vaults
#   5. DNS records (CNAME + TXT matching "staging" pattern)
#
# Usage:
#   ./scripts/destroy-staging.sh epcubegraph-b005-emp

set -euo pipefail

info()    { echo -e "\033[0;36m  ℹ $*\033[0m"; }
success() { echo -e "\033[0;32m  ✓ $*\033[0m"; }
fail()    { echo -e "\033[0;31m  ✗ $*\033[0m"; exit 1; }
header()  { echo -e "\n\033[1;33m── $* ──\033[0m"; }

ENV_NAME="${1:-}"

[[ -z "$ENV_NAME" ]] && fail "Usage: $0 <environment-name>"
az account show -o none 2>/dev/null || fail "Not logged in to Azure CLI"

MAIN_RG="${ENV_NAME}-rg"
BOOTSTRAP_RG="${ENV_NAME}-bootstrap-rg"
STATE_BLOB="${ENV_NAME}.tfstate"
STATE_BOOTSTRAP="${ENV_NAME}.tfstate-bootstrap"
ZONE="devsbx.xyz"
ZONE_RG="devsbx-shared"

echo ""
echo "  Target environment: $ENV_NAME"
echo "  Resource groups:    $MAIN_RG, $BOOTSTRAP_RG"
echo "  State blobs:        $STATE_BLOB, $STATE_BOOTSTRAP"
echo "  DNS cleanup:        staging CNAME + TXT records"
echo ""
read -rp "  Destroy this staging environment? (yes/no): " confirm
[[ "$confirm" == "yes" ]] || { echo "Aborted."; exit 0; }

# ── 1. Delete resource groups ──

header "Deleting resource groups"

for rg in "$MAIN_RG" "$BOOTSTRAP_RG"; do
  if az group show --name "$rg" -o none 2>/dev/null; then
    az group delete --name "$rg" --yes --no-wait
    info "Deletion started: $rg"
  else
    info "Not found (already deleted): $rg"
  fi
done

# Wait for deletions
for rg in "$MAIN_RG" "$BOOTSTRAP_RG"; do
  while az group show --name "$rg" -o none 2>/dev/null; do
    echo "  Waiting for $rg..."
    sleep 15
  done
  success "$rg deleted"
done

# ── 2. Delete Terraform state blobs (via runner VM) ──

header "Deleting Terraform state blobs"

SCRIPT="az login --identity --output none
for blob in $STATE_BLOB $STATE_BOOTSTRAP; do
  if az storage blob exists --account-name tfstateepcubegraph --container-name tfstate --name \"\$blob\" --auth-mode login --query exists -o tsv | grep -q true; then
    az storage blob lease break --account-name tfstateepcubegraph --container-name tfstate --blob-name \"\$blob\" --auth-mode login --output none 2>/dev/null || true
    az storage blob delete --account-name tfstateepcubegraph --container-name tfstate --name \"\$blob\" --auth-mode login --output none
    echo \"Deleted \$blob\"
  else
    echo \"Not found: \$blob\"
  fi
done"

az vm run-command invoke \
  --resource-group tfstate-rg \
  --name github-runner-01 \
  --command-id RunShellScript \
  --scripts "$SCRIPT" \
  --query "value[0].message" -o tsv 2>&1

success "State blobs cleaned"

# ── 3. Delete Entra ID app registrations ──

header "Deleting Entra ID app registrations"

APP_IDS=$(az ad app list --filter "startswith(displayName, 'EP Cube Graph')" --query "[?contains(displayName, '($ENV_NAME)')].{name:displayName, id:id}" -o tsv 2>/dev/null)
if [[ -n "$APP_IDS" ]]; then
  while IFS=$'\t' read -r name id; do
    az ad app delete --id "$id"
    success "Deleted app: $name"
  done <<< "$APP_IDS"
else
  info "No Entra ID apps matching ($ENV_NAME)"
fi

# ── 4. Purge soft-deleted Key Vaults ──

header "Purging soft-deleted Key Vaults"

DELETED_KVS=$(az keyvault list-deleted --resource-type vault --query "[?contains(name, '$ENV_NAME')].{name:name, location:properties.location}" -o tsv 2>/dev/null)
if [[ -n "$DELETED_KVS" ]]; then
  while IFS=$'\t' read -r name location; do
    az keyvault purge --name "$name" --location "$location"
    success "Purged $name"
  done <<< "$DELETED_KVS"
else
  info "No soft-deleted Key Vaults matching $ENV_NAME"
fi

# ── 5. DNS cleanup ──

header "Cleaning staging DNS records"

CNAMES=$(az network dns record-set cname list --zone-name "$ZONE" --resource-group "$ZONE_RG" --query "[?contains(name, 'staging')].name" -o tsv 2>/dev/null)
for name in $CNAMES; do
  az network dns record-set cname delete --zone-name "$ZONE" --resource-group "$ZONE_RG" --name "$name" --yes
  success "Deleted CNAME $name"
done

TXTS=$(az network dns record-set txt list --zone-name "$ZONE" --resource-group "$ZONE_RG" --query "[?contains(name, 'staging')].name" -o tsv 2>/dev/null)
for name in $TXTS; do
  az network dns record-set txt delete --zone-name "$ZONE" --resource-group "$ZONE_RG" --name "$name" --yes
  success "Deleted TXT $name"
done

[[ -z "$CNAMES" && -z "$TXTS" ]] && info "No staging DNS records to clean"

# ── 6. Verify ──

header "Verification"

REMAINING_RG=$(az group show --name "$MAIN_RG" -o none 2>/dev/null && echo "$MAIN_RG" || true)
REMAINING_BOOT=$(az group show --name "$BOOTSTRAP_RG" -o none 2>/dev/null && echo "$BOOTSTRAP_RG" || true)

[[ -n "$REMAINING_RG" ]] && echo "  ✗ Resource group remains: $REMAINING_RG"
[[ -n "$REMAINING_BOOT" ]] && echo "  ✗ Bootstrap RG remains: $REMAINING_BOOT"

if [[ -z "$REMAINING_RG" && -z "$REMAINING_BOOT" ]]; then
  success "Staging environment $ENV_NAME destroyed"
else
  info "Some resources may still be deleting (--no-wait). Check Azure portal."
fi
