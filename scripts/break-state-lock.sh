#!/usr/bin/env bash
# Break a stuck Terraform state blob lease on the tfstate storage account.
# SFI-compliant: opens firewall, breaks lease, restores firewall.
#
# Usage:
#   ./break-state-lock.sh                           # breaks lease on epcubegraph.tfstate (production)
#   ./break-state-lock.sh epcubegraph-b002-web      # breaks lease on branch-specific state
#
# Why this exists: CD runners sometimes get interrupted without releasing
# the state lock. The blob lease persists with empty metadata, causing
# "state blob is already locked" errors on subsequent runs.

set -euo pipefail

STORAGE_ACCOUNT="tfstateepcubegraph"
RESOURCE_GROUP="tfstate-rg"
CONTAINER="tfstate"

STATE_KEY="${1:-epcubegraph}.tfstate"

echo "Breaking lease on: ${STORAGE_ACCOUNT}/${CONTAINER}/${STATE_KEY}"

# 1. Enable public network access (defaultAction remains Deny)
echo "Opening firewall..."
az storage account update \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --public-network-access Enabled \
  --output none

# 2. Whitelist deployer IP
DEPLOYER_IP=$(curl -sf https://api.ipify.org)
az storage account network-rule add \
  --account-name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --ip-address "$DEPLOYER_IP" \
  --output none
echo "IP ${DEPLOYER_IP} added to firewall"

# 3. Ensure cleanup on exit (even on failure)
cleanup() {
  echo "Restoring firewall..."
  az storage account network-rule remove \
    --account-name "$STORAGE_ACCOUNT" \
    --resource-group "$RESOURCE_GROUP" \
    --ip-address "$DEPLOYER_IP" \
    --output none 2>/dev/null || true
  az storage account update \
    --name "$STORAGE_ACCOUNT" \
    --resource-group "$RESOURCE_GROUP" \
    --public-network-access Disabled \
    --output none 2>/dev/null || true
  echo "Firewall restored"
}
trap cleanup EXIT

# 4. Wait for firewall propagation, then break lease
echo "Waiting for firewall propagation..."
sleep 20

az storage blob lease break \
  --blob-name "$STATE_KEY" \
  --container-name "$CONTAINER" \
  --account-name "$STORAGE_ACCOUNT" \
  --auth-mode login \
  --output none

echo "✓ Lease broken on ${STATE_KEY}"
