# Tasks: Web Dashboard for Energy Telemetry

**Input**: Design documents from `/specs/002-web-dashboard/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/dashboard-config.md, quickstart.md

**Tests**: Included — constitution mandates TDD with 100% code coverage (non-negotiable).

**Organization**: Tasks grouped by user story for independent implementation and testing.

**GitHub Issues**: #33 (U2-1, US1 P1), #34 (U2-2, US2 P2), #35 (U2-3, US3 P3)

**Regenerated**: 2026-03-19 — fresh start after branch reset to main. All spec fixes incorporated: corrected metric names (epcube_*), removed ip field, fixed grid sign convention (positive=import, negative=export), added FR-014 graceful auth failure handling, clarified FR-013 tiered downsampling with 30d fixed step, added Grafana acceptance scenario #4, Grafana Infinity plugin from the start.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story (US1, US2, US3) this task belongs to
- Exact file paths included in all descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, directory structure, build tooling

- [ ] T001 Create dashboard/ directory structure per plan.md: dashboard/{src/{components,utils},tests/{unit,component},public}, create public/favicon.ico placeholder
- [ ] T002 Initialize dashboard/package.json with runtime deps (preact, preact-router, @azure/msal-browser, uplot) and dev deps (vite, typescript, @preact/preset-vite, vitest, happy-dom, @testing-library/preact, @testing-library/jest-dom, @testing-library/user-event, @vitest/coverage-v8), include browserslist targeting Chrome/Firefox/Safari/Edge current + previous major version (FR-001, SC-006), run npm install
- [ ] T003 [P] Create dashboard/tsconfig.json with strict mode, ES2022 target, jsxImportSource: "preact", module: "ESNext", moduleResolution: "bundler", paths aliases
- [ ] T004 [P] Create dashboard/vite.config.ts (Preact plugin via @preact/preset-vite) and dashboard/vitest.config.ts (happy-dom environment, 100% coverage thresholds for branches/functions/lines/statements, test include paths)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core modules that MUST be complete before ANY user story — types, auth, API client, utilities

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Tests for Foundational (TDD — write tests FIRST, confirm they FAIL)

- [ ] T005 [P] Write auth unit tests in dashboard/tests/unit/auth.test.ts: MSAL PublicClientApplication init, acquireTokenSilent success path, loginRedirect fallback on InteractionRequiredAuthError, getAccessToken returns bearer token string, handles interaction_required error, logout clears session, loginRedirect preserves current route/view state via state parameter (FR-014), re-auth redirect on token expiry mid-session restores previous view
- [ ] T006 [P] Write API client unit tests in dashboard/tests/unit/api.test.ts: fetchDevices returns DeviceListResponse, fetchInstantQuery attaches bearer token, fetchRangeQuery sends correct start/end/step params, fetchGridPower calls grid endpoint, fetchDeviceMetrics returns metric list, fetchHealth returns health status, error response parsing (400/401/403/404/422/503), 401 triggers re-auth flow (FR-014), base URL from VITE_API_BASE_URL env var
- [ ] T007 [P] Write formatting unit tests in dashboard/tests/unit/formatting.test.ts: formatWatts auto-scales W/kW/MW with 1 decimal, formatPercent 0-100 with % suffix, formatTimestamp locale-aware date/time from epoch, formatRelativeTime "5m ago"/"2h ago" strings, edge cases: NaN returns "—", null returns "—", negative watts handled correctly
- [ ] T008 [P] Write polling unit tests in dashboard/tests/unit/polling.test.ts: createPollingInterval starts timer at 30000ms default (FR-012), callback executes at interval, clearPollingInterval stops timer, immediate first-call option, cleanup on unmount, DEFAULT_INTERVAL_MS equals 30000

### Implementation for Foundational

- [ ] T009 [P] Create TypeScript interfaces in dashboard/src/types.ts: Device (device, class, manufacturer?, product_code?, uid?, online — no ip field), DeviceListResponse, InstantQueryResponse, RangeQueryResponse, DeviceMetricsResponse, HealthResponse, ErrorResponse (all per data-model.md), TimeRange type ('today' | '7d' | '30d' | '1y' | 'custom'), TimeRangeValue interface {start: number, end: number, step: number}, AppState interface
- [ ] T010 [P] Create dashboard/staticwebapp.config.json per contracts/dashboard-config.md: navigationFallback rewrite to /index.html (exclude /assets/*, /*.ico, /*.png, /*.svg), 404 override to /index.html, security headers (X-Content-Type-Options: nosniff, X-Frame-Options: DENY, Referrer-Policy: strict-origin-when-cross-origin, Content-Security-Policy allowing connect-src to login.microsoftonline.com and *.azurecontainerapps.io)
- [ ] T011 [P] Create dashboard/index.html SPA entry point: minimal HTML5 with #app mount div, Vite module script tag pointing to /src/main.tsx
- [ ] T012 Create dashboard/src/vite-env.d.ts with Vite client type declarations for import.meta.env (VITE_API_BASE_URL, VITE_ENTRA_CLIENT_ID, VITE_ENTRA_TENANT_ID, VITE_ENTRA_API_SCOPE)
- [ ] T013 Implement dashboard/src/auth.ts: MSAL PublicClientApplication config from VITE_ENTRA_CLIENT_ID and VITE_ENTRA_TENANT_ID env vars, acquireTokenSilent with InteractionRequiredAuthError fallback to loginRedirect, loginRedirect passes current route + view state as state parameter to restore on return (FR-014), getAccessToken helper returning bearer token string, logout function, isAuthenticated check
- [ ] T014 Implement dashboard/src/api.ts: typed fetch wrapper using auth.getAccessToken() for Authorization header, base URL from VITE_API_BASE_URL env var, functions: fetchDevices() → DeviceListResponse, fetchInstantQuery(query) → InstantQueryResponse, fetchRangeQuery(query, start, end, step) → RangeQueryResponse, fetchGridPower(start?, end?, step?) → RangeQueryResponse, fetchDeviceMetrics(device) → DeviceMetricsResponse, fetchHealth() → HealthResponse, error handling: parse ErrorResponse, 401 status triggers re-auth via auth.ts (FR-014)
- [ ] T015 [P] Implement dashboard/src/utils/formatting.ts: formatWatts(watts: number) → string (auto-scale W/kW/MW with 1 decimal), formatPercent(value: number) → string, formatTimestamp(epoch: number) → string (locale-aware), formatRelativeTime(epoch: number) → string ("5m ago"), null/NaN guards returning "—"
- [ ] T016 [P] Implement dashboard/src/utils/polling.ts: createPollingInterval(callback, intervalMs, immediate?) → IntervalId, clearPollingInterval(id) cleanup, DEFAULT_INTERVAL_MS = 30_000 (30s per FR-012, half of 1-minute collection interval)

**Checkpoint**: Foundation ready — types defined, auth works with graceful failure handling (FR-014), API client fetches data and handles 401 re-auth, utilities format output. All foundational tests pass.

---

## Phase 3: User Story 1 — View Current Energy Readings (Priority: P1, #33) 🎯 MVP

**Goal**: Display real-time solar generation, battery charge/discharge, and grid import/export for all connected devices with online/offline indicators and 30-second auto-refresh

**Independent Test**: Open the dashboard in a browser, verify current solar, battery, and grid values are displayed for each device, offline devices show stale indicator (data >3 minutes old), readings refresh within 30 seconds

**FRs covered**: FR-001, FR-002, FR-003, FR-006, FR-010, FR-011, FR-012, FR-014

### Tests for User Story 1 (TDD — write tests FIRST, confirm they FAIL)

- [ ] T017 [P] [US1] Write ErrorBoundary component tests in dashboard/tests/component/ErrorBoundary.test.tsx: renders children when no error, shows error message + "Retry" button on catch, shows "API unreachable" banner when isApiReachable=false, retry button calls onRetry callback, handles connectivity errors gracefully
- [ ] T018 [P] [US1] Write DeviceCard component tests in dashboard/tests/component/DeviceCard.test.tsx: renders device name and class, shows green online badge when online=true, shows red offline/stale badge when online=false, displays solar generation formatted via formatWatts (epcube_solar_instantaneous_generation_watts), shows battery power (epcube_battery_power_watts) and SOC (epcube_battery_state_of_capacity_percent) formatted correctly, shows grid power (epcube_grid_power_watts) with "Import"/"Export" label based on sign (positive=import, negative=export), handles missing optional fields (manufacturer, uid)
- [ ] T019 [P] [US1] Write CurrentReadings component tests in dashboard/tests/component/CurrentReadings.test.tsx: renders loading state initially, fetches devices and instant queries on mount, renders DeviceCard for each device, shows error state when API fails, triggers polling refresh every 30 seconds via createPollingInterval, shows ErrorBoundary when API unreachable, updates readings on poll without full re-render
- [ ] T020 [P] [US1] Write main.test.tsx unit test in dashboard/tests/unit/main.test.tsx: verifies MSAL initialization, verifies unauthenticated user redirected to login, verifies authenticated user sees app, verifies route "/" renders CurrentReadings, verifies route "/history" renders HistoryView, verifies navigation links present

### Implementation for User Story 1

- [ ] T021 [P] [US1] Implement ErrorBoundary component in dashboard/src/components/ErrorBoundary.tsx: Preact class component with componentDidCatch, renders error message + "Retry" button, accepts isApiReachable prop to show connectivity banner, onRetry callback prop
- [ ] T022 [P] [US1] Implement DeviceCard component in dashboard/src/components/DeviceCard.tsx: accepts Device + metrics props, renders device name/class, online/offline badge (green/red), solar generation (formatWatts), battery power + SOC (formatWatts + formatPercent), grid power (formatWatts with "Import" when positive, "Export" when negative per sign convention)
- [ ] T023 [US1] Implement CurrentReadings component in dashboard/src/components/CurrentReadings.tsx: fetches device list via fetchDevices(), issues instant queries per device for epcube_battery_state_of_capacity_percent, epcube_battery_power_watts, epcube_solar_instantaneous_generation_watts, epcube_grid_power_watts, renders DeviceCard per device, sets up polling via createPollingInterval (30s default per FR-012), shows loading skeleton on initial fetch, wraps in ErrorBoundary, displays lastRefreshed timestamp via formatRelativeTime
- [ ] T024 [US1] Create dashboard/src/main.tsx entry point: initialize MSAL via auth.ts, check authentication (redirect to login if not authenticated), restore view state from MSAL redirect state parameter (FR-014), mount Preact app to #app div
- [ ] T025 [US1] Create dashboard/src/App.tsx: navigation header with links "Current" (/) and "History" (/history), preact-router mapping "/" to CurrentReadings and "/history" to HistoryView, wrap in ErrorBoundary

**Checkpoint**: Dashboard loads in browser, authenticates via MSAL, shows current device readings with correct metric names (epcube_*), online/offline status, auto-refreshes every 30 seconds. Auth failures redirect gracefully preserving view state. User Story 1 is independently functional and testable.

---

## Phase 4: User Story 2 — View Historical Energy Graphs (Priority: P2, #34)

**Goal**: Interactive time-series charts via uPlot with selectable ranges (today, 7d, 30d, 1y, custom), tiered data resolution (FR-013), broken line gap visualization (FR-008), aggregation notice when downsampled, within 2-second performance target

**Independent Test**: With historical data available, select each predefined time range and verify graph renders with accurate data points within 2 seconds. Verify tiered step values (today→60s, 7d→3600s, 30d→86400s, 1y→2592000s). Verify custom date range auto-selects tier. Verify aggregation notice shown when downsampled. Verify empty range shows "no data" message. Verify data gaps render as broken lines.

**FRs covered**: FR-004, FR-005, FR-007, FR-008, FR-013

### Tests for User Story 2 (TDD — write tests FIRST, confirm they FAIL)

- [ ] T026 [P] [US2] Write TimeRangeSelector component tests in dashboard/tests/component/TimeRangeSelector.test.tsx: renders today/7d/30d/1y/custom preset buttons, highlights active preset, emits onChange with correct start/end timestamps and tiered step (today→60s, 7d→3600s, 30d→86400s, 1y→2592000s), shows custom date inputs when "custom" selected, validates custom range (start < end), custom range auto-selects tier by duration (≤1d→60s, ≤7d→3600s, ≤30d→86400s, >30d→2592000s), hides custom inputs for preset selections
- [ ] T027 [P] [US2] Write HistoricalGraph component tests in dashboard/tests/component/HistoricalGraph.test.tsx: converts RangeQueryResponse to uPlot.AlignedData format, renders uPlot canvas element, shows "No data available for this time range" for empty result (FR-007), handles data gaps with null values (not NaN) for broken line rendering (FR-008), mergeTimeSeries produces null for missing timestamps, renders multiple series (solar, battery, grid) with correct labels and colors, displays aggregation notice when step > 60s ("Data shown at hourly/daily/monthly resolution" per FR-013), no aggregation notice when step=60s (daily view)
- [ ] T028 [P] [US2] Write HistoryView component tests in dashboard/tests/component/HistoryView.test.tsx: renders TimeRangeSelector and HistoricalGraph, passes TimeRangeValue (start, end, step) from selector to graph, defaults to "today" preset on mount, updates graph when time range changes

### Implementation for User Story 2

- [ ] T029 [P] [US2] Implement TimeRangeSelector component in dashboard/src/components/TimeRangeSelector.tsx: buttons for today/7d/30d/1y/custom presets, calculates start/end timestamps for each preset (today=start of day local, 7d/30d/1y=now minus duration), custom shows date input fields (unrestricted range), tiered step calculation per FR-013: today→60s, 7d→3600s, 30d→86400s, 1y→2592000s (30d fixed step for VM compatibility), custom auto-tiers by duration (≤1d→60s, ≤7d→3600s, ≤30d→86400s, >30d→2592000s), emits TimeRangeValue via onChange prop
- [ ] T030 [US2] Implement HistoricalGraph component in dashboard/src/components/HistoricalGraph.tsx: accepts TimeRangeValue props, fetches range queries for epcube_solar_instantaneous_generation_watts, epcube_battery_power_watts, epcube_grid_power_watts via fetchRangeQuery + fetchGridPower with correct step, converts responses to uPlot.AlignedData (timestamps + value arrays, null for missing data points — not NaN — per FR-008), initializes uPlot with responsive sizing, line series per metric with color coding, tooltip showing formatted values, shows "No data available for this time range" when results empty (FR-007), displays aggregation notice banner above chart when step > 60s with tier label (3600→"hourly", 86400→"daily", 2592000→"monthly") per FR-013
- [ ] T031 [US2] Implement HistoryView component in dashboard/src/components/HistoryView.tsx: renders TimeRangeSelector + HistoricalGraph, manages selectedTimeRange state (default "today"), passes TimeRangeValue from selector onChange to HistoricalGraph props

**Checkpoint**: Dashboard shows interactive time-series charts for all five time range presets plus custom, applies tiered step values, shows aggregation notice when downsampled, renders data gaps as broken lines, handles empty ranges. Renders within 2 seconds for 30-day data. User Stories 1 AND 2 both work independently.

---

## Phase 5: User Story 3 — Grafana Integration & Deployment Infrastructure (Priority: P3, #35)

**Goal**: Deploy Grafana on Container Apps with Infinity plugin (REST API via OAuth2), deploy dashboard SPA on Azure Static Web Apps, register dashboard Entra ID app, configure service principal for Grafana API access

**Independent Test**: SWA resource created. Dashboard Entra ID app registration exists with correct SPA redirect URIs and API permissions. Grafana Container App runs with Infinity plugin installed. Grafana data source connection test succeeds against the REST API (acceptance scenario #4). terraform validate passes.

**FRs covered**: FR-009, FR-010, SC-004, SC-005

### Implementation for User Story 3

- [ ] T032 [P] [US3] Add dashboard Entra ID app registration in infra/entra.tf: azuread_application.dashboard (public client, sign_in_audience="AzureADMyOrg", single_page_application redirect URIs from SWA default hostname, required_resource_access for user_impersonation scope on API app)
- [ ] T033 [P] [US3] Create Azure Static Web Apps resource (Free tier, sku_tier="Free", sku_size="Free") with management lock (CanNotDelete) in infra/static-web-app.tf
- [ ] T034 [P] [US3] Add grafana_image variable (default "grafana/grafana:11.5.2", no :latest) in infra/variables.tf, add Grafana admin password (random_password + azurerm_key_vault_secret) in infra/keyvault.tf
- [ ] T035 [P] [US3] Add Grafana service principal app registration in infra/entra.tf: azuread_application.grafana_sp (confidential client with client secret), grant user_impersonation scope on API app, add azuread_service_principal.grafana_sp, store client secret in Key Vault via azurerm_key_vault_secret.grafana_sp_client_secret
- [ ] T036 [US3] Create Grafana Container App in infra/grafana.tf: azurerm_container_app with ingress on port 3000 (external), min_replicas=0/max_replicas=1, 0.25 vCPU/0.5Gi memory, Azure File Share volume mount for /var/lib/grafana (azurerm_container_app_environment_storage + azurerm_storage_share), GF_INSTALL_PLUGINS="yesoreyeram-infinity-datasource", Infinity plugin data source provisioned via YAML at /etc/grafana/provisioning/datasources/ (type: yesoreyeram-infinity-datasource, URL: API FQDN /api/v1, OAuth2 client credentials from service principal per contracts/dashboard-config.md), GF_SECURITY_ADMIN_PASSWORD from Key Vault, GF_SERVER_ROOT_URL, management lock (CanNotDelete)
- [ ] T037 [US3] Add Terraform outputs in infra/outputs.tf: swa_default_hostname, swa_deployment_token (sensitive), grafana_fqdn, dashboard_client_id, grafana_sp_client_id
- [ ] T038 [P] [US3] Create dashboard/.env.example with VITE_API_BASE_URL, VITE_ENTRA_CLIENT_ID, VITE_ENTRA_TENANT_ID, VITE_ENTRA_API_SCOPE placeholder values per contracts/dashboard-config.md
- [ ] T039 [US3] Run terraform validate and terraform fmt -check to verify all infrastructure changes compile and are formatted correctly

**Checkpoint**: terraform validate passes. SWA resource created. Dashboard Entra ID app registered with correct SPA redirect URIs. Grafana Container App configured with Infinity plugin and OAuth2 service principal for API access. All three user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: CI/CD, security review, end-to-end validation

- [ ] T040 [P] Create GitHub Actions CI workflow for dashboard in .github/workflows/dashboard-ci.yml: trigger on push/PR to 002-web-dashboard and main (paths: dashboard/**), steps: checkout, setup Node.js 22, npm ci, npm run test:coverage (fail if <100%), npm run build, Azure/static-web-apps-deploy@v1 on main branch only (deployment token from secrets.SWA_DEPLOYMENT_TOKEN)
- [ ] T041 [P] Update existing .github/workflows/ci.yml to add dashboard build + test job (npm ci, npm run test:coverage) alongside API build + test, ensure both must pass for PR merge
- [ ] T042 [P] Security review: verify MSAL auth on all API calls (no unauthenticated data fetch), verify CSP headers in staticwebapp.config.json block XSS, verify no secrets in client code (only public client ID/tenant ID), verify Grafana password stored in Key Vault and injected as secret env var, verify Grafana service principal client secret in Key Vault, verify all new infra resources have management locks
- [ ] T043 Run full test suite with coverage: cd dashboard && npm run test:coverage — verify 100% coverage (branches, functions, lines, statements)
- [ ] T044 Run quickstart.md end-to-end validation: cd dashboard, npm install, npm test, npm run test:coverage (100% pass), npm run build (dist/ output), cd ../infra, terraform validate, terraform fmt -check

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Foundational — requires types.ts, auth.ts, api.ts, formatting.ts, polling.ts
- **US2 (Phase 4)**: Depends on Foundational — requires types.ts, api.ts, formatting.ts; can run in parallel with US1
- **US3 (Phase 5)**: No code dependency on US1 or US2 (pure Terraform); can start after Setup
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1, #33)**: Can start after Foundational — no dependencies on US2 or US3
- **US2 (P2, #34)**: Can start after Foundational — no dependencies on US1 or US3 (separate components, separate route)
- **US3 (P3, #35)**: Can start after Setup — no dependencies on US1 or US2 (pure infrastructure/Terraform)
- **US1 and US2** can run in parallel since they involve different component files
- **US3** can run in parallel with US1/US2 since it involves only infra/ files (Terraform), not dashboard/ code

### Within Each User Story

- Tests MUST be written and FAIL before implementation (TDD — constitution)
- Components depend on foundational modules (types, auth, api, utils)
- Simpler/leaf components before composite components (DeviceCard before CurrentReadings)
- Story complete before moving to next priority (if working sequentially)

---

## Parallel Opportunities

### Phase 1 (Setup)
```
T001 (directories) → T002 (npm install)
                   ↘ T003 [P] (tsconfig)
                   ↘ T004 [P] (vite + vitest config)
```

### Phase 2 (Foundational)
```
# Tests first (all parallel):
T005 [P], T006 [P], T007 [P], T008 [P]

# Static files (parallel, no deps):
T009 [P] (types.ts), T010 [P] (staticwebapp.config.json), T011 [P] (index.html)

# Implementation (sequential where deps exist):
T012 (vite-env.d.ts)
T013 (auth.ts, depends on T009, T012)
T014 (api.ts, depends on T009, T013)
T015 [P] (formatting.ts), T016 [P] (polling.ts)
```

### Phase 3 (US1) + Phase 4 (US2) + Phase 5 (US3) — can run in parallel
```
US1: T017 [P], T018 [P], T019 [P], T020 [P] → T021 [P], T022 [P] → T023 → T024 → T025
US2: T026 [P], T027 [P], T028 [P] → T029 [P] → T030 → T031
US3: T032 [P], T033 [P], T034 [P], T035 [P], T038 [P] → T036 → T037 → T039
```

### Phase 6 (Polish)
```
T040 [P], T041 [P], T042 [P]
T043 (depends on all code tasks)
T044 (depends on all above)
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: US1 (current readings)
4. **STOP and VALIDATE**: Dashboard shows live device readings with auto-refresh
5. Deploy/demo if ready — basic dashboard is functional

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US1 → Current readings visible → MVP!
3. US2 → Historical graphs with tiered downsampling → Enhanced analytics
4. US3 → Infrastructure deployed (SWA + Grafana with Infinity plugin) → Full deployment
5. Polish → CI/CD enforced, security verified → Production-ready

### Parallel Strategy

With capacity for parallel work:

1. Complete Setup + Foundational together
2. Once Foundational is done:
   - Stream A: US1 (current readings components) + US2 (graph components) — different .tsx files
   - Stream B: US3 (Terraform infrastructure) — different file tree entirely (infra/)
3. Streams converge at Polish phase

---

## Notes

- All file paths are relative to repository root (`/Users/steve/repos/epcubegraph/`)
- TDD is mandated by constitution — tests MUST fail before implementation
- 100% code coverage enforced via Vitest in CI (branches, functions, lines, statements)
- US1 and US2 are pure SPA code (TypeScript/Preact), US3 is pure Terraform — different skill sets
- Components use `.tsx` extension (Preact JSX), utility/core modules use `.ts`
- Metric names: epcube_battery_state_of_capacity_percent, epcube_battery_power_watts, epcube_solar_instantaneous_generation_watts, epcube_grid_power_watts (via /api/v1/grid)
- Grid sign convention: positive = net import from grid, negative = net export to grid
- Device interface has no ip field — only device, class, manufacturer?, product_code?, uid?, online
- FR-014: auth failures mid-session redirect to re-auth preserving current view state
- FR-013: tiered downsampling uses 2592000s (30d) fixed step for yearly/calendar month (VM compatibility)
- Grafana uses Infinity plugin from day one — no direct VictoriaMetrics data source
- Commit after each task or logical group, linked to the relevant GitHub issue (#33, #34, #35)
- Stop at any checkpoint to validate the story independently
- The dashboard consumes Feature 001's API — no new backend code, only client-side TypeScript
- SC-001 (<2s current display) and SC-002 (<2s graph render) are structurally covered by technology choice (uPlot canvas + lightweight Preact) and validated in the quickstart end-to-end test (T044)
