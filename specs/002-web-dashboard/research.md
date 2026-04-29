# Phase 0 Research: Web Dashboard for Energy Telemetry

**Branch**: `002-web-dashboard` | **Date**: 2026-03-22 | **Spec**: [spec.md](spec.md)

---

## Topic 1: Azure Static Web Apps for SPA Hosting

### Decision

**Use Azure Static Web Apps (Free tier)** via the `azurerm_static_web_app` Terraform resource, with GitHub Actions deployment.

### Rationale

SWA Free tier is purpose-built for this use case — a small (~75KB) SPA with client-side auth. Zero cost, auto-managed TLS, `azurerm_static_web_app` Terraform resource is stable. GitHub Actions deploys via `Azure/static-web-apps-deploy@v1`. SPA routing handled by `staticwebapp.config.json` with navigation fallback.

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| **SWA Standard (~$9/month)** | Standard adds SLA, larger limits, private endpoints. None needed for single-user ~75KB SPA. YAGNI (Constitution II). |
| **Azure Blob Storage + CDN** | 3+ resources (storage, CDN profile, CDN endpoint), more complex Terraform, manual TLS certificate management, no built-in CI/CD. Violates Simplicity (I). |
| **Azure Container Apps** | Container runtime for static files is extreme overkill. Adds Dockerfile, ACR, vCPU costs. Violates Simplicity (I) and YAGNI (II). |

### Already Implemented

SWA resource exists in `infra/static-web-app.tf` (Free tier, eastus2). SPA routing config exists in `dashboard/staticwebapp.config.json` with CSP headers. Entra app registration for dashboard SPA exists in `infra/entra.tf`. CI/CD pipeline deploys dashboard in both staging and production.

---

## Topic 2: Application Insights for Client-Side Telemetry (FR-020)

### Decision

**Use `@microsoft/applicationinsights-web` (v3.x)** — the framework-agnostic core SDK. No React-specific plugin needed.

### Rationale

- The SDK is framework-agnostic. Preact doesn't need the React plugin — manual `trackPageView()` and `trackException()` calls are sufficient for the spec's requirements (FR-020: unhandled exceptions, failed API calls, page load performance).
- Init requires only a `connectionString` (output from Terraform's `azurerm_application_insights`).
- Lazy initialization: only activate when `VITE_APPINSIGHTS_CONNECTION_STRING` is set. No telemetry in local dev or tests by default.
- No PII captured — only error details, page views, and performance timings.

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| **No telemetry (rely on in-UI errors only)** | Spec explicitly requires Application Insights (FR-020, clarification session 2026-03-22). |
| **Custom error logging to API** | Requires new server-side endpoint, more code, more testing. App Insights is a managed Azure service — simpler (Constitution I). |
| **Sentry / Datadog** | Non-Azure-native. Violates Platform Constraints (constitution: Azure-native services preferred). |

### Configuration

```typescript
// dashboard/src/telemetry.ts
import { ApplicationInsights } from '@microsoft/applicationinsights-web';

let appInsights: ApplicationInsights | null = null;

export function initTelemetry(connectionString: string): void {
  appInsights = new ApplicationInsights({
    config: { connectionString, enableAutoRouteTracking: true }
  });
  appInsights.loadAppInsights();
  appInsights.trackPageView();
}

export function trackException(error: Error): void {
  appInsights?.trackException({ exception: error });
}

export function trackApiFailure(url: string, status: number): void {
  appInsights?.trackEvent({
    name: 'ApiFailure',
    properties: { url, status: String(status) }
  });
}
```

### Terraform Resource

```hcl
resource "azurerm_application_insights" "dashboard" {
  name                = "${var.environment_name}-dashboard-insights"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  application_type    = "web"
}
```

Classic mode (no Log Analytics workspace) — simplest option. Workspace-based mode can be adopted later if log correlation is needed.

---

## Topic 3: uPlot for Historical Charts (US2)

### Decision

**Use uPlot (already installed, v1.6.31)** for time-series charts with native gap handling.

### Rationale

- uPlot renders ~43K points (30 days at 1-min resolution) within the 2-second performance target (SC-002). Canvas-based rendering is significantly faster than SVG-based alternatives.
- **Gap handling (FR-008)**: uPlot natively supports `null` values in data arrays. When a value is `null`, the line breaks — producing the "broken line" visualization required by FR-008. No custom gap detection logic needed.
- Lightweight (~40KB gzipped) — aligns with Simplicity (Constitution I).
- Already a dependency in `dashboard/package.json`.

### Data Conversion

API returns range data from the data store. Conversion to uPlot's `AlignedData`:

```typescript
function toUPlotData(
  timestamps: number[],
  seriesResults: Array<{ values: Array<[number, string]> }>
): uPlot.AlignedData {
  const aligned: (number | null)[][] = seriesResults.map(series => {
    const valueMap = new Map(series.values.map(([ts, v]) => [ts, parseFloat(v)]));
    return timestamps.map(ts => valueMap.get(ts) ?? null);
  });
  return [timestamps, ...aligned];
}
```

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| **Chart.js** | SVG-based, ~200KB. Slower for large time-series. Gap handling requires plugins. Violates Simplicity (I). |
| **Recharts** | React-specific (not Preact-compatible without aliasing). SVG-based, slower at scale. |
| **D3 (raw)** | Maximum flexibility but requires building chart primitives from scratch. Violates Simplicity (I). |

---

## Topic 4: API Contract Stability

### Decision

**Dashboard currently consumes the active PostgreSQL-backed API endpoints.** Since we own all clients (web dashboard, iPhone, iPad), the API contract uses clean JSON models tailored to those clients rather than storage-native response shapes.

### Current State

The dashboard depends on these API endpoints (per `specs/001-data-ingestor/contracts/api-v1.md`):
- `GET /api/v1/readings/current` → `CurrentReadingsResponse`
- `GET /api/v1/readings/range` → `RangeReadingsResponse`
- `GET /api/v1/devices` → `DeviceListResponse`
- `GET /api/v1/grid` → `RangeReadingsResponse`
- `GET /api/v1/health` → `HealthResponse`

Responses use the active JSON contract (`metric`, `readings`, `series`, and typed device payloads). Any future contract change must be treated as a first-party coordination update across docs, code, and issues.

### Impact Assessment

Since we own all clients, the API contract redesign is an opportunity to simplify. The dashboard's `types.ts`, `api.ts`, and graph data conversion will be updated during the migration. No backward compatibility with legacy monitoring tools is needed.

### No Action Required Now

The dashboard proceeds with the current API format. All format changes will happen during the Azure SQL migration.

---

## Topic 5: Tiered Data Resolution Implementation (FR-013)

### Decision

**Client-side tier selection.** The dashboard calculates the step parameter based on the selected time range and passes it to the API's `query_range` endpoint.

### Tier Table

| Range Duration | Step | Label |
|----------------|------|-------|
| ≤ 1 day | 60s (1 min) | Collection interval |
| ≤ 7 days | 3600s (1 hour) | Hourly |
| ≤ 30 days | 86400s (1 day) | Daily |
| > 30 days | 2592000s (~30 days) | Monthly |

### Aggregation Notice

When `step > 60`, display a `role="status"` banner above the chart: "Data shown at {hourly|daily|monthly} resolution". No notice for the 1-min tier (full resolution).

### Custom Range Auto-Tiering

Custom date ranges use the same tier table, selected by range duration. No cap on custom range length.

---

## Decision Summary

| Decision | Choice | Cost Impact | Complexity |
|----------|--------|-------------|------------|
| SPA Hosting | Azure SWA Free | $0/month | Already implemented |
| Client Telemetry | @microsoft/applicationinsights-web v3 (classic mode) | $0 (free tier) | Low — ~50 lines of init + wrapper code |
| Charting | uPlot v1.6.31 (canvas) | $0 | Already installed |
| API Contract | Current format (will change during Azure SQL migration — we own all clients) | $0 | Low — types.ts changes deferred |
| Data Tiering | Client-side step calculation | $0 | Low — step parameter in query |

All decisions prioritize Simplicity (Constitution I), avoid YAGNI (Constitution II), use Azure-native services (Platform Constraints), and are fully Terraform-provisioned (DevOps: IaC).
