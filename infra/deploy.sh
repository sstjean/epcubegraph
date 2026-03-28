#!/usr/bin/env bash
# EP Cube Graph — Azure Deployment Script
# Deploys all Azure infrastructure and the API service in one command.
#
# Usage:
#   ./deploy.sh              # Full deploy: infra + API build + push
#   ./deploy.sh --plan       # Show what Terraform would change
#   ./deploy.sh --output     # Show deployment outputs (endpoints, token)
#   ./deploy.sh --validate   # Validate deployed resources match Terraform
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

detect_deployer_ip() {
  info "Detecting your public IP for firewall allowlisting..."
  DEPLOYER_IP=$(curl -sf https://api.ipify.org) \
    || die "Cannot detect public IP. Check internet connectivity."
  ok "Public IP: ${DEPLOYER_IP}"
}

tf_var_ip() {
  echo "-var=allowed_ips=[\"${DEPLOYER_IP}\"]"
}

tf_init() {
  info "Initializing Terraform..."
  cd "$SCRIPT_DIR"
  if [[ -f "$SCRIPT_DIR/backend.hcl" ]]; then
    terraform init -upgrade -input=false -backend-config="$SCRIPT_DIR/backend.hcl"
  else
    terraform init -upgrade -input=false
  fi
  ok "Terraform initialized"
}

tf_apply() {
  info "Applying Terraform configuration..."
  cd "$SCRIPT_DIR"
  terraform apply -auto-approve -input=false "$(tf_var_ip)" "$@"
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

  info "Building API image: ${api_image}..."
  docker build \
    --tag "$api_image" \
    --file "$REPO_ROOT/api/Dockerfile" \
    "$REPO_ROOT/api"

  info "Pushing API image..."
  docker push "$api_image"

  ok "API image pushed: ${api_image}"
  echo "$api_image"
}

# -- Exporter image build & push -----------------------------------------------

build_and_push_exporter() {
  local acr_name acr_login_server image_tag epcube_image

  acr_name=$(tf_output -raw acr_name)
  acr_login_server=$(tf_output -raw acr_login_server)
  image_tag=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null) \
    || die "Cannot determine git commit SHA. Refusing to build without a deterministic tag."
  epcube_image="${acr_login_server}/epcube-exporter:${image_tag}"

  info "Building epcube-exporter image: ${epcube_image}..."
  docker build \
    --tag "$epcube_image" \
    --file "$REPO_ROOT/local/epcube-exporter/Dockerfile" \
    "$REPO_ROOT/local/epcube-exporter"

  info "Pushing epcube-exporter image..."
  docker push "$epcube_image"

  ok "Exporter image pushed: ${epcube_image}"
  echo "$epcube_image"
}

# -- Commands ------------------------------------------------------------------

cmd_deploy() {
  info "Deploying EP Cube Graph to Azure..."
  echo ""

  require_tools
  require_azure_login
  require_tfvars
  detect_deployer_ip

  # Phase 1: Create all infrastructure (ACR, Container Apps, Entra ID, Key Vault)
  # Container apps using custom images are skipped on first deploy
  tf_init
  tf_apply

  # Phase 2: Build container images and push to ACR
  echo ""
  local acr_name
  acr_name=$(tf_output -raw acr_name)
  info "Logging in to ACR: ${acr_name}..."
  az acr login --name "$acr_name"

  info "Building and pushing container images..."
  local api_image epcube_image
  api_image=$(build_and_push_api)
  epcube_image=$(build_and_push_exporter)

  # Persist image references for subsequent terraform applies
  cat > "$SCRIPT_DIR/deploy.auto.tfvars" <<EOF
api_image    = "${api_image}"
epcube_image = "${epcube_image}"
EOF

  # Phase 3: Deploy all container apps with the built images
  echo ""
  info "Deploying container apps..."
  tf_apply

  echo ""
  cmd_output_summary
}

cmd_api_only() {
  info "Rebuilding and redeploying API only..."

  require_tools
  require_azure_login
  detect_deployer_ip

  cd "$SCRIPT_DIR"
  if ! terraform output acr_name >/dev/null 2>&1; then
    die "Infrastructure not deployed yet. Run './deploy.sh' first."
  fi

  local acr_name
  acr_name=$(tf_output -raw acr_name)
  az acr login --name "$acr_name"

  local api_image
  api_image=$(build_and_push_api)

  # Update only api_image in deploy.auto.tfvars (preserve other values)
  if [[ -f "$SCRIPT_DIR/deploy.auto.tfvars" ]]; then
    grep -v '^api_image' "$SCRIPT_DIR/deploy.auto.tfvars" > "$SCRIPT_DIR/deploy.auto.tfvars.tmp" \
      && mv "$SCRIPT_DIR/deploy.auto.tfvars.tmp" "$SCRIPT_DIR/deploy.auto.tfvars"
  fi
  echo "api_image = \"${api_image}\"" >> "$SCRIPT_DIR/deploy.auto.tfvars"

  tf_apply

  echo ""
  cmd_output_summary
}

cmd_exporter_only() {
  info "Rebuilding and redeploying epcube-exporter only..."

  require_tools
  require_azure_login
  detect_deployer_ip

  cd "$SCRIPT_DIR"
  if ! terraform output acr_name >/dev/null 2>&1; then
    die "Infrastructure not deployed yet. Run './deploy.sh' first."
  fi

  local acr_name
  acr_name=$(tf_output -raw acr_name)
  az acr login --name "$acr_name"

  local epcube_image
  epcube_image=$(build_and_push_exporter)

  # Update only epcube_image in deploy.auto.tfvars (preserve other values)
  if [[ -f "$SCRIPT_DIR/deploy.auto.tfvars" ]]; then
    grep -v '^epcube_image' "$SCRIPT_DIR/deploy.auto.tfvars" > "$SCRIPT_DIR/deploy.auto.tfvars.tmp" \
      && mv "$SCRIPT_DIR/deploy.auto.tfvars.tmp" "$SCRIPT_DIR/deploy.auto.tfvars"
  fi
  echo "epcube_image = \"${epcube_image}\"" >> "$SCRIPT_DIR/deploy.auto.tfvars"

  tf_apply

  echo ""
  cmd_output_summary
}

cmd_plan() {
  require_tools
  require_azure_login
  require_tfvars
  detect_deployer_ip
  tf_init

  info "Planning Terraform changes..."
  cd "$SCRIPT_DIR"
  terraform plan -input=false "$(tf_var_ip)"
}

cmd_destroy() {
  require_tools
  require_azure_login
  detect_deployer_ip

  warn "This will DESTROY all Azure resources for EP Cube Graph."
  read -rp "Type 'destroy' to confirm: " confirm
  if [[ "${confirm}" != "destroy" ]]; then
    info "Cancelled."
    exit 0
  fi

  cd "$SCRIPT_DIR"
  terraform destroy -auto-approve "$(tf_var_ip)"
  rm -f "$SCRIPT_DIR/deploy.auto.tfvars"
  ok "All Azure resources destroyed"
}

cmd_output() {
  cd "$SCRIPT_DIR"
  terraform output
}

cmd_validate() {
  info "Running deployment validation..."
  exec "$SCRIPT_DIR/validate-deployment.sh"
}

cmd_output_summary() {
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  EP Cube Graph — Deployment Complete${NC}"
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  echo ""

  local postgres_fqdn api_fqdn

  postgres_fqdn=$(tf_output -raw postgres_fqdn 2>/dev/null || echo "pending")
  api_fqdn=$(tf_output -raw api_fqdn 2>/dev/null || echo "not deployed")

  echo -e "  ${BOLD}Endpoints:${NC}"
  echo -e "    PostgreSQL:       ${postgres_fqdn} (private managed server)"
  echo -e "    API:              https://${api_fqdn}"
  echo ""
  echo -e "  ${BOLD}Entra ID:${NC}"
  echo -e "    Tenant ID:  $(tf_output -raw entra_tenant_id 2>/dev/null || echo 'pending')"
  echo -e "    Client ID:  $(tf_output -raw entra_app_client_id 2>/dev/null || echo 'pending')"
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
}

# -- Entrypoint ----------------------------------------------------------------

case "${1:-}" in
  --plan|-p)            cmd_plan           ;;
  --output|-o)          cmd_output         ;;
  --validate|-v)        cmd_validate       ;;
  --api-only|-a)        cmd_api_only       ;;
  --exporter-only|-e)   cmd_exporter_only  ;;
  --destroy)            cmd_destroy        ;;
  --help|-h)
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  (none)            Full deploy: infrastructure + all images"
    echo "  --plan            Show what Terraform would change"
    echo "  --output          Show deployment outputs (endpoints, token)"
    echo "  --validate        Validate deployed resources are correct"
    echo "  --api-only        Rebuild and redeploy only the API container"
    echo "  --exporter-only   Rebuild and redeploy only the epcube-exporter"
    echo "  --destroy         Tear down all Azure resources"
    echo "  --help            Show this help message"
    ;;
  "")              cmd_deploy    ;;
  *)               die "Unknown command: $1 (try --help)" ;;
esac
