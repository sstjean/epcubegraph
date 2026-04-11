# Tasks: Dashboard Vue Circuit Display

**Input**: Design documents from `/specs/007-dashboard-vue-circuits/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-v1-vue-circuits.md, quickstart.md
**Branch**: `007-dashboard-vue-circuits`

**Tests**: TDD required — 100% coverage CI gate. Tests FIRST, fail, then implement.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup — Tests First

**Purpose**: Write failing tests for shared infrastructure (types, utilities, schema), then implement

### Tests (RED — write first, confirm they fail)

- [ ] T001 [P] Unit tests for circuit utility functions in `dashboard/tests/unit/circuits.test.ts` (filterActiveCircuits, sortByWattsThenName, sortByCircuitNumber, orderPanels)
- [ ] T002 [P] Unit tests for bulk current readings model serialization in `api/tests/EpCubeGraph.Api.Tests/Unit/ModelSerializationTests.cs` (add VueBulkCurrentReadingsResponse and VueBulkDailyReadingsResponse round-trip tests)
- [ ] T003 [P] Exporter tests for vue_readings_daily schema creation in `local/epcube-exporter/test_exporter.py` — test: `_ensure_vue_schema()` creates vue_readings_daily table with expected columns

### Implementation (GREEN — make tests pass)

- [ ] T004 [P] Create circuit sorting/filtering utility module `dashboard/src/utils/circuits.ts` (filterActiveCircuits, sortByWattsThenName, sortByCircuitNumber — sort contract: mains "1,2,3" always first, numeric parse of channel_num, "Balance" always last — orderPanels — reuse existing `formatKwh` from `utils/formatting.ts`)
- [ ] T005 [P] Add bulk current/daily response models to `api/src/EpCubeGraph.Api/Models/Vue.cs` (VueBulkCurrentReadingsResponse, VueDailyChannelReading, VueDeviceDailyReadings, VueBulkDailyReadingsResponse)
- [ ] T006 [P] Add Vue dashboard TypeScript types to `dashboard/src/types.ts` (VueCurrentChannel, VueDeviceCurrentReadings, VueBulkCurrentReadingsResponse, VueDailyChannel, VueDeviceDailyReadings, VueBulkDailyReadingsResponse, VuePanelMapping, VueDeviceMapping)
- [ ] T007 [P] Add `vue_readings_daily` table to exporter schema init (`local/epcube-exporter/exporter.py` — add `CREATE TABLE IF NOT EXISTS` in `_ensure_vue_schema()`)

**Checkpoint**: All setup tests pass at 100% coverage. Types, utilities, and schema are in place.

---

## Phase 2: Foundational — API + Data Pipeline

**Purpose**: API endpoints and exporter daily pipeline. MUST be complete before dashboard user stories.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Tests (RED — write first, confirm they fail)

- [X] T008 [P] Unit tests for new VueEndpoints handlers (bulk current, daily) in `api/tests/EpCubeGraph.Api.Tests/Unit/VueEndpointsTests.cs`
- [X] T009 [P] Unit tests for Settings allowlist extension (vue_device_mapping validation, vue_daily_poll_interval_seconds) in `api/tests/EpCubeGraph.Api.Tests/Unit/ValidateTests.cs`
- [X] T010 [P] Integration tests for `GET /vue/readings/current` (bulk) in `api/tests/EpCubeGraph.Api.Tests/Integration/PostgresVueStoreTests.cs` (add GetBulkCurrentReadingsAsync tests)
- [X] T011 [P] Integration tests for `GET /vue/readings/daily` in `api/tests/EpCubeGraph.Api.Tests/Integration/PostgresVueStoreTests.cs` (add GetDailyReadingsAsync tests — insert vue_readings_daily rows, query by date)
- [X] T012 [P] Integration tests for `PUT /settings/vue_device_mapping` in `api/tests/EpCubeGraph.Api.Tests/Integration/SettingsEndpointTests.cs` (valid JSON, invalid JSON, duplicate GIDs, non-array values)
- [X] T013 [P] Unit tests for new API client functions in `dashboard/tests/unit/api.test.ts` (add fetchVueBulkCurrentReadings, fetchVueDailyReadings tests)
- [X] T014 [P] Exporter tests for daily poll loop and vue_readings_daily upsert in `local/epcube-exporter/test_exporter.py` — include: upsert creates/updates rows, two readings on different dates produce separate rows (date boundary), configurable poll interval from settings

### Implementation (GREEN — make tests pass)

- [X] T015 Add `GetBulkCurrentReadingsAsync` and `GetDailyReadingsAsync` to `api/src/EpCubeGraph.Api/Services/IVueStore.cs`
- [X] T016 Implement `GetBulkCurrentReadingsAsync` in `api/src/EpCubeGraph.Api/Services/PostgresVueStore.cs` (query latest vue_readings per channel across all devices, join display_name_overrides + vue_channels for name resolution)
- [X] T017 Implement `GetDailyReadingsAsync` in `api/src/EpCubeGraph.Api/Services/PostgresVueStore.cs` (query vue_readings_daily by date, join display names)
- [X] T018 Register `GET /vue/readings/current` and `GET /vue/readings/daily` endpoints in `api/src/EpCubeGraph.Api/Endpoints/VueEndpoints.cs`
- [X] T019 Extend Settings API allowlist in `api/src/EpCubeGraph.Api/Endpoints/SettingsEndpoints.cs` — add `vue_device_mapping` (JSON structure validation: object with string keys, array-of-objects values with gid/alias, no duplicate GIDs) and `vue_daily_poll_interval_seconds` (integer 1–3600)
- [X] T020 Add `fetchVueBulkCurrentReadings()` and `fetchVueDailyReadings(date)` to `dashboard/src/api.ts`
- [X] T021 Implement daily poll loop in `local/epcube-exporter/exporter.py` — poll PyEmVue at daily scale on configurable interval (settings key `vue_daily_poll_interval_seconds`, default 300s), upsert per-circuit kWh to `vue_readings_daily` table
- [X] T022 Endpoint integration tests for bulk current + daily in `api/tests/EpCubeGraph.Api.Tests/Integration/EndpointTests.cs` (full HTTP round-trip through the app)

**Checkpoint**: API serves bulk current + daily readings. Exporter writes daily kWh. Dashboard can fetch data. All foundational tests pass at 100% coverage.

---

## Phase 3: User Story 1 — Display Active Vue Circuits in Flow Diagram (Priority: P1) 🎯 MVP

**Goal**: Show active Vue circuits (>0W) inline on each EP Cube flow diagram card, sorted ascending by watts, split into two columns flanking the Home node. Circuits mapped to EP Cube devices via `vue_device_mapping` setting.

**Independent Test**: Load Current Readings page in Flow mode. Each EP Cube card shows active circuits (<0.75em, name left / watts right) in two columns. Circuits at 0W are hidden. Cards with unmapped Vue panels show no circuits. When all circuits are at 0W, cards look identical to pre-feature.

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T023 [P] [US1] Component test for circuit list overlay in `dashboard/tests/component/EnergyFlowDiagram.test.tsx` — add tests: renders active circuits sorted by watts, excludes 0W and mains, shows Balance as "Unmonitored loads", hides circuit area when no active circuits, handles missing vue_device_mapping, two-column layout (left fills first), display name override takes priority over channel name, circuits from multiple panels shown by display_name
- [X] T024 [P] [US1] Component test for Vue polling in `dashboard/tests/component/CurrentReadings.test.tsx` — add tests: fetches bulk current readings on 1s interval (separate from EP Cube 30s interval), passes Vue data to EnergyFlowDiagram, handles API errors gracefully

### Implementation for User Story 1

- [X] T025 [US1] Add Vue circuit list rendering to `dashboard/src/components/EnergyFlowDiagram.tsx` — accept Vue current readings + device mapping props, filter active circuits (>0W, exclude mains "1,2,3"), sort by watts then name, render as two columns flanking Home node (0.75em, name left / watts right), show display_name directly without prefix
- [X] T026 [US1] Add Vue bulk current polling loop to `dashboard/src/components/CurrentReadings.tsx` — separate 1s interval for `fetchVueBulkCurrentReadings`, pass results + vue_device_mapping to EnergyFlowDiagram, handle API errors without breaking EP Cube data display
- [X] T027 [US1] Wire Vue data flow in `dashboard/src/components/CurrentReadings.tsx` — read `vue_device_mapping` from settings response, pass device mapping to flow diagram for per-card circuit filtering

**Checkpoint**: Flow diagram cards show active circuits inline. 0W circuits hidden. Cards with no mapping look unchanged. US1 independently testable. `npm run typecheck && npm run test:coverage` passes at 100%.

---

## Phase 4: User Story 2 — Circuits by Panel Page (Priority: P2)

**Goal**: Dedicated `/circuits` page showing all Vue circuits grouped by panel, with current watts and daily kWh. Fixed positions by circuit number. Mains bold with separator. Panel headers show raw/dedup totals and daily kWh sum.

**Independent Test**: Navigate to Circuits via nav. Each panel listed with name, raw total, dedup total, daily kWh. All circuits shown (including 0W) in fixed order by circuit number. Mains first (bold), individual circuits, Balance last. Each row shows name, current watts, daily kWh. Page auto-refreshes.

### Tests for User Story 2

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T028 [P] [US2] Component test for CircuitsPage in `dashboard/tests/component/CircuitsPage.test.tsx` — renders panels in correct order (top-level without children alphabetical, parents followed by children alphabetical), renders circuits in fixed order (mains, numbered, Balance), mains row bold, shows 0W circuits in fixed position, shows current watts and daily kWh for each circuit, panel header shows raw/dedup/daily totals, auto-refresh updates data, empty state shows configuration prompt when vue_device_mapping missing, handles API errors
- [ ] T029 [P] [US2] Component test for App routing in `dashboard/tests/component/App.test.tsx` — add tests: /circuits route renders CircuitsPage, nav shows "Circuits" as third item

### Implementation for User Story 2

- [ ] T030 [US2] Create `dashboard/src/components/CircuitsPage.tsx` — fetch vue devices + bulk current + daily readings + hierarchy, group circuits by panel, order panels per FR-014, order circuits per FR-011 (mains → numbered → Balance), render panel headers with deduplicated watts total and daily kWh sum, render circuit rows (name, watts, kWh), mains bold with separator, Balance labeled "Unmonitored loads", auto-refresh on polling interval
- [ ] T031 [US2] Add `/circuits` route and nav link in `dashboard/src/App.tsx` — third nav item after Current Readings, before Settings
- [ ] T032 [US2] Add CSS styles for Circuits page in `dashboard/src/app.css` — panel section styling, mains bold + separator, circuit row layout (name left, watts center, kWh right), 0W dimming

**Checkpoint**: Circuits page fully functional with panel grouping, circuit ordering, daily kWh. Navigation updated. US2 independently testable. `npm run typecheck && npm run test:coverage` passes at 100%.

---

## Phase 5: User Story 3 — Graceful Display When No Circuits Active (Priority: P3)

**Goal**: Flow cards and Circuits page handle edge cases cleanly: no active circuits, Vue offline, vue_device_mapping unconfigured, API errors.

**Independent Test**: With all Vue devices offline or 0W: flow cards look identical to pre-feature. Circuits page shows all panels/circuits at 0W in fixed positions. With Vue data unavailable: no errors, no layout shifts, Circuits page shows "Vue data not yet available" message.

### Tests for User Story 3

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T033 [P] [US3] Component test for empty/error states in `dashboard/tests/component/EnergyFlowDiagram.test.tsx` — add tests: no circuit area rendered when API returns empty devices, no circuit area when vue_device_mapping is `{}`, no errors when API call fails (flow card renders normally), no layout shift between circuits-visible and circuits-hidden states
- [ ] T034 [P] [US3] Component test for Circuits page edge cases in `dashboard/tests/component/CircuitsPage.test.tsx` — add tests: API error shows "Vue data is not yet available" message, all circuits 0W still renders in fixed positions, stale data persists when API call fails mid-session (verify last-known values displayed not cleared), empty mapping shows configuration prompt

### Implementation for User Story 3

- [ ] T035 [US3] Harden EnergyFlowDiagram circuit overlay in `dashboard/src/components/EnergyFlowDiagram.tsx` — ensure circuit area is completely hidden (not empty container) when no active circuits or no Vue data, no layout shift when transitioning between states
- [ ] T036 [US3] Harden CircuitsPage error handling in `dashboard/src/components/CircuitsPage.tsx` — show "Vue data is not yet available" when API fails, preserve last-known values on transient errors, show "Configure Vue device mapping in Settings to see circuits" when mapping is empty/unconfigured

**Checkpoint**: All edge cases handled gracefully. No visual regressions. US3 independently testable. `npm run typecheck && npm run test:coverage` passes at 100%.

---

## Phase 6: Settings Page Mapping Editor (Cross-cutting — serves US1+US2)

**Goal**: Visual editor on the Settings page for assigning Vue panels to EP Cube devices. Auto-discovers devices from existing APIs. No manual GID entry.

### Tests for Phase 6

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T037 [P] Component test for mapping editor in `dashboard/tests/component/SettingsPage.test.tsx` — add tests: renders EP Cube devices with assigned Vue panels, renders unassigned Vue panel pool, assign panel to device updates mapping state, unassign panel returns to pool, save calls PUT /settings/vue_device_mapping with correct JSON, validation error displayed on save failure, auto-discovers devices from API, handles empty device lists

### Implementation for Phase 6

- [X] T038 Add mapping editor section to `dashboard/src/components/SettingsPage.tsx` — fetch EP Cube devices (`GET /devices`) and Vue devices (`GET /vue/devices`), read current mapping from settings, render EP Cube targets with assigned Vue panels, unassigned pool, dropdown assignment, save to `PUT /settings/vue_device_mapping`
- [X] T039 Add CSS for mapping editor in `dashboard/src/app.css` — device/panel assignment layout, unassigned pool styling

**Checkpoint**: Settings page allows mapping Vue panels to EP Cubes. Mapping persists via API. `npm run typecheck && npm run test:coverage` passes at 100%.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation across all user stories, coverage verification, integration

- [ ] T040 Run full API coverage check: `cd api && rm -rf TestResults CoverageMerged && dotnet test EpCubeGraph.sln --collect:"XPlat Code Coverage" --results-directory ./TestResults --settings tests/EpCubeGraph.Api.Tests/coverlet.runsettings` then `reportgenerator` + verify 100% line coverage
- [ ] T041 Run full dashboard coverage check: `cd dashboard && npm run typecheck && npm run test:coverage` — verify 100% line coverage
- [ ] T042 Run exporter tests with coverage: `cd local/epcube-exporter && python -m pytest test_exporter.py -v --cov=exporter --cov-report=term --cov-fail-under=100` — verify all pass at 100% coverage
- [ ] T043 Run quickstart.md validation — start local stack, verify both new endpoints return data, verify Circuits page renders, verify flow card circuits display
- [ ] T044 Verify no TypeScript type errors across all dashboard files: `cd dashboard && npm run typecheck`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Phase 2 — MVP delivery
- **User Story 2 (Phase 4)**: Depends on Phase 2 — can run in parallel with US1 (different files)
- **User Story 3 (Phase 5)**: Depends on Phase 3 + Phase 4 (hardens components created there)
- **Settings Mapping Editor (Phase 6)**: Depends on Phase 2 (uses allowlist from T018) — can run in parallel with US1/US2
- **Polish (Phase 7)**: Depends on all previous phases complete

### User Story Dependencies

- **US1 (P1)**: Depends on Foundational phase. Touches `EnergyFlowDiagram.tsx` and `CurrentReadings.tsx`
- **US2 (P2)**: Depends on Foundational phase. Creates new `CircuitsPage.tsx` and modifies `App.tsx` — **independent of US1**
- **US3 (P3)**: Depends on US1 + US2. Hardens components created in both stories
- **Settings Editor**: Depends on Foundational (T018 allowlist). Touches `SettingsPage.tsx` — **independent of US1/US2**

### Within Each Phase

- Tests MUST be written and confirmed to FAIL before implementation (Red-Green-Refactor)
- No production code without a covering test
- `npm run typecheck` after each dashboard change
- Coverage verified at each checkpoint

### Parallel Opportunities

**Phase 1** — Test tasks T001-T003 parallel (different files). Then impl T004-T007 parallel.

**Phase 2** — Test tasks T008-T014 all parallel (different test files). Implementation T015-T021 has dependencies:
- T015 before T016/T017 (interface before implementation)
- T016/T017 parallel (different methods in same file)
- T018 after T016/T017 (endpoints wire up store methods)
- T019 independent (SettingsEndpoints.cs)
- T020 independent (dashboard api.ts)
- T021 independent (exporter.py)
- T022 after T018 (endpoint integration tests)

**Phase 3-6** — US1, US2, and Settings Editor can run in parallel after Phase 2 (different component files). Within each: tests first, then implementation.

---

## Parallel Example: Phase 1 (Setup)

```
# RED — all test tasks in parallel (different test files):
T001: Circuit utility unit tests (dashboard)
T002: Model serialization tests (API)
T003: Exporter schema creation tests

# GREEN — all impl tasks in parallel (different codebases):
T004: circuits.ts (dashboard)
T005: Vue.cs models (API)
T006: types.ts (dashboard)
T007: exporter schema (Python)
```
```

## Parallel Example: User Stories (after Phase 2)

```
# Can run in parallel (different files):
US1: EnergyFlowDiagram.tsx + CurrentReadings.tsx
US2: CircuitsPage.tsx (new) + App.tsx routing
Settings: SettingsPage.tsx

# US3 runs last (hardens US1 + US2 components)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (types, models, schema)
2. Complete Phase 2: Foundational (API endpoints, exporter pipeline, API client)
3. Complete Phase 3: User Story 1 (flow card circuit display)
4. **STOP and VALIDATE**: Test US1 independently — flow cards show active circuits
5. Deploy/demo if ready — this is the core feature

### Incremental Delivery

1. Setup + Foundational → Data pipeline ready
2. Add US1 → Flow cards show circuits → Deploy (MVP!)
3. Add US2 → Dedicated Circuits page → Deploy
4. Add US3 → Edge cases handled → Deploy
5. Add Settings Editor → Mapping configurable via UI → Deploy
6. Polish → Coverage verified, quickstart validated

### Suggested MVP Scope

**User Story 1 only** — active circuits visible on flow cards. This delivers the core value: seeing what's drawing power alongside the solar/grid/battery overview. The Circuits page (US2), edge case hardening (US3), and Settings editor (Phase 6) add value incrementally but aren't required for initial visibility.

---

## Notes

- All tasks include exact file paths referencing existing project structure
- TDD required: every implementation task has corresponding test tasks that MUST fail first
- 100% coverage enforced by CI gate — verify locally before claiming done (see quickstart.md)
- `npm run typecheck` must pass after every dashboard change (vitest doesn't catch type errors)
- Exporter changes require Python test coverage as well
- No suppression flags (`/* c8 ignore */`, `@ts-ignore`, etc.) — fix the code structure instead
