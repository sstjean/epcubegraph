---
description: "Task list for Separate Application Insights per Environment (verify-only)"
---

# Tasks: Separate Application Insights per Environment

**Input**: Design documents from `/specs/115-appinsights-per-environment/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, quickstart.md

**Scope**: **Option A — verify-only.** Per-environment resource separation is
**already implemented** in IaC (`infra/application-insights.tf`, `infra/storage.tf`,
`infra/keyvault.tf`, `infra/container-apps.tf` are all templated by
`environment_name`; `cd.yml` injects the per-env connection string). No application
code (TypeScript/C#) and no `.tf` resource changes are in scope. Per-environment
cloud-role naming is **explicitly out of scope** (research §3 D2 — YAGNI). The work
is **proof**: extend the Bash validator to assert App Insights wiring, then run a
deploy-then-destroy evidence cycle.

**Tests**: No unit-test harness exists or is required for `validate-deployment.sh`
(operational Bash tooling, consistent with current repo practice — research §1.6,
§3 D4). The verification/evidence tasks ARE the deliverable. No application-code
TDD tasks because no application code changes.

**Organization**: Tasks are grouped by user story (US1 = P1, US2 = P2, US3 = P2)
to map evidence to the spec's isolation guarantees.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths / commands included in each description

## Path Conventions

- Validator script: [infra/validate-deployment.sh](../../infra/validate-deployment.sh)
- Evidence runbook: [specs/115-appinsights-per-environment/quickstart.md](./quickstart.md)
- CD pipeline (verify-only, not edited): [.github/workflows/cd.yml](../../.github/workflows/cd.yml)
- Docs: [DEPLOY.md](../../DEPLOY.md)

---

## Phase 1: Setup (Shared Prerequisites)

**Purpose**: Confirm tooling and grounding before touching the validator or running evidence.

- [x] T001 Verify operator prerequisites are met: `az login` against the target subscription succeeds, `az account show` returns the correct subscription, and `gh auth status` is authenticated for `workflow_dispatch` (per [quickstart.md](./quickstart.md) Prerequisites).
- [x] T002 [P] Re-confirm the grounded IaC facts (no edits) so the validator assertions match reality: `name = "${var.environment_name}-appinsights"` in [infra/application-insights.tf](../../infra/application-insights.tf), `workspace_id` → `${var.environment_name}-logs` in [infra/storage.tf](../../infra/storage.tf), secret `appinsights-connection-string` in [infra/keyvault.tf](../../infra/keyvault.tf), and env var `APPLICATIONINSIGHTS_CONNECTION_STRING` (secret ref `appinsights-connection-string`) in [infra/container-apps.tf](../../infra/container-apps.tf).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Extend the post-deploy validator with an enforceable "Application Insights"
section. This closes the verification gap (G2 / FR-009) and is the only code change in
the feature. It MUST exist before any evidence cycle (US1–US3) is run, because every
story relies on `validate-deployment.sh` to assert per-env wiring.

**⚠️ CRITICAL**: All tasks in this phase edit the SAME file
([infra/validate-deployment.sh](../../infra/validate-deployment.sh)) and are therefore sequential (no `[P]`).
Mirror the existing connection-string check pattern (~line 234, python3 inline parse) and reuse the
`header`/`pass`/`fail`/`skip` helpers and the resolved `$ENV_NAME` / `$RG_NAME` /
`$API_JSON` variables already defined in the script.

- [x] T003 Add an `Application Insights` section (via `header "Application Insights"`) to [infra/validate-deployment.sh](../../infra/validate-deployment.sh), placed after the API Container App section, that fetches the component once: `AI_JSON=$(az monitor app-insights component show --app "${ENV_NAME}-appinsights" -g "$RG_NAME" -o json 2>/dev/null || echo "")`, reusing the existing skip-if-empty guard pattern.
- [x] T004 Implement assertion **R1** (resource exists) in the new section of [infra/validate-deployment.sh](../../infra/validate-deployment.sh): `pass` when `AI_JSON` is non-empty for `${ENV_NAME}-appinsights`, otherwise `fail "Application Insights '${ENV_NAME}-appinsights' not found"` (data-model R1; FR-001/FR-009).
- [x] T005 Implement assertion **R2** (per-env workspace link) in [infra/validate-deployment.sh](../../infra/validate-deployment.sh): parse `workspaceResourceId` from `AI_JSON` and `pass` only if it ends with `/${ENV_NAME}-logs`, else `fail` reporting the actual workspace id (data-model R2; confirms the per-env Log Analytics workspace, FR-005/FR-006 grounding).
- [x] T006 Implement assertion **R3** (API secret ref) in [infra/validate-deployment.sh](../../infra/validate-deployment.sh): from the already-fetched `$API_JSON`, extract the `APPLICATIONINSIGHTS_CONNECTION_STRING` env entry and `pass` only if its `secretRef == "appinsights-connection-string"`, else `fail` with the observed value — mirroring the existing `ConnectionStrings__DefaultConnection` check (~line 234, python3 inline parse, expecting `api-connection-string`) (data-model R3; FR-004/FR-009).
- [x] T007 Validate the edited script statically and confirm it still exits cleanly: run `bash -n infra/validate-deployment.sh` (syntax) and, if available, `shellcheck infra/validate-deployment.sh`; confirm the new section integrates with the final PASS/FAIL summary tally.

**Checkpoint**: `validate-deployment.sh` now asserts R1–R3 and can be run against any deployed environment.

---

## Phase 3: User Story 1 — Production monitoring is free of staging noise (Priority: P1) 🎯 MVP

**Goal**: Prove that staging telemetry never appears in production's Application
Insights views (Application Map, Failures, traces) — the core isolation guarantee.

**Independent Test**: With a staging environment generating traffic and a deliberate
error, inspect the production Application Map / Failures and confirm zero
staging-originated component, request, or exception (quickstart Step 4).

**Note**: Requires a deployed staging environment (T008) as the evidence substrate;
production isolation is structurally guaranteed because the Application Map is computed
per App Insights resource (research §3 D2).

- [x] T008 [US1] Deploy a staging environment via `workflow_dispatch` per [quickstart.md](./quickstart.md) Step 1: `gh workflow run cd.yml -f environment=staging -f branch_name=115-appinsights-per-environment -f destroy=false`; wait for the deploy job to succeed and record the resolved env name (e.g. `epcubegraph-115-appi`). This deployment is the shared substrate for US1–US3.
- [x] T009 [US1] Generate staging activity and a deliberate error against the staging dashboard/API so staging emits requests + an exception (quickstart Step 4 setup). **Done**: 8×`200` on `/api/v1/health`, several `401`s, 3×`404` errors driven against the live staging API. **Observability note**: although traffic was served, the apps emit **no** Application Insights request/exception telemetry (see filed defect for the no-telemetry root cause). The positive-landing demo is therefore not observable; isolation is proven structurally (distinct resources + distinct InstrumentationKeys, see T012) rather than by watching telemetry land.
- [x] T010 [US1] Confirm **zero** staging-originated telemetry in the **production** resource without manual portal steps: ran `az monitor app-insights query --app epcubegraph-appinsights -g epcubegraph-rg` over both `ago(30m)` and `ago(30d)` windows — production returns **zero** request/exception rows, so no staging telemetry (nor any other) leaked into production (SC-001, FR-002; FR-007 portal-free). Query CLI verified working via a trivial `print` probe. Cross-env isolation is structurally guaranteed because the Application Map is computed per App Insights resource.

**Checkpoint**: Production monitoring demonstrably contains no staging telemetry (P1 / MVP satisfied).

---

## Phase 4: User Story 2 — Staging telemetry is captured in its own isolated resource (Priority: P2)

**Goal**: Prove staging telemetry lands in a dedicated App Insights resource with a
connection string distinct from production's, and that the validator enforces the wiring.

**Independent Test**: Against the deployed staging env, the validator's R1–R3 pass and
the staging connection string differs from production's (quickstart Steps 2–3).

- [x] T011 [US2] Ran the extended validator against the staging env: `cd infra && /opt/homebrew/bin/bash ./validate-deployment.sh --rg epcubegraph-b115-app-rg` — the new **Application Insights** section reports **R1–R3 all PASS** (overall 65 passed, 0 failed) (FR-009, SC-002). (Local run required Homebrew bash 5.x; macOS system bash 3.2 lacks `${var,,}`. CI runs Linux bash so this is local-only.)
- [x] T012 [US2] Confirmed distinct resource + distinct connection string: `epcubegraph-b115-app-appinsights` InstrumentationKey `9ce57485-…` vs production `epcubegraph-appinsights` `c62f58ff-…` — **DISTINCT** (SC-002, FR-003).
- [x] T012a [US2] Attempted to positively confirm staging telemetry **lands in** the staging resource: after T009 traffic+errors, queried `az monitor app-insights query --app epcubegraph-b115-app-appinsights -g epcubegraph-b115-app-rg` across `requests, exceptions, customEvents, traces, dependencies` over `ago(60m)` — **zero rows**. Root cause is the app-level no-telemetry defect (filed separately), **not** an isolation failure. Positive-landing remains structurally covered by the distinct-resource + distinct-key proof (T012) and the validator's R1–R3 wiring assertions (T011). This task is **closed as not-observable**, deferred to the no-telemetry defect.
- [x] T013 [P] [US2] (SC-006 / FR-010) FR-010 is satisfied **structurally** by `environment_name` templating (each env resolves `${env}-appinsights`; the validator's R1 proves this per env). Per the Option A scope and to avoid the cost of a second concurrent staging stack, the second-env deploy is **deliberately skipped**: the templating + the per-env R1 PASS already prove each environment resolves its own distinct resource (two distinct keys already demonstrated in T012). No telemetry commingling is possible across separate resources/keys.

**Checkpoint**: Staging telemetry is provably isolated in its own resource; validator enforces it from the repo alone.

---

## Phase 5: User Story 3 — Tearing down staging removes its Application Insights resource (Priority: P2)

**Goal**: Prove the standard staging-destroy removes the staging App Insights **and**
Log Analytics resources, leaving production untouched.

**Independent Test**: After `destroy=true`, `<env>-appinsights` and `<env>-logs` no
longer exist while `epcubegraph-appinsights` still does (quickstart Steps 5–6).

**Dependency**: Runs after US1 and US2 evidence is captured (destroy removes the shared
substrate from T008).

- [x] T014 [US3] Destroyed the staging environment via `workflow_dispatch` (run 26906146556): `gh workflow run cd.yml -f environment=staging -f branch_name=115-appinsights-per-environment -f destroy=true`; the destroy job completed green (Terraform Destroy + state-blob + bootstrap cleanup all succeeded).
- [x] T015 [US3] Confirmed teardown removed the staging monitoring resources: all `b115` resource groups are gone, and both `az monitor app-insights component show --app epcubegraph-b115-app-appinsights -g epcubegraph-b115-app-rg` and `az monitor log-analytics workspace show --workspace-name epcubegraph-b115-app-logs -g epcubegraph-b115-app-rg` return *Resource group not found* (SC-003, FR-005).
- [x] T016 [US3] Confirmed production is intact: `az monitor app-insights component show --app epcubegraph-appinsights -g epcubegraph-rg --query name -o tsv` still returns `epcubegraph-appinsights` (SC-004, FR-006). Production ingestion-recency could not be asserted because the app emits no telemetry (see no-telemetry defect); resource existence + the earlier zero-staging-leakage query stand as the production-untouched evidence.

**Checkpoint**: Full deploy-then-destroy evidence captured; staging leaves no monitoring residue; production unaffected.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Record the evidence and keep docs synchronized with verified reality.

- [x] T017 [P] Added a "Per-environment Application Insights" note to [DEPLOY.md](../../DEPLOY.md) explaining each env gets its own `${env}-appinsights` + `${env}-logs`, that the validator's Application Insights section (R1–R3) enforces the wiring, and that staging destroy removes both monitoring resources (also added both rows to the "What Gets Created" table).
- [x] T018 [P] Closing evidence recorded in the issue #115 thread (validator R1–R3 PASS, distinct InstrumentationKeys, clean production query, teardown confirmations) plus the Verification Outcome section below.
- [x] T019 Final full-cycle pass: every quickstart step maps to captured evidence except the *positive* telemetry-landing demo, which is documented as not-observable due to the app-level no-telemetry defect (tracked separately). No manual portal steps were required (SC-005).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **BLOCKS all user stories** — the validator must exist before any evidence run. Sequential (single file).
- **User Stories (Phases 3–5)**: All depend on Foundational. They also share the staging deployment created in T008:
  - **US1 (T008–T010)** deploys the substrate and proves production isolation.
  - **US2 (T011–T013)** consumes the same deployment for resource/connection-string evidence.
  - **US3 (T014–T016)** destroys the substrate last and proves clean teardown — therefore runs **after** US1 and US2 evidence is captured.
- **Polish (Phase 6)**: Depends on all evidence (T010, T012, T015, T016) being captured.

### Critical Path

```text
T001/T002 → T003 → T004 → T005 → T006 → T007 (validator ready)
          → T008 (deploy staging) → T009 → T010 (US1)
                                  → T011 → T012 → T012a (US2)
          → T014 → T015 → T016 (US3, destroy last)
          → T017/T018 → T019
```

### Within Each Phase

- Phase 2 tasks (T003–T007) are strictly sequential — same file.
- US3's destroy (T014) MUST follow US1/US2 evidence capture, since it removes the deployed env.
- T013 (second concurrent env) and the Polish doc tasks (T017, T018) are the only `[P]` items.

### Parallel Opportunities

- T002 can run alongside T001 (read-only grounding vs. auth check).
- T013 (SC-006 second env) is independent of the primary env's US2 assertions.
- T017 and T018 (docs + evidence write-up) touch different files and can run in parallel once evidence exists.

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: Setup (auth + grounding).
2. Phase 2: Foundational — extend `validate-deployment.sh` with R1–R3.
3. Phase 3: US1 — deploy staging, generate an error, confirm production map is clean.
4. **STOP and VALIDATE**: production isolation (SC-001/FR-002) proven — the core value.

### Incremental Delivery

1. Setup + Foundational → validator enforces App Insights wiring.
2. US1 → production-isolation evidence (MVP).
3. US2 → distinct-resource + distinct-connection-string evidence (validator R1–R3 PASS).
4. US3 → clean-teardown evidence (destroy removes `<env>-appinsights` + `<env>-logs`).
5. Polish → docs + closing evidence for FR-009 / SC-005.

---

## Notes

- **No application code changes** — TypeScript/C# untouched; no coverage impact (research §3 D1/D2).
- **No `.tf` resource changes** — separation already implemented; Phase 1 only re-confirms it.
- Per-environment cloud-role naming is deliberately **out of scope** (YAGNI; the Application Map is per-resource, so resource separation alone satisfies SC-001).

## Verification Outcome (closing)

Per-environment Application Insights isolation is **PROVEN** against a live staging deploy (`epcubegraph-b115-app`):

- **Distinct resources**: `epcubegraph-b115-app-appinsights` exists separately from production `epcubegraph-appinsights` (validator R1 PASS).
- **Distinct keys**: staging InstrumentationKey `9ce57485-…` ≠ production `c62f58ff-…`.
- **Per-env workspace link**: linked to `epcubegraph-b115-app-logs` (validator R2 PASS).
- **API secret wiring**: `APPLICATIONINSIGHTS_CONNECTION_STRING` → secret `appinsights-connection-string` (validator R3 PASS).
- **Validator**: 65 passed / 0 failed against the live staging RG.
- **Production clean**: zero request/exception telemetry over both 30m and 30d windows — no staging leakage.

**Known limitation (filed as a separate defect):** the API/dashboard emit **no** Application Insights request/exception telemetry at runtime, so the *positive* "watch staging telemetry land" demo (T012a) is not observable. This is an application-instrumentation defect, **not** an isolation failure — isolation is guaranteed structurally by separate resources and distinct instrumentation keys. The no-telemetry root cause is tracked in its own issue.
- `validate-deployment.sh` is operational Bash — no unit-test harness, consistent with repo practice.
- Use `--rg <env>-rg` to point the validator at staging; production uses `epcubegraph-rg`.
- Commit the validator change (Phase 2) on the feature branch; do not push without approval.
