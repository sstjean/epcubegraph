# Phase 0 Research: Web Dashboard for Energy Telemetry

**Branch**: `002-web-dashboard` | **Date**: 2026-03-16 | **Spec**: [spec.md](spec.md)

---

## Topic 1: Azure Static Web Apps vs Alternatives for SPA Hosting

The web dashboard is a Preact SPA (TypeScript + Vite build, ~75KB total). Single user. Requirements: custom domain with TLS, MSAL.js client-side OAuth (no server-side auth), CI/CD from GitHub Actions, Terraform provisioning (constitution: IaC required), rollback capability (constitution: DevOps).

### Decision

**Use Azure Static Web Apps (Free tier)** via the `azurerm_static_web_app` Terraform resource, with GitHub Actions deployment.

### Rationale

Azure Static Web Apps Free tier is purpose-built for exactly this use case — a small SPA with client-side auth. It satisfies every requirement with the least complexity and zero cost:

- **Cost**: $0/month (Free tier). The app is ~75KB, single user, well within Free tier limits (100MB storage, 100GB bandwidth/month).
- **Custom domain + TLS**: Free tier includes custom domains with auto-managed TLS certificates. No CDN or certificate provisioning needed.
- **MSAL.js compatibility**: MSAL.js runs entirely client-side (Authorization Code flow with PKCE). SWA serves static files — no server-side auth integration needed. The Entra ID app registration already exists in `infra/entra.tf`. A second app registration for the SPA (public client, no secret) is needed for MSAL.js.
- **Terraform support**: `azurerm_static_web_app` resource is stable in the azurerm provider (~> 4.0, already used by the project). Straightforward resource definition:
  ```hcl
  resource "azurerm_static_web_app" "dashboard" {
    name                = "${var.environment_name}-dashboard"
    resource_group_name = azurerm_resource_group.main.name
    location            = azurerm_resource_group.main.location
    sku_tier            = "Free"
    sku_size            = "Free"
  }
  ```
- **CI/CD**: GitHub Actions deploys via the official `Azure/static-web-apps-deploy@v1` action. The deployment token is output from Terraform and stored as a GitHub Actions secret.
- **Rollback**: SWA maintains deployment history. Previous deployments can be redeployed via the GitHub Actions workflow or Azure CLI. Each deployment is an immutable snapshot of the static assets.
- **Simplicity (Constitution I)**: Single Azure resource, no containers, no CDN profiles, no storage accounts, no custom routing rules. Fewest moving parts of all options evaluated.
- **Azure-native (Constitution: Platform Constraints)**: SWA is an Azure-native service, satisfying the constitution's requirement that infrastructure choices use Azure-native services.

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| **Azure Static Web Apps (Standard tier, ~$9/month)** | Standard adds: SLA, larger storage/bandwidth limits, private endpoints, custom auth integration, staging environments. None of these are needed for a single-user ~75KB SPA. The Free tier's limits (100MB storage, 100GB bandwidth) are orders of magnitude beyond this app's needs. Standard tier's features would be YAGNI violations (Constitution II). Can upgrade later if needed — no migration required. |
| **Azure Blob Storage static website + Azure CDN** | Requires 3+ Azure resources: storage account (static website enabled), CDN profile, CDN endpoint, plus custom domain + TLS certificate configuration on the CDN. Terraform is more complex (multiple resources, depends_on chains). No built-in CI/CD integration — must write custom GitHub Actions steps to `az storage blob upload-batch` and purge CDN cache. Custom domain TLS requires CDN-managed certificates or Key Vault integration. More moving parts, more maintenance, more cost ($0.081/GB storage + CDN costs), all for no functional benefit over SWA Free. Violates Simplicity (Constitution I). |
| **Azure Container Apps** | Full container runtime for serving static files is extreme overkill. Would require: building a Docker image (nginx/caddy + static assets), pushing to ACR, defining a Container App with ingress. Min replica = 1 burns ~$0.25/vCPU/hour even idle. Adds Dockerfile maintenance, container image versioning, and ACR storage costs. The dashboard is 75KB of static files — this is like renting a semitruck to deliver a letter. Violates both Simplicity (I) and YAGNI (II). The only scenario where Container Apps would be justified is if the dashboard required server-side rendering or a backend-for-frontend, which it does not (FR-011: consumes API via client-side fetch). |

### Configuration Notes

**SPA routing**: SWA needs a `staticwebapp.config.json` to handle client-side routing (return `index.html` for all paths):
```json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/assets/*"]
  }
}
```

**Entra ID app registration for SPA**: The existing `azuread_application.api` in `entra.tf` is for the API (confidential client). MSAL.js in the SPA requires a separate app registration configured as a public client (no client secret, redirect URIs for the SWA domain). This should be added to `entra.tf`:
```hcl
resource "azuread_application" "dashboard" {
  display_name     = "EP Cube Graph Dashboard"
  sign_in_audience = "AzureADMyOrg"

  single_page_application {
    redirect_uris = ["https://${azurerm_static_web_app.dashboard.default_host_name}/"]
  }

  required_resource_access {
    resource_app_id = azuread_application.api.client_id
    resource_access {
      id   = random_uuid.user_impersonation_scope.result
      type = "Scope"
    }
  }
}
```

---

## Topic 2: Grafana Deployment Approach

FR-009 requires a Grafana-compatible data source. The API already exposes Prometheus-compatible endpoints (`/query`, `/query_range`, `/series`, `/labels`, `/label/{name}/values`). The spec assumes: "Grafana will be self-hosted or hosted on Azure alongside the server components." Single user, Terraform-provisioned, Azure-native preferred.

### Decision

**Self-host Grafana on Azure Container Apps** as a new container app in the existing Container Apps Environment, with the REST API via the Infinity plugin as the data source.

### Rationale

Self-hosting Grafana on the existing Container Apps Environment is the right balance of simplicity, cost, and constitution compliance:

- **Cost**: ~$0/month incremental at single-user scale. Azure Container Apps bills per vCPU-second and GiB-second of consumption. With `min_replicas = 0` and `max_replicas = 1`, Grafana scales to zero when not in use. The Consumption plan includes a generous free grant (180,000 vCPU-seconds + 360,000 GiB-seconds/month). A single-user Grafana instance used intermittently will likely stay within or near the free grant. Even at min_replicas=1 (0.25 vCPU, 0.5Gi), cost is ~$5-7/month.
- **Infrastructure reuse**: The Container Apps Environment already exists (`azurerm_container_app_environment.main`), as does the Azure File Share infrastructure for persistent storage. Adding Grafana is one additional `azurerm_container_app` resource — incremental complexity is minimal.
- **Terraform support**: `azurerm_container_app` is the same resource type already used for VictoriaMetrics and the API. The team has working patterns and existing Terraform code to extend. No new provider or resource type required.
- **Data source configuration**: Grafana connects to VictoriaMetrics directly via internal Container Apps networking (same environment = shared network). The data source URL is `http://${azurerm_container_app.vm.name}:8428` — the same pattern the API already uses (see `container-apps.tf` line ~192). This bypasses vmauth (which guards external remote-write) and queries VictoriaMetrics directly on port 8428. No API proxy needed, no additional auth layer for internal traffic.
- **Persistent storage**: Grafana needs persistent storage for its SQLite database (dashboards, data sources, preferences). An Azure File Share (same storage account, new share) mounted to `/var/lib/grafana` provides this, using the same pattern as VictoriaMetrics data storage.
- **Custom domain + TLS**: Container Apps provides auto-managed TLS on the default FQDN. Custom domain can be added via `azurerm_container_app_custom_domain` if desired.
- **Constitution compliance**:
  - **Platform Constraints**: Container Apps is Azure-native. ✅
  - **IaC**: Defined in Terraform. ✅
  - **Simplicity (I)**: Reuses existing infrastructure (Container Apps Environment, storage account). One new container app resource. ✅
  - **Security**: Grafana access must be authenticated. Options: (a) Grafana's built-in auth (username/password, stored in Key Vault), (b) Azure Container Apps Easy Auth with Entra ID, or (c) Grafana's Azure AD OAuth integration. Option (a) is simplest for a single user. Password stored in Key Vault, injected as environment variable.
  - **Rollback**: Immutable tagged container images (`grafana/grafana:11.x.y`). No `:latest` tag (constitution: DevOps). ✅

**Grafana configuration via environment variables**:
```hcl
resource "azurerm_container_app" "grafana" {
  name                         = "${var.environment_name}-grafana"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"

  ingress {
    external_enabled = true
    target_port      = 3000
    transport        = "http"
    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    min_replicas = 0
    max_replicas = 1

    container {
      name   = "grafana"
      image  = var.grafana_image  # e.g., "grafana/grafana:11.5.2"
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "GF_SECURITY_ADMIN_PASSWORD"
        secret_name = "grafana-admin-password"
      }

      env {
        name  = "GF_SERVER_ROOT_URL"
        value = "https://${var.environment_name}-grafana.${azurerm_container_app_environment.main.default_domain}"
      }

      volume_mounts {
        name = "grafana-data"
        path = "/var/lib/grafana"
      }
    }

    volume {
      name         = "grafana-data"
      storage_name = azurerm_container_app_environment_storage.grafana.name
      storage_type = "AzureFile"
    }
  }
}
```

**Data source provisioning**: Grafana is provisioned with the Infinity plugin data source configured to query the REST API with OAuth2 client credentials. See the updated Grafana Data Source Configuration section below for the provisioning YAML.

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| **Azure Managed Grafana** | Azure Managed Grafana has a minimum cost of **~$90/month** (Essential tier) or **~$300/month** (Standard tier). For a single-user personal telemetry project, this is disproportionately expensive. The Essential tier is Azure's cheapest option but still includes managed infrastructure, zone redundancy, and SLA that are YAGNI for this project. Terraform support exists (`azurerm_dashboard_grafana`), but the resource is more complex to configure (requires managed identity integration, workspace-level RBAC). The service also requires the Grafana instance to connect to VictoriaMetrics — since VM runs in Container Apps with internal-only query access on port 8428, Managed Grafana (which runs in Microsoft-managed infrastructure) cannot reach it without exposing VM's query port externally or setting up private endpoints ($$$). This would add network complexity that violates Simplicity (I). |
| **Grafana Cloud (free tier)** | Grafana Cloud free tier provides a hosted Grafana instance with 10k metrics, 50GB logs, 50GB traces. However: (1) It's **not Azure-native** — the constitution requires Azure-native services unless a justified exception is documented. (2) The free tier Grafana instance would need to reach VictoriaMetrics over the public internet, requiring exposing VM's query port externally with authentication — currently only vmauth's remote-write port is exposed. This adds attack surface and complexity. (3) Data sovereignty: telemetry data would transit through Grafana Labs' infrastructure. (4) No Terraform support via the azurerm provider (would require the separate `grafana/grafana` Terraform provider for a third-party cloud service). (5) Vendor dependency on a free tier that could change terms. The only advantage is zero maintenance, but the self-hosted approach on existing Container Apps infrastructure is nearly as low-maintenance with a pinned image version. |

### Data Source: Grafana Infinity Plugin via REST API

The spec clarification (2026-03-16) explicitly requires Grafana to consume telemetry data via the existing versioned REST API using the Grafana Infinity plugin (generic JSON/REST data source). This supersedes the original decision to use VictoriaMetrics directly.

| Option | Pros | Cons |
|---|---|---|
| **REST API via Infinity plugin** (chosen) | Single API contract for all consumers (FR-011 principle), API authorization enforced, consistent data across dashboard and Grafana | Requires auth config on Infinity plugin, Grafana features limited to what the API exposes, API must be running for Grafana |
| **VictoriaMetrics direct** (superseded) | Full PromQL support, native Prometheus data source, no auth layer, all Grafana features | Bypasses API authorization, creates a second data access path, couples Grafana to VictoriaMetrics internal details |

**Decision**: Use the Infinity plugin. This maintains the single API contract principle and ensures Grafana sees identical data to the native dashboard. The Infinity plugin can parse the Prometheus-compatible JSON responses from `/query`, `/query_range`, and `/devices`.

**Auth configuration for Infinity plugin**: The Infinity plugin supports OAuth2 client credentials flow. A service principal (app registration with client secret) can be configured in Grafana to acquire tokens for the API's `user_impersonation` scope. The client secret is stored in Key Vault and injected as a Grafana environment variable. This follows the existing secrets management pattern.

### Security Note

Grafana access is authenticated via Grafana's built-in admin auth (username/password). The admin password is generated via `random_password` in Terraform, stored in Key Vault, and injected as `GF_SECURITY_ADMIN_PASSWORD`. The Infinity plugin's API credentials (service principal client secret) follow the same Key Vault pattern.

---

## Topic 3: Tiered Data Resolution (FR-013)

FR-013 requires tiered downsampling based on the selected time range. The dashboard controls resolution via the `step` parameter sent to the API's `/query_range` endpoint.

### Decision

**Client-side step calculation** in `TimeRangeSelector`. The dashboard calculates the appropriate step value based on the selected range tier. No server-side aggregation or new API endpoints needed — VictoriaMetrics handles resolution natively via the PromQL `step` parameter.

### Resolution Tiers

| Range | Step | Data Points (approx) | Rationale |
|-------|------|---------------------|-----------|
| Today (daily) | `1m` (60s) | ~1,440 | Collection interval — full resolution |
| Last 7 days (weekly) | `1h` (3600s) | ~168 | Hourly aggregation — manageable for 7d |
| Last 30 days (monthly) | `1d` (86400s) | ~30 | Daily aggregation — one point per day |
| Last year (yearly) | `30d` (2592000s) | ~12 | Monthly aggregation — one point per month |
| Custom | Calculated | ≤2,000 target | `max(60, floor((end-start)/2000))` |

### Rationale

- **Simplicity (Constitution I)**: VictoriaMetrics already supports arbitrary `step` values in `query_range`. No backend changes needed — the SPA just sends the right step.
- **YAGNI (Constitution II)**: No pre-aggregation, no materialized views, no server-side rollups. The step parameter handles downsampling naturally.
- **Performance (SC-002)**: Fewer data points for larger ranges means faster API responses and chart rendering. 30 daily points for monthly view is trivially fast.
- **Aggregation notice**: When step > collection interval, the dashboard displays a banner: "Data shown at [hourly/daily/monthly] resolution".

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Server-side pre-aggregation (recording rules) | YAGNI — VictoriaMetrics handles step-based downsampling natively. Pre-aggregation adds complexity without benefit at this scale. |
| Fixed 2000-point target for all ranges | Doesn't match the spec's explicit tier definitions (daily=1min, weekly=hourly, etc.) |

---

## Topic 4: Auto-Polling Interval (FR-012)

FR-012 requires the dashboard to auto-poll at half the collection interval (30 seconds).

### Decision

**Update `polling.ts` to default to 30,000ms** (30 seconds). The polling utility already supports configurable intervals. The change is a constant update.

### Rationale

- The 1-minute collection interval means new data arrives every ~60 seconds.
- Polling at 30 seconds ensures the display is never more than ~30 seconds behind new data arriving in VictoriaMetrics.
- 30-second polling with a single user generates negligible API load (~2 requests/minute for current readings).

---

## Topic 5: Broken Line Gap Visualization (FR-008)

FR-008 requires data gaps to be rendered as broken lines (discontinuous segments).

### Decision

**Use `null` values in uPlot series data** to create natural line breaks. uPlot natively renders `null` as a gap in the line series — the line stops before the gap and resumes after.

### Rationale

- The existing `mergeTimeSeries` function in `HistoricalGraph.tsx` already produces `null` for timestamps where a metric has no data point. When the API returns `result: []` or a sparse series, the merge function maps missing timestamps to `null`.
- uPlot's default behavior for `null` values is to leave a gap in the line. No custom plugin or configuration needed.
- The conversion `v ?? NaN` in the uPlot data preparation should use `v ?? null` to ensure uPlot treats gaps correctly (NaN may also work but `null` is the documented approach).

### Validation

Test that uPlot renders gaps correctly by including a test case with sparse data (timestamps with null values in between). Verify visually that the line breaks rather than connecting through the gap.

---

## Summary of Decisions

| Topic | Decision | Cost | Complexity |
|---|---|---|---|
| SPA Hosting | Azure Static Web Apps (Free tier) | $0/month | Low — 1 Azure resource, built-in CI/CD and TLS |
| Grafana | Self-hosted on Azure Container Apps | ~$0-7/month | Low — 1 additional container app in existing environment |
| Grafana Data Source | Infinity plugin via REST API | $0 | Medium — requires OAuth2 service principal for API auth |
| Tiered Downsampling | Client-side step calculation per range tier | $0 | Low — step parameter passed to existing API |
| Auto-Polling | 30-second interval (half collection interval) | $0 | Low — constant change in polling.ts |
| Gap Visualization | uPlot null values for broken lines | $0 | Low — existing behavior, minor code adjustment |

All decisions prioritize Simplicity (Constitution I), avoid YAGNI (Constitution II), use Azure-native services (Platform Constraints), and are fully Terraform-provisioned (DevOps: IaC).
