#!/usr/bin/env bash
# setup-azure-cd.sh — Provision Azure OIDC identity and Terraform state storage for GitHub Actions CD
#
# This script automates the one-time Azure setup required for the CD pipeline:
#   1. Registers required Azure resource providers
#   2. Creates a Terraform remote state storage account
#   3. Creates an Entra ID app registration with OIDC federated credentials
#   4. Assigns roles (Contributor, User Access Administrator, Storage Blob Data Contributor)
#   5. Configures GitHub repository secrets (requires `gh` CLI)
#
# Prerequisites:
#   - Azure CLI (`az`) logged in with Owner or Contributor + User Access Administrator
#   - GitHub CLI (`gh`) authenticated (for --github flag)
#
# Usage:
#   ./scripts/setup-azure-cd.sh                          # Azure setup only
#   ./scripts/setup-azure-cd.sh --github                 # Azure + GitHub secrets
#   ./scripts/setup-azure-cd.sh --github --repo owner/repo  # Specify repo
#   ./scripts/setup-azure-cd.sh --dry-run                # Show what would be done
#   ./scripts/setup-azure-cd.sh --teardown               # Remove everything created

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────

APP_NAME="epcubegraph-github-actions"
TFSTATE_RG="tfstate-rg"
TFSTATE_STORAGE="tfstateepcubegraph"
TFSTATE_CONTAINER="tfstate"
LOCATION="eastus"

# GitHub repo — auto-detected from git remote, or override with --repo
GITHUB_REPO=""

# Resource providers required by Terraform
REQUIRED_PROVIDERS=(
  Microsoft.App
  Microsoft.ContainerRegistry
  Microsoft.KeyVault
  Microsoft.ManagedIdentity
  Microsoft.OperationalInsights
  Microsoft.Storage
)

# ── Argument Parsing ──────────────────────────────────────────────────────────

SETUP_GITHUB=false
DRY_RUN=false
TEARDOWN=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --github)    SETUP_GITHUB=true; shift ;;
    --repo)      GITHUB_REPO="$2"; shift 2 ;;
    --dry-run)   DRY_RUN=true; shift ;;
    --teardown)  TEARDOWN=true; shift ;;
    -h|--help)
      echo "Usage: $0 [--github] [--repo owner/repo] [--dry-run] [--teardown]"
      echo ""
      echo "Options:"
      echo "  --github     Also configure GitHub repository secrets (requires gh CLI)"
      echo "  --repo       GitHub repo (default: auto-detect from git remote)"
      echo "  --dry-run    Show what would be done without making changes"
      echo "  --teardown   Remove all resources created by this script"
      echo "  -h, --help   Show this help message"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Helpers ────────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}▸${NC} $*"; }
success() { echo -e "${GREEN}✓${NC} $*"; }
warn()    { echo -e "${YELLOW}⚠${NC} $*"; }
error()   { echo -e "${RED}✗${NC} $*" >&2; }
header()  { echo -e "\n${BOLD}═══ $* ═══${NC}"; }

run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${YELLOW}[dry-run]${NC} $*"
  else
    "$@"
  fi
}

# ── Preflight Checks ──────────────────────────────────────────────────────────

header "Preflight Checks"

# Verify Azure CLI
if ! command -v az &>/dev/null; then
  error "Azure CLI (az) is not installed. Install from https://aka.ms/install-azure-cli"
  exit 1
fi
success "Azure CLI found"

# Verify logged in
if ! az account show &>/dev/null; then
  error "Not logged in to Azure. Run: az login"
  exit 1
fi

SUBSCRIPTION_ID=$(az account show --query id -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)
SUBSCRIPTION_NAME=$(az account show --query name -o tsv)

success "Logged in to Azure"
info "  Tenant:       $TENANT_ID"
info "  Subscription: $SUBSCRIPTION_ID ($SUBSCRIPTION_NAME)"

# Verify GitHub CLI (if needed)
if [[ "$SETUP_GITHUB" == "true" ]]; then
  if ! command -v gh &>/dev/null; then
    error "GitHub CLI (gh) is not installed. Install from https://cli.github.com"
    exit 1
  fi
  if ! gh auth status &>/dev/null; then
    error "Not logged in to GitHub. Run: gh auth login"
    exit 1
  fi
  success "GitHub CLI authenticated"
fi

# Detect GitHub repo
if [[ -z "$GITHUB_REPO" ]]; then
  GITHUB_REPO=$(git remote get-url origin 2>/dev/null | sed -E 's#.*github\.com[:/](.+)(\.git)?$#\1#' | sed 's/\.git$//')
  if [[ -z "$GITHUB_REPO" ]]; then
    error "Could not detect GitHub repo. Use --repo owner/repo"
    exit 1
  fi
fi
info "  GitHub repo:  $GITHUB_REPO"

# ── Teardown ───────────────────────────────────────────────────────────────────

if [[ "$TEARDOWN" == "true" ]]; then
  header "Teardown"
  warn "This will remove all CD infrastructure. Terraform state will be LOST."
  echo ""
  read -rp "Type 'yes' to confirm teardown: " CONFIRM
  if [[ "$CONFIRM" != "yes" ]]; then
    echo "Aborted."
    exit 0
  fi

  # Remove role assignments
  APP_ID=$(az ad app list --display-name "$APP_NAME" --query '[0].appId' -o tsv 2>/dev/null || true)
  if [[ -n "$APP_ID" ]]; then
    info "Removing role assignments for $APP_ID..."
    SUB_SCOPE="/subscriptions/$SUBSCRIPTION_ID"
    STORAGE_SCOPE="$SUB_SCOPE/resourceGroups/$TFSTATE_RG/providers/Microsoft.Storage/storageAccounts/$TFSTATE_STORAGE"

    for ROLE in "Contributor" "User Access Administrator"; do
      run az role assignment delete --assignee "$APP_ID" --role "$ROLE" --scope "$SUB_SCOPE" 2>/dev/null || true
    done
    run az role assignment delete --assignee "$APP_ID" --role "Storage Blob Data Contributor" --scope "$STORAGE_SCOPE" 2>/dev/null || true
    success "Role assignments removed"

    # Remove app registration (cascades federated credentials + service principal)
    APP_OBJECT_ID=$(az ad app list --display-name "$APP_NAME" --query '[0].id' -o tsv 2>/dev/null || true)
    if [[ -n "$APP_OBJECT_ID" ]]; then
      info "Deleting app registration $APP_NAME..."
      run az ad app delete --id "$APP_OBJECT_ID"
      success "App registration deleted"
    fi
  else
    warn "App registration '$APP_NAME' not found — skipping"
  fi

  # Remove storage account + resource group
  if az group show --name "$TFSTATE_RG" &>/dev/null; then
    info "Deleting resource group $TFSTATE_RG (contains tfstate storage)..."
    run az group delete --name "$TFSTATE_RG" --yes --no-wait
    success "Resource group deletion initiated (runs in background)"
  else
    warn "Resource group '$TFSTATE_RG' not found — skipping"
  fi

  # Remove GitHub secrets
  if [[ "$SETUP_GITHUB" == "true" ]]; then
    info "Removing GitHub secrets..."
    for SECRET in AZURE_CLIENT_ID AZURE_TENANT_ID AZURE_SUBSCRIPTION_ID EPCUBE_USERNAME EPCUBE_PASSWORD; do
      run gh secret delete "$SECRET" --repo "$GITHUB_REPO" 2>/dev/null || true
    done
    success "GitHub secrets removed"
  fi

  echo ""
  success "Teardown complete"
  exit 0
fi

# ── Step 1: Register Resource Providers ────────────────────────────────────────

header "Step 1: Register Resource Providers"

for PROVIDER in "${REQUIRED_PROVIDERS[@]}"; do
  STATE=$(az provider show --namespace "$PROVIDER" --query "registrationState" -o tsv 2>/dev/null || echo "NotRegistered")
  if [[ "$STATE" == "Registered" ]]; then
    success "$PROVIDER (already registered)"
  else
    info "Registering $PROVIDER..."
    run az provider register --namespace "$PROVIDER" --wait
    success "$PROVIDER"
  fi
done

# ── Step 2: Create Terraform State Storage ─────────────────────────────────────

header "Step 2: Terraform State Storage"

# Resource group
if az group show --name "$TFSTATE_RG" &>/dev/null; then
  success "Resource group '$TFSTATE_RG' already exists"
else
  info "Creating resource group '$TFSTATE_RG'..."
  run az group create --name "$TFSTATE_RG" --location "$LOCATION" --output none
  success "Resource group '$TFSTATE_RG' created"
fi

# Storage account
if az storage account show --name "$TFSTATE_STORAGE" --resource-group "$TFSTATE_RG" &>/dev/null; then
  success "Storage account '$TFSTATE_STORAGE' already exists"
else
  info "Creating storage account '$TFSTATE_STORAGE'..."
  run az storage account create \
    --name "$TFSTATE_STORAGE" \
    --resource-group "$TFSTATE_RG" \
    --location "$LOCATION" \
    --sku Standard_LRS \
    --allow-blob-public-access false \
    --allow-shared-key-access true \
    --output none
  success "Storage account '$TFSTATE_STORAGE' created"
fi

# Blob container
CONTAINER_EXISTS=$(az storage container exists \
  --name "$TFSTATE_CONTAINER" \
  --account-name "$TFSTATE_STORAGE" \
  --auth-mode login \
  --query exists -o tsv 2>/dev/null || echo "false")

if [[ "$CONTAINER_EXISTS" == "true" ]]; then
  success "Blob container '$TFSTATE_CONTAINER' already exists"
else
  info "Creating blob container '$TFSTATE_CONTAINER'..."
  run az storage container create \
    --name "$TFSTATE_CONTAINER" \
    --account-name "$TFSTATE_STORAGE" \
    --auth-mode login \
    --output none
  success "Blob container '$TFSTATE_CONTAINER' created"
fi

# ── Step 3: Create App Registration + Service Principal ────────────────────────

header "Step 3: App Registration (OIDC)"

# Check if app already exists
EXISTING_APP_ID=$(az ad app list --display-name "$APP_NAME" --query '[0].appId' -o tsv 2>/dev/null || true)

if [[ -n "$EXISTING_APP_ID" ]]; then
  APP_ID="$EXISTING_APP_ID"
  success "App registration '$APP_NAME' already exists (appId: $APP_ID)"
else
  info "Creating app registration '$APP_NAME'..."
  if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${YELLOW}[dry-run]${NC} az ad app create --display-name $APP_NAME"
    APP_ID="<dry-run-app-id>"
  else
    APP_ID=$(az ad app create --display-name "$APP_NAME" --query appId -o tsv)
  fi
  success "App registration created (appId: $APP_ID)"
fi

# Service principal
SP_EXISTS=$(az ad sp show --id "$APP_ID" --query appId -o tsv 2>/dev/null || true)
if [[ -n "$SP_EXISTS" ]]; then
  success "Service principal already exists"
else
  info "Creating service principal..."
  run az ad sp create --id "$APP_ID" --output none
  success "Service principal created"
fi

# ── Step 4: Federated Credentials ──────────────────────────────────────────────

header "Step 4: Federated Credentials"

APP_OBJECT_ID=$(az ad app list --display-name "$APP_NAME" --query '[0].id' -o tsv)

# Credential name=subject pairs (bash 3 compatible)
CRED_NAMES=(
  "github-actions-main"
  "github-actions-feature-branch"
  "github-actions-staging"
  "github-actions-production"
)
CRED_SUBJECTS=(
  "repo:${GITHUB_REPO}:ref:refs/heads/main"
  "repo:${GITHUB_REPO}:ref:refs/heads/001-data-ingestor"
  "repo:${GITHUB_REPO}:environment:staging"
  "repo:${GITHUB_REPO}:environment:production"
)

for i in "${!CRED_NAMES[@]}"; do
  CRED_NAME="${CRED_NAMES[$i]}"
  SUBJECT="${CRED_SUBJECTS[$i]}"
  # Check if credential already exists
  EXISTS=$(az ad app federated-credential list --id "$APP_OBJECT_ID" --query "[?name=='$CRED_NAME'].name" -o tsv 2>/dev/null || true)
  if [[ -n "$EXISTS" ]]; then
    success "$CRED_NAME (already exists)"
  else
    info "Creating federated credential '$CRED_NAME'..."
    run az ad app federated-credential create --id "$APP_OBJECT_ID" --parameters "{
      \"name\": \"$CRED_NAME\",
      \"issuer\": \"https://token.actions.githubusercontent.com\",
      \"subject\": \"$SUBJECT\",
      \"audiences\": [\"api://AzureADTokenExchange\"]
    }"
    success "$CRED_NAME → $SUBJECT"
  fi
done

# ── Step 5: Role Assignments ──────────────────────────────────────────────────

header "Step 5: Role Assignments"

SUB_SCOPE="/subscriptions/$SUBSCRIPTION_ID"
STORAGE_SCOPE="$SUB_SCOPE/resourceGroups/$TFSTATE_RG/providers/Microsoft.Storage/storageAccounts/$TFSTATE_STORAGE"

assign_role() {
  local ROLE="$1"
  local SCOPE="$2"
  local SCOPE_DESC="$3"

  EXISTING=$(az role assignment list --assignee "$APP_ID" --role "$ROLE" --scope "$SCOPE" --query '[0].id' -o tsv 2>/dev/null || true)
  if [[ -n "$EXISTING" ]]; then
    success "$ROLE on $SCOPE_DESC (already assigned)"
  else
    info "Assigning $ROLE on $SCOPE_DESC..."
    run az role assignment create \
      --assignee "$APP_ID" \
      --role "$ROLE" \
      --scope "$SCOPE" \
      --output none
    success "$ROLE on $SCOPE_DESC"
  fi
}

assign_role "Contributor" "$SUB_SCOPE" "subscription"
assign_role "User Access Administrator" "$SUB_SCOPE" "subscription"
assign_role "Storage Blob Data Contributor" "$STORAGE_SCOPE" "tfstate storage"

# ── Step 6: GitHub Secrets ─────────────────────────────────────────────────────

if [[ "$SETUP_GITHUB" == "true" ]]; then
  header "Step 6: GitHub Secrets"

  info "Setting AZURE_CLIENT_ID..."
  run gh secret set AZURE_CLIENT_ID --repo "$GITHUB_REPO" --body "$APP_ID"
  success "AZURE_CLIENT_ID"

  info "Setting AZURE_TENANT_ID..."
  run gh secret set AZURE_TENANT_ID --repo "$GITHUB_REPO" --body "$TENANT_ID"
  success "AZURE_TENANT_ID"

  info "Setting AZURE_SUBSCRIPTION_ID..."
  run gh secret set AZURE_SUBSCRIPTION_ID --repo "$GITHUB_REPO" --body "$SUBSCRIPTION_ID"
  success "AZURE_SUBSCRIPTION_ID"

  # Prompt for EP Cube credentials (not echoed)
  echo ""
  read -rp "EP Cube username (monitoring-us.epcube.com email): " EPCUBE_USER
  if [[ -n "$EPCUBE_USER" ]]; then
    run gh secret set EPCUBE_USERNAME --repo "$GITHUB_REPO" --body "$EPCUBE_USER"
    success "EPCUBE_USERNAME"
  else
    warn "Skipped EPCUBE_USERNAME (empty)"
  fi

  read -rsp "EP Cube password: " EPCUBE_PASS
  echo ""
  if [[ -n "$EPCUBE_PASS" ]]; then
    run gh secret set EPCUBE_PASSWORD --repo "$GITHUB_REPO" --body "$EPCUBE_PASS"
    success "EPCUBE_PASSWORD"
  else
    warn "Skipped EPCUBE_PASSWORD (empty)"
  fi
fi

# ── Summary ────────────────────────────────────────────────────────────────────

header "Setup Complete"

echo ""
echo -e "  ${BOLD}App Registration${NC}"
echo -e "    Name:            $APP_NAME"
echo -e "    Client ID:       $APP_ID"
echo -e "    Tenant ID:       $TENANT_ID"
echo -e "    Subscription ID: $SUBSCRIPTION_ID"
echo ""
echo -e "  ${BOLD}Terraform State${NC}"
echo -e "    Resource Group:  $TFSTATE_RG"
echo -e "    Storage Account: $TFSTATE_STORAGE"
echo -e "    Container:       $TFSTATE_CONTAINER"
echo ""
echo -e "  ${BOLD}Roles Assigned${NC}"
echo -e "    Contributor                 → subscription"
echo -e "    User Access Administrator   → subscription"
echo -e "    Storage Blob Data Contributor → $TFSTATE_STORAGE"
echo ""
echo -e "  ${BOLD}Federated Credentials${NC}"
for i in "${!CRED_NAMES[@]}"; do
  echo -e "    ${CRED_NAMES[$i]} → ${CRED_SUBJECTS[$i]}"
done
echo ""

if [[ "$SETUP_GITHUB" != "true" ]]; then
  echo -e "  ${YELLOW}Next step:${NC} Configure GitHub secrets manually, or re-run with --github:"
  echo ""
  echo "    $0 --github"
  echo ""
  echo "  Required secrets:"
  echo "    AZURE_CLIENT_ID       = $APP_ID"
  echo "    AZURE_TENANT_ID       = $TENANT_ID"
  echo "    AZURE_SUBSCRIPTION_ID = $SUBSCRIPTION_ID"
  echo "    EPCUBE_USERNAME       = <your EP Cube email>"
  echo "    EPCUBE_PASSWORD       = <your EP Cube password>"
  echo ""
fi
