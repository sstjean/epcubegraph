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

# Ensure cleanup on exit (even on failure). Registered before any firewall
# changes so an early failure (e.g., IP detection) still restores state.
DEPLOYER_IP=""
FIREWALL_OPENED=false

cleanup() {
  if [[ "$FIREWALL_OPENED" != "true" ]]; then
    return 0
  fi
  echo "Restoring firewall..."
  if [[ -n "$DEPLOYER_IP" ]]; then
    az storage account network-rule remove \
      --account-name "$STORAGE_ACCOUNT" \
      --resource-group "$RESOURCE_GROUP" \
      --ip-address "$DEPLOYER_IP" \
      --output none 2>/dev/null || true
  fi
  az storage account update \
    --name "$STORAGE_ACCOUNT" \
    --resource-group "$RESOURCE_GROUP" \
    --public-network-access Disabled \
    --output none 2>/dev/null || true
  echo "Firewall restored"
}
trap cleanup EXIT

# 1. Enable public network access (defaultAction remains Deny)
echo "Opening firewall..."
az storage account update \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --public-network-access Enabled \
  --output none
FIREWALL_OPENED=true

# 2. Whitelist deployer IP
DEPLOYER_IP=$(curl -sf https://api.ipify.org)
az storage account network-rule add \
  --account-name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --ip-address "$DEPLOYER_IP" \
  --output none
echo "IP ${DEPLOYER_IP} added to firewall"

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
