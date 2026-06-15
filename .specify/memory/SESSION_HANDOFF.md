# Session Handoff — 2026-06-14

## Why this handoff exists

Issue #166 (validate-prod CD failure) is in active development on branch
`166-validate-pg-db-check`. A **critical design discovery was made at session
end** that must be applied before the remaining call-site conversions proceed.
Do NOT start converting the 17 az call sites until after applying the design
revision described below.

## Current branch / tree state

- Branch: `166-validate-pg-db-check` (local only — NOT pushed to origin)
- Commit: `eb93845` (WIP commit, everything done this session is in it)
- Working tree: clean after WIP commit
- `main` is at `504a39c` (PR #165 merge) — no change
- Docker prod-local stack: leave running (do NOT tear down)
- No other stashes or abandoned branches

## What is DONE (do not redo)

1. **Full spec-kit artifacts** under `specs/166-validate-pg-db-check/`: spec.md, plan.md, research.md, data-model.md, contracts/az-json.md, quickstart.md, tasks.md (27 tasks). Analysis passed GO with zero critical/high issues.
2. **`infra/lib/az-json.sh`**: `az_json()` helper implemented and working.
3. **`infra/tests/stub-az`**: stub `az` with `STUB_AZ_MODE` in three modes.
4. **`infra/tests/test-az-json.sh`**: 15-assertion test — Red confirmed, Green confirmed (15/15 pass). Run `bash infra/tests/test-az-json.sh` to re-verify.
5. **`infra/validate-deployment.sh`**: sources `lib/az-json.sh` after the helper block.
6. **`.github/agents/copilot-instructions.md`**: speckit boilerplate added for #166.

## CRITICAL DISCOVERY: az CLI absence behavior

**The original call-site contract in `specs/166-validate-pg-db-check/contracts/az-json.md` is wrong for the absence case.**

Live-verified behavior (az 2.84.0 against production):
```
az resource show --ids "/subscriptions/.../databases/nonexistentdb"
→ rc=3, stdout=(empty), stderr="ResourceNotFound ... not found"

az containerapp show --name "epcubegraph-nonexistent" --resource-group "..."
→ rc=1, stdout=(empty), stderr="ResourceNotFound ... not found"

az resource show --ids "/subscriptions/.../databases/epcubegraph"  (EXISTS)
→ rc=0, stdout=JSON with .properties.charset/collation, stderr=(empty)
```

**Conclusion:** There is NO "zero-exit-with-empty-stdout" case for missing resources. A missing resource exits non-zero (rc=1 or rc=3) with "ResourceNotFound" on stderr. The current `success-empty` stub mode and `elif [[ -z "$AZ_JSON_OUT" ]]` branch in the contract do NOT reflect real az CLI behavior.

The CORRECT three-branch pattern is:
```
rc=0                               → PRESENT (JSON on stdout)
rc!=0, stderr contains "NotFound"  → ABSENT  (fail or skip per policy)
rc!=0, other stderr                → TOOL ERROR (surface AZ_JSON_ERR)
```

## What to do NEXT SESSION (in order)

### Step 1: Update `stub-az` (replace `success-empty` with `resource-not-found`)

In `infra/tests/stub-az`, replace the `success-empty` mode with `resource-not-found`:
```bash
  resource-not-found)
    printf '%s\n' "ERROR: (ResourceNotFound) The resource was not found." >&2
    exit 3
    ;;
```
Keep `success-json` and `error` as-is.

### Step 2: Update `test-az-json.sh` (Scenario 3: absence via non-zero rc)

Replace the `success-empty` scenario with `resource-not-found`. Update `decide_db()`:
```bash
decide_db() {
  if ! az_json resource show --ids "/fake/db/id" -o json; then
    if [[ "$AZ_JSON_ERR" == *"ResourceNotFound"* || "$AZ_JSON_ERR" == *"not found"* ]]; then
      echo "NOT_FOUND"
    else
      echo "TOOL_ERROR: ${AZ_JSON_ERR}"
    fi
  else
    echo "PRESENT"
  fi
}
```
New Scenario 3 assertions:
- `AZ_JSON_RC != 0` (rc=3 from stub)
- `AZ_JSON_OUT` is empty
- `AZ_JSON_ERR` contains "ResourceNotFound"
- `decide_db` returns "NOT_FOUND"
- Verify Scenario 2 (`error` mode / "unrecognized arguments") still returns "TOOL_ERROR" not "NOT_FOUND"

Re-run `bash infra/tests/test-az-json.sh` and confirm Green.

### Step 3: Update `contracts/az-json.md`

Replace the stub contract table and call-site patterns to match the corrected behavior. Key patterns:

**Required resource** (DB, ACR, KV, logs, appinsights, identity, entra):
```bash
if ! az_json resource show --ids "$PG_DB_ID" -o json; then
  if [[ "$AZ_JSON_ERR" == *"ResourceNotFound"* || "$AZ_JSON_ERR" == *"not found"* ]]; then
    fail "Managed PostgreSQL database 'epcubegraph' not found"
  else
    fail "Managed PostgreSQL database 'epcubegraph': az CLI error — ${AZ_JSON_ERR}"
  fi
else
  PG_DB_JSON="$AZ_JSON_OUT"
  pass "Managed PostgreSQL database 'epcubegraph' exists"
  ...charset/collation sub-checks...
fi
```

**Optional resource** (API/exporter — legitimately absent when not deployed):
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
  ...sub-checks...
fi
```

**tsv commands** (KV secret list, ACR id, role assignment) — zero-exit with empty stdout IS valid (empty list is not an error):
```bash
if ! az_json keyvault secret list --vault-name "$KV_NAME" --query "[].name" -o tsv; then
  fail "Key Vault '$KV_NAME' secret list: az CLI error — ${AZ_JSON_ERR}"
else
  KV_SECRETS="$AZ_JSON_OUT"  # empty = firewall fallback, not a tool error
  ...existing firewall fallback logic unchanged...
fi
```

### Step 4: Convert the 17 call sites in `infra/validate-deployment.sh` (T009-T023)

With the corrected pattern, convert all sites sequentially (same file — no parallel edits):

| Section | ~Line | Pattern |
|---------|-------|---------|
| 1 Container Apps Env | 86 | fail-on-absence |
| 2 PostgreSQL server | 107 | fail-on-absence |
| 3 API Container App | 170 | **skip-on-absence** |
| 4 exporter Container App | 273 | **skip-on-absence** |
| 5 ACR | 377 | fail-on-absence |
| 6 Key Vault | 405 | fail-on-absence |
| 6 KV secrets | 420 | tsv pattern (empty=firewall fallback) |
| 6 KV fallback exporter | 423 | fail-on-absence |
| 6 KV env query | 430 | remove python parse stderr swallow |
| **7 DB check (THE FIX)** | **457** | **fail-on-absence, `az resource show --ids`, `.properties.*`** |
| 8 Log Analytics | 485 | fail-on-absence |
| 8b App Insights | 506 | fail-on-absence |
| 9 Managed Identity | 550 | fail-on-absence |
| 9 ACR id | 562 | tsv pattern |
| 9 role list | 564 | tsv pattern (empty=role not assigned → fail) |
| 10 Entra app | 581 | fail-on-absence (also guard `== "null"`) |
| 10 SP show | 619 | fail-on-absence |

DB resource ID (version-stable, confirmed live on az 2.84.0):
```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
PG_DB_ID="/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RG_NAME}/providers/Microsoft.DBforPostgreSQL/flexibleServers/${PG_NAME}/databases/epcubegraph"
```
DB response: `.properties.charset` = `"UTF8"`, `.properties.collation` = `"en_US.utf8"` (live-verified).

### Step 5: Verify and close

- `bash infra/tests/test-az-json.sh` → Green
- `grep -n '2>/dev/null || echo ""' infra/validate-deployment.sh` → zero hits
- `cd infra && ./validate-deployment.sh --rg epcubegraph-rg` → RESULT: PASS
- Wire test into CI (`validate-infra` job in `.github/workflows/ci.yml`); confirm `infra/**` is in the `changes` path filter so `infra/tests/**` triggers it
- Push branch, open PR referencing #166, wait for CD `validate-prod` to go GREEN

## #164 investigation notes

Leading hypothesis: workspace-based App Insights. Query `AppPageViews` in Log Analytics directly:
```bash
az monitor app-insights component show --app epcubegraph-appinsights \
  -g epcubegraph-rg -o json | jq '{ingestionMode,workspaceResourceId}'

az monitor log-analytics query -w <workspace-guid> \
  --analytics-query "AppPageViews | where TimeGenerated > ago(24h) | take 20" -o table
```
Do NOT close #164 until pageViews are visibly queryable (5-minute debug limit applies).

## #167 (CSP)

Add `https://js.monitor.azure.com` to `connect-src` in
`dashboard/public/staticwebapp.config.json` (narrow, no wildcard). Separate branch/PR.

## Must NOT do

- Do NOT start converting the 17 call sites before updating stub/test/contracts (Steps 1-3 above)
- Do NOT close #164 until pageViews are visibly queryable
- Do NOT shut down the local Docker prod-local stack
- Do NOT squash-merge (always merge commit)
- Do NOT push the WIP branch without completing it (commit message says "wip")
