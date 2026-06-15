# Quickstart: Verify the validation hardening (Issue #166)

**Feature**: `166-validate-pg-db-check` | **Date**: 2026-06-13

Follow Red → Green → live verification, in order.

## 1. Run the unit test (RED first, then GREEN)

```bash
# Before implementing the helper — expect FAILURE (lib/az-json.sh absent):
bash infra/tests/test-az-json.sh ; echo "exit=$?"

# After adding infra/lib/az-json.sh — expect SUCCESS:
bash infra/tests/test-az-json.sh ; echo "exit=$?"   # exit=0
```

The test stubs `az` and asserts the three scenarios (success-json, error,
success-empty) plus the call-site outcomes (pass / tool-error-surfaced / absence).

## 2. Confirm no anti-pattern survives (US4 / SC-006)

```bash
# Should report 0 unguarded az occurrences (the one remaining match, if any,
# must be a documented non-az exception):
grep -n '2>/dev/null || echo ""' infra/validate-deployment.sh || echo "none remaining"
```

## 3. Live verification against production (az 2.84.0, FR-002 / SC-001)

```bash
az account show >/dev/null   # ensure logged in
cd infra
./validate-deployment.sh --rg epcubegraph-rg
```

Expect in the output:
- Section **"Managed PostgreSQL Database"**:
  - `✓ Managed PostgreSQL database 'epcubegraph' exists`
  - `✓ Database charset: UTF8`
  - `✓ Database collation: en_US.utf8`
- Summary: **zero** failures attributable to the database check; `RESULT: PASS`
  (assuming production is healthy).

## 4. Confirm a forced CLI error surfaces (US2 / SC-003)

Temporarily point `az` at the stub in error mode and run just the DB block, or rely on
the unit test scenario `error`, which asserts the message contains the real stderr
(`unrecognized arguments`) and **not** "database not found".

## 5. Final green on the runner (>= 2.86.0, SC-005)

Confirmed by the production CD **`validate-prod`** gate run after merge — this is the
only place the runner's auto-updated az (>= 2.86.0) executes. The `validate-prod` job
must transition from RED to GREEN.

## Files touched

| File | Change |
|------|--------|
| `infra/lib/az-json.sh` | **new** — the `az_json` helper |
| `infra/validate-deployment.sh` | source the lib; replace all 17 sites; new DB command + `.properties.*` paths |
| `infra/tests/stub-az` | **new** — fake `az` for tests |
| `infra/tests/test-az-json.sh` | **new** — bash test runner |
| CI workflow (validation/lint job) | add `bash infra/tests/test-az-json.sh` step |
