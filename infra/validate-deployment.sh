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

pass()   { echo -e "  ${GREEN}✓${NC} $*"; ((PASS++)); }
fail()   { echo -e "  ${RED}✗${NC} $*"; ((FAIL++)); }
skip()   { echo -e "  ${YELLOW}⊘${NC} $*"; ((SKIP++)); }
header() { echo ""; echo -e "${BOLD}── $* ──${NC}"; }
info()   { echo -e "  ${BLUE}→${NC} $*"; }

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
    echo "Run ./deploy.sh first, or pass --rg <resource-group-name>."
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
CAE_JSON=$(az containerapp env show --name "$CAE_NAME" --resource-group "$RG_NAME" -o json 2>/dev/null || echo "")

if [[ -z "$CAE_JSON" ]]; then
  fail "Container Apps Environment '$CAE_NAME' not found"
else
  pass "Container Apps Environment '$CAE_NAME' exists"

  CAE_STATUS=$(echo "$CAE_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('properties',{}).get('provisioningState',''))")
  if [[ "$CAE_STATUS" == "Succeeded" ]]; then
    pass "Environment provisioning state: Succeeded"
  else
    fail "Environment provisioning state: $CAE_STATUS (expected Succeeded)"
  fi
fi

# ==============================================================================
# 2. VictoriaMetrics Container App
# ==============================================================================
header "VictoriaMetrics Container App"

VM_NAME="${ENV_NAME}-vm"
VM_JSON=$(az containerapp show --name "$VM_NAME" --resource-group "$RG_NAME" -o json 2>/dev/null || echo "")

if [[ -z "$VM_JSON" ]]; then
  fail "VictoriaMetrics Container App '$VM_NAME' not found"
else
  pass "Container App '$VM_NAME' exists"

  # Check running status
  VM_STATUS=$(echo "$VM_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('properties',{}).get('provisioningState',''))")
  if [[ "$VM_STATUS" == "Succeeded" ]]; then
    pass "Provisioning state: Succeeded"
  else
    fail "Provisioning state: $VM_STATUS (expected Succeeded)"
  fi

  # Check ingress is external
  VM_INGRESS_EXT=$(echo "$VM_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['properties']['configuration']['ingress']['external'])")
  if [[ "$VM_INGRESS_EXT" == "True" ]]; then
    pass "Ingress: external enabled"
  else
    fail "Ingress: external=$VM_INGRESS_EXT (expected True)"
  fi

  # Check target port is 8427 (vmauth)
  VM_PORT=$(echo "$VM_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['properties']['configuration']['ingress']['targetPort'])")
  if [[ "$VM_PORT" == "8427" ]]; then
    pass "Ingress target port: 8427 (vmauth)"
  else
    fail "Ingress target port: $VM_PORT (expected 8427)"
  fi

  # Check FQDN is assigned
  VM_FQDN=$(echo "$VM_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['properties']['configuration']['ingress'].get('fqdn',''))")
  if [[ -n "$VM_FQDN" ]]; then
    pass "FQDN assigned: $VM_FQDN"
  else
    fail "No FQDN assigned"
  fi

  # Check revision mode is Single
  VM_REV_MODE=$(echo "$VM_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['properties']['configuration'].get('activeRevisionsMode',''))")
  if [[ "$VM_REV_MODE" == "Single" ]]; then
    pass "Revision mode: Single"
  else
    fail "Revision mode: $VM_REV_MODE (expected Single)"
  fi

  # Check containers: expect victoria-metrics and vmauth
  CONTAINER_NAMES=$(echo "$VM_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
containers = d['properties']['template']['containers']
print(' '.join(c['name'] for c in containers))
")
  if echo "$CONTAINER_NAMES" | grep -q "victoria-metrics"; then
    pass "Container 'victoria-metrics' present"
  else
    fail "Container 'victoria-metrics' missing (found: $CONTAINER_NAMES)"
  fi
  if echo "$CONTAINER_NAMES" | grep -q "vmauth"; then
    pass "Container 'vmauth' present"
  else
    fail "Container 'vmauth' missing (found: $CONTAINER_NAMES)"
  fi

  # Check min/max replicas = 1
  VM_MIN=$(echo "$VM_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['properties']['template']['scale']['minReplicas'])")
  VM_MAX=$(echo "$VM_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['properties']['template']['scale']['maxReplicas'])")
  if [[ "$VM_MIN" == "1" && "$VM_MAX" == "1" ]]; then
    pass "Replicas: min=1, max=1"
  else
    fail "Replicas: min=$VM_MIN, max=$VM_MAX (expected 1/1)"
  fi

  # Smoke test: hit the FQDN (expect 401 — vmauth requires bearer token)
  if [[ -n "$VM_FQDN" ]]; then
    VM_HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${VM_FQDN}/api/v1/query?query=up" 2>/dev/null || echo "timeout")
    if [[ "$VM_HTTP" == "401" ]]; then
      pass "Remote-write endpoint rejects unauthenticated requests (401)"
    elif [[ "$VM_HTTP" == "timeout" ]]; then
      skip "Could not reach $VM_FQDN (timeout — may be expected in CI)"
    else
      fail "Remote-write endpoint returned HTTP $VM_HTTP (expected 401)"
    fi
  fi
fi

# ==============================================================================
# 3. API Container App
# ==============================================================================
header "API Container App"

API_NAME="${ENV_NAME}-api"
API_JSON=$(az containerapp show --name "$API_NAME" --resource-group "$RG_NAME" -o json 2>/dev/null || echo "")

if [[ -z "$API_JSON" ]]; then
  skip "API Container App '$API_NAME' not deployed (api_image may be empty)"
else
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
  for expected_env in AzureAd__Instance AzureAd__TenantId AzureAd__ClientId AzureAd__Audience VictoriaMetrics__Url; do
    if echo "$API_ENVS" | grep -q "$expected_env"; then
      pass "Env var '$expected_env' configured"
    else
      fail "Env var '$expected_env' missing"
    fi
  done

  # Check VictoriaMetrics URL points to internal VM container
  VM_URL=$(echo "$API_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
envs = d['properties']['template']['containers'][0].get('env',[])
vm = next((e for e in envs if e['name'] == 'VictoriaMetrics__Url'), None)
print(vm['value'] if vm else '')
")
  if echo "$VM_URL" | grep -q "${ENV_NAME}-vm"; then
    pass "VictoriaMetrics URL points to internal VM app"
  else
    fail "VictoriaMetrics URL: $VM_URL (expected to contain '${ENV_NAME}-vm')"
  fi

  # Smoke test: health endpoint (unauthenticated)
  if [[ -n "$API_FQDN" ]]; then
    API_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${API_FQDN}/api/v1/health" 2>/dev/null || echo "timeout")
    if [[ "$API_HEALTH" == "200" || "$API_HEALTH" == "503" ]]; then
      pass "Health endpoint responded: HTTP $API_HEALTH"
    elif [[ "$API_HEALTH" == "timeout" ]]; then
      skip "Could not reach API (timeout)"
    else
      fail "Health endpoint returned HTTP $API_HEALTH (expected 200 or 503)"
    fi

    # Authenticated endpoints should reject without token
    API_NOAUTH=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${API_FQDN}/api/v1/query?query=up" 2>/dev/null || echo "timeout")
    if [[ "$API_NOAUTH" == "401" ]]; then
      pass "Query endpoint rejects unauthenticated requests (401)"
    elif [[ "$API_NOAUTH" == "timeout" ]]; then
      skip "Could not reach API (timeout)"
    else
      fail "Query endpoint returned HTTP $API_NOAUTH without token (expected 401)"
    fi

    # Prometheus metrics endpoint (unauthenticated)
    API_METRICS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${API_FQDN}/metrics" 2>/dev/null || echo "timeout")
    if [[ "$API_METRICS" == "200" ]]; then
      pass "Prometheus /metrics endpoint accessible (200)"
    elif [[ "$API_METRICS" == "timeout" ]]; then
      skip "Could not reach /metrics (timeout)"
    else
      fail "/metrics endpoint returned HTTP $API_METRICS (expected 200)"
    fi
  fi
fi

# ==============================================================================
# 4. epcube-exporter Container App
# ==============================================================================
header "epcube-exporter Container App"

EXP_NAME="${ENV_NAME}-exporter"
EXP_JSON=$(az containerapp show --name "$EXP_NAME" --resource-group "$RG_NAME" -o json 2>/dev/null || echo "")

if [[ -z "$EXP_JSON" ]]; then
  skip "epcube-exporter Container App '$EXP_NAME' not deployed (epcube_image may be empty)"
else
  pass "Container App '$EXP_NAME' exists"

  EXP_STATUS=$(echo "$EXP_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('properties',{}).get('provisioningState',''))")
  if [[ "$EXP_STATUS" == "Succeeded" ]]; then
    pass "Provisioning state: Succeeded"
  else
    fail "Provisioning state: $EXP_STATUS (expected Succeeded)"
  fi

  # Check external ingress on port 9200
  EXP_EXT=$(echo "$EXP_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['properties']['configuration']['ingress']['external'])")
  EXP_PORT=$(echo "$EXP_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['properties']['configuration']['ingress']['targetPort'])")
  if [[ "$EXP_EXT" == "True" ]]; then
    pass "Ingress: external enabled (for debug page)"
  else
    fail "Ingress: external=$EXP_EXT (expected True)"
  fi
  if [[ "$EXP_PORT" == "9200" ]]; then
    pass "Ingress target port: 9200"
  else
    fail "Ingress target port: $EXP_PORT (expected 9200)"
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
  for expected_env in EPCUBE_PORT EPCUBE_INTERVAL AZURE_TENANT_ID AZURE_CLIENT_ID AZURE_AUDIENCE; do
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
    EXP_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${EXP_FQDN}/health" 2>/dev/null || echo "timeout")
    if [[ "$EXP_HEALTH" == "200" || "$EXP_HEALTH" == "503" ]]; then
      pass "Health endpoint responded: HTTP $EXP_HEALTH"
    elif [[ "$EXP_HEALTH" == "timeout" ]]; then
      skip "Could not reach exporter (timeout)"
    else
      fail "Health endpoint returned HTTP $EXP_HEALTH (expected 200 or 503)"
    fi

    # Metrics endpoint should be unauthenticated
    EXP_METRICS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${EXP_FQDN}/metrics" 2>/dev/null || echo "timeout")
    if [[ "$EXP_METRICS" == "200" ]]; then
      pass "Metrics endpoint accessible without auth (200)"
    elif [[ "$EXP_METRICS" == "timeout" ]]; then
      skip "Could not reach /metrics (timeout)"
    else
      fail "Metrics endpoint returned HTTP $EXP_METRICS (expected 200)"
    fi

    # Debug page should require auth (401 without token)
    EXP_DEBUG=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${EXP_FQDN}/" 2>/dev/null || echo "timeout")
    if [[ "$EXP_DEBUG" == "401" ]]; then
      pass "Debug page requires JWT auth (401 without token)"
    elif [[ "$EXP_DEBUG" == "timeout" ]]; then
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
ACR_JSON=$(az acr show --name "$ACR_NAME" --resource-group "$RG_NAME" -o json 2>/dev/null || echo "")

if [[ -z "$ACR_JSON" ]]; then
  fail "Container Registry '$ACR_NAME' not found"
else
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
KV_JSON=$(az keyvault show --name "$KV_NAME" --resource-group "$RG_NAME" -o json 2>/dev/null || echo "")

if [[ -z "$KV_JSON" ]]; then
  fail "Key Vault '$KV_NAME' not found"
else
  pass "Key Vault '$KV_NAME' exists"

  KV_SOFT_DELETE=$(echo "$KV_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['properties'].get('enableSoftDelete',False))")
  if [[ "$KV_SOFT_DELETE" == "True" ]]; then
    pass "Soft delete enabled"
  else
    fail "Soft delete not enabled"
  fi

  # Check required secrets exist
  KV_SECRETS=$(az keyvault secret list --vault-name "$KV_NAME" --query "[].name" -o tsv 2>/dev/null || echo "")
  for expected_secret in remote-write-token epcube-username epcube-password; do
    if echo "$KV_SECRETS" | grep -q "^${expected_secret}$"; then
      pass "Secret '$expected_secret' exists"
    else
      fail "Secret '$expected_secret' not found"
    fi
  done
fi

# ==============================================================================
# 7. Storage Account & File Share
# ==============================================================================
header "Storage Account"

SA_NAME=$(echo "${ENV_NAME}sa" | tr -d '-')
SA_JSON=$(az storage account show --name "$SA_NAME" --resource-group "$RG_NAME" -o json 2>/dev/null || echo "")

if [[ -z "$SA_JSON" ]]; then
  fail "Storage Account '$SA_NAME' not found"
else
  pass "Storage Account '$SA_NAME' exists"

  SA_REPL=$(echo "$SA_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('sku',{}).get('name',''))")
  if [[ "$SA_REPL" == "Standard_LRS" ]]; then
    pass "Replication: Standard_LRS"
  else
    fail "Replication: $SA_REPL (expected Standard_LRS)"
  fi

  # Check file share exists
  SA_KEY=$(az storage account keys list --account-name "$SA_NAME" --resource-group "$RG_NAME" --query "[0].value" -o tsv 2>/dev/null || echo "")
  if [[ -n "$SA_KEY" ]]; then
    SHARE_EXISTS=$(az storage share exists --name "victoria-metrics-data" --account-name "$SA_NAME" --account-key "$SA_KEY" --query "exists" -o tsv 2>/dev/null || echo "false")
    if [[ "$SHARE_EXISTS" == "true" ]]; then
      pass "File share 'victoria-metrics-data' exists"

      SHARE_QUOTA=$(az storage share show --name "victoria-metrics-data" --account-name "$SA_NAME" --account-key "$SA_KEY" --query "properties.quota" -o tsv 2>/dev/null || echo "")
      if [[ "$SHARE_QUOTA" == "50" ]]; then
        pass "File share quota: 50 GB"
      else
        fail "File share quota: ${SHARE_QUOTA} GB (expected 50)"
      fi
    else
      fail "File share 'victoria-metrics-data' not found"
    fi
  else
    skip "Cannot retrieve storage key (permissions?)"
  fi
fi

# ==============================================================================
# 8. Log Analytics Workspace
# ==============================================================================
header "Log Analytics Workspace"

LAW_NAME="${ENV_NAME}-logs"
LAW_JSON=$(az monitor log-analytics workspace show --workspace-name "$LAW_NAME" --resource-group "$RG_NAME" -o json 2>/dev/null || echo "")

if [[ -z "$LAW_JSON" ]]; then
  fail "Log Analytics Workspace '$LAW_NAME' not found"
else
  pass "Log Analytics Workspace '$LAW_NAME' exists"

  LAW_RETENTION=$(echo "$LAW_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('retentionInDays',0))")
  if [[ "$LAW_RETENTION" == "30" ]]; then
    pass "Retention: 30 days"
  else
    fail "Retention: $LAW_RETENTION days (expected 30)"
  fi
fi

# ==============================================================================
# 9. Managed Identity & RBAC
# ==============================================================================
header "Managed Identity"

MI_NAME="${ENV_NAME}-identity"
MI_JSON=$(az identity show --name "$MI_NAME" --resource-group "$RG_NAME" -o json 2>/dev/null || echo "")

if [[ -z "$MI_JSON" ]]; then
  fail "Managed Identity '$MI_NAME' not found"
else
  pass "Managed Identity '$MI_NAME' exists"

  MI_PRINCIPAL=$(echo "$MI_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('principalId',''))")
  if [[ -n "$MI_PRINCIPAL" ]]; then
    pass "Principal ID assigned: ${MI_PRINCIPAL:0:8}..."

    # Check AcrPull role on ACR
    ACR_ID=$(az acr show --name "$ACR_NAME" --resource-group "$RG_NAME" --query "id" -o tsv 2>/dev/null || echo "")
    if [[ -n "$ACR_ID" ]]; then
      ACR_ROLE=$(az role assignment list --assignee "$MI_PRINCIPAL" --scope "$ACR_ID" --query "[?roleDefinitionName=='AcrPull'].roleDefinitionName" -o tsv 2>/dev/null || echo "")
      if [[ "$ACR_ROLE" == "AcrPull" ]]; then
        pass "AcrPull role assigned on Container Registry"
      else
        fail "AcrPull role not found on Container Registry"
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

ENTRA_APP=$(az ad app list --display-name "EP Cube Graph API" --query "[0]" -o json 2>/dev/null || echo "")

if [[ -z "$ENTRA_APP" || "$ENTRA_APP" == "null" ]]; then
  fail "Entra ID App Registration 'EP Cube Graph API' not found"
else
  pass "App Registration 'EP Cube Graph API' exists"

  ENTRA_URI=$(echo "$ENTRA_APP" | python3 -c "import sys,json; d=json.load(sys.stdin); uris=d.get('identifierUris',[]); print(uris[0] if uris else '')")
  if echo "$ENTRA_URI" | grep -q "api://${ENV_NAME}"; then
    pass "Identifier URI: $ENTRA_URI"
  else
    fail "Identifier URI: $ENTRA_URI (expected api://${ENV_NAME})"
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
  SP_JSON=$(az ad sp show --id "$APP_ID" -o json 2>/dev/null || echo "")
  if [[ -n "$SP_JSON" && "$SP_JSON" != "null" ]]; then
    pass "Service Principal exists for app"
  else
    fail "Service Principal not found"
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
