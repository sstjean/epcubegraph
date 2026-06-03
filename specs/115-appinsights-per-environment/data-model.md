# Data Model: Separate Application Insights per Environment

**Feature**: `115-appinsights-per-environment` | **Date**: 2026-06-01

This feature introduces no database schema or application data. The "entities"
are infrastructure resources and their per-environment invariants. This document
records those entities and the validation rules the verifier enforces.

## Entities

### Environment

| Field | Value / Rule |
|-------|--------------|
| `environment_name` | `epcubegraph` (production) or `epcubegraph-<branch-slug>` (staging). Sole discriminator for all per-env resources. |
| Lifecycle | Production is long-lived; staging is ephemeral (created/destroyed via `cd.yml` `workflow_dispatch`). |
| State | One Terraform state per env: `<environment_name>.tfstate`. |

### Application Insights resource (per environment)

| Field | Value / Rule | Source |
|-------|--------------|--------|
| `name` | `${environment_name}-appinsights` | [infra/application-insights.tf](../../infra/application-insights.tf) |
| `application_type` | `web` | same |
| `workspace_id` | `${environment_name}-logs` Log Analytics workspace | same / [infra/storage.tf](../../infra/storage.tf) |
| `connection_string` | exported + stored in Key Vault | [infra/outputs.tf](../../infra/outputs.tf), [infra/keyvault.tf](../../infra/keyvault.tf) |
| Cardinality | exactly one per deployed environment | — |
| `prevent_destroy` | absent ⇒ removed on `terraform destroy` | — |

### Log Analytics workspace (per environment)

| Field | Value / Rule | Source |
|-------|--------------|--------|
| `name` | `${environment_name}-logs` | [infra/storage.tf](../../infra/storage.tf) |
| Sharing | **not shared** across environments | same |
| `prevent_destroy` | absent ⇒ removed on `terraform destroy` | — |

### Telemetry connection string (per environment)

| Field | Value / Rule | Source |
|-------|--------------|--------|
| KV secret name | `appinsights-connection-string` | [infra/keyvault.tf](../../infra/keyvault.tf) |
| API consumption | env var `APPLICATIONINSIGHTS_CONNECTION_STRING` via secret ref `appinsights-connection-string` | [infra/container-apps.tf](../../infra/container-apps.tf) |
| Dashboard consumption | build-time `VITE_APPINSIGHTS_CONNECTION_STRING` from `terraform output` | [.github/workflows/cd.yml](../../.github/workflows/cd.yml#L270) |
| Fail-safe | dashboard no-ops if the value is empty (never falls back to production) | [dashboard/src/telemetry.ts](../../dashboard/src/telemetry.ts#L5-L7) |

## Validation rules (enforced by `validate-deployment.sh`)

For the resolved `ENV_NAME`:

1. **R1** — `${ENV_NAME}-appinsights` exists.
2. **R2** — its `workspace_id` references `${ENV_NAME}-logs` (per-env workspace).
3. **R3** — the API container app exposes env var
   `APPLICATIONINSIGHTS_CONNECTION_STRING` with secret ref
   `appinsights-connection-string`.
4. **R4** (manual, deploy-then-destroy) — a staging `${ENV}-appinsights`
   connection string differs from production's `epcubegraph-appinsights`.
5. **R5** (manual, destroy) — after teardown, `${ENV}-appinsights` and
   `${ENV}-logs` no longer exist; `epcubegraph-appinsights` still exists.

## State transitions

```text
(absent) --terraform apply (env_name)--> [AI + Logs created, conn string in KV]
[present] --validate-deployment.sh------> R1..R3 asserted
[present] --terraform destroy (env_name)-> (absent)  # R5: prod resource unaffected
```
