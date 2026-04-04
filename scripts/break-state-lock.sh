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

# 1. Pre-warm IP rule while publicNetworkAccess is still Disabled,
#    then enable. This avoids the slow propagation delay that occurs
#    when adding an IP rule after enabling public access.
DEPLOYER_IP=$(curl -sf https://api.ipify.org)
echo "Pre-warming IP ${DEPLOYER_IP} in firewall rules..."
az storage account network-rule add \
  --account-name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --ip-address "$DEPLOYER_IP" \
  --output none

echo "Enabling public network access..."
az storage account update \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --public-network-access Enabled \
  --output none
FIREWALL_OPENED=true
echo "✓ Firewall open with pre-warmed IP"

# 2. Wait for firewall propagation, then break lease
echo "Waiting for firewall propagation..."
sleep 20

az storage blob lease break \
  --blob-name "$STATE_KEY" \
  --container-name "$CONTAINER" \
  --account-name "$STORAGE_ACCOUNT" \
  --auth-mode login \
  --output none

echo "✓ Lease broken on ${STATE_KEY}"
