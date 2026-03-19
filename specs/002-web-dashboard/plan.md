# Implementation Plan: Web Dashboard for Energy Telemetry

**Branch**: `002-web-dashboard` | **Date**: 2026-03-16 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/002-web-dashboard/spec.md`

## Summary

Build a web dashboard (Preact SPA) for viewing EP Cube energy telemetry data in a browser. The dashboard:

1. **Current readings** (US1): Displays live solar, battery, and grid metrics per device, auto-polling every 30 seconds (half the 1-minute collection interval), with stale/offline indicators when data exceeds 3 minutes old.
2. **Historical graphs** (US2): Interactive line charts via uPlot with time range presets (today, 7d, 30d, 1y, custom) and tiered data resolution (1-min for daily, hourly for weekly, daily for monthly, monthly for yearly). Data gaps rendered as broken lines.
3. **Grafana integration** (US3): Existing API is consumed by Grafana via the Infinity plugin (generic JSON/REST) — no separate Grafana-specific endpoint.

The SPA is hosted on Azure Static Web Apps (Free tier), authenticates via MSAL.js + Entra ID (PKCE), and consumes the Feature 001 REST API exclusively.

## Technical Context

**Language/Version**: TypeScript 5.8 / Preact 10.x (SPA); C# / .NET 10 (API — already exists from Feature 001)
**Primary Dependencies**: Preact, preact-router, @azure/msal-browser (MSAL.js), uPlot (charting), Vite (build)
**Storage**: N/A — stateless SPA; all data fetched from Feature 001 API at runtime
**Testing**: Vitest 3.x, @testing-library/preact, happy-dom, @vitest/coverage-v8 (100% coverage)
**Target Platform**: Azure Static Web Apps (Free tier); browsers: Chrome, Firefox, Safari, Edge (current + previous major)
**Project Type**: Web application (SPA)
**Performance Goals**: Current readings displayed within 2s (SC-001); graphs for 30d render within 2s (SC-002)
**Constraints**: Single user, 100% test coverage (constitution), TLS-only, authenticated access
**Scale/Scope**: 1 user, 2–4 EP Cube devices, ~20 metrics at 1-minute intervals

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| I | Simplicity | ✅ PASS | Preact (3KB) over React/Angular, uPlot (canvas) over Chart.js/Recharts, Azure SWA Free tier (1 resource). Fewest moving parts. |
| II | YAGNI | ✅ PASS | No state management library, no SSR, no multi-user support, no plugin system. Every component maps to a current FR. |
| III | Test-Driven Development (NON-NEGOTIABLE) | ✅ PASS | Vitest + @testing-library/preact + happy-dom. TDD Red-Green-Refactor cycle enforced. AAA pattern (Arrange-Act-Assert) with section comments. 100% coverage enforced via vitest.config.ts thresholds. Unit + component tests for all code. |
| — | Dev Workflow | ✅ PASS | Feature branch `002-web-dashboard`, atomic commits, CI gate with full test suite. |
| — | Performance | ✅ PASS | uPlot handles 30d data at 1-min resolution (~43K points) within 2s. Tiered downsampling (FR-013) reduces data for weekly/monthly/yearly views. |
| — | Platform: Azure | ✅ PASS | Azure Static Web Apps (Azure-native) for hosting. Grafana on Azure Container Apps (existing environment). |
| — | Platform: Web | ✅ PASS | FR-001 satisfied. Browserslist targets last 2 versions of Chrome, Firefox, Safari, Edge. |
| — | Security: TLS | ✅ PASS | SWA provides auto-managed TLS. All API calls over HTTPS. |
| — | Security: Auth | ✅ PASS | MSAL.js (PKCE flow, public client) authenticates with Entra ID. Bearer token on every API request (FR-010). |
| — | Security: Tokens | ✅ PASS | MSAL.js handles token refresh automatically. Tokens have bounded lifetime. Session storage, no long-lived tokens. |
| — | Security: Zero-Trust | ✅ PASS | Dashboard never trusts client state for auth decisions. All API requests authenticated. Server enforces authorization via `user_impersonation` scope. |
| — | Security: Secrets | ✅ PASS | No secrets in SPA. Client ID and tenant ID are public identifiers. No client secret (PKCE flow). |
| — | DevOps: IaC | ✅ PASS | SWA + dashboard Entra app registration defined in Terraform (`infra/static-web-app.tf`, `infra/entra.tf`). |
| — | DevOps: Remote State | ✅ PASS | Existing Terraform remote state in Azure Blob Storage. |
| — | DevOps: CI/CD | ✅ PASS | GitHub Actions deploys via `Azure/static-web-apps-deploy@v1`. CI gate runs full Vitest suite with 100% coverage. |
| — | DevOps: Rollback | ✅ PASS | SWA maintains deployment history. Previous deployments redeployable via GitHub Actions. |
| — | Grafana Auth | ⚠ NOTE | Grafana uses Infinity plugin against the authenticated API. Infinity plugin must be configured with OAuth2 credentials or service account token to authenticate. See Complexity Tracking. |

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
│   ├── api.ts                   # API client (fetch + bearer token)
│   ├── auth.ts                  # MSAL.js init, token acquisition
│   ├── types.ts                 # TypeScript interfaces for API responses
│   ├── components/
│   │   ├── CurrentReadings.tsx  # US1: device cards with live metrics
│   │   ├── DeviceCard.tsx       # Per-device metric display + online/offline badge
│   │   ├── ErrorBoundary.tsx    # Global error handling + retry
│   │   ├── HistoricalGraph.tsx  # US2: uPlot time-series chart
│   │   ├── HistoryView.tsx      # US2: time range selector + graph container
│   │   └── TimeRangeSelector.tsx # Presets: today, 7d, 30d, 1y, custom
│   └── utils/
│       ├── formatting.ts        # formatWatts, formatPercent, formatTimestamp
│       └── polling.ts           # Auto-poll at 30s (half collection interval)
└── tests/
    ├── component/               # @testing-library/preact component tests
    │   ├── App.test.tsx
    │   ├── CurrentReadings.test.tsx
    │   ├── DeviceCard.test.tsx
    │   ├── ErrorBoundary.test.tsx
    │   ├── HistoricalGraph.test.tsx
    │   ├── HistoryView.test.tsx
    │   └── TimeRangeSelector.test.tsx
    └── unit/                    # Pure function unit tests
        ├── api.test.ts
        ├── auth.test.ts
        ├── formatting.test.ts
        └── polling.test.ts

# Azure infrastructure additions (Terraform)
infra/
├── static-web-app.tf           # azurerm_static_web_app (dashboard hosting)
├── entra.tf                    # + azuread_application.dashboard (SPA public client)
└── grafana.tf                  # azurerm_container_app.grafana (Grafana on Container Apps)
```

**Structure Decision**: The dashboard is a standalone SPA under `dashboard/` — separate from the API (`api/`) since they have different runtimes, build tools, and deployment targets (SWA vs Container Apps). Infrastructure additions in `infra/` extend the existing Terraform configuration. This mirrors Feature 001's structure pattern.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Grafana Infinity plugin auth complexity | FR-009 requires API-based Grafana access. The API requires Entra ID auth. Infinity plugin must authenticate with Entra ID OAuth2. | Direct VictoriaMetrics access (simpler, no auth) rejected because spec clarification explicitly requires Grafana to consume the versioned REST API via Infinity plugin — maintaining the single API contract principle (FR-011). |
