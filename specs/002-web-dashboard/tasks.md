# Tasks: Web Dashboard for Energy Telemetry

**Input**: Design documents from `/specs/002-web-dashboard/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/dashboard-config.md, quickstart.md

**Tests**: Included — constitution mandates TDD with 100% code coverage (non-negotiable).

**Organization**: Tasks grouped by user story for independent implementation and testing.

**Update 2026-03-16**: Spec updated — collection interval changed to 1 min, polling to 30s, added yearly preset with tiered downsampling, broken line gap visualization, Grafana Infinity plugin. Phases 1–6 completed; Phase 7+ added for spec changes.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story (US1, US2, US3) this task belongs to
- Exact file paths included in all descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, directory structure, build tooling

- [X] T001 Create dashboard/ directory structure per plan.md: dashboard/{src/{components,utils},tests/{unit,component},public}, create public/favicon.ico placeholder
- [X] T002 Initialize dashboard/package.json with runtime deps (preact, preact-router, @azure/msal-browser, uplot) and dev deps (vite, typescript, @preact/preset-vite, vitest, happy-dom, @testing-library/preact, @testing-library/jest-dom, @testing-library/user-event, @vitest/coverage-v8), include browserslist targeting Chrome/Firefox/Safari/Edge current + previous major version (FR-001, SC-006), run npm install
- [X] T003 [P] Create dashboard/tsconfig.json with strict mode, ES2022 target, jsxImportSource: "preact", module: "ESNext", moduleResolution: "bundler", paths aliases
- [X] T004 [P] Create dashboard/vite.config.ts (Preact plugin via @preact/preset-vite) and dashboard/vitest.config.ts (happy-dom environment, 100% coverage thresholds for branches/functions/lines/statements, test include paths)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core modules that MUST be complete before ANY user story — types, auth, API client, utilities

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Tests for Foundational (TDD — write tests FIRST, confirm they FAIL)

- [X] T005 [P] Write auth unit tests (MSAL init, acquireTokenSilent, loginRedirect fallback, getAccessToken returns bearer token, handles interaction_required error, logout, loginRedirect preserves current route/view state via state parameter — edge case 3) in dashboard/tests/unit/auth.test.ts
- [X] T006 [P] Write API client unit tests (fetchDevices, fetchInstantQuery, fetchRangeQuery, fetchGridPower, fetchDeviceMetrics, fetchHealth — verifies bearer token attachment, error response handling, timeout, base URL from env) in dashboard/tests/unit/api.test.ts
- [X] T007 [P] Write formatting unit tests (formatWatts: W/kW/MW with 1 decimal, formatPercent: 0-100 with % suffix, formatTimestamp: locale-aware date/time, formatRelativeTime: "5m ago"/"2h ago", edge cases: NaN, null, negative) in dashboard/tests/unit/formatting.test.ts
- [X] T008 [P] Write polling unit tests (createPollingInterval starts timer, callback executes at interval, clearPollingInterval stops timer, immediate first call option, cleanup on unmount) in dashboard/tests/unit/polling.test.ts

### Implementation for Foundational

- [X] T009 [P] Create TypeScript interfaces in dashboard/src/types.ts: Device, DeviceListResponse, InstantQueryResponse, RangeQueryResponse, DeviceMetricsResponse, HealthResponse, ErrorResponse (all per data-model.md), plus client-side TimeRange type ('today' | '7d' | '30d' | 'custom') and AppState interface
- [X] T010 [P] Create dashboard/staticwebapp.config.json per contracts/dashboard-config.md: navigationFallback rewrite to /index.html (exclude /assets/*), security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Content-Security-Policy allowing connect-src to login.microsoftonline.com and *.azurecontainerapps.io)
- [X] T011 [P] Create dashboard/index.html SPA entry point: minimal HTML5 with #app mount div, Vite module script tag pointing to /src/main.tsx
- [X] T012 Implement dashboard/src/auth.ts: MSAL PublicClientApplication config from VITE_ENTRA_CLIENT_ID and VITE_ENTRA_TENANT_ID env vars, acquireTokenSilent with InteractionRequiredAuthError fallback to loginRedirect (pass current route as state parameter to preserve view on re-auth — edge case 3), getAccessToken helper returning bearer token string, logout function, isAuthenticated check
- [X] T013 Implement dashboard/src/api.ts: typed fetch wrapper using auth.getAccessToken() for Authorization header, base URL from VITE_API_BASE_URL env var, functions: fetchDevices() → DeviceListResponse, fetchInstantQuery(query) → InstantQueryResponse, fetchRangeQuery(query, start, end, step) → RangeQueryResponse, fetchGridPower(start?, end?, step?) → RangeQueryResponse, fetchDeviceMetrics(device) → DeviceMetricsResponse, fetchHealth() → HealthResponse, error handling parsing ErrorResponse
- [X] T014 [P] Implement dashboard/src/utils/formatting.ts: formatWatts(watts: number) → string (auto-scale W/kW/MW), formatPercent(value: number) → string, formatTimestamp(epoch: number) → string (locale-aware), formatRelativeTime(epoch: number) → string ("5m ago"), null/NaN guards
- [X] T015 [P] Implement dashboard/src/utils/polling.ts: createPollingInterval(callback, intervalMs, immediate?) → IntervalId, clearPollingInterval(id) cleanup, default interval 30000ms (30s per FR-012)

**Checkpoint**: Foundation ready — types defined, auth works, API client fetches data, utilities format output. All foundational tests pass.

---

## Phase 3: User Story 1 — View Current Energy Readings (Priority: P1) 🎯 MVP

**Goal**: Display real-time solar generation, battery charge/discharge, and grid import/export for all connected devices with online/offline indicators and 30-second auto-refresh

**Independent Test**: Open the dashboard in a browser, verify current solar, battery, and grid values are displayed for each device, offline devices show stale indicator, readings refresh within 30 seconds

**FRs covered**: FR-001, FR-002, FR-003, FR-006, FR-011, FR-012

### Tests for User Story 1 (TDD — write tests FIRST, confirm they FAIL)

- [X] T016 [P] [US1] Write ErrorBoundary component tests in dashboard/tests/component/ErrorBoundary.test.tsx: renders children when no error, shows error message + retry button on catch, shows "API unreachable" banner when isApiReachable=false, retry button calls onRetry callback, handles API connectivity errors gracefully
- [X] T017 [P] [US1] Write DeviceCard component tests in dashboard/tests/component/DeviceCard.test.tsx: renders device name and class, shows online badge when online=true, shows offline/stale badge when online=false, displays solar/battery/grid metric values formatted via formatWatts, shows battery SOC as formatted percent, handles missing optional fields (manufacturer, uid)
- [X] T018 [P] [US1] Write CurrentReadings component tests in dashboard/tests/component/CurrentReadings.test.tsx: renders loading state initially, fetches devices and instant queries on mount, renders DeviceCard for each device, shows error state when API fails, triggers polling refresh every 30 seconds, shows ErrorBoundary when API unreachable, updates readings on poll without full re-render

### Implementation for User Story 1

- [X] T019 [P] [US1] Implement ErrorBoundary component in dashboard/src/components/ErrorBoundary.tsx: Preact class component with componentDidCatch, renders error message + "Retry" button, accepts isApiReachable prop to show connectivity banner, onRetry callback prop
- [X] T020 [P] [US1] Implement DeviceCard component in dashboard/src/components/DeviceCard.tsx: accepts Device + metrics props, renders device name/class, online/offline badge (green/red), solar generation (formatWatts), battery power + SOC (formatWatts + formatPercent), grid power (formatWatts with import/export label based on sign)
- [X] T021 [US1] Implement CurrentReadings component in dashboard/src/components/CurrentReadings.tsx: fetches device list via fetchDevices(), issues instant queries per device for battery/solar/grid metrics, renders DeviceCard per device, sets up polling via createPollingInterval (30s default per FR-012), shows loading skeleton on initial fetch, wraps in ErrorBoundary, displays lastRefreshed timestamp
- [X] T022 [US1] Create dashboard/src/main.tsx entry point: initialize MSAL via auth.ts, check authentication (redirect to login if needed), mount Preact app with preact-router, map "/" route to CurrentReadings, render to #app div

**Checkpoint**: Dashboard loads in browser, authenticates via MSAL, shows current device readings with online/offline status, auto-refreshes every 30 seconds. User Story 1 is independently functional and testable.

---

## Phase 4: User Story 2 — View Historical Energy Graphs (Priority: P2)

**Goal**: Interactive time-series charts with selectable ranges (today, 7d, 30d, custom) using uPlot canvas rendering within 2-second performance target

**Independent Test**: With historical data available, select each predefined time range and verify graph renders with accurate data points within 2 seconds. Verify custom date range works. Verify empty range shows "no data" message.

**FRs covered**: FR-004, FR-005, FR-007, FR-008

### Tests for User Story 2 (TDD — write tests FIRST, confirm they FAIL)

- [X] T023 [P] [US2] Write TimeRangeSelector component tests in dashboard/tests/component/TimeRangeSelector.test.tsx: renders today/7d/30d/custom preset buttons, highlights active preset, emits onChange with correct start/end timestamps, shows custom date inputs when "custom" selected, validates custom range (start < end), hides custom inputs for preset selections
- [X] T024 [P] [US2] Write HistoricalGraph component tests in dashboard/tests/component/HistoricalGraph.test.tsx: converts RangeQueryResponse to uPlot.AlignedData format, renders uPlot canvas element, shows "No data available" for empty result, shows "No data available" for selected time range when result is empty (FR-007), handles data gaps without false interpolation (FR-008), auto-calculates step for ≤2000 data points, renders multiple series (solar, battery, grid) with correct labels

### Implementation for User Story 2

- [X] T025 [P] [US2] Implement TimeRangeSelector component in dashboard/src/components/TimeRangeSelector.tsx: buttons for today/7d/30d/custom, calculates start/end timestamps for each preset (today=start of day local, 7d/30d=now minus duration), custom shows date input fields (no range cap), emits {start, end, step} via onChange prop, step auto-calculation: max(60, (end-start)/2000) seconds
- [X] T026 [US2] Implement HistoricalGraph component in dashboard/src/components/HistoricalGraph.tsx: accepts timeRange props, fetches range queries for solar/battery/grid via fetchRangeQuery + fetchGridPower, converts responses to uPlot.AlignedData (timestamps + value arrays), initializes uPlot with responsive sizing, line series per metric with color coding, tooltip showing formatted values, shows "No data available for this time range" when results empty, null values for data gaps (uPlot renders gaps natively)
- [X] T027 [US2] Add historical graph route ("/history") to dashboard/src/main.tsx, add navigation header with links between Current Readings ("/") and Historical Graphs ("/history") views

**Checkpoint**: Dashboard shows interactive time-series charts for all time ranges, renders within 2 seconds for 30-day data, handles empty ranges and data gaps. User Stories 1 AND 2 both work independently.

---

## Phase 5: User Story 3 — Grafana Dashboards + Deployment Infrastructure (Priority: P3)

**Goal**: Deploy Grafana on Container Apps, deploy dashboard SPA on Azure Static Web Apps, register dashboard Entra ID app (Grafana data source superseded by Phase 10 — Infinity plugin)

**Independent Test**: SWA serves the built dashboard. Dashboard Entra ID app registration exists with correct redirect URIs and API permissions. (Grafana data source validation moved to Phase 10.)

**FRs covered**: FR-009, FR-010, SC-004, SC-005

### Implementation for User Story 3

- [X] T028 [P] [US3] Add dashboard Entra ID app registration in infra/entra.tf: azuread_application.dashboard (public client, sign_in_audience="AzureADMyOrg", single_page_application redirect URIs from SWA default hostname, required_resource_access for user_impersonation scope on API app)
- [X] T029 [P] [US3] Create Azure Static Web Apps resource (Free tier, sku_tier="Free", sku_size="Free") with management lock (CanNotDelete) in infra/static-web-app.tf
- [X] T030 [P] [US3] Add grafana_image variable (default "grafana/grafana:11.5.2") in infra/variables.tf, add Grafana admin password (random_password + azurerm_key_vault_secret) in infra/keyvault.tf
- [X] T031 [US3] Create Grafana Container App in infra/grafana.tf: azurerm_container_app with ingress on port 3000, min_replicas=0/max_replicas=1, 0.25 vCPU/0.5Gi memory, Azure File Share volume mount for /var/lib/grafana (azurerm_container_app_environment_storage + azurerm_storage_share), provision VictoriaMetrics Prometheus data source via provisioning YAML mounted at /etc/grafana/provisioning/datasources/ per contracts/dashboard-config.md (FR-009, SC-004), GF_SECURITY_ADMIN_PASSWORD from Key Vault secret, GF_SERVER_ROOT_URL, management lock (CanNotDelete)
- [X] T032 [US3] Add Terraform outputs in infra/outputs.tf: swa_default_hostname, swa_deployment_token (sensitive), grafana_fqdn, dashboard_client_id (from azuread_application.dashboard)
- [X] T033 [P] [US3] Create dashboard/.env.example with VITE_API_BASE_URL, VITE_ENTRA_CLIENT_ID, VITE_ENTRA_TENANT_ID, VITE_ENTRA_API_SCOPE placeholder values per contracts/dashboard-config.md
- [X] T034 [US3] Run terraform validate and terraform fmt -check to verify all infrastructure changes compile and are formatted correctly

**Checkpoint**: `terraform validate` passes. SWA resource created. Dashboard Entra ID app registered with correct SPA redirect URIs. All three user stories are independently functional. (Grafana data source config superseded by Phase 10 — Infinity plugin.)

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: CI/CD, security review, end-to-end validation

- [X] T035 [P] Create GitHub Actions CI workflow for dashboard in .github/workflows/dashboard-ci.yml: trigger on push/PR to 002-web-dashboard and main (paths: dashboard/**), steps: checkout, setup Node.js 22, npm ci, npm run test:coverage (fail if <100%), npm run build, Azure/static-web-apps-deploy@v1 on main branch only (deployment token from secrets.SWA_DEPLOYMENT_TOKEN)
- [X] T036 [P] Security review: verify MSAL auth on all API calls (no unauthenticated data fetch), verify CSP headers in staticwebapp.config.json block XSS, verify no secrets in client code (only public client ID/tenant ID), verify Grafana password stored in Key Vault and injected as secret env var, verify all new infra resources have management locks
- [X] T037 Run quickstart.md end-to-end validation: cd dashboard, npm install, npm test, npm run test:coverage (100% pass), npm run build (dist/ output), cd ../infra, terraform validate, terraform fmt -check
- [X] T038 [P] Update existing .github/workflows/ci.yml to add dashboard build + test job (npm ci, npm run test:coverage) alongside API build + test, ensure both must pass for PR merge

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Foundational — requires types.ts, auth.ts, api.ts, formatting.ts, polling.ts
- **US2 (Phase 4)**: Depends on Foundational — requires types.ts, api.ts, formatting.ts; can run in parallel with US1
- **US3 (Phase 5)**: Depends on Foundational (for Entra SWA redirect URI referencing SWA resource) — no code dependency on US1 or US2 (pure Terraform)
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: Can start after Foundational — no dependencies on US2 or US3
- **US2 (P2)**: Can start after Foundational — no dependencies on US1 or US3 (separate components, separate route)
- **US3 (P3)**: Can start after Foundational — no dependencies on US1 or US2 (pure infrastructure/Terraform)
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
T012 (auth.ts, depends on T009)
T013 (api.ts, depends on T009, T012)
T014 [P] (formatting.ts), T015 [P] (polling.ts)
```

### Phase 3 (US1) + Phase 4 (US2) + Phase 5 (US3) — can run in parallel
```
US1: T016 [P], T017 [P], T018 [P] → T019 [P], T020 [P] → T021 → T022
US2: T023 [P], T024 [P] → T025 [P] → T026 → T027
US3: T028 [P], T029 [P], T030 [P], T033 [P] → T031 → T032 → T034
```

### Phase 6 (Polish)
```
T035 [P], T036 [P], T038 [P]
T037 (depends on all above)
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
3. US2 → Historical graphs available → Enhanced analytics
4. US3 → Infrastructure deployed (SWA + Grafana) → Full deployment
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
- Commit after each task or logical group
- Stop at any checkpoint to validate the story independently
- The dashboard consumes Feature 001's API — no new backend code, only client-side TypeScript
- SC-001 (<2s current display) and SC-002 (<2s graph render) are structurally covered by technology choice (uPlot GPU-accelerated canvas + lightweight Preact 10) and validated in the quickstart end-to-end manual test (T037). Automated render-time assertions in happy-dom are not meaningful — real-browser performance is inherent to the toolchain

---

## Phase 7: Spec Update — Polling Interval & Stale Threshold (US1)

**Purpose**: Update polling from 5-min to 30-sec default (FR-012), stale threshold from 15-min to 3-min (FR-006), collection interval references from 5-min to 1-min

**FRs covered**: FR-003, FR-006, FR-012

### Tests for Phase 7 (TDD — write tests FIRST, confirm they FAIL)

- [X] T039 [P] [US1] Update polling unit tests in dashboard/tests/unit/polling.test.ts: change DEFAULT_INTERVAL_MS expectation from 300000 to 30000 (30 seconds per FR-012), update any test descriptions referencing "5 minutes" to "30 seconds"

### Implementation for Phase 7

- [X] T040 [US1] Update DEFAULT_INTERVAL_MS in dashboard/src/utils/polling.ts from 300_000 to 30_000 (30 seconds, half of 1-minute collection interval per FR-012), update JSDoc comment

**Checkpoint**: Dashboard auto-refreshes every 30 seconds. All polling tests pass with updated interval.

---

## Phase 8: Spec Update — Yearly Preset & Tiered Downsampling (US2)

**Purpose**: Add "Last year" time range preset (FR-004), implement tiered step calculation per FR-013 (daily=1m, weekly=1h, monthly=1d, yearly=30d), display aggregation notice when data is downsampled

**FRs covered**: FR-004, FR-005, FR-013

### Tests for Phase 8 (TDD — write tests FIRST, confirm they FAIL)

- [X] T041 [P] [US2] Update TimeRangeSelector tests in dashboard/tests/component/TimeRangeSelector.test.tsx: add test for "1y" preset button renders and emits correct start/end (now - 365 days), verify tiered step values (today → 60s, 7d → 3600s, 30d → 86400s, 1y → calendar month), verify custom range auto-tiered step selection (≤1d → 60s, ≤7d → 3600s, ≤30d → 86400s, >30d → calendar month)
- [X] T042 [P] [US2] Update HistoricalGraph tests in dashboard/tests/component/HistoricalGraph.test.tsx: add test for aggregation notice displayed when step > 60 (e.g., "Data shown at hourly resolution"), verify notice not shown for daily view (step=60), verify notice text matches resolution tier (hourly/daily/calendar monthly)

### Implementation for Phase 8

- [X] T043 [US2] Update TimeRange type in dashboard/src/types.ts: change from `'today' | '7d' | '30d' | 'custom'` to `'today' | '7d' | '30d' | '1y' | 'custom'`
- [X] T044 [US2] Update TimeRangeSelector component in dashboard/src/components/TimeRangeSelector.tsx: add Preset type '1y', add "1y" button between "30d" and "custom", add case '1y' in selectPreset (start = now - 365 * 86400), replace generic calculateStep function with tiered step logic: today=60, 7d=3600, 30d=86400, 1y=calendar month, custom=auto-tiered by range duration (≤1d → 60, ≤7d → 3600, ≤30d → 86400, >30d → calendar month)
- [X] T045 [US2] Update HistoricalGraph component in dashboard/src/components/HistoricalGraph.tsx: accept step prop, display aggregation notice banner when step > 60 seconds (text: "Data shown at [hourly/daily/calendar monthly] resolution" based on step value: 3600→hourly, 86400→daily, calendar month→monthly), position notice above the chart
- [X] T046 [US2] Update HistoryView component in dashboard/src/components/HistoryView.tsx if needed to pass step from TimeRangeSelector through to HistoricalGraph (verify step is already in TimeRangeValue interface and passed correctly)

**Checkpoint**: Dashboard shows "1y" time range preset. Selecting any preset uses the correct tiered step. Aggregation notice appears when data is downsampled. All TimeRangeSelector and HistoricalGraph tests pass.

---

## Phase 9: Spec Update — Broken Line Gap Visualization (US2)

**Purpose**: Ensure data gaps render as broken lines in uPlot (FR-008) by using null values instead of NaN

**FRs covered**: FR-008

### Tests for Phase 9 (TDD — write tests FIRST, confirm they FAIL)

- [X] T047 [P] [US2] Add/update HistoricalGraph test in dashboard/tests/component/HistoricalGraph.test.tsx: verify that mergeTimeSeries produces null (not NaN) for missing data points, verify uPlot data preparation maps null values correctly for gap rendering (no `NaN` conversion)

### Implementation for Phase 9

- [X] T048 [US2] Update HistoricalGraph component in dashboard/src/components/HistoricalGraph.tsx: change uPlot data preparation from `v ?? NaN` to `v ?? null` for all series (solar, battery, grid) to ensure uPlot renders broken lines at data gaps per FR-008

**Checkpoint**: Historical graphs render data gaps as broken lines (discontinuous segments). No false interpolation across gaps. FR-008 test passes.

---

## Phase 10: Spec Update — Grafana Infinity Plugin (US3)

**Purpose**: Replace VictoriaMetrics direct Prometheus data source with Infinity plugin (generic JSON/REST) per spec clarification. Add service principal for OAuth2 API authentication.

**FRs covered**: FR-009, SC-004

### Implementation for Phase 10

- [X] T049 [P] [US3] Add Grafana service principal app registration in infra/entra.tf: azuread_application.grafana_sp (confidential client, with client secret), grant user_impersonation scope on API app, add azuread_service_principal.grafana_sp
- [X] T050 [P] [US3] Add Grafana service principal client secret to Key Vault in infra/keyvault.tf: azurerm_key_vault_secret.grafana_sp_client_secret (from azuread_application_password.grafana_sp)
- [X] T051 [US3] Update Grafana Container App in infra/grafana.tf: add GF_INSTALL_PLUGINS="yesoreyeram-infinity-datasource" environment variable, replace VictoriaMetrics Prometheus data source provisioning YAML with Infinity plugin config per contracts/dashboard-config.md (type: yesoreyeram-infinity-datasource, URL: API FQDN, OAuth2 client credentials from service principal), inject client secret from Key Vault
- [X] T052 [US3] Update Terraform outputs in infra/outputs.tf if needed: add grafana_sp_client_id output
- [X] T053 [US3] Run terraform validate and terraform fmt -check to verify all infrastructure changes compile and are formatted correctly

**Checkpoint**: Grafana uses Infinity plugin to query the REST API via OAuth2 service principal. terraform validate passes. FR-009 and SC-004 satisfied via API-based access.

---

## Phase 11: Polish & Validation (Post-Update)

**Purpose**: End-to-end validation of all spec changes, test coverage verification

- [X] T054 [P] Update dashboard/tests/component/App.test.tsx if navigation tests reference only today/7d/30d/custom — add "1y" link/route
- [X] T055 [P] Update dashboard/tests/component/HistoryView.test.tsx if mock TimeRangeValue uses old step calculations — align with tiered step values
- [X] T056 Run full test suite: cd dashboard && npm run test:coverage — verify 100% coverage maintained after all changes (branches, functions, lines, statements)
- [X] T057 Run quickstart.md validation: cd infra && terraform validate && terraform fmt -check, cd ../dashboard && npm run build — verify clean build and infrastructure

**Checkpoint**: All tests pass at 100% coverage. Terraform validates. Build succeeds. All spec changes fully implemented.

---

## Dependencies & Execution Order (Phases 7–11)

### Phase Dependencies

- **Phase 7 (Polling)**: No dependencies on other new phases — can start immediately
- **Phase 8 (Yearly + Downsampling)**: No dependencies on Phase 7 — can run in parallel
- **Phase 9 (Gap Visualization)**: No dependencies on Phase 7 or 8 — can run in parallel
- **Phase 10 (Grafana Infinity)**: No dependencies on Phases 7–9 — can run in parallel (pure Terraform)
- **Phase 11 (Polish)**: Depends on ALL of Phases 7–10 being complete

### Parallel Opportunities

```
# All four update phases can run in parallel:
Phase 7:  T039 → T040                              (polling.ts)
Phase 8:  T041 [P], T042 [P] → T043 → T044 → T045 → T046  (types + components)
Phase 9:  T047 → T048                              (HistoricalGraph.tsx)
Phase 10: T049 [P], T050 [P] → T051 → T052 → T053 (infra/)

# After all converge:
Phase 11: T054 [P], T055 [P] → T056 → T057
```

### Within Each Phase

- Tests MUST be written and FAIL before implementation (TDD — constitution)
- Run `npm test` after each task to verify incremental correctness

---

## Implementation Strategy (Phases 7–11)

### Sequential Approach

1. Phase 7: Update polling (quick — 2 tasks)
2. Phase 8: Add yearly preset + tiered downsampling (largest — 6 tasks)
3. Phase 9: Fix gap visualization (quick — 2 tasks)
4. Phase 10: Grafana Infinity plugin (Terraform — 5 tasks)
5. Phase 11: Validate everything (4 tasks)

### Parallel Approach

With capacity for parallel work:
- **Stream A**: Phases 7 + 8 + 9 (all dashboard/ TypeScript changes)
- **Stream B**: Phase 10 (all infra/ Terraform changes)
- **Converge**: Phase 11
