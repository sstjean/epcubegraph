#!/usr/bin/env bash
# EP Cube Graph — Mock Stack (automated testing only)
#
# Runs mock data services for CI/automated tests. For manual local
# development, use ./deploy.sh which connects to live EP Cube data.
#
# Usage:
#   ./deploy-local.sh              # Build and start the mock stack
#   ./deploy-local.sh --status     # Show container status
#   ./deploy-local.sh --stop       # Stop (preserves data)
#   ./deploy-local.sh --destroy    # Stop and remove volumes
#   ./deploy-local.sh --logs       # Tail logs
#   ./deploy-local.sh --seed       # Start + wait for data to be ingested
#   ./deploy-local.sh --query      # Quick-test query to VictoriaMetrics

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.local.yml"

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

COMPOSE_CMD=""
require_compose() {
  command -v docker >/dev/null 2>&1 || die "Docker is not installed."
  docker info >/dev/null 2>&1      || die "Docker daemon is not running."
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
  else
    die "Docker Compose is not available."
  fi
}

cmd_deploy() {
  require_compose
  info "Building mock EP Cube stack ..."
  ${COMPOSE_CMD} -f "${COMPOSE_FILE}" build --pull
  info "Starting services ..."
  ${COMPOSE_CMD} -f "${COMPOSE_FILE}" up -d --remove-orphans
  echo ""
  ok "Local stack running"
  echo "  Mock metrics:     http://localhost:9191/metrics"
  echo "  VictoriaMetrics:  http://localhost:8428"
  echo "  VM web UI (vmui): http://localhost:8428/vmui"
  echo "  vmagent targets:  http://localhost:8429/targets"
  echo ""
  info "Wait ~2 minutes for data, then run the API:"
  echo "  cd api/src/EpCubeGraph.Api && dotnet run"
}

cmd_seed() {
  cmd_deploy
  echo ""
  info "Waiting for mock data to be ingested (2 scrape cycles) ..."
  sleep 130
  cmd_query
}

cmd_query() {
  info "Querying VictoriaMetrics for battery SoC ..."
  if curl -sf 'http://localhost:8428/api/v1/query?query=epcube_battery_state_of_capacity_percent' | python3 -m json.tool 2>/dev/null; then
    ok "Data is being ingested"
  else
    warn "No data yet — wait a bit longer or check: $0 --logs"
  fi
}

cmd_status() {
  require_compose
  ${COMPOSE_CMD} -f "${COMPOSE_FILE}" ps -a
}

cmd_stop() {
  require_compose
  ${COMPOSE_CMD} -f "${COMPOSE_FILE}" down
  ok "Stack stopped (data volumes preserved)"
}

cmd_destroy() {
  require_compose
  warn "This will delete all local VictoriaMetrics data."
  read -rp "Are you sure? [y/N] " confirm
  if [[ "${confirm}" =~ ^[Yy]$ ]]; then
    ${COMPOSE_CMD} -f "${COMPOSE_FILE}" down -v
    ok "Stack destroyed"
  else
    info "Cancelled."
  fi
}

cmd_logs() {
  require_compose
  ${COMPOSE_CMD} -f "${COMPOSE_FILE}" logs -f --tail=100
}

# -- Main dispatch -------------------------------------------------------------
case "${1:-}" in
  --status)  cmd_status ;;
  --stop)    cmd_stop ;;
  --destroy) cmd_destroy ;;
  --logs)    cmd_logs ;;
  --seed)    cmd_seed ;;
  --query)   cmd_query ;;
  ""|--start) cmd_deploy ;;
  *)         die "Unknown option: $1. Use --status|--stop|--destroy|--logs|--seed|--query" ;;
esac
