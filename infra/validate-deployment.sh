#!/usr/bin/env bash
# EP Cube Graph — Post-Deployment Validation
# Verifies that Azure resources are correctly deployed and configured.
#
# Usage:
#   ./validate-deployment.sh                # Auto-detect from Terraform state
#   ./validate-deployment.sh --rg NAME      # Specify resource group explicitly
#
# Prerequisites:
#   - az CLI authenticated (az login)
#   - Terraform state accessible (if not using --rg)
#
# Exit code 0 = all checks pass, 1 = one or more failures.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# -- Colours -------------------------------------------------------------------
if [[ -t 1 ]]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
  BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; NC=''
fi

PASS=0
FAIL=0
SKIP=0

pass()   { echo -e "  ${GREEN}✓${NC} $*"; PASS=$((PASS + 1)); }
fail()   { echo -e "  ${RED}✗${NC} $*"; FAIL=$((FAIL + 1)); }
skip()   { echo -e "  ${YELLOW}⊘${NC} $*"; SKIP=$((SKIP + 1)); }
header() { echo ""; echo -e "${BOLD}── $* ──${NC}"; }
info()   { echo -e "  ${BLUE}→${NC} $*"; }

# -- az_json helper ------------------------------------------------------------
# Runs `az` capturing stdout/stderr/exit-code separately so each check can tell
# a real CLI/tool error apart from a genuinely-absent resource — instead of the
# old `2>/dev/null || echo ""` pattern that swallowed errors and misreported
# them as "not found" (issue #166). See infra/lib/az-json.sh.
# shellcheck source=lib/az-json.sh
source "${SCRIPT_DIR}/lib/az-json.sh"

# -- Argument parsing ----------------------------------------------------------
RG_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rg) RG_OVERRIDE="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# -- Resolve resource group and environment name -------------------------------
header "Resolving deployment context"

if [[ -n "$RG_OVERRIDE" ]]; then
  RG_NAME="$RG_OVERRIDE"
  info "Using provided resource group: $RG_NAME"
else
  cd "$SCRIPT_DIR"
  if ! terraform output resource_group_name >/dev/null 2>&1; then
    echo "ERROR: No Terraform state found and --rg not specified."
    echo "Pass --rg <resource-group-name> to specify the target environment."
    exit 1
  fi
  RG_NAME=$(terraform output -raw resource_group_name)
  info "From Terraform state: $RG_NAME"
fi

# Derive environment name from RG (strip -rg suffix)
ENV_NAME="${RG_NAME%-rg}"
info "Environment name: $ENV_NAME"

# -- Pre-flight: verify Azure login and RG exists ----------------------------
if ! az account show >/dev/null 2>&1; then
  echo "ERROR: Not logged in to Azure. Run 'az login' first."
  exit 1
fi

if ! az group show --name "$RG_NAME" >/dev/null 2>&1; then
  echo "ERROR: Resource group '$RG_NAME' not found."
  exit 1
fi

pass "Resource group '$RG_NAME' exists"

# ==============================================================================
# 1. Container Apps Environment
# ==============================================================================
header "Container Apps Environment"

CAE_NAME="${ENV_NAME}-env"
if ! az_json containerapp env show --name "$CAE_NAME" --resource-group "$RG_NAME" -o json; then
  if [[ "$AZ_JSON_ERR" == *"ResourceNotFound"* || "$AZ_JSON_ERR" == *"not found"* ]]; then
    fail "Container Apps Environment '$CAE_NAME' not found"
  else
    fail "Container Apps Environment '$CAE_NAME': az CLI error — ${AZ_JSON_ERR}"
  fi
else
  CAE_JSON="$AZ_JSON_OUT"
  pass "Container Apps Environment '$CAE_NAME' exists"

  CAE_STATUS=$(echo "$CAE_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('properties',{}).get('provisioningState',''))")
  if [[ "$CAE_STATUS" == "Succeeded" ]]; then
    pass "Environment provisioning state: Succeeded"
  else
    fail "Environment provisioning state: $CAE_STATUS (expected Succeeded)"
  fi
fi

# ==============================================================================
# 2. Managed PostgreSQL Server
# ==============================================================================
header "Managed PostgreSQL Server"

PG_NAME="${ENV_NAME}-postgres"
if ! az_json postgres flexible-server show --name "$PG_NAME" --resource-group "$RG_NAME" -o json; then
  if [[ "$AZ_JSON_ERR" == *"ResourceNotFound"* || "$AZ_JSON_ERR" == *"not found"* ]]; then
    fail "Managed PostgreSQL server '$PG_NAME' not found"
  else
    fail "Managed PostgreSQL server '$PG_NAME': az CLI error — ${AZ_JSON_ERR}"
  fi
else
  PG_JSON="$AZ_JSON_OUT"
  pass "Managed PostgreSQL server '$PG_NAME' exists"

  PG_STATE=$(echo "$PG_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('state',''))")
  if [[ "$PG_STATE" == "Ready" ]]; then
    pass "Server state: Ready"
  else
    fail "Server state: $PG_STATE (expected Ready)"
  fi

  PG_VERSION=$(echo "$PG_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('version',''))")
  if [[ "$PG_VERSION" == "17" ]]; then
    pass "Server version: 17"
  else
    fail "Server version: $PG_VERSION (expected 17)"
  fi

  PG_SKU=$(echo "$PG_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); sku=d.get('sku',{}); print(sku.get('name','') or d.get('skuName',''))")
  if [[ "$PG_SKU" == "Standard_B1ms" || "$PG_SKU" == "B_Standard_B1ms" ]]; then
    pass "SKU: $PG_SKU"
  else
    fail "SKU: $PG_SKU (expected Standard_B1ms/B_Standard_B1ms)"
  fi

  PG_PUBLIC=$(echo "$PG_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('network',{}).get('publicNetworkAccess',''))")
  if [[ "${PG_PUBLIC,,}" == "disabled" ]]; then
    pass "Public network access disabled"
  else
    fail "Public network access: $PG_PUBLIC (expected Disabled)"
  fi

  PG_SUBNET=$(echo "$PG_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('network',{}).get('delegatedSubnetResourceId',''))")
  if [[ "$PG_SUBNET" == *"/subnets/postgres" ]]; then
    pass "Delegated subnet configured"
  else
    fail "Delegated subnet missing or unexpected: $PG_SUBNET"
  fi

  PG_DNS=$(echo "$PG_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('network',{}).get('privateDnsZoneArmResourceId',''))")
  if [[ "$PG_DNS" == *".postgres.database.azure.com"* ]]; then
    pass "Private DNS zone configured"
  else
    fail "Private DNS zone missing or unexpected: $PG_DNS"
  fi

  PG_FQDN=$(echo "$PG_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('fullyQualifiedDomainName',''))")
  if [[ -n "$PG_FQDN" ]]; then
    pass "Private FQDN assigned: $PG_FQDN"
  else
    fail "No PostgreSQL FQDN assigned"
  fi
fi

# ==============================================================================
# 3. API Container App
# ==============================================================================
header "API Container App"

API_NAME="${ENV_NAME}-api"
API_JSON=""
if ! az_json containerapp show --name "$API_NAME" --resource-group "$RG_NAME" -o json; then
  if [[ "$AZ_JSON_ERR" == *"ResourceNotFound"* || "$AZ_JSON_ERR" == *"not found"* ]]; then
    skip "API Container App '$API_NAME' not deployed (api_image may be empty)"
  else
    fail "API Container App '$API_NAME': az CLI error — ${AZ_JSON_ERR}"
  fi
else
  API_JSON="$AZ_JSON_OUT"
  pass "Container App '$API_NAME' exists"

  API_STATUS=$(echo "$API_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('properties',{}).get('provisioningState',''))")
  if [[ "$API_STATUS" == "Succeeded" ]]; then
    pass "Provisioning state: Succeeded"
  else
    fail "Provisioning state: $API_STATUS (expected Succeeded)"
  fi

  # Check ingress is external on port 8080
  API_EXT=$(echo "$API_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['properties']['configuration']['ingress']['external'])")
  API_PORT=$(echo "$API_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['properties']['configuration']['ingress']['targetPort'])")
  if [[ "$API_EXT" == "True" ]]; then
    pass "Ingress: external enabled"
  else
    fail "Ingress: external=$API_EXT (expected True)"
  fi
  if [[ "$API_PORT" == "8080" ]]; then
    pass "Ingress target port: 8080"
  else
    fail "Ingress target port: $API_PORT (expected 8080)"
  fi

  # Check FQDN
  API_FQDN=$(echo "$API_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['properties']['configuration']['ingress'].get('fqdn',''))")
  if [[ -n "$API_FQDN" ]]; then
    pass "FQDN assigned: $API_FQDN"
  else
    fail "No FQDN assigned"
  fi

  # Check scaling (1-3)
  API_MIN=$(echo "$API_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['properties']['template']['scale']['minReplicas'])")
  API_MAX=$(echo "$API_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['properties']['template']['scale']['maxReplicas'])")
  if [[ "$API_MIN" == "1" && "$API_MAX" == "3" ]]; then
    pass "Replicas: min=1, max=3"
  else
    fail "Replicas: min=$API_MIN, max=$API_MAX (expected 1/3)"
  fi

  # Check environment variables
  API_ENVS=$(echo "$API_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
envs = d['properties']['template']['containers'][0].get('env',[])
print(' '.join(e['name'] for e in envs))
")
  for expected_env in AzureAd__Instance AzureAd__TenantId AzureAd__ClientId AzureAd__Audience ConnectionStrings__DefaultConnection; do
    if echo "$API_ENVS" | grep -q "$expected_env"; then
      pass "Env var '$expected_env' configured"
    else
      fail "Env var '$expected_env' missing"
    fi
  done

  # Check API connection string is sourced from the expected secret
  CONNECTION_STRING_SECRET=$(echo "$API_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
envs = d['properties']['template']['containers'][0].get('env',[])
conn = next((e for e in envs if e['name'] == 'ConnectionStrings__DefaultConnection'), None)
print(conn.get('secretRef','') if conn else '')
")
  if [[ "$CONNECTION_STRING_SECRET" == "api-connection-string" ]]; then
    pass "API connection string secret configured"
  else
    fail "API connection string secret ref: $CONNECTION_STRING_SECRET (expected api-connection-string)"
  fi

  # Smoke test: health endpoint (unauthenticated)
  if [[ -n "$API_FQDN" ]]; then
    API_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${API_FQDN}/api/v1/health" 2>/dev/null) || true
    if [[ "$API_HEALTH" == "200" || "$API_HEALTH" == "503" ]]; then
      pass "Health endpoint responded: HTTP $API_HEALTH"
    elif [[ "$API_HEALTH" == "000" || -z "$API_HEALTH" ]]; then
      skip "Could not reach API (timeout)"
    else
      fail "Health endpoint returned HTTP $API_HEALTH (expected 200 or 503)"
    fi

    # Authenticated endpoints should reject without token
    API_NOAUTH=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${API_FQDN}/api/v1/devices" 2>/dev/null) || true
    if [[ "$API_NOAUTH" == "401" ]]; then
      pass "Protected endpoint rejects unauthenticated requests (401)"
    elif [[ "$API_NOAUTH" == "000" || -z "$API_NOAUTH" ]]; then
      skip "Could not reach API (timeout)"
    else
      fail "Protected endpoint returned HTTP $API_NOAUTH without token (expected 401)"
    fi
  fi
fi

# ==============================================================================
# 4. epcube-exporter Container App
# ==============================================================================
header "epcube-exporter Container App"

EXP_NAME="${ENV_NAME}-exporter"
EXP_JSON=""
if ! az_json containerapp show --name "$EXP_NAME" --resource-group "$RG_NAME" -o json; then
  if [[ "$AZ_JSON_ERR" == *"ResourceNotFound"* || "$AZ_JSON_ERR" == *"not found"* ]]; then
    skip "epcube-exporter Container App '$EXP_NAME' not deployed (epcube_image may be empty)"
  else
    fail "epcube-exporter Container App '$EXP_NAME': az CLI error — ${AZ_JSON_ERR}"
  fi
else
  EXP_JSON="$AZ_JSON_OUT"
  pass "Container App '$EXP_NAME' exists"

  EXP_STATUS=$(echo "$EXP_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('properties',{}).get('provisioningState',''))")
  if [[ "$EXP_STATUS" == "Succeeded" ]]; then
    pass "Provisioning state: Succeeded"
  else
    fail "Provisioning state: $EXP_STATUS (expected Succeeded)"
  fi

  # Check external ingress on port 9250
  EXP_EXT=$(echo "$EXP_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['properties']['configuration']['ingress']['external'])")
  EXP_PORT=$(echo "$EXP_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['properties']['configuration']['ingress']['targetPort'])")
  if [[ "$EXP_EXT" == "True" ]]; then
    pass "Ingress: external enabled (for debug page)"
  else
    fail "Ingress: external=$EXP_EXT (expected True)"
  fi
  if [[ "$EXP_PORT" == "9250" ]]; then
    pass "Ingress target port: 9250"
  else
    fail "Ingress target port: $EXP_PORT (expected 9250)"
  fi

  # Check FQDN
  EXP_FQDN=$(echo "$EXP_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['properties']['configuration']['ingress'].get('fqdn',''))")
  if [[ -n "$EXP_FQDN" ]]; then
    pass "FQDN assigned: $EXP_FQDN"
  else
    fail "No FQDN assigned"
  fi

  # Check replicas (1/1)
  EXP_MIN=$(echo "$EXP_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['properties']['template']['scale']['minReplicas'])")
  EXP_MAX=$(echo "$EXP_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['properties']['template']['scale']['maxReplicas'])")
  if [[ "$EXP_MIN" == "1" && "$EXP_MAX" == "1" ]]; then
    pass "Replicas: min=1, max=1"
  else
    fail "Replicas: min=$EXP_MIN, max=$EXP_MAX (expected 1/1)"
  fi

  # Check critical env vars
  EXP_ENVS=$(echo "$EXP_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
envs = d['properties']['template']['containers'][0].get('env',[])
print(' '.join(e['name'] for e in envs))
")
  for expected_env in EPCUBE_PORT EPCUBE_INTERVAL POSTGRES_DSN AZURE_TENANT_ID AZURE_CLIENT_ID AZURE_AUDIENCE; do
    if echo "$EXP_ENVS" | grep -q "$expected_env"; then
      pass "Env var '$expected_env' configured"
    else
      fail "Env var '$expected_env' missing"
    fi
  done

  # Check secrets are referenced (not values — just names)
  EXP_SECRETS=$(echo "$EXP_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
secrets = d['properties']['configuration'].get('secrets',[])
print(' '.join(s['name'] for s in secrets))
")
  for expected_secret in epcube-username epcube-password; do
    if echo "$EXP_SECRETS" | grep -q "$expected_secret"; then
      pass "Secret '$expected_secret' referenced"
    else
      fail "Secret '$expected_secret' missing"
    fi
  done

  # Smoke test: health endpoint (unauthenticated)
  if [[ -n "$EXP_FQDN" ]]; then
    EXP_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${EXP_FQDN}/health" 2>/dev/null) || true
    if [[ "$EXP_HEALTH" == "200" || "$EXP_HEALTH" == "503" ]]; then
      pass "Health endpoint responded: HTTP $EXP_HEALTH"
    elif [[ "$EXP_HEALTH" == "000" || -z "$EXP_HEALTH" ]]; then
      skip "Could not reach exporter (timeout)"
    else
      fail "Health endpoint returned HTTP $EXP_HEALTH (expected 200 or 503)"
    fi

    # Debug page should require auth (401 without token)
    EXP_DEBUG=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${EXP_FQDN}/" 2>/dev/null) || true
    if [[ "$EXP_DEBUG" == "401" ]]; then
      pass "Debug page requires JWT auth (401 without token)"
    elif [[ "$EXP_DEBUG" == "000" || -z "$EXP_DEBUG" ]]; then
      skip "Could not reach debug page (timeout)"
    else
      fail "Debug page returned HTTP $EXP_DEBUG without token (expected 401)"
    fi
  fi
fi

# ==============================================================================
# 5. Azure Container Registry
# ==============================================================================
header "Azure Container Registry"

ACR_NAME=$(echo "${ENV_NAME}cr" | tr -d '-')
if ! az_json acr show --name "$ACR_NAME" --resource-group "$RG_NAME" -o json; then
  if [[ "$AZ_JSON_ERR" == *"ResourceNotFound"* || "$AZ_JSON_ERR" == *"not found"* ]]; then
    fail "Container Registry '$ACR_NAME' not found"
  else
    fail "Container Registry '$ACR_NAME': az CLI error — ${AZ_JSON_ERR}"
  fi
else
  ACR_JSON="$AZ_JSON_OUT"
  pass "Container Registry '$ACR_NAME' exists"

  ACR_SKU=$(echo "$ACR_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('sku',{}).get('name',''))")
  if [[ "$ACR_SKU" == "Basic" ]]; then
    pass "SKU: Basic"
  else
    fail "SKU: $ACR_SKU (expected Basic)"
  fi

  ACR_ADMIN=$(echo "$ACR_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('adminUserEnabled',True))")
  if [[ "$ACR_ADMIN" == "False" ]]; then
    pass "Admin user disabled (security best practice)"
  else
    fail "Admin user enabled (should be disabled)"
  fi
fi

# ==============================================================================
# 6. Key Vault
# ==============================================================================
header "Key Vault"

KV_NAME="${ENV_NAME}-kv"
if ! az_json keyvault show --name "$KV_NAME" --resource-group "${ENV_NAME}-bootstrap-rg" -o json; then
  if [[ "$AZ_JSON_ERR" == *"ResourceNotFound"* || "$AZ_JSON_ERR" == *"not found"* ]]; then
    fail "Key Vault '$KV_NAME' not found"
  else
    fail "Key Vault '$KV_NAME': az CLI error — ${AZ_JSON_ERR}"
  fi
else
  KV_JSON="$AZ_JSON_OUT"
  pass "Key Vault '$KV_NAME' exists"

  KV_SOFT_DELETE=$(echo "$KV_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['properties'].get('enableSoftDelete',False))")
  if [[ "$KV_SOFT_DELETE" == "True" ]]; then
    pass "Soft delete enabled"
  else
    fail "Soft delete not enabled"
  fi

  # Check required secrets exist. The KV firewall (public network access
  # disabled) intentionally blocks the runner's data-plane access, so the
  # secret-list call fails with a Forbidden error. That is an expected,
  # recoverable condition: fall back to verifying the secrets via the
  # Container App. Any other error is a genuine tool failure.
  KV_DATAPLANE_BLOCKED=false
  KV_SECRETS=""
  if ! az_json keyvault secret list --vault-name "$KV_NAME" --query "[].name" -o tsv; then
    if [[ "$AZ_JSON_ERR" == *"Forbidden"* \
       || "$AZ_JSON_ERR" == *"Public network access is disabled"* \
       || "$AZ_JSON_ERR" == *"not from a trusted service"* ]]; then
      KV_DATAPLANE_BLOCKED=true
    else
      fail "Key Vault '$KV_NAME' secret list: az CLI error — ${AZ_JSON_ERR}"
    fi
  else
    KV_SECRETS="$AZ_JSON_OUT"
    # An empty-but-successful list also indicates the data-plane is unreachable.
    if [[ -z "$KV_SECRETS" ]]; then
      KV_DATAPLANE_BLOCKED=true
    fi
  fi

  if [[ "$KV_DATAPLANE_BLOCKED" == true ]]; then
    # Firewall blocking data-plane access — check via Container App secrets instead
    if ! az_json containerapp show --name "${ENV_NAME}-exporter" --resource-group "$RG_NAME" -o json; then
      if [[ "$AZ_JSON_ERR" == *"ResourceNotFound"* || "$AZ_JSON_ERR" == *"not found"* ]]; then
        fail "Cannot verify KV secrets (firewall blocks data-plane, exporter not found)"
      else
        fail "Cannot verify KV secrets (firewall blocks data-plane, exporter: az CLI error — ${AZ_JSON_ERR})"
      fi
    else
      EXP_CONTAINER_JSON="$AZ_JSON_OUT"
      EXP_CA_SECRETS=$(echo "$EXP_CONTAINER_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
secrets = d['properties']['configuration'].get('secrets',[])
print(' '.join(s['name'] for s in secrets))
")
      for expected_secret in epcube-username epcube-password exporter-oauth-secret; do
        if echo "$EXP_CA_SECRETS" | grep -q "$expected_secret"; then
          pass "Secret '$expected_secret' referenced in Container App (KV data-plane blocked by firewall)"
        else
          fail "Secret '$expected_secret' not found in Container App or Key Vault"
        fi
      done
    fi
  else
    for expected_secret in epcube-username epcube-password exporter-oauth-secret; do
      if echo "$KV_SECRETS" | grep -q "^${expected_secret}$"; then
        pass "Secret '$expected_secret' exists"
      else
        fail "Secret '$expected_secret' not found"
      fi
    done
  fi
fi

# ==============================================================================
# 7. Managed PostgreSQL Database
# ==============================================================================
header "Managed PostgreSQL Database"

# az postgres flexible-server db show was removed in az CLI 2.86.0 (issue #166).
# Use az resource show --ids with the stable ARM resource ID instead.
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
PG_DB_ID="/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RG_NAME}/providers/Microsoft.DBforPostgreSQL/flexibleServers/${PG_NAME}/databases/epcubegraph"
if ! az_json resource show --ids "$PG_DB_ID" -o json; then
  if [[ "$AZ_JSON_ERR" == *"ResourceNotFound"* || "$AZ_JSON_ERR" == *"not found"* ]]; then
    fail "Managed PostgreSQL database 'epcubegraph' not found"
  else
    fail "Managed PostgreSQL database 'epcubegraph': az CLI error — ${AZ_JSON_ERR}"
  fi
else
  PG_DB_JSON="$AZ_JSON_OUT"
  pass "Managed PostgreSQL database 'epcubegraph' exists"

  # az resource show wraps fields under .properties (live-verified on az 2.84.0)
  PG_DB_CHARSET=$(echo "$PG_DB_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('properties',{}).get('charset',''))")
  if [[ "$PG_DB_CHARSET" == "UTF8" ]]; then
    pass "Database charset: UTF8"
  else
    fail "Database charset: $PG_DB_CHARSET (expected UTF8)"
  fi

  PG_DB_COLLATION=$(echo "$PG_DB_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('properties',{}).get('collation',''))")
  if [[ "$PG_DB_COLLATION" == "en_US.utf8" ]]; then
    pass "Database collation: en_US.utf8"
  else
    fail "Database collation: $PG_DB_COLLATION (expected en_US.utf8)"
  fi
fi

# ==============================================================================
# 8. Log Analytics Workspace
# ==============================================================================
header "Log Analytics Workspace"

LAW_NAME="${ENV_NAME}-logs"
if ! az_json monitor log-analytics workspace show --workspace-name "$LAW_NAME" --resource-group "$RG_NAME" -o json; then
  if [[ "$AZ_JSON_ERR" == *"ResourceNotFound"* || "$AZ_JSON_ERR" == *"not found"* ]]; then
    fail "Log Analytics Workspace '$LAW_NAME' not found"
  else
    fail "Log Analytics Workspace '$LAW_NAME': az CLI error — ${AZ_JSON_ERR}"
  fi
else
  LAW_JSON="$AZ_JSON_OUT"
  pass "Log Analytics Workspace '$LAW_NAME' exists"

  LAW_RETENTION=$(echo "$LAW_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('retentionInDays',0))")
  if [[ "$LAW_RETENTION" == "30" ]]; then
    pass "Retention: 30 days"
  else
    fail "Retention: $LAW_RETENTION days (expected 30)"
  fi
fi

# ==============================================================================
# 8b. Application Insights (per-environment isolation — issue #115)
# ==============================================================================
header "Application Insights"

AI_NAME="${ENV_NAME}-appinsights"
if ! az_json monitor app-insights component show --app "$AI_NAME" --resource-group "$RG_NAME" -o json; then
  if [[ "$AZ_JSON_ERR" == *"ResourceNotFound"* || "$AZ_JSON_ERR" == *"not found"* ]]; then
    # R1: per-environment Application Insights resource must exist
    fail "Application Insights '$AI_NAME' not found"
  else
    fail "Application Insights '$AI_NAME': az CLI error — ${AZ_JSON_ERR}"
  fi
else
  AI_JSON="$AZ_JSON_OUT"
  pass "Application Insights '$AI_NAME' exists"

  # R2: the component must link to THIS environment's Log Analytics workspace
  #     (workspaceResourceId is the az-CLI JSON field for the workspace_id link)
  AI_WORKSPACE=$(echo "$AI_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('workspaceResourceId',''))")
  if [[ "$AI_WORKSPACE" == *"/${ENV_NAME}-logs" ]]; then
    pass "Linked to per-environment Log Analytics workspace '${ENV_NAME}-logs'"
  else
    fail "Workspace link: $AI_WORKSPACE (expected to end with /${ENV_NAME}-logs)"
  fi

  # R3: the API Container App must source its connection string from the
  #     per-environment secret (mirrors the ConnectionStrings__DefaultConnection
  #     check above). Skip cleanly if the API was not deployed.
  if [[ -z "$API_JSON" ]]; then
    skip "API Container App not deployed — cannot verify connection-string secret ref"
  else
    AI_SECRET_REF=$(echo "$API_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
envs = d['properties']['template']['containers'][0].get('env',[])
conn = next((e for e in envs if e['name'] == 'APPLICATIONINSIGHTS_CONNECTION_STRING'), None)
print(conn.get('secretRef','') if conn else '')
")
    if [[ "$AI_SECRET_REF" == "appinsights-connection-string" ]]; then
      pass "API App Insights connection string sourced from secret 'appinsights-connection-string'"
    else
      fail "API App Insights connection string secret ref: $AI_SECRET_REF (expected appinsights-connection-string)"
    fi
  fi
fi

# ==============================================================================
# 9. Managed Identity & RBAC
# ==============================================================================
header "Managed Identity"

MI_NAME="${ENV_NAME}-identity"
if ! az_json identity show --name "$MI_NAME" --resource-group "$RG_NAME" -o json; then
  if [[ "$AZ_JSON_ERR" == *"ResourceNotFound"* || "$AZ_JSON_ERR" == *"not found"* ]]; then
    fail "Managed Identity '$MI_NAME' not found"
  else
    fail "Managed Identity '$MI_NAME': az CLI error — ${AZ_JSON_ERR}"
  fi
else
  MI_JSON="$AZ_JSON_OUT"
  pass "Managed Identity '$MI_NAME' exists"

  MI_PRINCIPAL=$(echo "$MI_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('principalId',''))")
  if [[ -n "$MI_PRINCIPAL" ]]; then
    pass "Principal ID assigned: ${MI_PRINCIPAL:0:8}..."

    # Check AcrPull role on ACR
    if ! az_json acr show --name "$ACR_NAME" --resource-group "$RG_NAME" --query "id" -o tsv; then
      fail "Container Registry '$ACR_NAME': az CLI error during role check — ${AZ_JSON_ERR}"
    else
      ACR_ID="$AZ_JSON_OUT"
      if [[ -n "$ACR_ID" ]]; then
        if ! az_json role assignment list --assignee "$MI_PRINCIPAL" --scope "$ACR_ID" --query "[?roleDefinitionName=='AcrPull'].roleDefinitionName" -o tsv; then
          fail "AcrPull role check: az CLI error — ${AZ_JSON_ERR}"
        else
          ACR_ROLE="$AZ_JSON_OUT"
          if [[ "$ACR_ROLE" == "AcrPull" ]]; then
            pass "AcrPull role assigned on Container Registry"
          else
            fail "AcrPull role not found on Container Registry"
          fi
        fi
      fi
    fi
  else
    fail "No principal ID"
  fi
fi

# ==============================================================================
# 10. Entra ID App Registration
# ==============================================================================
header "Entra ID App Registration"

# az ad app list --query "[0]" exits 0 with "null" when no app matches; use
# az_json to surface real CLI errors, then guard for the "null" absence case.
if ! az_json ad app list --filter "displayName eq 'EP Cube Graph API (${ENV_NAME})'" --query "[0]" -o json; then
  fail "Entra ID App Registration 'EP Cube Graph API (${ENV_NAME})': az CLI error — ${AZ_JSON_ERR}"
else
  ENTRA_APP="$AZ_JSON_OUT"
  if [[ -z "$ENTRA_APP" || "$ENTRA_APP" == "null" ]]; then
    fail "Entra ID App Registration 'EP Cube Graph API (${ENV_NAME})' not found"
  else
    ENTRA_DISPLAY=$(echo "$ENTRA_APP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('displayName',''))")
    pass "App Registration '$ENTRA_DISPLAY' exists"

    ENTRA_URI=$(echo "$ENTRA_APP" | python3 -c "import sys,json; d=json.load(sys.stdin); uris=d.get('identifierUris',[]); print(uris[0] if uris else '')")
    if echo "$ENTRA_URI" | grep -qE "^api://"; then
      pass "Identifier URI: $ENTRA_URI"
    else
      fail "Identifier URI: $ENTRA_URI (expected api://<client-id>)"
    fi

    ENTRA_AUDIENCE=$(echo "$ENTRA_APP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('signInAudience',''))")
    if [[ "$ENTRA_AUDIENCE" == "AzureADMyOrg" ]]; then
      pass "Sign-in audience: AzureADMyOrg"
    else
      fail "Sign-in audience: $ENTRA_AUDIENCE (expected AzureADMyOrg)"
    fi

    # Check user_impersonation scope exists
    SCOPE_VALUE=$(echo "$ENTRA_APP" | python3 -c "
import sys,json
d=json.load(sys.stdin)
scopes = d.get('api',{}).get('oauth2PermissionScopes',[])
values = [s['value'] for s in scopes if s.get('isEnabled')]
print(' '.join(values))
")
    if echo "$SCOPE_VALUE" | grep -q "user_impersonation"; then
      pass "OAuth2 scope 'user_impersonation' configured and enabled"
    else
      fail "OAuth2 scope 'user_impersonation' not found (found: $SCOPE_VALUE)"
    fi

    # Check service principal exists
    APP_ID=$(echo "$ENTRA_APP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('appId',''))")
    if ! az_json ad sp show --id "$APP_ID" -o json; then
      fail "Service Principal: az CLI error — ${AZ_JSON_ERR}"
    else
      SP_JSON="$AZ_JSON_OUT"
      if [[ -n "$SP_JSON" && "$SP_JSON" != "null" ]]; then
        pass "Service Principal exists for app"
      else
        fail "Service Principal not found"
      fi
    fi
  fi
fi

# ==============================================================================
# Summary
# ==============================================================================
echo ""
echo -e "${BOLD}════════════════════════════════════════${NC}"
echo -e "${BOLD}  Deployment Validation Summary${NC}"
echo -e "${BOLD}════════════════════════════════════════${NC}"
echo -e "  ${GREEN}Passed:${NC}  $PASS"
echo -e "  ${RED}Failed:${NC}  $FAIL"
echo -e "  ${YELLOW}Skipped:${NC} $SKIP"
echo -e "${BOLD}════════════════════════════════════════${NC}"

if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo -e "  ${RED}RESULT: FAIL${NC}"
  exit 1
else
  echo ""
  echo -e "  ${GREEN}RESULT: PASS${NC}"
  exit 0
fi
