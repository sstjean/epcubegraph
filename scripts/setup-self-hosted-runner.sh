#!/usr/bin/env bash
# setup-self-hosted-runner.sh — Provision self-hosted GitHub Actions runner with
# private endpoint access to tfstate storage and per-environment Key Vaults.
#
# Eliminates the publicNetworkAccess toggle that causes CD firewall timeout
# failures. SFI can enforce Disabled permanently on both storage and KV.
#
# What this script creates (all in tfstate-rg / centralus):
#   1. VNet with subnets for private endpoints and runner VM
#   2. Private endpoint for tfstate blob + private DNS zone
#   3. Private DNS zone for Key Vault (linked to runner VNet; per-env KV PEs
#      are created by Terraform using runner_pe_subnet_id variable)
#   4. Ubuntu 24.04 B2s VM with managed identity + GitHub runner agent
#   5. Role assignments: Storage Blob Data Contributor on tfstate
#
# Idempotent — safe to re-run. Skips resources that already exist.
#
# Prerequisites:
#   - Azure CLI logged in with Owner on the subscription
#   - GitHub fine-grained PAT with Administration:Read+Write on the repo
#   - Storage account already in centralus (run setup-tfstate-migration.sh first if needed)
#
# Usage:
#   ./scripts/setup-self-hosted-runner.sh --pat <GITHUB_PAT>
#   ./scripts/setup-self-hosted-runner.sh --teardown

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────

LOCATION="centralus"
RG="tfstate-rg"
STORAGE="tfstateepcubegraph"
STORAGE_CONTAINER="tfstate"

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
TEARDOWN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pat) PAT="$2"; shift 2 ;;
    --teardown) TEARDOWN=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Helpers ────────────────────────────────────────────────────────────────────

info()    { echo -e "\033[0;36m  ℹ $*\033[0m"; }
success() { echo -e "\033[0;32m  ✓ $*\033[0m"; }
warn()    { echo -e "\033[0;33m  ⚠ $*\033[0m"; }
fail()    { echo -e "\033[0;31m  ✗ $*\033[0m"; exit 1; }
header()  { echo -e "\n\033[1;35m── $* ──\033[0m"; }

# ── Teardown ───────────────────────────────────────────────────────────────────

if $TEARDOWN; then
  header "Tearing down self-hosted runner infrastructure"
  echo "This will delete: VM, VNet, private endpoints, DNS zones."
  echo "It will NOT delete the storage account or state blobs."
  read -rp "Continue? (yes/no): " confirm
  [[ "$confirm" == "yes" ]] || exit 0

  az vm delete --name "$VM_NAME" --resource-group "$RG" --yes --force-deletion none 2>/dev/null || true
  success "VM deleted"
  az network nic delete --name "${VM_NAME}VMNic" --resource-group "$RG" 2>/dev/null || true
  az network nsg delete --name "${VM_NAME}NSG" --resource-group "$RG" 2>/dev/null || true
  az disk list --resource-group "$RG" --query "[?starts_with(name, '${VM_NAME}')].name" -o tsv | \
    xargs -I{} az disk delete --name {} --resource-group "$RG" --yes 2>/dev/null || true
  success "VM resources cleaned up"

  az network private-endpoint delete --name "${STORAGE}-blob-pe" --resource-group "$RG" 2>/dev/null || true
  success "Blob private endpoint deleted"

  az network private-dns zone delete --name "$BLOB_DNS_ZONE" --resource-group "$RG" --yes 2>/dev/null || true
  az network private-dns zone delete --name "$VAULT_DNS_ZONE" --resource-group "$RG" --yes 2>/dev/null || true
  success "DNS zones deleted"

  az network vnet delete --name "$VNET_NAME" --resource-group "$RG" 2>/dev/null || true
  success "VNet deleted"

  echo ""
  success "Teardown complete. Storage account and state blobs preserved."
  exit 0
fi

# ── Validation ─────────────────────────────────────────────────────────────────

[[ -n "$PAT" ]] || fail "GitHub PAT required: --pat <token>"

header "Validating prerequisites"

az account show --query "{sub:name, id:id}" -o table || fail "Not logged in to Azure CLI"
success "Azure CLI authenticated"

curl -sf -H "Authorization: token $PAT" "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO" -o /dev/null \
  || fail "GitHub PAT cannot access $GITHUB_OWNER/$GITHUB_REPO"
success "GitHub PAT valid for $GITHUB_OWNER/$GITHUB_REPO"

STORAGE_LOCATION=$(az storage account show --name "$STORAGE" --resource-group "$RG" --query location -o tsv 2>/dev/null) \
  || fail "Storage account '$STORAGE' not found. Run setup-tfstate-migration.sh first."
[[ "$STORAGE_LOCATION" == "$LOCATION" ]] \
  || fail "Storage account is in '$STORAGE_LOCATION', expected '$LOCATION'. Run setup-tfstate-migration.sh first."
success "Storage account '$STORAGE' is in $LOCATION"

# ── VNet ───────────────────────────────────────────────────────────────────────

header "Creating VNet and subnets"

if az network vnet show --name "$VNET_NAME" --resource-group "$RG" -o none 2>/dev/null; then
  info "VNet '$VNET_NAME' already exists"
else
  az network vnet create \
    --name "$VNET_NAME" \
    --resource-group "$RG" \
    --location "$LOCATION" \
    --address-prefix "$VNET_CIDR" \
    --output none
  success "VNet '$VNET_NAME' created"
fi

for SUBNET_INFO in "$SUBNET_ENDPOINTS:$SUBNET_ENDPOINTS_CIDR" "$SUBNET_RUNNER:$SUBNET_RUNNER_CIDR"; do
  SNAME="${SUBNET_INFO%%:*}"
  SCIDR="${SUBNET_INFO##*:}"
  if az network vnet subnet show --name "$SNAME" --vnet-name "$VNET_NAME" --resource-group "$RG" -o none 2>/dev/null; then
    info "Subnet '$SNAME' already exists"
  else
    az network vnet subnet create \
      --name "$SNAME" \
      --vnet-name "$VNET_NAME" \
      --resource-group "$RG" \
      --address-prefixes "$SCIDR" \
      --output none
    success "Subnet '$SNAME' ($SCIDR) created"
  fi
done

# ── Private DNS Zones ──────────────────────────────────────────────────────────

header "Creating private DNS zones"

for ZONE in "$BLOB_DNS_ZONE" "$VAULT_DNS_ZONE"; do
  if az network private-dns zone show --name "$ZONE" --resource-group "$RG" -o none 2>/dev/null; then
    info "DNS zone '$ZONE' already exists"
  else
    az network private-dns zone create --name "$ZONE" --resource-group "$RG" --output none
    success "DNS zone '$ZONE' created"
  fi

  LINK_NAME="${ZONE//./-}-link"
  if az network private-dns link vnet show --name "$LINK_NAME" --zone-name "$ZONE" --resource-group "$RG" -o none 2>/dev/null; then
    info "VNet link for '$ZONE' already exists"
  else
    VNET_ID=$(az network vnet show --name "$VNET_NAME" --resource-group "$RG" --query id -o tsv)
    az network private-dns link vnet create \
      --name "$LINK_NAME" \
      --zone-name "$ZONE" \
      --resource-group "$RG" \
      --virtual-network "$VNET_ID" \
      --registration-enabled false \
      --output none
    success "VNet link for '$ZONE' created"
  fi
done

# ── Tfstate Blob Private Endpoint ──────────────────────────────────────────────

header "Creating tfstate blob private endpoint"

PE_NAME="${STORAGE}-blob-pe"
if az network private-endpoint show --name "$PE_NAME" --resource-group "$RG" -o none 2>/dev/null; then
  info "Private endpoint '$PE_NAME' already exists"
else
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
fi

# ── Runner VM ──────────────────────────────────────────────────────────────────

header "Creating self-hosted runner VM"

if az vm show --name "$VM_NAME" --resource-group "$RG" -o none 2>/dev/null; then
  info "VM '$VM_NAME' already exists"
else
  # Get runner registration token from GitHub
  REG_TOKEN=$(curl -sf -X POST \
    -H "Authorization: token $PAT" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/actions/runners/registration-token" \
    | jq -r '.token') || fail "Failed to get runner registration token"
  [[ -n "$REG_TOKEN" && "$REG_TOKEN" != "null" ]] || fail "Runner registration token is empty"
  success "Got GitHub runner registration token"

  # Cloud-init script for VM provisioning
  CLOUD_INIT=$(cat <<'CLOUD_INIT_EOF'
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
echo "deb [signed-by=/usr/share/keyrings/hashicorp.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" > /etc/apt/sources.list.d/hashicorp.list
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
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin
usermod -aG docker __ADMIN_USER__

echo "=== Installing GitHub Actions Runner ==="
RUNNER_VERSION=$(curl -sf https://api.github.com/repos/actions/runner/releases/latest | jq -r '.tag_name' | sed 's/^v//')
RUNNER_DIR="/home/__ADMIN_USER__/actions-runner"
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"
curl -sL "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" | tar xz
chown -R __ADMIN_USER__:__ADMIN_USER__ "$RUNNER_DIR"

echo "=== Configuring runner ==="
su - __ADMIN_USER__ -c "cd $RUNNER_DIR && ./config.sh --url https://github.com/__OWNER__/__REPO__ --token __REG_TOKEN__ --name __VM_NAME__ --labels self-hosted,linux,x64,azure --unattended --replace"

echo "=== Installing runner as service ==="
cd "$RUNNER_DIR"
./svc.sh install __ADMIN_USER__
./svc.sh start

echo "=== Runner setup complete ==="
CLOUD_INIT_EOF
  )

  # Substitute variables into cloud-init
  CLOUD_INIT="${CLOUD_INIT//__ADMIN_USER__/$VM_ADMIN}"
  CLOUD_INIT="${CLOUD_INIT//__OWNER__/$GITHUB_OWNER}"
  CLOUD_INIT="${CLOUD_INIT//__REPO__/$GITHUB_REPO}"
  CLOUD_INIT="${CLOUD_INIT//__REG_TOKEN__/$REG_TOKEN}"
  CLOUD_INIT="${CLOUD_INIT//__VM_NAME__/$VM_NAME}"

  CLOUD_INIT_FILE=$(mktemp)
  echo "$CLOUD_INIT" > "$CLOUD_INIT_FILE"

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
  success "VM '$VM_NAME' created with cloud-init provisioning"

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
fi

# ── Output ─────────────────────────────────────────────────────────────────────

header "Setup Complete"

PE_SUBNET_ID=$(az network vnet subnet show --name "$SUBNET_ENDPOINTS" --vnet-name "$VNET_NAME" --resource-group "$RG" --query id -o tsv)
VAULT_DNS_ZONE_ID=$(az network private-dns zone show --name "$VAULT_DNS_ZONE" --resource-group "$RG" --query id -o tsv)

echo ""
echo "Runner VM: $VM_NAME"
echo "VNet: $VNET_NAME ($LOCATION)"
echo "Storage: $STORAGE ($LOCATION) — access via private endpoint"
echo ""
echo "Add these Terraform variables to cd.yml env blocks:"
echo "  TF_VAR_runner_pe_subnet_id: '$PE_SUBNET_ID'"
echo "  TF_VAR_runner_kv_dns_zone_id: '$VAULT_DNS_ZONE_ID'"
echo ""
echo "Cloud-init provisioning takes ~5 minutes. Check progress:"
echo "  az vm run-command invoke --name $VM_NAME --resource-group $RG --command-id RunShellCommand --scripts 'tail -20 /var/log/runner-setup.log'"
echo ""
echo "Verify runner is online:"
echo "  https://github.com/$GITHUB_OWNER/$GITHUB_REPO/settings/actions/runners"
SUBNET_ENDPOINTS="endpoints"
