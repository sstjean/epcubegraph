# Implementation Plan: Web Dashboard for Energy Telemetry

**Branch**: `002-web-dashboard` | **Date**: 2026-03-22 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/002-web-dashboard/spec.md`

## Summary

Build a web dashboard (Preact SPA) for viewing EP Cube energy telemetry data in a browser. The dashboard:

1. **Current readings** (US1, #33): Displays live solar, battery, home load, and grid metrics for 2 EP Cube devices in a side-by-side grid, auto-polling every 30 seconds (half the 1-minute collection interval), with stale/offline indicators when data exceeds 3 minutes old. Includes animated energy flow diagram (FR-017) with toggle to gauge dial view.
2. **Historical graphs** (US2, #34): Interactive line charts via uPlot with time range presets (today, 7d, 30d, 1y, custom) and tiered data resolution (1-min for daily, hourly for weekly, daily for monthly, calendar month for yearly). Data gaps rendered as broken lines. Aggregation notice when downsampled.

The SPA is hosted on Azure Static Web Apps (Free tier), authenticates via MSAL.js + Entra ID (PKCE), consumes the Feature 001 REST API exclusively (FR-011), and reports client-side errors to Azure Application Insights (FR-020).

## Technical Context

**Language/Version**: TypeScript 5.8 / Preact 10.x (SPA); C# / .NET 10 (API — already exists from Feature 001)
**Build Runtime**: Node.js 22 (CI and local development)
**Primary Dependencies**: Preact, preact-router, @azure/msal-browser (MSAL.js), uPlot (charting), @microsoft/applicationinsights-web (telemetry), Vite (build)
**Storage**: N/A — stateless SPA; all data fetched from Feature 001 API at runtime
**Testing**: Vitest 3.x, @testing-library/preact, happy-dom, @vitest/coverage-v8 (100% coverage)
**Target Platform**: Azure Static Web Apps (Free tier); browsers: Chrome, Firefox, Safari, Edge (current + previous major)
**Project Type**: Web application (SPA)
**Performance Goals**: Current readings displayed within 2s (SC-001); graphs for 30d render within 2s (SC-002)
**Constraints**: Single user, 100% test coverage (constitution), TLS-only, authenticated access
**Scale/Scope**: 1 user, 2 EP Cube devices, ~20 metrics at 1-minute intervals

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| I | Simplicity | ✅ PASS | Preact (3KB) over React/Angular, uPlot (canvas) over Chart.js/Recharts, Azure SWA Free tier (1 resource). Fewest moving parts. |
| II | YAGNI | ✅ PASS | No state management library, no SSR, no multi-user support, no plugin system. Every component maps to a current FR. No Grafana (FR-009 removed). |
| III | Test-Driven Development (NON-NEGOTIABLE) | ✅ PASS | Vitest + @testing-library/preact + happy-dom. TDD Red-Green-Refactor cycle enforced. AAA pattern (Arrange-Act-Assert) with section comments. 100% coverage enforced via vitest.config.ts thresholds. Unit + component tests for all code. |
| — | Dev Workflow | ✅ PASS | Feature branch `002-web-dashboard`, atomic commits, CI gate with full test suite. |
| — | Local Type-Checking (NON-NEGOTIABLE) | ✅ PASS | `npm run typecheck` (tsc --noEmit) in package.json. CI runs typecheck before tests. |
| — | Performance | ✅ PASS | uPlot handles 30d data at 1-min resolution (~43K points) within 2s. Tiered downsampling (FR-013) reduces data for weekly/monthly/yearly views. |
| — | Platform: Azure | ✅ PASS | Azure Static Web Apps (Azure-native) for hosting. Azure Application Insights (Azure-native) for telemetry. |
| — | Platform: Web | ✅ PASS | FR-001 satisfied. Browserslist targets last 2 versions of Chrome, Firefox, Safari, Edge. |
| — | Security: TLS | ✅ PASS | SWA provides auto-managed TLS. All API calls over HTTPS. |
| — | Security: Auth | ✅ PASS | MSAL.js (PKCE flow, public client) authenticates with Entra ID. Bearer token on every API request (FR-010). |
| — | Security: Tokens | ✅ PASS | MSAL.js handles token refresh automatically. Tokens have bounded lifetime. Session storage, no long-lived tokens. |
| — | Security: Zero-Trust | ✅ PASS | Dashboard never trusts client state for auth decisions. All API requests authenticated. Server enforces authorization via `user_impersonation` scope. |
| — | Security: Secrets | ✅ PASS | No secrets in SPA. Client ID and tenant ID are public identifiers. No client secret (PKCE flow). Application Insights connection string is not a secret (instrumentation only). |
| — | Security: SFI | ✅ PASS | SWA Free tier has no storage/keyvault dependencies. App Insights uses managed identity where applicable. No SFI conflicts. |
| — | DevOps: IaC | ✅ PASS | SWA, dashboard Entra app registration, and Application Insights defined in Terraform. |
| — | DevOps: Remote State | ✅ PASS | Existing Terraform remote state in Azure Blob Storage with Azure AD auth. CI/CD uses OIDC. |
| — | DevOps: CI/CD | ✅ PASS | GitHub Actions deploys via `Azure/static-web-apps-deploy@v1`. CI gate runs full Vitest suite with 100% coverage. |
| — | DevOps: CI Test Coverage (NON-NEGOTIABLE) | ✅ PASS | Dashboard CI job runs `npm run test:coverage` with 100% threshold. |
| — | DevOps: CI/CD Zero Warnings | ✅ PASS | All CI/CD steps configured to fail on warnings. |
| — | DevOps: Environment Parity (NON-NEGOTIABLE) | ✅ PASS | Staging and production SWA + App Insights resources identical in architecture; differ only in parameter values. |
| — | DevOps: Rollback | ✅ PASS | SWA maintains deployment history. Previous deployments redeployable via GitHub Actions. |
| — | GitHub Issue Discipline (NON-NEGOTIABLE) | ✅ PASS | Feature #4 → US issues #33, #34. #35 closed (Grafana descoped). Tasks tracked as checklists in US issue bodies. |

## Project Structure

### Documentation (this feature)

```text
specs/002-web-dashboard/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── dashboard-config.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
# Dashboard SPA (Preact + TypeScript — hosted on Azure Static Web Apps)
dashboard/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── staticwebapp.config.json     # SWA routing + security headers
├── public/
├── src/
│   ├── main.tsx                 # Bootstrap, MSAL init, render
│   ├── App.tsx                  # Router: / (current) and /history
│   ├── vite-env.d.ts            # Vite client type declarations
│   ├── app.css                  # Global styles (gauge grid, device cards, flow diagram)
│   ├── api.ts                   # API client (fetch + bearer token)
│   ├── auth.ts                  # MSAL.js init, token acquisition
│   ├── types.ts                 # TypeScript interfaces for API responses
│   ├── telemetry.ts             # Application Insights init + trackException/trackPageView (FR-020)
│   ├── components/
│   │   ├── CurrentReadings.tsx  # US1: device cards with live metrics + view toggle
│   │   ├── DeviceCard.tsx       # Per-device metric display via gauge dials
│   │   ├── EnergyFlowDiagram.tsx # US1: animated SVG energy flow per device (FR-017)
│   │   ├── ErrorBoundary.tsx    # Global error handling + retry
│   │   ├── GaugeDial.tsx        # SVG arc gauge for single metric (reusable)
│   │   ├── HistoricalGraph.tsx  # US2: uPlot time-series chart
│   │   ├── HistoryView.tsx      # US2: time range selector + graph container
│   │   └── TimeRangeSelector.tsx # Presets: today, 7d, 30d, 1y, custom
│   └── utils/
│       ├── formatting.ts        # formatWatts, formatPercent, formatKwh, formatTimestamp
│       └── polling.ts           # Auto-poll at 30s (half collection interval)
└── tests/
    ├── setup.ts                 # Test setup (happy-dom, jest-dom matchers)
    ├── component/               # @testing-library/preact component tests
    │   ├── App.test.tsx
    │   ├── CurrentReadings.test.tsx
    │   ├── DeviceCard.test.tsx
    │   ├── EnergyFlowDiagram.test.tsx
    │   ├── ErrorBoundary.test.tsx
    │   ├── GaugeDial.test.tsx
    │   ├── HistoricalGraph.test.tsx
    │   ├── HistoryView.test.tsx
    │   └── TimeRangeSelector.test.tsx
    └── unit/                    # Pure function unit tests
        ├── api.test.ts
        ├── auth.test.ts
        ├── formatting.test.ts
        ├── main.test.tsx
        ├── polling.test.ts
        └── telemetry.test.ts

# Azure infrastructure additions (Terraform)
infra/
├── static-web-app.tf           # azurerm_static_web_app (dashboard hosting)
├── entra.tf                    # + azuread_application.dashboard (SPA public client)
├── application-insights.tf     # azurerm_application_insights (FR-020)
├── variables.tf                # + app_insights variables
└── outputs.tf                  # + swa_default_hostname, swa_api_key, dashboard_client_id, appinsights_connection_string
```

**Structure Decision**: The dashboard is a standalone SPA under `dashboard/` — separate from the API (`api/`) since they have different runtimes, build tools, and deployment targets (SWA vs Container Apps). Infrastructure additions in `infra/` extend the existing Terraform configuration. This mirrors Feature 001's structure pattern. Application Insights gets its own `.tf` file to keep resource types cleanly separated.

## Design Decisions

### Device Alias Grouping

EP Cube devices expose two separate targets per physical unit: one for the battery (`storage_battery` class) and one for the solar inverter (`home_solar` class). The dashboard groups these into a single DeviceCard per physical EP Cube unit by extracting the base alias (e.g., "Steve St Jean 3") from the `Device.alias` field, stripping trailing "Battery" or "Solar" suffixes. This presents a unified view per EP Cube rather than showing two disconnected device entries.

### Gauge Dial Presentation

Current readings use SVG arc gauges (`GaugeDial` component) instead of plain text values. Each metric gets a dedicated gauge with appropriate scaling:
- **Solar**: 0–12 kW (unidirectional)
- **Battery SOC**: 0–100% (unidirectional)
- **Battery Power**: ±20 kW (bidirectional — charging vs discharging)
- **Home Load**: 0–10 kW (unidirectional)
- **Grid**: ±20 kW (bidirectional — import vs export)

Bidirectional gauges render from a center zero point. This visual approach gives at-a-glance comprehension of system state without reading numeric values.

### Secondary Value Display

The Battery SOC gauge displays remaining stored energy (kWh) as a secondary value below the percentage. The `GaugeDial` component accepts an optional `secondaryValue` prop rendered at a smaller font size beneath the main reading.

### Energy Flow Diagram (FR-017)

The default current-readings view is an animated SVG energy flow diagram per device. Flow lines animate directionally (CSS dashed-line animation) between Solar, Grid, EP Cube Gateway, Battery, and Home nodes. Lines activate when power exceeds a 10W threshold and dim when inactive. Battery node shows SOC ring, stored kWh, and charge/discharge state. A radiogroup toggle switches between Flow and Gauges views.

### Application Insights Integration (FR-020)

Application Insights is initialized lazily — only when the `VITE_APPINSIGHTS_CONNECTION_STRING` env var is set. This means:
- **Production/Staging**: Telemetry is captured (env var injected at build time from Terraform output)
- **Local dev**: No telemetry unless explicitly configured (no noise in dev workspace)
- **Tests**: Module is mock-friendly (telemetry.ts exports simple functions wrapping the SDK)

Tracked events: unhandled exceptions (via `trackException`), failed API calls (4xx/5xx), page load performance (`trackPageView`). No PII is captured.

## Complexity Tracking

> No constitution violations requiring justification. All principles pass.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
