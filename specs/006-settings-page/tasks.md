# Tasks: Dashboard Settings Page

**Input**: Design documents from `/specs/006-settings-page/`
**Prerequisites**: plan.md, spec.md
**GitHub Issues**: #82 (US1 P1), #83 (US2 P2), #84 (US3 P3)

**Tests**: Included — constitution mandates TDD with 100% code coverage.
**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story (US1, US2, US3) this task belongs to
- Exact file paths included in all descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Shared models and types

- [ ] T002 [P] Create Settings models in api/src/EpCubeGraph.Api/Models/Settings.cs: SettingEntry (key, value, lastModified), PanelHierarchyEntry (id, parentDeviceGid, childDeviceGid), DisplayNameOverride (id, deviceGid, channelNumber, displayName)
- [ ] T003 [P] Create settings types in dashboard/src/types.ts: SettingEntry, PanelHierarchyEntry, DisplayNameOverride, matching API response shapes

---

## Phase 2: User Story 1 — Polling Intervals (#82, P1)

**Goal**: View and modify polling intervals for EP Cube and Vue exporters from the Settings page.

### Tests (TDD)

- [ ] T004 [P] [US1] Write SettingsService unit tests in api/tests/EpCubeGraph.Api.Tests/Unit/SettingsServiceTests.cs: GetAllSettings returns key-value pairs, GetSetting returns single value, UpdateSetting persists new value and updates last_modified, UpdateSetting with invalid key returns error, GetAllSettings returns empty when no rows exist
- [ ] T005 [P] [US1] Write settings API integration tests in api/tests/EpCubeGraph.Api.Tests/Integration/SettingsEndpointsTests.cs: GET /api/v1/settings returns all settings, PUT /api/v1/settings/{key} updates value, PUT with invalid value returns 400, PUT with value outside bounds (min 1, max 3600) returns 400, all endpoints return 401 without auth
- [ ] T006 [P] [US1] Write polling intervals component tests in dashboard/tests/component/SettingsPage.test.tsx: renders polling interval inputs with current values, validates min/max bounds, shows error for invalid input, saves successfully and shows success message, displays fallback defaults when no DB rows exist
- [ ] T007 [P] [US1] Write exporter settings read tests in local/epcube-exporter/test_exporter.py: reads poll interval from settings table, falls back to default (30s) when no row exists, falls back to default on DB read error

### Implementation

- [ ] T008 [US1] Implement SettingsService in api/src/EpCubeGraph.Api/Services/SettingsService.cs: GetAllSettings, GetSetting, UpdateSetting with Npgsql. Table auto-created if not exists. Validates polling interval bounds (1-3600).
- [ ] T009 [US1] Implement settings endpoints in api/src/EpCubeGraph.Api/Endpoints/SettingsEndpoints.cs: GET /api/v1/settings, PUT /api/v1/settings/{key}. Wire into Program.cs with auth.
- [ ] T010 [US1] Implement polling intervals section in dashboard/src/components/SettingsPage.tsx: number inputs for epcube_poll_interval_seconds (editable) and vue_poll_interval_seconds (disabled, labeled "Coming in Feature 005"), independent Save button, validation (1-3600), success message on save.
- [ ] T011 [US1] Add settings API functions to dashboard/src/api.ts: fetchSettings(), updateSetting(key, value)
- [ ] T012 [US1] Add /settings route to dashboard/src/App.tsx with gear icon + "Settings" nav link
- [ ] T013 [US1] Modify local/epcube-exporter/exporter.py: read epcube_poll_interval_seconds from settings table on each poll cycle, fallback to 30s default

---

## Phase 3: User Story 2 — Panel Hierarchy (#83, P2)

**Goal**: Manage parent-child panel relationships from the Settings page for deduplication.

### Tests (TDD)

- [ ] T014 [P] [US2] Write hierarchy service tests in api/tests: GetHierarchy returns entries, UpdateHierarchy replaces all entries, UpdateHierarchy rejects circular references (A→B→A), UpdateHierarchy rejects self-reference (A→A), DeleteHierarchy removes all entries
- [ ] T015 [P] [US2] Write hierarchy API integration tests: GET /api/v1/settings/hierarchy returns entries, PUT /api/v1/settings/hierarchy replaces hierarchy, PUT with circular reference returns 400, all endpoints return 401 without auth
- [ ] T016 [P] [US2] Write hierarchy section component tests in dashboard/tests/component/SettingsPage.test.tsx: renders current hierarchy as parent-child list, add new relationship, remove relationship, shows error for circular reference, saves independently with success message

### Implementation

- [ ] T017 [US2] Implement hierarchy methods in SettingsService: GetHierarchy, UpdateHierarchy (replace-all with cycle detection), table auto-created if not exists
- [ ] T018 [US2] Implement hierarchy endpoints: GET /api/v1/settings/hierarchy, PUT /api/v1/settings/hierarchy. Wire into Program.cs with auth.
- [ ] T019 [US2] Implement hierarchy section in SettingsPage.tsx: list of parent→child entries, add/remove controls, cycle validation on client side, independent Save button, success message
- [ ] T020 [US2] Add hierarchy API functions to dashboard/src/api.ts: fetchHierarchy(), updateHierarchy(entries)

---

## Phase 4: User Story 3 — Display Names (#84, P3)

**Goal**: Override device and circuit names from the Settings page.

### Tests (TDD)

- [ ] T021 [P] [US3] Write display name service tests in api/tests: GetDisplayNames returns overrides, UpdateDisplayName creates/updates override, DeleteDisplayName removes override and reverts to default, GetDisplayNames returns empty when no overrides
- [ ] T022 [P] [US3] Write display name API integration tests: GET /api/v1/settings/display-names returns overrides, PUT /api/v1/settings/display-names/{device_gid} updates names, DELETE clears override, all endpoints return 401 without auth
- [ ] T023 [P] [US3] Write display names section component tests in dashboard/tests/component/SettingsPage.test.tsx: renders device/circuit list with current names (override or default), edit name and save, clear override reverts to default, saves independently with success message

### Implementation

- [ ] T024 [US3] Implement display name methods in SettingsService: GetDisplayNames, UpdateDisplayName, DeleteDisplayName, table auto-created if not exists
- [ ] T025 [US3] Implement display name endpoints: GET /api/v1/settings/display-names, PUT /api/v1/settings/display-names/{device_gid}, DELETE /api/v1/settings/display-names/{device_gid}/{channel_number}. Wire into Program.cs with auth.
- [ ] T026 [US3] Implement display names section in SettingsPage.tsx: device/circuit list from DB-discovered data, editable name fields, save per device, clear button to revert, success message
- [ ] T027 [US3] Add display name API functions to dashboard/src/api.ts: fetchDisplayNames(), updateDisplayName(deviceGid, names), clearDisplayName(deviceGid, channelNumber)

---

## Phase 5: Polish and Cross-Cutting Concerns

- [ ] T028 [P] Accessibility: keyboard navigation on Settings page, ARIA labels on form fields, focus styles, touch targets (44px minimum on all buttons/inputs)
- [ ] T029 [P] Error handling: API errors shown inline per section, network failure recovery
- [ ] T030 Run full test suite: dashboard typecheck + test:coverage (100%), API dotnet test (100%), exporter pytest. Verify performance: settings page load < 500ms (SC-002)
- [ ] T031 Run quickstart validation: npm run build, terraform validate, terraform fmt -check

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1. Setup | 2 | Models + types |
| 2. US1 Polling (#82) | 10 | Tests + API + dashboard + exporter |
| 3. US2 Hierarchy (#83) | 7 | Tests + API + dashboard |
| 4. US3 Display Names (#84) | 7 | Tests + API + dashboard |
| 5. Polish | 4 | Accessibility, errors, validation |
| **Total** | **30** | |
