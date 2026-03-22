#!/usr/bin/env bash
# EP Cube Graph — Local Development Stack Deployment
# For local testing with Docker Compose. Production runs entirely in Azure
# via infra/deploy.sh — this script is NOT needed for production.
#
# Usage:
#   ./deploy.sh              # Build and start (or update) the stack
#   ./deploy.sh --status     # Show container status and health
#   ./deploy.sh --stop       # Stop the stack (preserves data)
#   ./deploy.sh --destroy    # Stop the stack and remove volumes
#   ./deploy.sh --logs       # Tail logs from all services
#   ./deploy.sh --validate   # Validate configuration without starting

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="${SCRIPT_DIR}"
COMPOSE_FILE="${COMPOSE_DIR}/docker-compose.prod-local.yml"
ENV_FILE="${COMPOSE_DIR}/.env"
ENV_EXAMPLE="${COMPOSE_DIR}/.env.example"

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
require_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker is not installed. Install from https://docs.docker.com/get-docker/"
  docker info >/dev/null 2>&1      || die "Docker daemon is not running. Start Docker and try again."
}

require_compose() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
  else
    die "Docker Compose is not available. Install from https://docs.docker.com/compose/install/"
  fi
}

# -- .env validation ----------------------------------------------------------
validate_env() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    if [[ -f "${ENV_EXAMPLE}" ]]; then
      warn ".env file not found. Creating from .env.example ..."
      cp "${ENV_EXAMPLE}" "${ENV_FILE}"
      warn "Edit ${ENV_FILE} with your EP Cube credentials, then re-run."
      exit 1
    else
      die ".env file not found and no .env.example available."
    fi
  fi

  local errors=0

  # Required variable names and their placeholder patterns
  local -a var_names=( EPCUBE_USERNAME EPCUBE_PASSWORD )
  local -a placeholders=( "<" "<" )

  # Source the env file to export values
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a

  local i
  for i in "${!var_names[@]}"; do
    local var="${var_names[$i]}"
    local val="${!var:-}"
    local placeholder="${placeholders[$i]}"
    if [[ -z "${val}" ]]; then
      error "${var} is not set in .env"
      ((errors++))
    elif [[ "${val}" == *"${placeholder}"* ]]; then
      error "${var} still contains placeholder value: ${val}"
      ((errors++))
    fi
  done

  if ((errors > 0)); then
    die "Fix the ${errors} error(s) above in ${ENV_FILE} and re-run."
  fi

  ok "Configuration validated"
}

# -- Commands ------------------------------------------------------------------
cmd_deploy() {
  info "Deploying EP Cube Graph local ingestion stack ..."

  require_docker
  require_compose
  validate_env

  info "Building container images ..."
  ${COMPOSE_CMD} -f "${COMPOSE_FILE}" build --pull

  info "Starting services ..."
  ${COMPOSE_CMD} -f "${COMPOSE_FILE}" up -d --remove-orphans

  echo ""
  ok "Stack deployed successfully"
  echo ""
  cmd_status
  echo ""
  info "View logs with:  $0 --logs"
  info "Check status:    $0 --status"
}

cmd_status() {
  require_docker
  require_compose

  info "Container status:"
  ${COMPOSE_CMD} -f "${COMPOSE_FILE}" ps -a

  echo ""

  # Check if epcube-exporter metrics endpoint is reachable
  if curl -sf http://localhost:9250/metrics >/dev/null 2>&1; then
    ok "epcube-exporter metrics endpoint is reachable at http://localhost:9250/metrics"
  else
    warn "epcube-exporter metrics endpoint is not reachable at http://localhost:9250/metrics"
  fi
}

cmd_stop() {
  require_docker
  require_compose

  info "Stopping EP Cube Graph local ingestion stack ..."
  ${COMPOSE_CMD} -f "${COMPOSE_FILE}" down
  ok "Stack stopped (data volumes preserved)"
}

cmd_destroy() {
  require_docker
  require_compose

  warn "This will stop all containers AND delete the vmagent WAL data volume."
  read -rp "Are you sure? [y/N] " confirm
  if [[ "${confirm}" =~ ^[Yy]$ ]]; then
    ${COMPOSE_CMD} -f "${COMPOSE_FILE}" down -v
    ok "Stack destroyed (volumes removed)"
  else
    info "Cancelled."
  fi
}

cmd_logs() {
  require_docker
  require_compose

  info "Tailing logs (Ctrl+C to stop) ..."
  ${COMPOSE_CMD} -f "${COMPOSE_FILE}" logs -f --tail=100
}

cmd_validate() {
  info "Validating deployment prerequisites ..."

  require_docker
  ok "Docker is installed and running"

  require_compose
  ok "Docker Compose is available (${COMPOSE_CMD})"

  validate_env

  # Validate compose file syntax
  ${COMPOSE_CMD} -f "${COMPOSE_FILE}" config --quiet 2>/dev/null \
    && ok "docker-compose.yml is valid" \
    || die "docker-compose.yml has syntax errors"

  echo ""
  ok "All checks passed — ready to deploy with: $0"
}

# -- Entrypoint ----------------------------------------------------------------
case "${1:-}" in
  --status|-s)    cmd_status   ;;
  --stop)         cmd_stop     ;;
  --destroy)      cmd_destroy  ;;
  --logs|-l)      cmd_logs     ;;
  --validate|-v)  cmd_validate ;;
  --help|-h)
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  (none)       Build and start (or update) the local ingestion stack"
    echo "  --status     Show container status and health"
    echo "  --stop       Stop the stack (preserves data volumes)"
    echo "  --destroy    Stop the stack and remove data volumes"
    echo "  --logs       Tail logs from all services"
    echo "  --validate   Validate configuration without starting"
    echo "  --help       Show this help message"
    ;;
  "")             cmd_deploy   ;;
  *)              die "Unknown command: $1 (try --help)" ;;
esac
