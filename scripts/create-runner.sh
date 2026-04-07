#!/usr/bin/env bash
# create-runner.sh — Create a self-hosted GitHub Actions runner with private
# endpoint access to tfstate storage and per-environment Key Vaults.
#
# Creates all resources from scratch in tfstate-rg / centralus:
#   1. VNet with subnets for private endpoints and runner VM
#   2. Private endpoint for tfstate blob + private DNS zone
#   3. Private DNS zone for Key Vault (per-env KV PEs created by Terraform)
#   4. Ubuntu 24.04 B2s VM — no public IP, NSG denies all inbound (zero trust)
#   5. GitHub Actions runner agent registered and running as a service
#   6. Storage Blob Data Contributor role for VM managed identity
#
# Idempotent — safe to re-run. Skips resources that already exist.
#
# Prerequisites:
#   - Azure CLI logged in with Owner on the subscription
#   - GitHub fine-grained PAT with Administration:Read+Write on the repo
#   - Storage account 'tfstateepcubegraph' exists in centralus
#
# Usage:
#   ./scripts/create-runner.sh --pat <GITHUB_PAT>

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────

LOCATION="centralus"
RG="tfstate-rg"
STORAGE="tfstateepcubegraph"

VNET_NAME="github-runner-vnet"
VNET_CIDR="10.200.0.0/16"
SUBNET_ENDPOINTS="endpoints"
SUBNET_ENDPOINTS_CIDR="10.200.1.0/24"
SUBNET_RUNNER="runner"
SUBNET_RUNNER_CIDR="10.200.2.0/24"

VM_NAME="github-runner-01"
VM_SIZE="Standard_B2s"
VM_IMAGE="Canonical:ubuntu-24_04-lts:server:latest"
VM_ADMIN="runner"

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

header "Validating prerequisites"

az account show --query "{sub:name, id:id}" -o table || fail "Not logged in to Azure CLI"
success "Azure CLI authenticated"

curl -sf -H "Authorization: token $PAT" "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO" -o /dev/null \
  || fail "GitHub PAT cannot access $GITHUB_OWNER/$GITHUB_REPO"
success "GitHub PAT valid"

STORAGE_LOCATION=$(az storage account show --name "$STORAGE" --resource-group "$RG" --query location -o tsv 2>/dev/null) \
  || fail "Storage account '$STORAGE' not found in '$RG'"
[[ "$STORAGE_LOCATION" == "$LOCATION" ]] \
  || fail "Storage account is in '$STORAGE_LOCATION', expected '$LOCATION'"
success "Storage account '$STORAGE' is in $LOCATION"

# Verify clean environment — stop if any runner resources exist
DIRTY=false
az vm show --name "$VM_NAME" --resource-group "$RG" -o none 2>/dev/null && { echo "  ✗ VM '$VM_NAME' exists"; DIRTY=true; }
az network vnet show --name "$VNET_NAME" --resource-group "$RG" -o none 2>/dev/null && { echo "  ✗ VNet '$VNET_NAME' exists"; DIRTY=true; }
az network private-endpoint show --name "${STORAGE}-blob-pe" --resource-group "$RG" -o none 2>/dev/null && { echo "  ✗ Private endpoint exists"; DIRTY=true; }
az network private-dns zone show --name "$BLOB_DNS_ZONE" --resource-group "$RG" -o none 2>/dev/null && { echo "  ✗ DNS zone '$BLOB_DNS_ZONE' exists"; DIRTY=true; }
az network private-dns zone show --name "$VAULT_DNS_ZONE" --resource-group "$RG" -o none 2>/dev/null && { echo "  ✗ DNS zone '$VAULT_DNS_ZONE' exists"; DIRTY=true; }
if $DIRTY; then
  fail "Environment is not clean. Run ./scripts/teardown-runner.sh --pat <PAT> first."
fi
success "Environment is clean"

# ── VNet ───────────────────────────────────────────────────────────────────────

header "Creating VNet and subnets"

az network vnet create \
  --name "$VNET_NAME" \
  --resource-group "$RG" \
  --location "$LOCATION" \
  --address-prefix "$VNET_CIDR" \
  --output none
success "VNet '$VNET_NAME' created"

for SUBNET_INFO in "$SUBNET_ENDPOINTS:$SUBNET_ENDPOINTS_CIDR" "$SUBNET_RUNNER:$SUBNET_RUNNER_CIDR"; do
  SNAME="${SUBNET_INFO%%:*}"
  SCIDR="${SUBNET_INFO##*:}"
  az network vnet subnet create \
    --name "$SNAME" \
    --vnet-name "$VNET_NAME" \
    --resource-group "$RG" \
    --address-prefixes "$SCIDR" \
    --output none
  success "Subnet '$SNAME' ($SCIDR) created"
done

# ── Private DNS Zones ──────────────────────────────────────────────────────────

header "Creating private DNS zones"

for ZONE in "$BLOB_DNS_ZONE" "$VAULT_DNS_ZONE"; do
  az network private-dns zone create --name "$ZONE" --resource-group "$RG" --output none
  success "DNS zone '$ZONE' created"

  LINK_NAME="${ZONE//./-}-link"
  VNET_ID=$(az network vnet show --name "$VNET_NAME" --resource-group "$RG" --query id -o tsv)
  az network private-dns link vnet create \
    --name "$LINK_NAME" \
    --zone-name "$ZONE" \
    --resource-group "$RG" \
    --virtual-network "$VNET_ID" \
    --registration-enabled false \
    --output none
  success "VNet link for '$ZONE' created"
done

# ── Tfstate Blob Private Endpoint ──────────────────────────────────────────────

header "Creating tfstate blob private endpoint"

PE_NAME="${STORAGE}-blob-pe"
STORAGE_ID=$(az storage account show --name "$STORAGE" --resource-group "$RG" --query id -o tsv)
DNS_ZONE_ID=$(az network private-dns zone show --name "$BLOB_DNS_ZONE" --resource-group "$RG" --query id -o tsv)

az network private-endpoint create \
  --name "$PE_NAME" \
  --resource-group "$RG" \
  --location "$LOCATION" \
  --vnet-name "$VNET_NAME" \
  --subnet "$SUBNET_ENDPOINTS" \
  --private-connection-resource-id "$STORAGE_ID" \
  --group-ids blob \
  --connection-name "${STORAGE}-blob-psc" \
  --output none

az network private-endpoint dns-zone-group create \
  --endpoint-name "$PE_NAME" \
  --resource-group "$RG" \
  --name default \
  --private-dns-zone "$DNS_ZONE_ID" \
  --zone-name blob \
  --output none

success "Private endpoint '$PE_NAME' created with DNS registration"

# ── Runner VM ──────────────────────────────────────────────────────────────────

header "Creating self-hosted runner VM"

# Get runner registration token from GitHub
REG_TOKEN=$(curl -sf -X POST \
  -H "Authorization: token $PAT" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/actions/runners/registration-token" \
  | jq -r '.token') || fail "Failed to get runner registration token"
[[ -n "$REG_TOKEN" && "$REG_TOKEN" != "null" ]] || fail "Runner registration token is empty"
success "Got GitHub runner registration token"

# Cloud-init script — installs all tools and registers the runner
CLOUD_INIT_FILE=$(mktemp)
cat > "$CLOUD_INIT_FILE" <<ENDINIT
#!/bin/bash
set -euo pipefail
exec > /var/log/runner-setup.log 2>&1

export DEBIAN_FRONTEND=noninteractive

echo "=== Installing base packages ==="
apt-get update
apt-get install -y curl wget apt-transport-https ca-certificates gnupg lsb-release jq unzip software-properties-common

echo "=== Installing Azure CLI ==="
curl -sL https://aka.ms/InstallAzureCLIDeb | bash

echo "=== Installing Terraform ==="
wget -qO- https://apt.releases.hashicorp.com/gpg | gpg --dearmor -o /usr/share/keyrings/hashicorp.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp.gpg] https://apt.releases.hashicorp.com \$(lsb_release -cs) main" > /etc/apt/sources.list.d/hashicorp.list
apt-get update && apt-get install -y terraform

echo "=== Installing .NET 10 SDK ==="
wget https://dot.net/v1/dotnet-install.sh -O /tmp/dotnet-install.sh
chmod +x /tmp/dotnet-install.sh
/tmp/dotnet-install.sh --channel 10.0 --install-dir /usr/share/dotnet
ln -sf /usr/share/dotnet/dotnet /usr/local/bin/dotnet
export DOTNET_ROOT=/usr/share/dotnet

echo "=== Installing Node.js 22 ==="
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

echo "=== Installing Docker ==="
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \$(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin
usermod -aG docker ${VM_ADMIN}

echo "=== Installing GitHub Actions Runner ==="
RUNNER_VERSION=\$(curl -sf https://api.github.com/repos/actions/runner/releases/latest | jq -r '.tag_name' | sed 's/^v//')
RUNNER_DIR="/home/${VM_ADMIN}/actions-runner"
mkdir -p "\$RUNNER_DIR"
cd "\$RUNNER_DIR"
curl -sL "https://github.com/actions/runner/releases/download/v\${RUNNER_VERSION}/actions-runner-linux-x64-\${RUNNER_VERSION}.tar.gz" | tar xz
chown -R ${VM_ADMIN}:${VM_ADMIN} "\$RUNNER_DIR"

echo "=== Configuring runner ==="
su - ${VM_ADMIN} -c "cd \$RUNNER_DIR && ./config.sh --url https://github.com/${GITHUB_OWNER}/${GITHUB_REPO} --token ${REG_TOKEN} --name ${VM_NAME} --labels self-hosted,linux,x64,azure --unattended --replace"

echo "=== Installing runner as service ==="
cd "\$RUNNER_DIR"
./svc.sh install ${VM_ADMIN}
./svc.sh start

echo "=== Runner setup complete ==="
ENDINIT

az vm create \
  --name "$VM_NAME" \
  --resource-group "$RG" \
  --location "$LOCATION" \
  --image "$VM_IMAGE" \
  --size "$VM_SIZE" \
  --admin-username "$VM_ADMIN" \
  --generate-ssh-keys \
  --vnet-name "$VNET_NAME" \
  --subnet "$SUBNET_RUNNER" \
  --public-ip-address "" \
  --nsg "${VM_NAME}NSG" \
  --assign-identity '[system]' \
  --custom-data "$CLOUD_INIT_FILE" \
  --output none

rm -f "$CLOUD_INIT_FILE"
success "VM '$VM_NAME' created (no public IP, zero trust)"

# Remove default SSH allow rule from NSG
if az network nsg rule show --nsg-name "${VM_NAME}NSG" --resource-group "$RG" --name default-allow-ssh -o none 2>/dev/null; then
  az network nsg rule delete --nsg-name "${VM_NAME}NSG" --resource-group "$RG" --name default-allow-ssh
  success "SSH inbound rule deleted"
fi
success "NSG locked down — all inbound denied"

# Assign Storage Blob Data Contributor to the VM managed identity
VM_IDENTITY=$(az vm show --name "$VM_NAME" --resource-group "$RG" --query "identity.principalId" -o tsv)
SUB_ID=$(az account show --query id -o tsv)
STORAGE_SCOPE="/subscriptions/$SUB_ID/resourceGroups/$RG/providers/Microsoft.Storage/storageAccounts/$STORAGE"
az role assignment create \
  --assignee-object-id "$VM_IDENTITY" \
  --assignee-principal-type ServicePrincipal \
  --role "Storage Blob Data Contributor" \
  --scope "$STORAGE_SCOPE" \
  --output none
success "Storage Blob Data Contributor assigned to VM managed identity"

# ── Wait for runner to come online ─────────────────────────────────────────────

header "Waiting for runner to come online"

info "Cloud-init provisioning takes ~3 minutes..."
for attempt in $(seq 1 30); do
  STATUS=$(curl -sf \
    -H "Authorization: token $PAT" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/actions/runners" \
    | jq -r ".runners[] | select(.name == \"$VM_NAME\") | .status") || true

  if [[ "$STATUS" == "online" ]]; then
    success "Runner '$VM_NAME' is online (attempt $attempt)"
    break
  fi
  echo "  Attempt $attempt/30 — status: ${STATUS:-not registered yet}. Waiting 15s..."
  sleep 15
done

if [[ "$STATUS" != "online" ]]; then
  fail "Runner did not come online after 30 attempts (~7.5 min). Check cloud-init log:
  az vm run-command create --name debug --vm-name $VM_NAME --resource-group $RG --location $LOCATION --script 'cat /var/log/runner-setup.log' --async-execution false --query instanceView.output -o tsv"
fi

# ── Output ─────────────────────────────────────────────────────────────────────

header "Setup Complete"

echo ""
echo "  Runner: $VM_NAME (online)"
echo "  VNet: $VNET_NAME ($LOCATION)"
echo "  Storage: $STORAGE — access via private endpoint"
echo "  Public IP: none (zero trust)"
echo "  NSG: all inbound denied"
echo ""
echo "  Runner page: https://github.com/$GITHUB_OWNER/$GITHUB_REPO/settings/actions/runners"
