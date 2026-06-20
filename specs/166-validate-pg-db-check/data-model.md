# Data Model: Validation Outcomes & the `az_json` Helper

**Feature**: `166-validate-pg-db-check` | **Date**: 2026-06-13

This is a Bash tooling change; "entities" are runtime states and the helper's
input/output contract rather than persisted records. No database schema, no
application model.

---

## Entity 1 — Validation Check Outcome

A single named assertion about a deployed resource. Existing outcomes are unchanged in
their reporting helpers; the change adds an internal **distinction between two kinds of
fail**.

| Outcome | Reporting helper | Counter | Meaning |
|---------|------------------|---------|---------|
| pass    | `pass()`         | `PASS`  | Resource present / property as expected |
| skip    | `skip()`         | `SKIP`  | Legitimately not applicable (optional app not deployed, endpoint timeout) — **preserved** (FR-013) |
| fail — **absence** | `fail("… not found")` | `FAIL` | Resource genuinely missing (true negative, US3) |
| fail — **tool/CLI error** *(new distinction)* | `fail("…: az CLI error — <stderr>")` | `FAIL` | Underlying `az` exited non-zero for a non-absence reason; real stderr surfaced (US2) |

State transitions (per check): the underlying `az` invocation maps to exactly one
outcome:

```
az exit != 0                      → fail (tool error, surface AZ_JSON_ERR)
az exit == 0 AND output empty     → absence policy: fail "not found"  OR  skip (site-specific)
az exit == 0 AND output non-empty → pass, then run sub-checks on the JSON
```

Invariants:
- Exit-code contract unchanged: `FAIL > 0` ⇒ script exits 1; else exits 0 (FR-012, SC-007).
- A present resource whose detail-read fails for a tooling reason MUST NOT be reported as
  absent (spec edge case; enforced because the `az exit != 0` branch is checked first).

---

## Entity 2 — `az_json` Helper Contract

| Aspect | Value |
|--------|-------|
| Location | `infra/lib/az-json.sh` (sourced by `validate-deployment.sh` and by tests) |
| Input | `az_json <az-args...>` — the exact arguments to pass to `az` (e.g. `containerapp show --name X -o json`) |
| Output: `AZ_JSON_OUT` | stdout of the command (JSON, tsv, or empty string) |
| Output: `AZ_JSON_ERR` | stderr of the command (the real error text on failure; empty on success) |
| Output: `AZ_JSON_RC`  | the `az` process exit code (0 = ran OK; non-zero = tool error) |
| Return value | `AZ_JSON_RC` (so `if az_json …; then` branches on success/failure) |
| Side effects | Creates and removes one temp file (for stderr capture); sets the three globals |
| Single responsibility | **Execute + capture only.** Does not call `pass`/`fail`/`skip`, does not decide policy. |
| `set -e` safety | Capture wrapped in `set +e … set -e`; capture line is not `local` (avoids `$?` masking) |

Validation rules for the helper:
- MUST NOT redirect stderr to `/dev/null` (rule 6 / FR-004).
- MUST capture exit status separately from stdout (FR-005).
- MUST remain a no-op on the global PASS/FAIL/SKIP counters (decision belongs to callers).

---

## Entity 3 — PostgreSQL Database Resource (the failing check)

| Attribute | Asserted value | New source path |
|-----------|----------------|-----------------|
| existence | present | `az resource show --ids "$PG_DB_ID"` exit 0 + non-empty |
| charset   | `UTF8` | `.properties.charset` |
| collation | `en_US.utf8` | `.properties.collation` |

Derived input:
- `SUBSCRIPTION_ID = az account show --query id -o tsv`
- `PG_DB_ID = /subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RG_NAME}/providers/Microsoft.DBforPostgreSQL/flexibleServers/${PG_NAME}/databases/epcubegraph`
- `PG_NAME` and `RG_NAME` already exist in scope earlier in the script.
