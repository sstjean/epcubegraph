# Tasks: Reliable Post-Deployment Validation (No False Negatives, No Swallowed CLI Errors)

**Input**: Design documents from `/specs/166-validate-pg-db-check/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/az-json.md, quickstart.md

**Tests**: Tests ARE included — the TDD regression test (`infra/tests/test-az-json.sh` + `infra/tests/stub-az`) is the **NON-NEGOTIABLE Red artifact** required by the constitution and is written FIRST, before the `az_json` helper exists.

**Organization**: Tasks are grouped by user story. Because this is a single-script hardening change, US1/US2/US3 are the three branches (present / tool-error / absence) of the same call-site block and are delivered together at the PostgreSQL DB site; US4 applies the identical distinction to the remaining ~16 sites in the same file.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1, US2, US3, US4 (maps to spec.md user stories)
- Exact file paths are included in each task

## ⚠️ Same-file serialization note

The bulk of US4 edits the **single file** `infra/validate-deployment.sh`. Those call-site
conversions are deliberately **NOT marked [P]** — concurrent edits to the same file would
collide. They run sequentially. Only tasks touching genuinely independent files
(`infra/lib/az-json.sh`, `infra/tests/stub-az`, `infra/tests/test-az-json.sh`,
`.github/workflows/ci.yml`) are eligible for [P].

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the new lib/tests structure and ground edits against the live script.

- [x] T001 Review `infra/validate-deployment.sh` and confirm the section-7 PostgreSQL DB check (~line 457) and the 17 anti-pattern sites against the inventory in [research.md](research.md) (`grep -n '2>/dev/null || echo ""' infra/validate-deployment.sh` should return 17 matches)
- [x] T002 [P] Create directories `infra/lib/` and `infra/tests/` per plan.md structure

---

## Phase 2: Foundational (TDD Red → Green for `az_json`)

**Purpose**: The `az_json` getter + its stubbed-`az` test are the single hardening primitive every user story depends on. Per the constitution, the test is written FIRST and must be RED before the helper exists.

**⚠️ CRITICAL**: No call-site work (US1–US4) may begin until the helper is GREEN (T007).

- [x] T003 [P] Create stub `infra/tests/stub-az` — a fake `az` whose behavior is selected by `STUB_AZ_MODE` with the three modes from [contracts/az-json.md](contracts/az-json.md): `success-json` (charset/collation JSON, exit 0), `error` (empty stdout, stderr `... unrecognized arguments: --server-name ...`, exit 2), `success-empty` (empty stdout, exit 0); `chmod +x`
- [x] T004 Write `infra/tests/test-az-json.sh` (the **RED** artifact) — plain-bash runner that puts `infra/tests/stub-az` first on `PATH`, sources `infra/lib/az-json.sh`, and asserts all three scenarios + call-site outcomes from the contract: success-json → `AZ_JSON_RC=0` / `AZ_JSON_OUT`=JSON / `AZ_JSON_ERR` empty; error → `AZ_JSON_RC!=0` / `AZ_JSON_ERR` contains `unrecognized arguments` / a call-site block emits the real error **not** "not found" (US2/SC-003); success-empty → `AZ_JSON_RC=0` / `AZ_JSON_OUT` empty / call-site reports absence (US3/SC-004); `chmod +x`
- [x] T005 Run `bash infra/tests/test-az-json.sh` and confirm it **FAILS** (RED — `infra/lib/az-json.sh` absent). Do not proceed until Red is verified
- [x] T006 Implement `infra/lib/az-json.sh` defining `az_json()` per the reference implementation in [contracts/az-json.md](contracts/az-json.md): `set +e`/`set -e`-wrapped capture into `AZ_JSON_OUT`, stderr to a temp file then `AZ_JSON_ERR` (never `/dev/null`), `AZ_JSON_RC=$?`, `return "$AZ_JSON_RC"`; pure getter (no pass/fail/skip, no counter mutation); `_errfile` the only `local`
- [x] T007 Run `bash infra/tests/test-az-json.sh` and confirm it **PASSES** (GREEN). All three branches + three call-site outcomes covered
- [x] T008 Source `infra/lib/az-json.sh` near the top of `infra/validate-deployment.sh` (after the helper-function block, before the checks), keeping `set -euo pipefail` intact

**Checkpoint**: `az_json` exists, is unit-tested, and is available to the validation script.

---

## Phase 3: User Story 1 - Production CD gate passes when production is healthy (Priority: P1) 🎯 MVP

**Goal**: Make the section-7 PostgreSQL DB check report the existing `epcubegraph` database as **present** so the `validate-prod` gate goes from permanently RED to GREEN.

**Independent Test**: Run `./validate-deployment.sh --rg epcubegraph-rg` against healthy production on az 2.84.0 — section "Managed PostgreSQL Database" reports the DB present with charset `UTF8` and collation `en_US.utf8`, and the run has zero DB-attributable failures.

- [x] T009 [US1] Replace the deprecated DB check (~line 457, `az postgres flexible-server db show --server-name --database-name`) in `infra/validate-deployment.sh` with the version-stable approach from [research.md](research.md) Decision A: compute `SUBSCRIPTION_ID=$(az account show --query id -o tsv)`, construct `PG_DB_ID="/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RG_NAME}/providers/Microsoft.DBforPostgreSQL/flexibleServers/${PG_NAME}/databases/epcubegraph"`, then `az_json resource show --ids "$PG_DB_ID" -o json` as the present-branch source (`pass` on non-empty)
- [x] T010 [US1] In the same DB block, read charset from `.properties.charset` (assert `UTF8`) and collation from `.properties.collation` (assert `en_US.utf8`) — updating the python extraction from top-level `d.get('charset','')` to `d.get('properties',{}).get('charset','')` (and likewise collation), preserving the existing `pass`/`fail` sub-check reporting (FR-008)
- [~] T011 [US1] Run `bash infra/tests/test-az-json.sh` (still GREEN) and run `./validate-deployment.sh --rg epcubegraph-rg` against live production — test suite GREEN (16/16); live prod run skipped locally (wrong az account on dev machine); CI validate-infra will confirm via the wired test suite. Post-merge validate-prod CD run is the acceptance gate.

**Checkpoint**: The headline defect is fixed — production DB check is green on 2.84.0.

---

## Phase 4: User Story 2 - Real CLI errors are surfaced, never disguised as "not found" (Priority: P1)

**Goal**: When the DB-check `az` command exits non-zero for a non-absence reason, surface the real stderr — distinct from "not found".

**Independent Test**: Force the DB-check command to fail at the CLI level (stub `error` mode) — output shows the real stderr (`unrecognized arguments`) and reports a tool-level failure, never "database not found".

- [x] T012 [US2] In the DB block in `infra/validate-deployment.sh`, ensure the first branch is `if ! az_json resource show --ids "$PG_DB_ID" -o json; then fail "Managed PostgreSQL database 'epcubegraph': az CLI error — ${AZ_JSON_ERR}"` so a non-zero az exit surfaces `AZ_JSON_ERR` before any empty/absence handling (US2/FR-004)
- [x] T013 [US2] Verify the forced-error path per quickstart §4 (point `az` at `infra/tests/stub-az` in `error` mode for the DB block, or rely on the `error` scenario in `infra/tests/test-az-json.sh`): the message contains the real stderr and is NOT "database not found" (SC-003)

**Checkpoint**: Tool errors at the DB site are unmistakably distinct from absence.

---

## Phase 5: User Story 3 - Genuinely missing resources still fail the check (Priority: P2)

**Goal**: Preserve true negatives — an absent `epcubegraph` database still fails with a "not found" message, distinct from a CLI error.

**Independent Test**: With the DB-check command succeeding but returning empty (stub `success-empty`), the check reports `fail "... not found"`, distinct from the tool-error message.

- [x] T014 [US3] In the DB block in `infra/validate-deployment.sh`, ensure the absence branch fires `elif [[ -z "$AZ_JSON_OUT" ]]; then fail "Managed PostgreSQL database 'epcubegraph' not found"` (absence policy = fail for the DB), with the present-branch sub-checks in the `else` (US3/FR-006)
- [x] T015 [US3] Verify via the `resource-not-found` scenario in `infra/tests/test-az-json.sh` that the absence branch fires "not found" (stub updated from `success-empty` to `resource-not-found` per live-verified az CLI behavior)

**Checkpoint**: All three DB-site outcomes (present / tool-error / absent) are correct and distinct.

---

## Phase 6: User Story 4 - The whole script is hardened against the same anti-pattern (Priority: P2)

**Goal**: Apply the `az_json` error-vs-absence distinction to every remaining audited site in `infra/validate-deployment.sh`, preserving legitimate skips and the Key Vault firewall fallback.

**Independent Test**: After the change, `grep -n '2>/dev/null || echo ""' infra/validate-deployment.sh` returns zero unguarded `az` occurrences (the only allowed remainder is the documented non-`az` python-parse exception), and a forced CLI error at a representative site surfaces the real error.

> **Serialized**: All tasks below edit the single file `infra/validate-deployment.sh` and therefore run **sequentially (no [P])** to avoid edit collisions. Use the line numbers from [research.md](research.md) as a guide.

- [x] T016 [US4] Convert the Container Apps environment check (~line 86) and PostgreSQL server check (~line 107) to `az_json`, fail-on-absence pattern (tool-error branch surfaces `AZ_JSON_ERR`; empty-on-success → `fail "... not found"`)
- [x] T017 [US4] Convert the API Container App (~line 170) and exporter Container App (~line 273) checks to `az_json`, **skip-on-absence** pattern (empty-on-success → `skip "... not deployed"`, preserving FR-013)
- [x] T018 [US4] Convert the ACR check (~line 377) and Key Vault check (~line 405) to `az_json`, fail-on-absence pattern
- [x] T019 [US4] Convert the Key Vault secret list (~line 420, `-o tsv`) and the exporter Container App KV-fallback show (~line 423) to `az_json`, preserving the firewall-fallback meaning of empty-on-success and only changing the non-zero path to surface `AZ_JSON_ERR`
- [x] T020 [US4] Harden the python-parse fallback (~line 430): remove the `2>/dev/null || echo ""` swallow so a genuine `python3` parse error surfaces (documented non-`az` exception per FR-009; input is already validated non-empty JSON upstream)
- [x] T021 [US4] Convert the Log Analytics workspace check (~line 485) and Application Insights component check (~line 506) to `az_json`, fail-on-absence pattern
- [x] T022 [US4] Convert the managed identity check (~line 550), ACR id lookup (~line 562, `-o tsv`), and role-assignment list (~line 564, `-o tsv`) to `az_json`, preserving empty-on-success semantics (RBAC skip / role-missing fail) and surfacing `AZ_JSON_ERR` on non-zero
- [x] T023 [US4] Convert the Entra app list (~line 581, `--query "[0]"`) and service-principal show (~line 619) to `az_json`, preserving the existing `== "null"`/empty handling and surfacing `AZ_JSON_ERR` on non-zero
- [x] T024 [US4] Run `bash infra/tests/test-az-json.sh` (GREEN) and the audit grep `grep -n '2>/dev/null || echo ""' infra/validate-deployment.sh` → zero unguarded `az` sites remain (only the documented line-430 python exception, if any) (SC-006)

**Checkpoint**: No swallow-and-misreport anti-pattern survives anywhere in the script.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: CI wiring, full live verification, and acceptance closure.

- [x] T025 [P] Wire `bash infra/tests/test-az-json.sh` into the `validate-infra` job in `.github/workflows/ci.yml` so the helper test runs on every push (CI Test Coverage principle)
- [~] T026 Run the full live production validation `cd infra && ./validate-deployment.sh --rg epcubegraph-rg` — skipped locally (az CLI on wrong account); acceptance via post-merge validate-prod CD run
- [~] T027 Execute quickstart.md steps 1–4 end to end — unit tests Red→Green ✅, grep audit ✅, live prod run pending (post-merge), forced-error check ✅ via test-az-json.sh Scenario 2. Issue #166 acceptance evidence in PR #170 body.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **BLOCKS all user stories** (the `az_json` helper must be GREEN at T007 before any call-site conversion).
- **US1 (Phase 3)**: Depends on Foundational. Delivers the MVP (prod DB check green).
- **US2 (Phase 4)** and **US3 (Phase 5)**: Depend on Foundational; both refine the same DB-site block authored in US1 (T009/T010), so they follow US1 sequentially (same file).
- **US4 (Phase 6)**: Depends on Foundational. Independent of US1–US3 in concept, but edits the same file, so it is serialized after the DB-site work to avoid collisions.
- **Polish (Phase 7)**: Depends on all desired stories complete (T026/T027 require the final script; T025 may run as soon as the test file exists).

### User Story Dependencies

- **US1 (P1)** — MVP. The headline fix. No dependency on other stories.
- **US2 (P1)** — Shares the DB-site block with US1; the helper (Phase 2) already encodes the error distinction.
- **US3 (P2)** — Shares the DB-site block with US1/US2; preserves true negatives.
- **US4 (P2)** — Applies the same distinction to the other 16 sites; conceptually independent but same-file serialized.

### Within Each Story

- TDD (Phase 2): test (T004) + stub (T003) FIRST → confirm RED (T005) → helper (T006) → confirm GREEN (T007). NON-NEGOTIABLE order.
- US1: command swap (T009) → field-path update (T010) → live verify (T011).
- US4: sequential site conversions (T016→T023) → audit grep (T024).

### Parallel Opportunities

- T002 (mkdir) is [P] relative to T001.
- T003 (`stub-az`) is [P] — independent file from the test/helper.
- T025 (CI wiring, `.github/workflows/ci.yml`) is [P] — independent file from the script.
- **No [P] within US4**: every T016–T023 edits `infra/validate-deployment.sh` and must run sequentially.

---

## Implementation Strategy

### MVP First

1. Complete **Phase 1 → Phase 2 → Phase 3 (US1)**. At T011 the production DB check is green on az 2.84.0 — the issue's headline defect is resolved and independently verifiable. This is a shippable MVP.

### Incremental Delivery

2. **US2 (Phase 4)** and **US3 (Phase 5)** lock in the error-vs-absence distinction at the DB site (already proven by the Phase 2 unit test).
3. **US4 (Phase 6)** hardens the remaining 16 sites — the holistic root-cause sweep — one site group at a time, re-running the unit test as a regression guard.
4. **Polish (Phase 7)** wires CI, runs the full live production validation, and closes out issue #166 (with the post-merge CD run as the >= 2.86.0 confirmation).
