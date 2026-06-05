# Research: Separate Application Insights per Environment

**Feature**: `115-appinsights-per-environment`
**Date**: 2026-06-01
**Status**: Complete

This document captures the **verified current state** of the codebase (inspected
live, not assumed), the **confirmed gaps** against the spec, and the **chosen
approach** for each. The headline finding is that the resource separation the
spec asks for **already exists in infrastructure-as-code**; the real work is
**verification** (FR-009 / SC-005) plus a small set of explicit decisions.

---

## 1. Verified current state (ground truth)

### 1.1 Application Insights is already per-environment

- [infra/application-insights.tf](../../infra/application-insights.tf#L5-L11): `resource "azurerm_application_insights" "dashboard"` with
  `name = "${var.environment_name}-appinsights"`, linked via `workspace_id` to
  `azurerm_log_analytics_workspace.main`, `application_type = "web"`.
- [infra/outputs.tf](../../infra/outputs.tf): output `appinsights_connection_string` =
  `azurerm_application_insights.dashboard.connection_string`.
- [infra/keyvault.tf](../../infra/keyvault.tf): Key Vault secret `appinsights-connection-string` =
  `azurerm_application_insights.dashboard.connection_string` (per-env resource).
- [infra/container-apps.tf](../../infra/container-apps.tf): API secret ref `appinsights-connection-string`
  → that KV secret; env var `APPLICATIONINSIGHTS_CONNECTION_STRING`.
- [infra/static-web-app.tf](../../infra/static-web-app.tf): SWA `name = "${var.environment_name}-dashboard"` (per-env).

**Conclusion**: The App Insights resource, its KV secret, and the API/dashboard
wiring are **all templated by `environment_name`**. Production
(`environment_name = epcubegraph`) and each staging env
(`environment_name = epcubegraph-<branch>`) resolve to distinct resources.

### 1.2 Log Analytics workspace is ALSO per-environment

- [infra/storage.tf](../../infra/storage.tf#L5-L11): `resource "azurerm_log_analytics_workspace" "main"` with
  `name = "${var.environment_name}-logs"`.

**Conclusion** (corrects a grounding assumption): the workspace backing App
Insights is **not shared** — it is per-environment. There is no shared-resource
coupling that would orphan App Insights on a staging destroy. Neither resource
declares `lifecycle { prevent_destroy = true }`.

### 1.3 Dashboard consumes the per-environment connection string at build time

- [.github/workflows/cd.yml](../../.github/workflows/cd.yml#L270): staging reads
  `terraform output -raw appinsights_connection_string`, masks it, and injects it
  (line 297) as build-time `VITE_APPINSIGHTS_CONNECTION_STRING`. Production does
  the same at lines 659 / 686.
- [dashboard/src/telemetry.ts](../../dashboard/src/telemetry.ts#L5-L7): reads
  `import.meta.env.VITE_APPINSIGHTS_CONNECTION_STRING`; if empty it **returns
  early** (no-op, fail-safe — never falls back to a hardcoded/production string).
- No hardcoded connection string exists in source (only the fake
  `InstrumentationKey=test-key` in [dashboard/tests/unit/telemetry.test.ts](../../dashboard/tests/unit/telemetry.test.ts)).

### 1.4 Cloud role names (component identity in the Application Map)

- **Dashboard**: [dashboard/src/telemetry.ts](../../dashboard/src/telemetry.ts#L16-L19) registers a telemetry
  initializer that hardcodes `item.tags['ai.cloud.role'] = 'epcubegraph-dashboard'`.
  This string is **identical across all environments** (build-time constant).
- **API**: [api/src/EpCubeGraph.Api/Startup.cs](../../api/src/EpCubeGraph.Api/Startup.cs#L15-L21) calls
  `services.AddApplicationInsightsTelemetry()` **only** — it does **NOT** register
  any `TelemetryInitializer`, and it does **NOT** set `cloud_RoleName` /
  `RoleName` anywhere. (Verified: grep for `cloud_RoleName|RoleName|ai.cloud.role|TelemetryInitializer`
  in `api/src` → **no matches**.) The role name therefore defaults to the SDK
  value derived from the host (assembly / container app name).

**Correction to grounding**: the premise that "the API also sets a cloud role"
is **not accurate** — the API sets no role name at all.

### 1.5 Staging teardown

- [.github/workflows/cd.yml](../../.github/workflows/cd.yml#L842-L935): the `destroy` job runs
  `terraform destroy` in `infra/` against the per-env state key
  (`<env_name>.tfstate`) with `TF_VAR_environment_name = <env_name>`, then deletes
  the state blob. Because `azurerm_application_insights.dashboard` and
  `azurerm_log_analytics_workspace.main` are ordinary env-scoped resources in that
  state with no `prevent_destroy`, destroy removes them with the rest of the env.

### 1.6 Existing post-deploy validation

- [infra/validate-deployment.sh](../../infra/validate-deployment.sh): a bash validator (no test framework — operational
  tooling) that derives `ENV_NAME` from the resource group and asserts Container
  Apps Env, PostgreSQL, etc. It checks the API's `ConnectionStrings__DefaultConnection`
  secret ref (line 238) but **does not** currently assert anything about
  Application Insights (resource existence, workspace link, or the API's
  `APPLICATIONINSIGHTS_CONNECTION_STRING` secret ref).

---

## 2. Confirmed gaps vs. spec

| # | Gap | Spec ref | Status |
|---|-----|----------|--------|
| G1 | No end-to-end **verification** that a real staging deploy creates a distinct App Insights resource and that each component's connection string resolves to its own environment. | FR-009, SC-002, SC-005 | **Real gap** — primary work |
| G2 | `validate-deployment.sh` does **not** assert App Insights resource existence, workspace link, or the API's App Insights secret ref. | FR-009 | **Real gap** |
| G3 | Cloud role names are environment-invariant (dashboard hardcoded `epcubegraph-dashboard`; API unset). | SC-001 / FR-002 | **Decision needed — see §3** |
| G4 | Confirm `destroy` actually removes the staging App Insights + Log Analytics with no orphan/coupling. | FR-005, FR-006, SC-003, SC-004 | **Confirmed safe — verify-only** |

---

## 3. Decisions

### D1 — Resource separation: VERIFY-ONLY (no infra change)

- **Decision**: Do not change the App Insights / Key Vault / Container Apps / SWA
  resource definitions. They already satisfy FR-001, FR-003, FR-004, FR-007, FR-008.
- **Rationale**: All four are templated by `environment_name`; the connection
  string is sourced via Key Vault (SFI-compliant) and injected per-env. Changing
  working, correct IaC would violate Simplicity/YAGNI.
- **Alternatives considered**: Re-architecting to a shared resource with role-based
  filtering — rejected; weaker isolation and contradicts the spec's
  one-resource-per-environment guarantee.

### D2 — Cloud role naming: DO NOT make role names per-environment (recommended)

- **Decision (recommended)**: Leave cloud role names as-is. Do **not** inject the
  environment into the dashboard or API role name.
- **Rationale**: SC-001 ("production Application Map shows only production
  components") is satisfied by **resource separation alone**. The Application Map
  is computed **per Application Insights resource**. Production's map queries only
  production's resource; staging telemetry physically lands in a different
  resource and therefore can never appear on production's map — regardless of
  whether the role-name string happens to be identical across environments. The
  `ai.cloud.role` tag distinguishes components **within one resource** (dashboard
  vs. API), not **across resources/environments**. Adding an environment suffix
  would add build-time wiring (a new `VITE_ENVIRONMENT`-style injection for the
  dashboard, a `TelemetryInitializer` for the API) with **no effect on the
  isolation guarantee** — a YAGNI violation (Constitution Principles I & II), and
  the spec never asks for per-component naming.
- **Alternative (in scope only if the user wants it)**: Inject `environment_name`
  into the role name (dashboard via a new build-time env var threaded through
  cd.yml + `telemetry.ts`; API via a `TelemetryInitializer` reading the env name).
  This is **TDD-able** — `telemetry.ts` is covered by
  [dashboard/tests/unit/telemetry.test.ts](../../dashboard/tests/unit/telemetry.test.ts) and the API has xUnit coverage on
  `Startup`. Cost: more moving parts, 100%-coverage test updates, and cd.yml
  changes, for zero isolation benefit. **Recommended: defer/decline.**

### D3 — Teardown: VERIFY-ONLY

- **Decision**: No change to the `destroy` job. Confirm via the deploy-then-destroy
  cycle that App Insights + Log Analytics are gone and production is untouched.
- **Rationale**: Both resources are per-env, in the env's own state, with no
  `prevent_destroy` and no shared coupling. The job already deletes the state blob.

### D4 — Close the verification gap by extending `validate-deployment.sh`

- **Decision**: Add an "Application Insights" section to
  [infra/validate-deployment.sh](../../infra/validate-deployment.sh) asserting, for the resolved `ENV_NAME`:
  1. `${ENV_NAME}-appinsights` exists (`az monitor app-insights component show`).
  2. It is workspace-linked to `${ENV_NAME}-logs` (verifies the per-env workspace).
  3. The API container app exposes env var `APPLICATIONINSIGHTS_CONNECTION_STRING`
     sourced from secret ref `appinsights-connection-string` (mirrors the existing
     connection-string check pattern at line 238).
- **Rationale**: Makes FR-009 enforceable on every deploy from the repo alone, in
  the same operational tool operators already run. Bash script — no unit-test
  harness exists or is required for it (consistent with current repo practice).

### D5 — Provide a repeatable deploy-then-destroy evidence procedure (quickstart)

- **Decision**: Document the exact commands (workflow_dispatch deploy →
  `validate-deployment.sh` → assert distinct resource & connection string → destroy
  → assert removal → confirm production intact) as the FR-009 / SC-005 evidence.
- **Rationale**: SC-005 requires "at least one full deploy-then-destroy cycle"
  reproduced solely from IaC. A scripted runbook makes that auditable and repeatable.

---

## 4. Constraints honored

- Terraform `azurerm` only; Azure-native (Constitution: Platform Constraints). ✅
- SFI-compliant secret handling already in place via Key Vault — unchanged. ✅
- Reproducible from repo alone; no manual portal steps (DevOps: IaC). ✅
- No `:latest` tags touched. ✅
- TDD / 100% coverage: under the recommended scope, **no dashboard/API production
  code changes** are required, so coverage is unaffected. If D2's alternative is
  chosen, TDD applies to `telemetry.ts` and `Startup`. ✅
- Local typecheck parity: unaffected (no TS/C# source changes under recommended scope). ✅

---

## 5. Open question for the user (gates scope before /speckit.tasks)

**Recommended scope: VERIFY-ONLY** (D1 + D3 + D4 + D5) — extend
`validate-deployment.sh`, document the deploy-then-destroy evidence, change no
application code.

**Confirm**: accept verify-only, or opt into D2's per-environment role naming
(verify + role-naming)?
