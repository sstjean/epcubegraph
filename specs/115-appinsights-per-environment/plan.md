# Implementation Plan: Separate Application Insights per Environment

**Branch**: `115-appinsights-per-environment` | **Date**: 2026-06-01 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/115-appinsights-per-environment/spec.md`

## Summary

The spec asks that each environment (production and every ephemeral staging
environment) send telemetry to its own Application Insights resource, that
production monitoring never contains staging telemetry, and that destroying
staging removes its monitoring resources without touching production.

**Key finding from research**: the resource separation is **already implemented
in infrastructure-as-code** — App Insights, its Key Vault secret, the Container
Apps wiring, the Static Web App, and the backing Log Analytics workspace are all
templated by `environment_name`, and the dashboard build injects the per-env
connection string. The API sets **no** cloud role name; the dashboard role name is
a build-time constant. There is no `prevent_destroy` and no shared-resource
coupling.

The actual work is therefore **verification, not re-architecture**: prove the
isolation end to end (FR-009 / SC-005), and make that proof a repeatable,
repo-only check. The recommended scope changes **no application code** — it
extends the existing post-deploy validator and documents a deploy-then-destroy
evidence runbook. Per-environment cloud-role naming is **explicitly out of scope**
under the recommendation because resource separation already satisfies SC-001
(the Application Map is per-resource).

## Technical Context

**Language/Version**: Terraform (`azurerm ~>4.0`); Bash (validation script). No
TypeScript/C# changes under the recommended scope.
**Primary Dependencies**: Azure CLI (`az monitor app-insights`, `az containerapp`)
for validation; existing Terraform `azurerm_application_insights`,
`azurerm_log_analytics_workspace`, `azurerm_key_vault_secret`.
**Storage**: N/A (no schema/data changes; monitoring resources only).
**Testing**: `infra/validate-deployment.sh` (operational bash validator, no unit
harness); GitHub Actions `cd.yml` deploy/destroy jobs for the live cycle.
**Target Platform**: Azure (Container Apps, Static Web Apps, Application Insights,
Log Analytics).
**Project Type**: Infrastructure / DevOps verification feature.
**Performance Goals**: N/A.
**Constraints**: Azure-native, SFI-compliant secret handling (Key Vault, already
in place), reproducible from repo alone, no `:latest` tags, no manual portal steps.
**Scale/Scope**: 1 long-lived production env + N ephemeral staging envs.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|-----------|-----------|
| I. Simplicity | ✅ Recommended scope adds no abstractions; extends one existing script + adds a runbook. |
| II. YAGNI | ✅ Per-env role naming deferred — not required by any FR; would add wiring for zero isolation benefit. |
| III. Single Responsibility | ✅ New validator section is a focused "App Insights checks" block. |
| IV. TDD / 100% coverage | ✅ No application code (TypeScript/C#) changes ⇒ coverage-measured components unaffected. **Documented deviation**: the new R1–R3 logic added to `validate-deployment.sh` is operational Bash with no unit-test harness (consistent with existing repo practice — this script is outside the coverage gate), and acceptance evidence (T010/T012/T012a/T015/T016) is manual + live-Azure, which falls under the constitution's "manual user testing / live-data" carve-out rather than automated CI tests. CI gate for the validator is static analysis (`bash -n` + `shellcheck`, T007), not coverage. (If the role-naming alternative is ever chosen, full TDD with 100% coverage applies to `telemetry.ts` + `Startup`.) |
| Platform (Azure-native, IaC) | ✅ Terraform/azurerm only; Azure-native verification via `az`. |
| Security (SFI, secrets in KV) | ✅ Connection string remains in Key Vault, injected per-env, masked in CI. |
| DevOps (reproducible, no manual steps, env parity) | ✅ Verification is repo-only; staging and production share identical architecture. |

**Result**: PASS. No Complexity Tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/115-appinsights-per-environment/
├── plan.md              # This file
├── research.md          # Phase 0 output (verified state, gaps, decisions)
├── data-model.md        # Phase 1 output (entities: env, AI resource, conn string)
├── quickstart.md        # Phase 1 output (deploy-then-destroy evidence runbook)
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

No `contracts/` directory: this feature exposes **no new external interface**
(no API endpoints, no client contract). The "contract" is the set of
infrastructure invariants asserted by `validate-deployment.sh`, documented in
data-model.md and quickstart.md.

### Source Code (repository root)

```text
infra/
├── application-insights.tf     # (verify-only) per-env azurerm_application_insights
├── storage.tf                  # (verify-only) per-env azurerm_log_analytics_workspace
├── keyvault.tf                 # (verify-only) appinsights-connection-string secret
├── container-apps.tf           # (verify-only) API APPLICATIONINSIGHTS_CONNECTION_STRING
├── static-web-app.tf           # (verify-only) per-env dashboard SWA
└── validate-deployment.sh      # CHANGE: add "Application Insights" assertions

.github/workflows/
└── cd.yml                      # (verify-only) deploy injects per-env conn string; destroy removes env

# Out of scope under recommendation (only if D2 alternative chosen):
dashboard/src/telemetry.ts          # would inject env into ai.cloud.role
api/src/EpCubeGraph.Api/Startup.cs  # would add TelemetryInitializer for role name
```

**Structure Decision**: Infrastructure/DevOps feature. The only code change under
the recommended scope is additive assertions in
[infra/validate-deployment.sh](../../infra/validate-deployment.sh). All `.tf` and `cd.yml` references are
verify-only.

## Phased Technical Approach

### Phase A — Confirm resource separation (verify-only)

- Re-assert from IaC that App Insights, its KV secret, Container Apps env var, SWA,
  and Log Analytics are templated by `environment_name` (done in research; no edit).
- Satisfies FR-001, FR-003, FR-004, FR-007, FR-008.

### Phase B — Close the verification gap (the work)

1. Extend [infra/validate-deployment.sh](../../infra/validate-deployment.sh) with an **Application Insights**
   section that, for the resolved `ENV_NAME`, asserts:
   - `${ENV_NAME}-appinsights` exists (`az monitor app-insights component show`).
   - It is workspace-linked to `${ENV_NAME}-logs` (per-env workspace).
   - The API container app exposes `APPLICATIONINSIGHTS_CONNECTION_STRING` sourced
     from secret ref `appinsights-connection-string` (mirror the line-238 pattern).
2. Satisfies FR-009 (enforceable proof) and feeds SC-002.

### Phase C — Produce end-to-end evidence (deploy-then-destroy)

1. Document and run (quickstart.md): `workflow_dispatch` staging deploy →
   `validate-deployment.sh` → confirm `${ENV}-appinsights` distinct from
   `epcubegraph-appinsights` and connection strings differ → `workflow_dispatch`
   destroy → confirm `${ENV}-appinsights` and `${ENV}-logs` removed → confirm
   `epcubegraph-appinsights` still present.
2. Satisfies SC-002, SC-003, SC-004, SC-005, SC-006 (two concurrent staging envs
   each resolve to their own resource by `environment_name`).

### Phase D — Decision gate (before /speckit.tasks)

- **Recommended**: verify-only (Phases A–C). No application code, no coverage impact.
- **Alternative (opt-in)**: add per-environment cloud role naming (dashboard +
  API) under TDD with 100% coverage. Adds cd.yml `VITE_ENVIRONMENT`-style injection
  and an API `TelemetryInitializer`. Recommended **against** (YAGNI; no isolation
  benefit).

## Requirements coverage map

| Requirement | Addressed by |
|-------------|--------------|
| FR-001, FR-003, FR-004, FR-007, FR-008 | Phase A (already implemented; verified) |
| FR-002 | Resource separation (per-resource Application Map) — confirmed in Phase C |
| FR-005, FR-006 | Phase A + Phase C (destroy removes per-env AI + Logs; prod untouched) |
| FR-009 | Phase B (validator) + Phase C (live cycle) |
| FR-010 | `environment_name` templating ⇒ each staging env distinct (Phase C, SC-006) |
| SC-001 | Resource separation (Phase A); role naming not required (research §3 D2) |
| SC-002, SC-003, SC-004, SC-005, SC-006 | Phase C evidence runbook |

## Complexity Tracking

> No Constitution violations. Table intentionally empty.
