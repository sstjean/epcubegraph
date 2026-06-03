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

- [ ] T001 Verify operator prerequisites are met: `az login` against the target subscription succeeds, `az account show` returns the correct subscription, and `gh auth status` is authenticated for `workflow_dispatch` (per [quickstart.md](./quickstart.md) Prerequisites).
- [ ] T002 [P] Re-confirm the grounded IaC facts (no edits) so the validator assertions match reality: `name = "${var.environment_name}-appinsights"` in [infra/application-insights.tf](../../infra/application-insights.tf), `workspace_id` → `${var.environment_name}-logs` in [infra/storage.tf](../../infra/storage.tf), secret `appinsights-connection-string` in [infra/keyvault.tf](../../infra/keyvault.tf), and env var `APPLICATIONINSIGHTS_CONNECTION_STRING` (secret ref `appinsights-connection-string`) in [infra/container-apps.tf](../../infra/container-apps.tf).

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

- [ ] T003 Add an `Application Insights` section (via `header "Application Insights"`) to [infra/validate-deployment.sh](../../infra/validate-deployment.sh), placed after the API Container App section, that fetches the component once: `AI_JSON=$(az monitor app-insights component show --app "${ENV_NAME}-appinsights" -g "$RG_NAME" -o json 2>/dev/null || echo "")`, reusing the existing skip-if-empty guard pattern.
- [ ] T004 Implement assertion **R1** (resource exists) in the new section of [infra/validate-deployment.sh](../../infra/validate-deployment.sh): `pass` when `AI_JSON` is non-empty for `${ENV_NAME}-appinsights`, otherwise `fail "Application Insights '${ENV_NAME}-appinsights' not found"` (data-model R1; FR-001/FR-009).
- [ ] T005 Implement assertion **R2** (per-env workspace link) in [infra/validate-deployment.sh](../../infra/validate-deployment.sh): parse `workspaceResourceId` from `AI_JSON` and `pass` only if it ends with `/${ENV_NAME}-logs`, else `fail` reporting the actual workspace id (data-model R2; confirms the per-env Log Analytics workspace, FR-005/FR-006 grounding).
- [ ] T006 Implement assertion **R3** (API secret ref) in [infra/validate-deployment.sh](../../infra/validate-deployment.sh): from the already-fetched `$API_JSON`, extract the `APPLICATIONINSIGHTS_CONNECTION_STRING` env entry and `pass` only if its `secretRef == "appinsights-connection-string"`, else `fail` with the observed value — mirroring the existing `ConnectionStrings__DefaultConnection` check (~line 234, python3 inline parse, expecting `api-connection-string`) (data-model R3; FR-004/FR-009).
- [ ] T007 Validate the edited script statically and confirm it still exits cleanly: run `bash -n infra/validate-deployment.sh` (syntax) and, if available, `shellcheck infra/validate-deployment.sh`; confirm the new section integrates with the final PASS/FAIL summary tally.

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

- [ ] T008 [US1] Deploy a staging environment via `workflow_dispatch` per [quickstart.md](./quickstart.md) Step 1: `gh workflow run cd.yml -f environment=staging -f branch_name=115-appinsights-per-environment -f destroy=false`; wait for the deploy job to succeed and record the resolved env name (e.g. `epcubegraph-115-appi`). This deployment is the shared substrate for US1–US3.
- [ ] T009 [US1] Generate staging activity and a deliberate error against the staging dashboard/API so staging emits requests + an exception (quickstart Step 4 setup).
- [ ] T010 [US1] Confirm **zero** staging-originated telemetry in the **production** resource without manual portal steps: run a KQL query against production via `az monitor app-insights query --app epcubegraph-appinsights -g epcubegraph-rg --analytics-query "union requests, exceptions, dependencies | where timestamp > ago(30m) | summarize count() by cloud_RoleName, cloud_RoleInstance"` and confirm no staging env name / staging role instance appears; capture the query output as evidence (SC-001, FR-002; FR-007 portal-free). A portal Application Map screenshot MAY be attached as a secondary illustration but is not the primary evidence.

**Checkpoint**: Production monitoring demonstrably contains no staging telemetry (P1 / MVP satisfied).

---

## Phase 4: User Story 2 — Staging telemetry is captured in its own isolated resource (Priority: P2)

**Goal**: Prove staging telemetry lands in a dedicated App Insights resource with a
connection string distinct from production's, and that the validator enforces the wiring.

**Independent Test**: Against the deployed staging env, the validator's R1–R3 pass and
the staging connection string differs from production's (quickstart Steps 2–3).

- [ ] T011 [US2] Run the extended validator against the staging env per [quickstart.md](./quickstart.md) Step 2: `cd infra && ./validate-deployment.sh --rg <env>-rg`; confirm the new **Application Insights** section reports R1–R3 all PASS (FR-009, SC-002).
- [ ] T012 [US2] Confirm distinct resource + distinct connection string per [quickstart.md](./quickstart.md) Step 3: compare `az monitor app-insights component show --query connectionString` for `<env>-appinsights` vs `epcubegraph-appinsights` and assert they differ; capture the PASS result (SC-002, FR-003).
- [ ] T012a [US2] Positively confirm staging telemetry **lands in** the staging resource (not merely that config differs): after T009 generated traffic+error, query the staging resource via `az monitor app-insights query --app <env>-appinsights -g <env>-rg --analytics-query "union requests, exceptions | where timestamp > ago(30m) | summarize count() by cloud_RoleName"` and confirm the generated requests/exception are present; capture the output (SC-002, FR-009 — closes the positive-landing gap; templated definition alone is not sufficient).
- [ ] T013 [P] [US2] (SC-006 / FR-010) FR-010 is satisfied **structurally** by `environment_name` templating (each env resolves `${env}-appinsights`; the validator's R1 proves this per env). This task is the confirming evidence: deploy a second concurrent staging env with a different `branch_name` (quickstart Step 7), then confirm all three connection strings (two staging + production) are pairwise distinct, proving multiple staging envs do not commingle. Tear this second env down after capturing evidence.

**Checkpoint**: Staging telemetry is provably isolated in its own resource; validator enforces it from the repo alone.

---

## Phase 5: User Story 3 — Tearing down staging removes its Application Insights resource (Priority: P2)

**Goal**: Prove the standard staging-destroy removes the staging App Insights **and**
Log Analytics resources, leaving production untouched.

**Independent Test**: After `destroy=true`, `<env>-appinsights` and `<env>-logs` no
longer exist while `epcubegraph-appinsights` still does (quickstart Steps 5–6).

**Dependency**: Runs after US1 and US2 evidence is captured (destroy removes the shared
substrate from T008).

- [ ] T014 [US3] Destroy the staging environment via `workflow_dispatch` per [quickstart.md](./quickstart.md) Step 5: `gh workflow run cd.yml -f environment=staging -f branch_name=115-appinsights-per-environment -f destroy=true`; wait for the destroy job to complete.
- [ ] T015 [US3] Confirm teardown removed the staging monitoring resources per [quickstart.md](./quickstart.md) Step 6: `az monitor app-insights component show --app <env>-appinsights -g <env>-rg` and `az monitor log-analytics workspace show --workspace-name <env>-logs -g <env>-rg` both return not-found; capture both PASS results (SC-003, FR-005).
- [ ] T016 [US3] Confirm production is intact per [quickstart.md](./quickstart.md) Step 6: `az monitor app-insights component show --app epcubegraph-appinsights -g epcubegraph-rg --query name -o tsv` still returns the resource, AND production is still actively ingesting — `az monitor app-insights query --app epcubegraph-appinsights -g epcubegraph-rg --analytics-query "requests | where timestamp > ago(15m) | count"` returns a non-zero recent count (substantiates "no interruption or data loss"); capture both results (SC-004, FR-006).

**Checkpoint**: Full deploy-then-destroy evidence captured; staging leaves no monitoring residue; production unaffected.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Record the evidence and keep docs synchronized with verified reality.

- [ ] T017 [P] Add a short "Per-environment Application Insights" note to [DEPLOY.md](../../DEPLOY.md) explaining that each environment gets its own `${env}-appinsights` + `${env}-logs`, that the validator's Application Insights section (R1–R3) enforces the wiring, and that staging destroy removes both monitoring resources.
- [ ] T018 [P] Record the closing evidence (validator output for R1–R3, the distinct-connection-string result, the positive staging-landing query from T012a, the clean production query, and the teardown confirmations from T010/T012/T012a/T015/T016) in the issue #115 thread / a brief evidence summary, satisfying the FR-009 / SC-005 "at least one full deploy-then-destroy cycle reproduced from the repo alone" requirement.
- [ ] T019 Final full-cycle pass: re-read [quickstart.md](./quickstart.md) end to end and confirm every step maps to captured evidence (Success-criteria mapping table), with no manual portal steps required (SC-005).

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
- `validate-deployment.sh` is operational Bash — no unit-test harness, consistent with repo practice.
- Use `--rg <env>-rg` to point the validator at staging; production uses `epcubegraph-rg`.
- Commit the validator change (Phase 2) on the feature branch; do not push without approval.
