# Contract: `az_json` Bash helper

**Feature**: `166-validate-pg-db-check`
**File under contract**: `infra/lib/az-json.sh`
**Consumers**: `infra/validate-deployment.sh`, `infra/tests/test-az-json.sh`

This is the interface contract the validation script exposes internally. It is the
single hardening primitive applied at all audited `az` call sites (US4 / FR-009).

---

## Signature

```bash
az_json <az-args...>
```

- **Arguments**: the literal arguments to forward to the `az` CLI. The function
  prepends `az` and nothing else. Callers include `-o json` / `-o tsv` / `--query`
  as needed, exactly as today.
- **Return code**: the `az` process exit code (`$AZ_JSON_RC`). `0` ⇒ the CLI ran
  successfully (output may still be empty); non-zero ⇒ a **tool error**.

## Outputs (global variables)

| Variable | Meaning |
|----------|---------|
| `AZ_JSON_OUT` | Captured **stdout** (JSON / tsv / empty). |
| `AZ_JSON_ERR` | Captured **stderr** — the real error text on failure, empty on success. |
| `AZ_JSON_RC`  | The `az` exit code. |

## Guarantees

1. **No swallowed errors.** stderr is captured to `AZ_JSON_ERR`, never discarded to
   `/dev/null`. (Constitution rule 6 / FR-004)
2. **Exit status separate from output.** A non-zero exit is always observable via the
   return code and `AZ_JSON_RC`, independent of whether stdout was empty. (FR-005)
3. **`set -euo pipefail` compatible.** A non-zero `az` exit does **not** abort the
   surrounding script; it is captured and returned. (FR-011)
4. **Pure getter.** Does not touch `PASS`/`FAIL`/`SKIP`, does not print pass/fail/skip
   lines. Outcome policy is the caller's. (Constitution SRP / Decision B)

## Reference implementation

```bash
# infra/lib/az-json.sh
az_json() {
  local _errfile
  _errfile=$(mktemp)
  set +e
  AZ_JSON_OUT=$(az "$@" 2>"$_errfile")
  AZ_JSON_RC=$?
  set -e
  AZ_JSON_ERR=$(<"$_errfile")
  rm -f "$_errfile"
  return "$AZ_JSON_RC"
}
```

## Canonical call-site patterns

**Absence is a defect → `fail` (DB, ACR, Key Vault, Log Analytics, App Insights,
Managed Identity, Entra app, SP, PG server, CAE):**

```bash
if ! az_json acr show --name "$ACR_NAME" --resource-group "$RG_NAME" -o json; then
  fail "Container Registry '$ACR_NAME': az CLI error — ${AZ_JSON_ERR}"
elif [[ -z "$AZ_JSON_OUT" ]]; then
  fail "Container Registry '$ACR_NAME' not found"
else
  ACR_JSON="$AZ_JSON_OUT"
  pass "Container Registry '$ACR_NAME' exists"
  # ...sub-checks on $ACR_JSON...
fi
```

**Absence is legitimate → `skip` (API & exporter Container Apps):**

```bash
if ! az_json containerapp show --name "$API_NAME" --resource-group "$RG_NAME" -o json; then
  fail "API Container App '$API_NAME': az CLI error — ${AZ_JSON_ERR}"
elif [[ -z "$AZ_JSON_OUT" ]]; then
  skip "API Container App '$API_NAME' not deployed (api_image may be empty)"
else
  API_JSON="$AZ_JSON_OUT"
  pass "Container App '$API_NAME' exists"
  # ...sub-checks...
fi
```

**`-o tsv` / `--query` where empty-on-success is a meaningful result (KV secret list,
ACR id, role-assignment list):** the success path keeps its existing empty-handling;
only the **error** path changes to surface `AZ_JSON_ERR`:

```bash
if ! az_json keyvault secret list --vault-name "$KV_NAME" --query "[].name" -o tsv; then
  fail "Key Vault '$KV_NAME' secret list: az CLI error — ${AZ_JSON_ERR}"
else
  KV_SECRETS="$AZ_JSON_OUT"   # empty here = firewall fallback path, NOT a tool error
  # ...existing firewall-fallback logic unchanged...
fi
```

**Database check (Decision A):**

```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
PG_DB_ID="/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RG_NAME}/providers/Microsoft.DBforPostgreSQL/flexibleServers/${PG_NAME}/databases/epcubegraph"
if ! az_json resource show --ids "$PG_DB_ID" -o json; then
  fail "Managed PostgreSQL database 'epcubegraph': az CLI error — ${AZ_JSON_ERR}"
elif [[ -z "$AZ_JSON_OUT" ]]; then
  fail "Managed PostgreSQL database 'epcubegraph' not found"
else
  PG_DB_JSON="$AZ_JSON_OUT"
  pass "Managed PostgreSQL database 'epcubegraph' exists"
  PG_DB_CHARSET=$(echo "$PG_DB_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('properties',{}).get('charset',''))")
  # ...assert UTF8...
  PG_DB_COLLATION=$(echo "$PG_DB_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('properties',{}).get('collation',''))")
  # ...assert en_US.utf8...
fi
```

## Stub contract for tests

`infra/tests/stub-az` selects behaviour via `STUB_AZ_MODE`:

| `STUB_AZ_MODE` | stdout | stderr | exit |
|----------------|--------|--------|------|
| `success-json` | `{"properties":{"charset":"UTF8","collation":"en_US.utf8"}}` | (empty) | 0 |
| `error`        | (empty) | `... unrecognized arguments: --server-name ...` | 2 |
| `success-empty`| (empty) | (empty) | 0 |

## Test assertions (acceptance)

| Scenario | `AZ_JSON_RC` | `AZ_JSON_OUT` | `AZ_JSON_ERR` | Call-site outcome |
|----------|--------------|----------------|----------------|-------------------|
| success-json  | `0`     | the JSON | empty | pass + sub-checks |
| error         | `!= 0`  | empty    | contains `unrecognized arguments` | `fail` surfacing stderr, **not** "not found" (SC-003) |
| success-empty | `0`     | empty    | empty | absence: `fail "not found"` / `skip` (SC-004) |
