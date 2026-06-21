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
- **Return code**: the `az` process exit code (`$AZ_JSON_RC`). `0` ⇒ resource
  present (JSON/tsv on stdout); non-zero ⇒ either a **missing resource** (rc=1
  or rc=3, `ResourceNotFound` on stderr) or a **tool error** (other stderr).

> **Live-verified (az 2.84.0):** `az resource show --ids <missing>` exits
> rc=3 with `ResourceNotFound` on stderr; `az containerapp show <missing>`
> exits rc=1 with `ResourceNotFound`. Neither produces rc=0 with empty stdout.
> Callers must inspect `AZ_JSON_ERR` inside the failure branch to distinguish
> absence from a real tool error.

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
  if [[ "$AZ_JSON_ERR" == *"ResourceNotFound"* || "$AZ_JSON_ERR" == *"not found"* ]]; then
    fail "Container Registry '$ACR_NAME' not found"
  else
    fail "Container Registry '$ACR_NAME': az CLI error — ${AZ_JSON_ERR}"
  fi
else
  ACR_JSON="$AZ_JSON_OUT"
  pass "Container Registry '$ACR_NAME' exists"
  # ...sub-checks on $ACR_JSON...
fi
```

**Absence is legitimate → `skip` (API & exporter Container Apps):**

```bash
if ! az_json containerapp show --name "$API_NAME" --resource-group "$RG_NAME" -o json; then
  if [[ "$AZ_JSON_ERR" == *"ResourceNotFound"* || "$AZ_JSON_ERR" == *"not found"* ]]; then
    skip "API Container App '$API_NAME' not deployed (api_image may be empty)"
  else
    fail "API Container App '$API_NAME': az CLI error — ${AZ_JSON_ERR}"
  fi
else
  API_JSON="$AZ_JSON_OUT"
  pass "Container App '$API_NAME' exists"
  # ...sub-checks...
fi
```

**`-o tsv` / `--query` where empty-on-success is a meaningful result (ACR id,
role-assignment list):** the success path keeps its existing empty-handling;
only the **error** path changes to surface `AZ_JSON_ERR`.

**Recoverable error with a designed fallback (KV secret list):** the KV firewall
(public network access disabled) blocks the runner's data-plane access, so the
secret-list call exits **non-zero with a `Forbidden` message** (live-verified —
*not* rc=0 with empty stdout). That is an expected, recoverable condition that
must route to the Container App fallback, while any *other* non-zero exit is a
genuine tool failure:

```bash
KV_DATAPLANE_BLOCKED=false
KV_SECRETS=""
if ! az_json keyvault secret list --vault-name "$KV_NAME" --query "[].name" -o tsv; then
  if [[ "$AZ_JSON_ERR" == *"Forbidden"* \
     || "$AZ_JSON_ERR" == *"Public network access is disabled"* \
     || "$AZ_JSON_ERR" == *"not from a trusted service"* ]]; then
    KV_DATAPLANE_BLOCKED=true                  # expected: fall back to Container App
  else
    fail "Key Vault '$KV_NAME' secret list: az CLI error — ${AZ_JSON_ERR}"
  fi
else
  KV_SECRETS="$AZ_JSON_OUT"
  [[ -z "$KV_SECRETS" ]] && KV_DATAPLANE_BLOCKED=true   # empty-on-success also = blocked
fi
# if KV_DATAPLANE_BLOCKED: verify secrets via Container App; else grep KV_SECRETS
```

**Database check (Decision A):**

```bash
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
  PG_DB_CHARSET=$(echo "$PG_DB_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('properties',{}).get('charset',''))")
  # ...assert UTF8...
  PG_DB_COLLATION=$(echo "$PG_DB_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('properties',{}).get('collation',''))")
  # ...assert en_US.utf8...
fi
```

## Stub contract for tests

`infra/tests/stub-az` selects behaviour via `STUB_AZ_MODE`:

| `STUB_AZ_MODE`        | stdout  | stderr | exit |
|-----------------------|---------|--------|------|
| `success-json`        | `{"properties":{"charset":"UTF8","collation":"en_US.utf8"}}` | (empty) | 0 |
| `error`               | (empty) | `... unrecognized arguments: --server-name ...` | 2 |
| `resource-not-found`  | (empty) | `ERROR: (ResourceNotFound) The resource was not found.` | 3 |
| `forbidden`           | (empty) | `ERROR: (Forbidden) Public network access is disabled and request is not from a trusted service nor via an approved private link.` | 1 |

## Test assertions (acceptance)

| Scenario | `AZ_JSON_RC` | `AZ_JSON_OUT` | `AZ_JSON_ERR` | Call-site outcome |
|----------|--------------|----------------|----------------|-------------------|
| success-json       | `0`     | the JSON | empty | pass + sub-checks |
| error              | `!= 0`  | empty    | contains `unrecognized arguments` | `fail` surfacing stderr, **not** "not found" (SC-003) |
| resource-not-found | `3`     | empty    | contains `ResourceNotFound` | absence: `fail "not found"` / `skip` (SC-004) |
| forbidden          | `1`     | empty    | contains `Forbidden`        | recoverable: route to Container App fallback (`DATAPLANE_BLOCKED`), **not** a tool error |
