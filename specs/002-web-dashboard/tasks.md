# Tasks: Web Dashboard for Energy Telemetry

**Input**: Design documents from `/specs/002-web-dashboard/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/dashboard-config.md, quickstart.md

**Tests**: Included — constitution mandates TDD with 100% code coverage (non-negotiable).

**Organization**: Tasks grouped by user story for independent implementation and testing.

**GitHub Issues**: #33 (US1 P1), #34 (US2 P2)

**Regenerated**: 2025-06-22 — full regeneration. Removes Grafana (FR-009 descoped, #35 closed), adds FR-020 (Application Insights), fixes calendar month step to support true calendar boundaries, renames HealthResponse field to `datastore`.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story (US1, US2) this task belongs to
- Exact file paths included in all descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, directory structure, build tooling

- [x] T001 Create dashboard/ directory structure per plan.md: dashboard/{src/{components,utils},tests/{unit,component},public}, create public/favicon.ico placeholder
- [x] T002 Initialize dashboard/package.json with runtime deps (preact, preact-router, @azure/msal-browser, uplot, @microsoft/applicationinsights-web) and dev deps (vite, typescript, @preact/preset-vite, vitest, happy-dom, @testing-library/preact, @testing-library/jest-dom, @testing-library/user-event, @vitest/coverage-v8), include browserslist targeting Chrome/Firefox/Safari/Edge current + previous major version (FR-001, SC-006), run npm install
- [x] T003 [P] Create dashboard/tsconfig.json with strict mode, ES2022 target, jsxImportSource: "preact", module: "ESNext", moduleResolution: "bundler", paths aliases
- [x] T004 [P] Create dashboard/vite.config.ts (Preact plugin via @preact/preset-vite) and dashboard/vitest.config.ts (happy-dom environment, 100% coverage thresholds for branches/functions/lines/statements, test include paths)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core modules that MUST be complete before ANY user story — types, auth, API client, utilities

**CRITICAL**: No user story work can begin until this phase is complete

### Tests for Foundational (TDD — write tests FIRST, confirm they FAIL)

- [x] T005 [P] Write auth unit tests in dashboard/tests/unit/auth.test.ts: MSAL PublicClientApplication init, acquireTokenSilent success path, loginRedirect fallback on InteractionRequiredAuthError, getAccessToken returns bearer token string, handles interaction_required error, logout clears session, loginRedirect preserves current route/view state via state parameter (FR-014), re-auth redirect on token expiry mid-session restores previous view
- [x] T006 [P] Write API client unit tests in dashboard/tests/unit/api.test.ts: fetchDevices returns DeviceListResponse, fetchCurrentReadings attaches bearer token, fetchRangeReadings sends correct start/end/step params, fetchGridPower calls grid endpoint, error response parsing (400/401/403/404/422/503), 401 triggers re-auth flow (FR-014), base URL from VITE_API_BASE_URL env var
- [x] T007 [P] Write formatting unit tests in dashboard/tests/unit/formatting.test.ts: formatWatts auto-scales W/kW/MW with 1 decimal, formatPercent 0-100 with % suffix, formatKwh formats kWh with 1 decimal and dash for NaN/null, formatTimestamp locale-aware date/time from epoch, formatRelativeTime "5m ago"/"2h ago" strings, edge cases: NaN returns dash, null returns dash, negative watts handled correctly
- [x] T008 [P] Write polling unit tests in dashboard/tests/unit/polling.test.ts: createPollingInterval starts timer at 5000ms default, callback executes at interval, clearPollingInterval stops timer, immediate first-call option, cleanup on unmount, DEFAULT_INTERVAL_MS equals 5000

### Implementation for Foundational

- [x] T009 [P] Create TypeScript interfaces in dashboard/src/types.ts: Device, DeviceListResponse, Reading, CurrentReadingsResponse, TimeSeriesPoint, TimeSeries, RangeReadingsResponse (all per data-model.md), TimeRange type, TimeRangeValue interface
- [x] T010 [P] Create dashboard/staticwebapp.config.json per contracts/dashboard-config.md: navigationFallback, security headers (CSP allowing connect-src to login.microsoftonline.com, *.azurecontainerapps.io, *.applicationinsights.azure.com, *.monitor.azure.com)
- [x] T011 [P] Create dashboard/index.html SPA entry point: semantic HTML5 with lang attribute, main landmark wrapping #app mount div (FR-015)
- [x] T012 Create dashboard/src/vite-env.d.ts with Vite client type declarations for import.meta.env (VITE_API_BASE_URL, VITE_ENTRA_CLIENT_ID, VITE_ENTRA_TENANT_ID, VITE_ENTRA_API_SCOPE, VITE_APPINSIGHTS_CONNECTION_STRING)
- [x] T013 Implement dashboard/src/auth.ts: MSAL PublicClientApplication config, acquireTokenSilent with InteractionRequiredAuthError fallback to loginRedirect, loginRedirect passes current route + view state as state parameter (FR-014), getAccessToken helper, logout, isAuthenticated check
- [x] T014 Implement dashboard/src/api.ts: typed fetch wrapper using auth.getAccessToken() for Authorization header, base URL from VITE_API_BASE_URL, functions: fetchDevices, fetchCurrentReadings, fetchRangeReadings, fetchGridPower, error handling with 401 re-auth (FR-014)
- [x] T015 [P] Implement dashboard/src/utils/formatting.ts: formatWatts, formatKw, formatPercent, formatKwh, formatRelativeTime with null/NaN guards
- [x] T016 [P] Implement dashboard/src/utils/polling.ts: createPollingInterval, clearPollingInterval, DEFAULT_INTERVAL_MS = 5_000

**Checkpoint**: Foundation ready — types defined, auth works with graceful failure handling (FR-014), API client fetches data and handles 401 re-auth, utilities format output. All foundational tests pass.

---

## Phase 3: User Story 1 — View Current Energy Readings (Priority: P1, #33) MVP

**Goal**: Display real-time solar generation, battery charge/discharge, home load consumption, and grid import/export for all connected devices with online/offline indicators and 30-second auto-refresh

**Independent Test**: Open the dashboard in a browser, verify current solar, battery, home load, and grid values are displayed for each device, offline devices show stale indicator (data >3 minutes old), readings refresh within 30 seconds

**FRs covered**: FR-001, FR-002, FR-003, FR-006, FR-010, FR-011, FR-012, FR-014, FR-015, FR-017, FR-018

### Tests for User Story 1 (TDD — write tests FIRST, confirm they FAIL)

- [x] T017 [P] [US1] Write ErrorBoundary component tests in dashboard/tests/component/ErrorBoundary.test.tsx: renders children when no error, shows error message + "Retry" button on catch, shows "API unreachable" banner with role="alert" when isApiReachable=false, retry button calls onRetry callback and is keyboard-focusable
- [x] T018 [P] [US1] Write DeviceCard component tests in dashboard/tests/component/DeviceCard.test.tsx: renders as article with aria-label (FR-015), shows online/offline badge, renders 5 GaugeDial components (Solar, Battery SOC, Battery Power, Home Load, Grid), formatted values, color contrast verification (FR-015)
- [x] T019 [P] [US1] Write CurrentReadings component tests in dashboard/tests/component/CurrentReadings.test.tsx: renders as section with heading (FR-015), loading skeleton with aria-busy, fetches devices and instant queries on mount, renders DeviceCard per device group, error state on API failure, polls every 30s (FR-012)
- [x] T020 [P] [US1] Write App component tests in dashboard/tests/component/App.test.tsx: renders nav with links (FR-015), route "/" renders CurrentReadings, route "/history" renders HistoryView, keyboard-navigable (FR-015)
- [x] T021 [P] [US1] Write main.test.tsx unit test in dashboard/tests/unit/main.test.tsx: MSAL initialization, unauthenticated user redirected to login, authenticated user sees app

### Implementation for User Story 1

- [x] T022 [P] [US1] Implement ErrorBoundary component in dashboard/src/components/ErrorBoundary.tsx: componentDidCatch, error message + "Retry" button (keyboard-focusable), isApiReachable prop with role="alert" banner (FR-015)
- [x] T023 [P] [US1] Implement GaugeDial component in dashboard/src/components/GaugeDial.tsx and DeviceCard component in dashboard/src/components/DeviceCard.tsx: article with aria-label (FR-015), 5 gauge dials (Solar 0-12kW, SOC 0-100%, Battery Power +/-20kW bidirectional, Home Load 0-10kW, Grid +/-20kW bidirectional), CSS in dashboard/src/app.css
- [x] T024 [US1] Implement CurrentReadings component in dashboard/src/components/CurrentReadings.tsx: fetches device list + 6 instant queries per poll cycle, groups battery+solar devices by alias, renders DeviceCard per group, polling via createPollingInterval (5s default, FR-012), loading skeleton, ErrorBoundary, lastRefreshed timestamp
- [x] T025 [US1] Create dashboard/src/main.tsx entry point: MSAL init, auth check, restore view state from MSAL redirect (FR-014), mount Preact app
- [x] T026 [US1] Create dashboard/src/App.tsx: nav with "Current" (/) and "History" (/history) links (FR-015), preact-router, ErrorBoundary wrapper

### Energy Flow Diagram and Responsive Layout (FR-017, FR-018)

- [x] T024a [P] [US1] Write EnergyFlowDiagram component tests in dashboard/tests/component/EnergyFlowDiagram.test.tsx: SVG flow nodes, line activation at >10W threshold, direction indicators, SOC ring, battery state labels, device name and online badges
- [x] T024b [P] [US1] Write CurrentReadings view toggle tests in dashboard/tests/component/CurrentReadings.test.tsx: default view is flow, radiogroup toggle, Flow/Gauges switch
- [x] T024c [US1] Implement EnergyFlowDiagram component in dashboard/src/components/EnergyFlowDiagram.tsx: per-device SVG flow diagram, animated dashed lines, directional dots, SOC ring, 10W activation threshold (FR-017)
- [x] T024d [US1] Add view toggle to CurrentReadings: flow or gauges state (default flow), radiogroup, conditional rendering (FR-017)
- [x] T024e [P] [US1] Add responsive CSS to dashboard/src/app.css: flow diagram layout, animations, view toggle styles, breakpoints (FR-018)
- [x] T024f [P] Fix mock exporter missing metrics in local/mock-exporter/metrics_server.py: add epcube_battery_power_watts, epcube_grid_power_watts, epcube_battery_stored_kwh, epcube_battery_peak_stored_kwh

### Deployment Infrastructure (US1 — dashboard must be deployed for US1 to be complete)

- [x] T033 [P] [US1] Add dashboard Entra ID app registration in infra/entra.tf: azuread_application.dashboard (public client, SPA redirect URIs)
- [x] T034 [P] [US1] Create Azure Static Web Apps resource (Free tier) in infra/static-web-app.tf
- [x] T038a [P] [US1] Add SWA Terraform outputs in infra/outputs.tf: swa_default_hostname, swa_api_key (sensitive), dashboard_client_id
- [x] T039 [P] [US1] Create dashboard/.env.example with VITE_API_BASE_URL, VITE_ENTRA_CLIENT_ID, VITE_ENTRA_TENANT_ID, VITE_ENTRA_API_SCOPE, VITE_DISABLE_AUTH, VITE_APPINSIGHTS_CONNECTION_STRING placeholder values
- [x] T040a [US1] Run terraform validate and terraform fmt -check to verify SWA + Entra infrastructure changes
- [x] T041 [P] [US1] Add dashboard job to .github/workflows/ci.yml: checkout, setup Node.js 22, npm ci, npm run typecheck, npm run test:coverage (fail if <100%), npm run build
- [x] T042 [P] [US1] Add SWA deployment step to .github/workflows/cd.yml: build with Vite env vars, deploy via Azure/static-web-apps-deploy@v1, SWA smoke test
- [x] T043a [US1] Bug fix (#44): Add CORS to API — AddCors(), Cors:AllowedOrigin config, Cors__AllowedOrigin env var in container-apps.tf, CORS integration tests (FR-019)

**Checkpoint**: Dashboard SPA deployed to Azure Static Web Apps via CI/CD. Entra ID auth + CORS working. User Story 1 is complete — current readings viewable in a browser.

---

## Phase 4: User Story 2 — View Historical Energy Graphs (Priority: P2, #34)

**Goal**: Interactive time-series charts via uPlot with selectable ranges (today, 7d, 30d, 1y, custom), tiered data resolution (FR-013), broken line gap visualization (FR-008), aggregation notice when downsampled, within 2-second performance target

**Independent Test**: With historical data available, select each predefined time range and verify graph renders with accurate data points within 2 seconds. Verify tiered step values (today=60s, 7d=3600s, 30d=86400s, 1y=calendar month). Verify custom date range auto-selects tier. Verify aggregation notice shown when downsampled. Verify empty range shows "no data" message. Verify data gaps render as broken lines.

**FRs covered**: FR-004, FR-005, FR-007, FR-008, FR-013, FR-015, FR-021, FR-022, FR-023, FR-024

### Tests for User Story 2 (TDD — write tests FIRST, confirm they FAIL)

- [x] T027 [P] [US2] Write TimeRangeSelector component tests in dashboard/tests/component/TimeRangeSelector.test.tsx: renders today/7d/30d/1y/custom preset buttons with aria-pressed on active (FR-015), keyboard Tab navigates between presets (FR-015), emits onChange with correct start/end timestamps and tiered step (today=60s, 7d=3600s, 30d=86400s, 1y=calendar month), shows custom date inputs with label elements when "custom" selected (FR-015), validates custom range (start < end), custom range auto-selects tier by duration (1d or less=60s, 7d or less=3600s, 30d or less=86400s, over 30d=calendar month), hides custom inputs for preset selections
- [x] T028 [P] [US2] Write HistoricalGraph component tests in dashboard/tests/component/HistoricalGraph.test.tsx: converts RangeQueryResponse to uPlot.AlignedData format, renders uPlot canvas with accessible description via aria-label (FR-015), shows "No data available for this time range" for empty result (FR-007), handles data gaps with null values (not NaN) for broken line rendering (FR-008), mergeTimeSeries produces null for missing timestamps, renders multiple series (solar, battery, grid) with correct labels and colors, displays aggregation notice with role="status" when step > 60s ("Data shown at hourly/daily/monthly resolution" per FR-013), no aggregation notice when step=60s (daily view)
- [x] T029 [P] [US2] Write HistoryView component tests in dashboard/tests/component/HistoryView.test.tsx: renders TimeRangeSelector and HistoricalGraph, passes TimeRangeValue from selector to graph, defaults to "today" preset on mount, updates graph when time range changes

### Implementation for User Story 2

- [x] T030 [P] [US2] Implement TimeRangeSelector component in dashboard/src/components/TimeRangeSelector.tsx: buttons for today/7d/30d/1y/custom presets with aria-pressed on active (FR-015), keyboard-navigable (FR-015), calculates start/end timestamps for each preset, custom shows date input fields with label (FR-015, unrestricted range), tiered step calculation per FR-013: today=60s, 7d=3600s, 30d=86400s, 1y=calendar month aligned step, custom auto-tiers by duration (1d or less=60s, 7d or less=3600s, 30d or less=86400s, over 30d=calendar month), emits TimeRangeValue via onChange prop
- [x] T031 [US2] Implement HistoricalGraph component in dashboard/src/components/HistoricalGraph.tsx: accepts TimeRangeValue props, fetches range queries for solar, battery, grid metrics via fetchRangeReadings + fetchGridPower with correct step, converts responses to uPlot.AlignedData (timestamps + value arrays, null for missing data points per FR-008), initializes uPlot with responsive sizing and aria-label (FR-015), line series per metric with color coding, tooltip with formatted values, shows "No data available for this time range" when results empty (FR-007), displays aggregation notice with role="status" above chart when step > 60s with tier label (3600=hourly, 86400=daily, calendar month=monthly) per FR-013
- [x] T032 [US2] Implement HistoryView component in dashboard/src/components/HistoryView.tsx: renders as section with h2 heading (FR-015), renders TimeRangeSelector + HistoricalGraph, manages selectedTimeRange state (default "today"), passes TimeRangeValue from selector onChange to HistoricalGraph props

### Historical Graph Improvements (#53)

- [x] T051 [P] [US2] Write HistoricalGraph per-device chart tests in dashboard/tests/component/HistoricalGraph.test.tsx: renders one chart per device (stacked vertically), each labeled with device name, contains Solar/Battery/Home Load/Grid series, data from different devices NOT merged into single chart (FR-021)
- [x] T052 [P] [US2] Write HistoricalGraph legend and formatting tests in dashboard/tests/component/HistoricalGraph.test.tsx: legend displays live values on cursor hover (time + value per series), legend shows label + color swatch when cursor outside chart (FR-022), series colors match legend labels and are consistent across charts (FR-023), Y-axis and legend values display kW with 1 decimal for >999W and whole watts for ≤999W (FR-024)
- [x] T053 [US2] Implement per-device charts in dashboard/src/components/HistoricalGraph.tsx: fetch data per device, render one uPlot instance per EP Cube device stacked vertically, label each with device name, keep series colors consistent across charts (FR-021, FR-023)
- [x] T054 [US2] Implement legend cursor interactivity and kW formatting in dashboard/src/components/HistoricalGraph.tsx: uPlot cursor plugin for live legend values on hover (FR-022), custom axis value formatter — kW with 1 decimal for >999W, whole watts for ≤999W (FR-024), apply same formatter to legend hover values
- [x] T055 [US2] Fix temporal gap detection in dashboard/src/components/HistoricalGraph.tsx: after merging timestamps, scan for gaps where consecutive timestamps differ by more than 2× the step interval; insert null values at gap boundaries to break the line in uPlot (FR-008). Add tests: given data with a 30-minute gap at 1-min step, chart renders broken line across the gap

**Checkpoint**: Dashboard shows interactive time-series charts for all five time range presets plus custom. Applies tiered resolution with calendar-month aggregation for yearly views. Aggregation notice shown when downsampled. Data gaps rendered as broken lines. Empty ranges handled. Renders within 2 seconds for 30-day data. Keyboard-navigable and accessible (FR-015). User Stories 1 AND 2 both work independently.

---

## Phase 5: Application Insights Telemetry (FR-020)

**Purpose**: Client-side error telemetry via Azure Application Insights

**FRs covered**: FR-020

### Tests for FR-020 (TDD — write tests FIRST, confirm they FAIL)

- [ ] T046 [P] Write telemetry unit tests in dashboard/tests/unit/telemetry.test.ts: initTelemetry initializes ApplicationInsights when connection string is set, initTelemetry is no-op when connection string is empty/undefined, trackException calls appInsights.trackException, trackApiError calls appInsights.trackEvent with url and status, trackPageLoad calls appInsights.trackPageView, module is mock-friendly (exports simple wrapper functions)

### Implementation for FR-020

- [ ] T047 [P] Implement dashboard/src/telemetry.ts: lazy init of @microsoft/applicationinsights-web when VITE_APPINSIGHTS_CONNECTION_STRING is set, export initTelemetry(), trackException(error), trackApiError(url, status), trackPageLoad() wrapper functions. No PII captured. Silent when connection string absent (local dev/tests).
- [ ] T048 [US1] Wire telemetry into dashboard: call initTelemetry() in main.tsx after MSAL init, call trackApiError() in api.ts on 4xx/5xx responses, call trackPageLoad() in App.tsx on route change, wrap ErrorBoundary componentDidCatch with trackException()
- [ ] T049 [P] Create Azure Application Insights Terraform resource in infra/application-insights.tf: azurerm_application_insights linked to existing Log Analytics workspace, add appinsights_connection_string output to infra/outputs.tf, add VITE_APPINSIGHTS_CONNECTION_STRING to CD workflow env vars

**Checkpoint**: Application Insights captures unhandled exceptions, failed API calls, and page load performance in production/staging. Silent in local dev and tests.

---

## Phase 6: Polish and Cross-Cutting Concerns

**Purpose**: Security review, accessibility verification, end-to-end validation

- [x] T043a [US1] Bug fix (#44): Add CORS to API — AddCors(), Cors:AllowedOrigin config, Cors__AllowedOrigin env var in container-apps.tf, CORS integration tests (FR-019)
- [ ] T043 [P] Security review: verify MSAL auth on all API calls (no unauthenticated data fetch), verify CSP headers in staticwebapp.config.json block XSS, verify no secrets in client code (only public client ID/tenant ID), verify all infra resources have management locks
- [ ] T044 [P] Accessibility spot-check (FR-015): verify all pages keyboard-navigable (Tab through nav, cards, buttons), verify semantic landmarks (nav, main, section, article), verify ARIA attributes on interactive elements (aria-label, aria-pressed, aria-busy, role="alert", role="status"), verify color contrast at least 4.5:1 on all text/badges
- [ ] T045 Run full test suite with coverage: cd dashboard and npm run typecheck and npm run test:coverage — verify 100% coverage (branches, functions, lines, statements). Verify performance: load CurrentReadings with mock data <2s (SC-001); load HistoricalGraph with 30d mock data (~43K points) <2s (SC-002)
- [ ] T050 Run quickstart.md end-to-end validation: cd dashboard, npm install, npm test, npm run test:coverage (100% pass), npm run build (dist/ output), cd ../infra, terraform validate, terraform fmt -check

---

## Dependencies and Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Foundational — requires types.ts, auth.ts, api.ts, formatting.ts, polling.ts
- **US2 (Phase 4)**: Depends on Foundational — requires types.ts, api.ts, formatting.ts; can run in parallel with US1
- **FR-020 (Phase 5)**: Can start after Foundational — only depends on types; telemetry wiring into main/api/ErrorBoundary depends on those files existing
- **Polish (Phase 6)**: Depends on all phases being complete

### User Story Dependencies

- **US1 (P1, #33)**: Can start after Foundational — no dependencies on US2
- **US2 (P2, #34)**: Can start after Foundational — no dependencies on US1 (separate components, separate route)
- **US1 and US2** can run in parallel since they involve different component files
- **FR-020** can run in parallel with US2 since telemetry is a separate module (dashboard/src/telemetry.ts + infra/application-insights.tf)

### Within Each User Story

- Tests MUST be written and FAIL before implementation (TDD — constitution)
- Components depend on foundational modules (types, auth, api, utils)
- Simpler/leaf components before composite components (DeviceCard before CurrentReadings)
- Story complete before moving to next priority (if working sequentially)

---

## Parallel Opportunities

### Phase 2 (Foundational)
Tests first (all parallel): T005, T006, T007, T008
Static files (parallel, no deps): T009 (types.ts), T010 (staticwebapp.config), T011 (index.html)
Implementation (sequential where deps exist): T012 then T013 (auth) then T014 (api); T015 (formatting) and T016 (polling) parallel

### Phase 3 (US1) + Phase 4 (US2) + Phase 5 (FR-020) — can run in parallel
US1: T017-T021 tests then T022-T023 components then T024 then T025 then T026; T024a-T024f (flow diagram) then T033-T042 (infra/CD)
US2: T027-T029 tests then T030 then T031 then T032
FR-020: T046 test then T047 then T048 then T049

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: US1 (current readings + deploy)
4. STOP and VALIDATE: Dashboard shows live device readings with auto-refresh
5. Deploy/demo if ready — basic dashboard is functional

### Incremental Delivery

1. Setup + Foundational = Foundation ready
2. US1 = Current readings visible = MVP
3. US2 = Historical graphs with tiered downsampling = Enhanced analytics
4. FR-020 = Application Insights telemetry = Operational visibility
5. Polish = Security verified, accessibility checked = Production-ready

---

## Summary

| Phase | Tasks | Complete | Remaining |
|-------|-------|----------|-----------|
| 1. Setup | 4 | 4 | 0 |
| 2. Foundational | 12 | 12 | 0 |
| 3. US1 (P1, #33) | 24 | 24 | 0 |
| 4. US2 (P2, #34) | 11 | 11 | 0 |
| 5. FR-020 | 4 | 0 | 4 |
| 6. Polish | 5 | 1 | 4 |
| **Total** | **60** | **52** | **8** |

---

## Notes

- All file paths are relative to repository root
- TDD is mandated by constitution — tests MUST fail before implementation
- 100% code coverage enforced via Vitest in CI (branches, functions, lines, statements)
- FR-015 accessibility (semantic HTML, ARIA, keyboard nav, contrast) baked into each component — not a separate task
- US1 and US2 are pure SPA code (TypeScript/Preact), FR-020 spans SPA + Terraform
- Components use .tsx extension (Preact JSX), utility/core modules use .ts
- Metric names: epcube_battery_state_of_capacity_percent, epcube_battery_power_watts, epcube_solar_instantaneous_generation_watts, epcube_home_load_power_watts, epcube_grid_power_watts (via /api/v1/grid)
- Grid sign convention: positive = net import from grid, negative = net export to grid
- Device interface has no ip field — only device, class, alias, manufacturer, product_code, uid, online
- FR-014: auth failures mid-session redirect to re-auth preserving current view state
- FR-013: tiered downsampling uses calendar month for yearly views (not fixed 30d like the old VM-constrained implementation)
- Commit after each task or logical group, linked to the relevant GitHub issue (#33, #34)
- Stop at any checkpoint to validate the story independently
- The dashboard consumes Feature 001 API — no new backend code, only client-side TypeScript (except CORS and App Insights Terraform)
