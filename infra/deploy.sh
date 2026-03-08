#!/usr/bin/env bash
# EP Cube Graph — Azure Deployment Script
# Deploys all Azure infrastructure and the API service in one command.
#
# Usage:
#   ./deploy.sh              # Full deploy: infra + API build + push
#   ./deploy.sh --plan       # Show what Terraform would change
#   ./deploy.sh --output     # Show deployment outputs (endpoints, token)
#   ./deploy.sh --api-only   # Rebuild and redeploy only the API image
#   ./deploy.sh --destroy    # Tear down all Azure resources

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# -- Colours (suppressed if not a terminal) ------------------------------------
if [[ -t 1 ]]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
  BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; NC=''
fi

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die()   { error "$@"; exit 1; }

# -- Pre-flight checks --------------------------------------------------------

require_tools() {
  local missing=0
  for cmd in terraform az docker; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      error "'$cmd' is not installed."
      ((missing++))
    fi
  done
  ((missing == 0)) || die "Install missing tools and try again."
  ok "Required tools found: terraform, az, docker"
}

require_azure_login() {
  if ! az account show >/dev/null 2>&1; then
    info "Not logged in to Azure. Launching login..."
    az login
  fi

  local account
  account=$(az account show --query "{name:name, id:id, tenantId:tenantId}" -o tsv)
  ok "Azure account: $account"
}

require_tfvars() {
  if [[ ! -f "$SCRIPT_DIR/terraform.tfvars" ]]; then
    if [[ -f "$SCRIPT_DIR/terraform.tfvars.example" ]]; then
      warn "terraform.tfvars not found. Copying from terraform.tfvars.example..."
      cp "$SCRIPT_DIR/terraform.tfvars.example" "$SCRIPT_DIR/terraform.tfvars"
      warn "Review $SCRIPT_DIR/terraform.tfvars, then re-run."
      exit 1
    else
      die "terraform.tfvars not found and no example available."
    fi
  fi
  ok "terraform.tfvars found"
}

# -- Terraform helpers ---------------------------------------------------------

tf_init() {
  info "Initializing Terraform..."
  cd "$SCRIPT_DIR"
  terraform init -upgrade -input=false
  ok "Terraform initialized"
}

tf_apply() {
  info "Applying Terraform configuration..."
  cd "$SCRIPT_DIR"
  terraform apply -auto-approve -input=false "$@"
  ok "Terraform apply complete"
}

tf_output() {
  cd "$SCRIPT_DIR"
  terraform output "$@"
}

# -- API image build & push ----------------------------------------------------

build_and_push_api() {
  local acr_name acr_login_server image_tag api_image

  acr_name=$(tf_output -raw acr_name)
  acr_login_server=$(tf_output -raw acr_login_server)
  image_tag=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null) \
    || die "Cannot determine git commit SHA. Refusing to build without a deterministic tag."
  api_image="${acr_login_server}/epcubegraph-api:${image_tag}"

  info "Logging in to ACR: ${acr_name}..."
  az acr login --name "$acr_name"

  info "Building API image: ${api_image}..."
  docker build \
    --tag "$api_image" \
    --file "$REPO_ROOT/api/Dockerfile" \
    "$REPO_ROOT/api"

  info "Pushing API image..."
  docker push "$api_image"

  ok "API image pushed: ${api_image}"

  # Persist the image reference for subsequent terraform applies
  echo "api_image = \"${api_image}\"" > "$SCRIPT_DIR/deploy.auto.tfvars"
  echo "$api_image"
}

# -- Commands ------------------------------------------------------------------

cmd_deploy() {
  info "Deploying EP Cube Graph to Azure..."
  echo ""

  require_tools
  require_azure_login
  require_tfvars

  # Phase 1: Create all infrastructure (ACR, Container Apps, Entra ID, Key Vault)
  # API container app is skipped because api_image is empty on first deploy
  tf_init
  tf_apply

  # Phase 2: Build API image and push to ACR
  echo ""
  info "Building and pushing API container image..."
  local api_image
  api_image=$(build_and_push_api)

  # Phase 3: Deploy API container app with the built image
  echo ""
  info "Deploying API container app..."
  tf_apply

  echo ""
  cmd_output_summary
}

cmd_api_only() {
  info "Rebuilding and redeploying API only..."

  require_tools
  require_azure_login

  cd "$SCRIPT_DIR"
  if ! terraform output acr_name >/dev/null 2>&1; then
    die "Infrastructure not deployed yet. Run './deploy.sh' first."
  fi

  build_and_push_api
  tf_apply

  echo ""
  cmd_output_summary
}

cmd_plan() {
  require_tools
  require_azure_login
  require_tfvars
  tf_init

  info "Planning Terraform changes..."
  cd "$SCRIPT_DIR"
  terraform plan -input=false
}

cmd_destroy() {
  require_tools
  require_azure_login

  warn "This will DESTROY all Azure resources for EP Cube Graph."
  read -rp "Type 'destroy' to confirm: " confirm
  if [[ "${confirm}" != "destroy" ]]; then
    info "Cancelled."
    exit 0
  fi

  cd "$SCRIPT_DIR"
  terraform destroy -auto-approve
  rm -f "$SCRIPT_DIR/deploy.auto.tfvars"
  ok "All Azure resources destroyed"
}

cmd_output() {
  cd "$SCRIPT_DIR"
  terraform output
}

cmd_output_summary() {
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  EP Cube Graph — Deployment Complete${NC}"
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  echo ""

  local vm_fqdn api_fqdn remote_write_url

  vm_fqdn=$(tf_output -raw vm_fqdn 2>/dev/null || echo "pending")
  api_fqdn=$(tf_output -raw api_fqdn 2>/dev/null || echo "not deployed")
  remote_write_url=$(tf_output -raw remote_write_url 2>/dev/null || echo "pending")

  echo -e "  ${BOLD}Endpoints:${NC}"
  echo -e "    VictoriaMetrics:  https://${vm_fqdn}"
  echo -e "    API:              https://${api_fqdn}"
  echo ""
  echo -e "  ${BOLD}For local/.env:${NC}"
  echo -e "    REMOTE_WRITE_URL=${remote_write_url}"
  echo -e "    REMOTE_WRITE_TOKEN=$(tf_output -raw remote_write_token 2>/dev/null || echo '<run: terraform output -raw remote_write_token>')"
  echo ""
  echo -e "  ${BOLD}Entra ID:${NC}"
  echo -e "    Tenant ID:  $(tf_output -raw entra_tenant_id 2>/dev/null || echo 'pending')"
  echo -e "    Client ID:  $(tf_output -raw entra_app_client_id 2>/dev/null || echo 'pending')"
  echo ""
  echo -e "  Run ${BOLD}terraform output -raw remote_write_token${NC} to retrieve the bearer token."
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
}

# -- Entrypoint ----------------------------------------------------------------

case "${1:-}" in
  --plan|-p)       cmd_plan      ;;
  --output|-o)     cmd_output    ;;
  --api-only|-a)   cmd_api_only  ;;
  --destroy)       cmd_destroy   ;;
  --help|-h)
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  (none)       Full deploy: infrastructure + API build + push"
    echo "  --plan       Show what Terraform would change"
    echo "  --output     Show deployment outputs (endpoints, token)"
    echo "  --api-only   Rebuild and redeploy only the API container"
    echo "  --destroy    Tear down all Azure resources"
    echo "  --help       Show this help message"
    ;;
  "")              cmd_deploy    ;;
  *)               die "Unknown command: $1 (try --help)" ;;
esac
