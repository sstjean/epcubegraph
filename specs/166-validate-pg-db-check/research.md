# Research: Reliable Post-Deployment Validation (Issue #166)

**Feature**: `166-validate-pg-db-check`
**Date**: 2026-06-13
**Input**: [spec.md](spec.md)

All findings below were verified against the **live production environment** and the
**maintainer's local az CLI 2.84.0** (the version that predates the 2.86.0 breaking
change), not assumed from documentation.

---

## Decision A — Version-stable database existence check

### Decision

Replace the database check command:

```bash
# OLD (breaks on az >= 2.86.0 — flags removed):
az postgres flexible-server db show \
  --resource-group "$RG_NAME" --server-name "$PG_NAME" --database-name "epcubegraph" -o json
```

with a **generic ARM resource read by resource ID**, which is unaffected by the
`postgres` extension's flag churn:

```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
PG_DB_ID="/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RG_NAME}/providers/Microsoft.DBforPostgreSQL/flexibleServers/${PG_NAME}/databases/epcubegraph"
az resource show --ids "$PG_DB_ID" -o json
```

### Charset / collation field paths (FR-008) — CONFIRMED LIVE

The legacy command returned `charset` / `collation` at the **top level**. `az resource
show` returns them **nested under `.properties`**. Verified by running both commands
against the real production database on az 2.84.0:

| Field     | Legacy `flexible-server db show` | `az resource show --ids` (new) |
|-----------|----------------------------------|--------------------------------|
| charset   | `.charset` → `"UTF8"`            | `.properties.charset` → `"UTF8"` |
| collation | `.collation` → `"en_US.utf8"`   | `.properties.collation` → `"en_US.utf8"` |

Live output of the new command (production, az 2.84.0):

```json
{
  "id": ".../flexibleServers/epcubegraph-postgres/databases/epcubegraph",
  "name": "epcubegraph",
  "properties": { "charset": "UTF8", "collation": "en_US.utf8" },
  "type": "Microsoft.DBforPostgreSQL/flexibleServers/databases"
}
```

**Result**: the charset/collation assertions are **preserved**, with the extraction
path changing from `d.get('charset','')` to `d.get('properties',{}).get('charset','')`
(and likewise for collation). No sub-checks are dropped; FR-008 is satisfied by
sourcing the same fields from the same resource via a version-stable command.

### Rationale

- `az resource show --ids` is a core ARM command, **not** part of the `postgres`
  extension whose flags broke in 2.86.0 → straddles the version boundary (FR-002, FR-003).
- The resource ID is **constructed from values already in scope** (`$RG_NAME`,
  `$PG_NAME`, plus `$SUBSCRIPTION_ID` from `az account show`) — no deprecated command
  is reintroduced to discover it (spec "Resource ID availability" edge case).
- Confirmed present-when-present on az 2.84.0; the same generic command behaves
  identically on the runner's >= 2.86.0 (final green confirmed by the CD run).

### Alternatives considered

- **New post-2.86.0 `flexible-server db show` flag spelling** — rejected: would have to
  branch on CLI version (fragile), and still depends on the volatile extension surface.
- **Source charset/collation from the server JSON already fetched in section 2** —
  rejected: the server object does not carry per-database charset/collation; only the
  database resource does.
- **Drop the charset/collation sub-checks** — rejected: unnecessary, since
  `az resource show` exposes both fields (live-confirmed). Dropping them would weaken
  the gate with no benefit (violates "preserve true negatives").

---

## Decision B — Reusable helper that distinguishes CLI error from resource absence

### Decision

Introduce a single **getter** helper, `az_json`, extracted into a sourced library
`infra/lib/az-json.sh`. Its one job (SRP) is: run an `az` command, capture stdout,
stderr, and exit code **separately**, and surface the exit code as the signal — it does
**not** decide pass/fail/skip.

```bash
# az_json <az-args...>
#   Runs `az <az-args...>`, capturing output without swallowing stderr.
#   Sets globals:
#     AZ_JSON_OUT  stdout (JSON / tsv / empty)
#     AZ_JSON_ERR  stderr (the REAL error text on failure)
#     AZ_JSON_RC   the az exit code
#   Returns AZ_JSON_RC (0 = CLI ran OK; non-zero = TOOL error).
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

Each call site then applies its own three-way decision (the policy that legitimately
**varies** per site — `fail` vs `skip` on absence):

```bash
if ! az_json containerapp show --name "$API_NAME" --resource-group "$RG_NAME" -o json; then
  fail "API Container App '$API_NAME': az CLI error — ${AZ_JSON_ERR}"   # TOOL error (US2)
elif [[ -z "$AZ_JSON_OUT" ]]; then
  skip "API Container App '$API_NAME' not deployed (api_image may be empty)"  # absence policy: skip here
else
  API_JSON="$AZ_JSON_OUT"
  pass "Container App '$API_NAME' exists"                                # present (US1)
  # ...sub-checks...
fi
```

For checks where absence is a defect (PostgreSQL DB, ACR, Key Vault, etc.) the middle
branch is `fail "... not found"` (US3 true negative) instead of `skip`.

### Why getter-only and not a fixed-policy "require_resource"

The constitution's SRP principle requires separating "get the data" from "decide what to
do with it." Absence policy genuinely differs across sites — the API/exporter Container
Apps `skip` when absent (legitimately not deployed, FR-013), while the database/ACR/KV
`fail` when absent. A single fixed-policy helper cannot encode both without a flag
argument that just re-smuggles the decision back in. Keeping `az_json` as a pure getter
makes it independently unit-testable with a stubbed `az`, and keeps the per-site
`fail`/`skip` choice visible at the site where it matters. This is the DRY win the spec
asks for: **one** helper (the error-vs-absence distinction) applied at all ~17 sites,
not 17 copy-pasted `2>/dev/null || echo ""` lines.

### `set -euo pipefail` safety (FR-005, FR-011) — the exact safe pattern

Two pitfalls, both handled:

1. **Command substitution failure under `set -e`.** `VAR=$(az ...)` where `az` exits
   non-zero **will** trigger `set -e` and abort the script. The helper wraps the capture
   in `set +e; AZ_JSON_OUT=$(...); AZ_JSON_RC=$?; set -e` so a non-zero az exit is
   *captured* (the whole point) instead of killing the run.
2. **`local` masks `$?`.** `local VAR=$(cmd); rc=$?` always yields `rc=0` because
   `local` itself succeeds. The globals (`AZ_JSON_OUT` etc.) are assigned **without**
   `local` on the same line as the capture, and `AZ_JSON_RC=$?` reads the substitution's
   status directly. `_errfile` is the only `local`, declared on its own line before use.

stderr is captured to a temp file (not `2>/dev/null`) so the real error text is
available in `AZ_JSON_ERR` — directly satisfying "No silent error swallowing"
(constitution rule 6) and FR-004.

### Rationale

- One job → testable, composable, satisfies SRP.
- Captures rc separately from stdout → satisfies FR-005 and the spec's "exit code vs
  stdout" edge case.
- Never routes stderr to `/dev/null` → satisfies FR-004/US2 and rule 6.

### Alternatives considered

- **`az_json` returns a tri-state string ("ok"/"absent"/"error")** — rejected: redundant;
  the exit code + empty-check already encodes the three states, and a string return can't
  also carry the JSON.
- **`process substitution` `2> >(cat)`** — rejected: harder to capture stderr into a
  variable reliably under `set -e`; temp file is simpler and portable.

---

## Decision C — Testing strategy (TDD honoured pragmatically for Bash)

### Decision

Use a **self-contained Bash test** with a **stub `az` on `PATH`** — **no bats-core**
(YAGNI: a new test-framework dependency is not justified for one small helper, and would
require a `scripts/tools.json` + setup-script + DEVELOP.md sync per the Tool Sync
principle).

Artifacts:

- `infra/lib/az-json.sh` — the helper, **sourced** by `validate-deployment.sh` so it can
  also be sourced standalone by the test (no need to execute the whole validation).
- `infra/tests/stub-az` — a fake `az` whose behaviour is selected by an env var
  (`STUB_AZ_MODE`): `success-json`, `error`, `success-empty`.
- `infra/tests/test-az-json.sh` — plain-bash runner (exits non-zero on first failure)
  that, with the stub first on `PATH`, asserts:
  1. **success-json** → `AZ_JSON_RC=0`, `AZ_JSON_OUT` = the JSON, `AZ_JSON_ERR` empty.
  2. **error (exit non-zero, stderr "unrecognized arguments")** → `AZ_JSON_RC != 0`,
     `AZ_JSON_ERR` contains the real stderr, `AZ_JSON_OUT` empty — and a representative
     call-site block emits the **real error**, not "not found" (US2 / SC-003).
  3. **success-empty** → `AZ_JSON_RC=0`, `AZ_JSON_OUT` empty — the call-site block reports
     **absence** ("not found" / `skip`), distinct from the error case (US3 / SC-004).

These three scenarios exercise **every branch** of `az_json` (success-nonempty,
success-empty, failure) plus the three call-site outcomes (present / absent / tool-error),
giving full branch coverage of the new logic without a coverage tool. If `kcov` is
present locally it MAY be run for a line-coverage figure, but no new tool is introduced
or gated (Simplicity/YAGNI).

### Red → Green order (constitution TDD, NON-NEGOTIABLE)

1. Write `infra/tests/test-az-json.sh` + `stub-az` first; run → **RED** (helper/lib
   absent).
2. Add `infra/lib/az-json.sh` with `az_json` → run test → **GREEN**.
3. Refactor `validate-deployment.sh` to source the lib and replace all 17 sites; re-run
   test → still **GREEN**.

### Live verification (end-to-end, before declaring done)

- Run the **real** `infra/validate-deployment.sh` against production with local az
  **2.84.0** — section 7 (PostgreSQL Database) must report present + correct
  charset/collation, and the overall run must have **zero DB-attributable failures**
  (SC-001, SC-002, FR-002).
- Final green on the runner's **>= 2.86.0** is confirmed by the actual production CD
  `validate-prod` gate run (cannot be reproduced locally without that CLI; documented as
  the closing verification, SC-005).

### CI wiring

The new bash test is a test suite, so per the constitution it needs a CI job. The plan's
tasks include adding `infra/tests/test-az-json.sh` to the CI workflow that already runs
validation/lint steps (a lightweight `bash infra/tests/test-az-json.sh` step), so it runs
on every push (CI Test Coverage principle).

### Alternatives considered

- **bats-core** — rejected: adds a tool + three-file sync obligation (Tool Sync
  principle) for a single helper; a plain-bash runner with a stub `az` is sufficient.
- **Mocking `az` via a bash function override instead of a PATH stub** — viable, but a
  PATH stub more faithfully reproduces the real "az invoked as a process" path and is
  reusable across future infra tests.

---

## Anti-pattern inventory (US4 / FR-009) — verified line numbers

`grep -n '2>/dev/null || echo ""' infra/validate-deployment.sh` → **17 matches**, exactly
as catalogued in the issue. 16 are `az` invocations (remediated via `az_json`); **1**
(line 430) is the tail of a `python3 -c` JSON-parse fallback, a different category.

| # | Line | Command | Absence policy | Remediation |
|---|------|---------|----------------|-------------|
| 1 | 86  | `az containerapp env show` (CAE)        | fail | `az_json` |
| 2 | 107 | `az postgres flexible-server show` (server) | fail | `az_json` |
| 3 | 170 | `az containerapp show` (API)            | **skip** (not deployed) | `az_json` |
| 4 | 273 | `az containerapp show` (exporter)       | **skip** (not deployed) | `az_json` |
| 5 | 377 | `az acr show`                           | fail | `az_json` |
| 6 | 405 | `az keyvault show`                      | fail | `az_json` |
| 7 | 420 | `az keyvault secret list … -o tsv`      | empty=firewall fallback (not absence) | `az_json` (tool error vs empty-list) |
| 8 | 423 | `az containerapp show` (exporter, KV fallback) | fail-in-context | `az_json` |
| 9 | 430 | `python3 -c …` JSON parse of already-fetched JSON | n/a (not az) | drop the swallow; let a genuine parse error surface |
| 10 | 457 | `az postgres flexible-server db show` (**the bug**) | fail | **Decision A** (`az resource show --ids` via `az_json`) |
| 11 | 485 | `az monitor log-analytics workspace show` | fail | `az_json` |
| 12 | 506 | `az monitor app-insights component show` | fail | `az_json` |
| 13 | 550 | `az identity show`                      | fail | `az_json` |
| 14 | 562 | `az acr show … --query id -o tsv`       | empty=skip RBAC sub-check | `az_json` (tool error vs empty) |
| 15 | 564 | `az role assignment list … -o tsv`      | empty=role missing (fail) | `az_json` (tool error vs empty-list) |
| 16 | 581 | `az ad app list … --query "[0]"`        | `null`/empty = fail | `az_json` (also keep `== "null"` check) |
| 17 | 619 | `az ad sp show`                         | `null`/empty = fail | `az_json` |

Notes:
- **tsv/`--query` sites (7, 14, 15):** an empty result on **exit 0** is a legitimate
  "no rows" the caller already interprets (firewall fallback, optional RBAC, role
  missing). `az_json` makes the **non-zero** case surface the real error instead of being
  swallowed — the empty-but-successful case keeps its existing meaning (FR-013 skips
  preserved).
- **Line 430 (python parse):** `EXP_CONTAINER_JSON` is already validated non-empty JSON
  upstream, so the parse cannot legitimately fail on absence. The `2>/dev/null || echo ""`
  is removed so any unexpected `python3` error surfaces instead of silently yielding an
  empty secret list (rule 6). This is the "explicitly documented, justified" branch of
  FR-009 for the one non-`az` occurrence.

---

## Summary of resolved unknowns

| Unknown (from spec) | Resolution |
|---------------------|------------|
| Version-stable DB command | `az resource show --ids <constructed db id>` (Decision A) |
| Do charset/collation survive? | Yes — `.properties.charset` / `.properties.collation`, live-confirmed |
| Subscription id source | `az account show --query id -o tsv` (already authenticated) |
| Error-vs-absence helper | `az_json` getter, sets `AZ_JSON_OUT/ERR/RC` (Decision B) |
| `set -e` capture pattern | `set +e; OUT=$(...); RC=$?; set -e`; stderr→tempfile; no `local` on capture |
| Test framework | Stub-`az` + plain-bash runner; **no** bats (Decision C) |
| Coverage approach | 3 scenarios cover all helper branches; kcov optional, ungated |
