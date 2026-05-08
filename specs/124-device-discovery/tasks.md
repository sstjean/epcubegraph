# Tasks: Automatic Device Discovery

**Input**: Design documents from `/specs/124-device-discovery/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Schema changes and shared infrastructure needed by all user stories

### Tests (Red)

- [ ] T001 Test `_read_discovery_interval_from_db()` in `local/epcube-exporter/test_exporter.py` — reads setting from DB, returns default 3600 when missing, validates range
- [ ] T002 [P] Test `PUT /settings/discovery_interval_seconds` in `api/tests/EpCubeGraph.Api.Tests/Integration/` — valid value accepted, out-of-range (< 60, > 86400) rejected, non-integer rejected

### Implementation (Green)

- [ ] T003 Add `status` column to `devices` table and `pending_replacements` table in exporter schema at `local/epcube-exporter/exporter.py` (`_SCHEMA_SQL`)
- [ ] T004 Add `pending_replacements` table schema to API `EnsureTablesAsync` in `api/src/EpCubeGraph.Api/Services/PostgresSettingsStore.cs`
- [ ] T005 [P] Add `discovery_interval_seconds` to the API settings allowed keys in `api/src/EpCubeGraph.Api/Endpoints/SettingsEndpoints.cs` (valid range 60–86400)
- [ ] T006 [P] Add merge request/response and pending replacement model records in `api/src/EpCubeGraph.Api/Models/Models.cs`
- [ ] T007 [P] Add `_read_discovery_interval_from_db()` function in `local/epcube-exporter/exporter.py` following existing `_read_poll_interval_from_db()` pattern (reads `discovery_interval_seconds`, default 3600)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Pure functions and core logic that multiple user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Tests (Red)

- [ ] T008 Test `compare_device_lists()` in `local/epcube-exporter/test_exporter.py` — cases: no changes, new device, removed device, simultaneous add+remove, empty cloud list, metadata change
- [ ] T009 Test `retry_with_backoff()` in `local/epcube-exporter/test_exporter.py` — cases: success on first try, success on retry, all retries exhausted, correct delay calculation
- [ ] T010 [P] Test `GET /devices?status=` filtering in `api/tests/EpCubeGraph.Api.Tests/Integration/` — cases: default returns active only, `?status=removed` returns removed only, `?status=all` returns all with status field

### Implementation (Green)

- [ ] T011 Implement `compare_device_lists(known_ids, cloud_devices)` pure function in `local/epcube-exporter/exporter.py` — returns `(added, removed, unchanged)` tuples
- [ ] T012 Implement `retry_with_backoff(fn, max_retries=5, base_delay=30)` pure function in `local/epcube-exporter/exporter.py` — exponential delays 30/60/120/240/480s
- [ ] T013 [P] Add `GetDevicesByStatusAsync(status)` method to `api/src/EpCubeGraph.Api/Services/PostgresMetricsStore.cs` — SQL filters `devices` by status column, defaults to `active`
- [ ] T014 [P] Modify `GET /devices` endpoint in `api/src/EpCubeGraph.Api/Endpoints/DevicesEndpoints.cs` to accept optional `?status=` query parameter (active/removed/merged/all), pass to `GetDevicesByStatusAsync()`

**Checkpoint**: Foundation ready — all tests green, pure functions tested, device filtering working

---

## Phase 3: User Story 1 — Automatic New Device Detection (Priority: P1) 🎯 MVP

**Goal**: Exporter discovers new devices hourly and begins polling them without restart

**Independent Test**: Simulate cloud API returning a new device ID. Verify exporter registers it and includes it in subsequent polls.

### Tests (Red) for User Story 1

- [ ] T015 [US1] Test new device detection in `local/epcube-exporter/test_exporter.py` — mock cloud API returning a new device, verify it's registered in DB, logged, and included in `self._devices`
- [ ] T016 [US1] Test discovery interval timing in `local/epcube-exporter/test_exporter.py` — verify discovery runs when interval elapses, does not run before interval, reads interval from DB each cycle
- [ ] T017 [US1] Test startup discovery in `local/epcube-exporter/test_exporter.py` — verify cloud-vs-DB comparison on first auth, new devices registered, changes logged
- [ ] T018 [US1] Test empty cloud device list guard (FR-007) in `local/epcube-exporter/test_exporter.py` — verify empty list is treated as error, current devices retained, warning logged

### Implementation (Green) for User Story 1

- [ ] T019 [US1] Implement `_read_known_device_ids_from_db()` in `local/epcube-exporter/exporter.py` — queries `devices` table for active EP Cube device IDs (raw cloud IDs, extracted from `epcube{id}_*` pattern)
- [ ] T020 [US1] Refactor `_discover_devices()` on `EpCubeCollector` in `local/epcube-exporter/exporter.py` to compare cloud list against known DB devices using `compare_device_lists()`, log additions, register new devices in DB with status `active`
- [ ] T021 [US1] Add discovery interval check to `poll_loop()` in `local/epcube-exporter/exporter.py` — read `discovery_interval_seconds` from DB, track `_last_discovery_time`, call `_discover_devices()` with `retry_with_backoff()` when interval elapsed
- [ ] T022 [US1] Implement startup discovery (FR-024) in `local/epcube-exporter/exporter.py` — on first `_ensure_auth()`, compare cloud device list against active devices in DB to catch changes during downtime

**Checkpoint**: Exporter discovers new devices hourly and on startup. New devices are polled automatically.

---

## Phase 4: User Story 2 — Removed Device Detection (Priority: P2)

**Goal**: Exporter detects removed devices, stops polling them, marks them as removed in DB

**Independent Test**: Simulate cloud API no longer returning a known device. Verify exporter stops polling it and logs the removal.

### Tests (Red) for User Story 2

- [ ] T023 [US2] Test removed device detection in `local/epcube-exporter/test_exporter.py` — mock cloud API no longer returning a known device, verify device removed from poll list, status updated in DB, logged
- [ ] T024 [US2] Test historical data preservation (FR-004) in `local/epcube-exporter/test_exporter.py` — verify readings and device records are NOT deleted when a device is removed

### Implementation (Green) for User Story 2

- [ ] T025 [US2] Add `update_device_status()` method to `PostgresWriter` in `local/epcube-exporter/exporter.py` — updates `devices.status` for both `_battery` and `_solar` sub-devices given a raw cloud device ID
- [ ] T026 [US2] Extend `_discover_devices()` in `local/epcube-exporter/exporter.py` to handle removed devices — call `update_device_status(id, 'removed')`, remove from `self._devices`, log removal event

**Checkpoint**: Exporter detects removed devices, stops polling them, marks status as `removed`.

---

## Phase 5: User Story 3 — Device Replacement Prompt & Manual Merge (Priority: P2)

**Goal**: Pending replacement prompts created on same-cycle add+remove; dashboard banner shows prompt; Settings page allows manual merge

**Independent Test**: (a) Simulate same-cycle removal+addition, verify pending replacement created and banner shown. (b) Navigate to Settings, select removed device, merge into active device.

### Exporter: Pending Replacement Creation

#### Tests (Red)

- [ ] T027 [US3] Test pending replacement creation in `local/epcube-exporter/test_exporter.py` — same-cycle add+remove creates record; add-only or remove-only does NOT create record; multiple removals+additions create one record per removed device

#### Implementation (Green)

- [ ] T028 [US3] Add `insert_pending_replacement()` method to `PostgresWriter` in `local/epcube-exporter/exporter.py` — inserts into `pending_replacements` table
- [ ] T029 [US3] Extend `_discover_devices()` in `local/epcube-exporter/exporter.py` to detect same-cycle removal+addition (FR-010) and call `insert_pending_replacement()` for each removed+added pair

### API: Pending Replacement & Dismiss Endpoints

#### Tests (Red)

- [ ] T030 [US3] Test pending replacements API endpoints in `api/tests/EpCubeGraph.Api.Tests/Integration/` — list returns pending records; dismiss deletes record and marks old device removed; dismiss on 404 returns error

#### Implementation (Green)

- [ ] T031 [P] [US3] Add `GetPendingReplacementsAsync()` method to `PostgresMetricsStore` in `api/src/EpCubeGraph.Api/Services/PostgresMetricsStore.cs` — queries `pending_replacements` table
- [ ] T032 [P] [US3] Add `DismissPendingReplacementAsync(id)` method to `PostgresMetricsStore` in `api/src/EpCubeGraph.Api/Services/PostgresMetricsStore.cs` — deletes record, marks old device as `removed`
- [ ] T033 [US3] Add `GET /devices/pending-replacements` and `POST /devices/pending-replacements/{id}/dismiss` endpoints in `api/src/EpCubeGraph.Api/Endpoints/DevicesEndpoints.cs`

### Dashboard: Replacement Banner

#### Tests (Red)

- [ ] T034 [P] [US3] Test `ReplacementBanner` component in `dashboard/tests/component/` — renders banner with device names, shows dropdown for multiple new devices, shows label for single, shows reading count from merge-preview, calls dismiss on No, shows Settings page message on dismiss
- [ ] T035 [P] [US3] Test `useDeviceDiscovery` hook in `dashboard/tests/unit/` — polls pending-replacements on 30s cycle, fetches merge-preview for each pending item to get reading counts, returns pending list with counts, handles empty list

#### Implementation (Green)

- [ ] T036 [US3] Add `fetchPendingReplacements()`, `dismissPendingReplacement(id)`, `fetchMergePreview(oldId, newId)` functions to `dashboard/src/api.ts`
- [ ] T037 [P] [US3] Create `ReplacementBanner.tsx` component in `dashboard/src/components/` — displays banner for each pending replacement, dropdown for multiple new devices (label if single), reading count from merge-preview, confirm/dismiss buttons
- [ ] T038 [P] [US3] Create `useDeviceDiscovery.ts` hook in `dashboard/src/hooks/` — polls `GET /devices/pending-replacements` on 30s cycle, calls `merge-preview` for each pending item to populate reading counts, provides pending list and action handlers
- [ ] T039 [US3] Mount `ReplacementBanner` in `dashboard/src/App.tsx` between `</nav>` and `<Router>`

### Dashboard: Settings Page Manual Merge UI

#### Tests (Red)

- [ ] T040 [US3] Test `DeviceMerge` component in `dashboard/tests/component/` — shows removed devices in source dropdown, active devices in target dropdown, shows confirmation dialog with reading count from merge-preview, calls merge API on confirm

#### Implementation (Green)

- [ ] T041 [US3] Add `fetchDevicesByStatus(status)` function to `dashboard/src/api.ts`
- [ ] T042 [US3] Create `DeviceMerge.tsx` component in `dashboard/src/components/` — select removed device first, then active target, confirmation dialog with reading count + irreversibility warning, merge button
- [ ] T043 [US3] Mount `DeviceMerge` section in Settings page in `dashboard/src/components/SettingsPage.tsx`

**Checkpoint**: Pending replacements flow end-to-end. Banner prompt and Settings page merge UI both functional.

---

## Phase 6: User Story 4 — Historical Data Merge (Priority: P3)

**Goal**: Merge API re-attributes readings from old to new device in a single transaction; dashboard shows success/error feedback

**Independent Test**: Create two devices with separate readings. Call merge API. Verify new device has all readings and old device is marked `merged`.

### API: Merge & Preview Endpoints

#### Tests (Red)

- [ ] T044 [US4] Test merge preview in `api/tests/EpCubeGraph.Api.Tests/Integration/` — returns correct counts for readings and conflicts; 404 for unknown devices; 422 for wrong status
- [ ] T045 [US4] Test merge execution in `api/tests/EpCubeGraph.Api.Tests/Integration/` — readings re-attributed for both sub-devices, conflicts discarded (new takes precedence), conflict count logged, `vue_device_mapping` key renamed, old device marked `merged`, pending replacement deleted, transaction rolls back on failure
- [ ] T046 [US4] Test merge atomicity in `api/tests/EpCubeGraph.Api.Tests/Integration/` — simulate failure mid-transaction, verify no partial changes

#### Implementation (Green)

- [ ] T047 [US4] Add `GetMergePreviewAsync(oldCloudId, newCloudId)` method to `PostgresMetricsStore` in `api/src/EpCubeGraph.Api/Services/PostgresMetricsStore.cs` — counts readings to transfer and conflicts to skip for both `_battery` and `_solar` sub-devices
- [ ] T048 [US4] Add `ExecuteMergeAsync(oldCloudId, newCloudId)` method to `PostgresMetricsStore` in `api/src/EpCubeGraph.Api/Services/PostgresMetricsStore.cs` — single transaction: validate statuses, delete conflicting old readings, UPDATE remaining old readings device_id, update `vue_device_mapping` JSON key, set old device status to `merged`, delete pending_replacement if exists
- [ ] T049 [US4] Add `GET /devices/merge-preview` and `POST /devices/merge` endpoints in `api/src/EpCubeGraph.Api/Endpoints/DevicesEndpoints.cs`

### Dashboard: Merge Feedback

#### Tests (Red)

- [ ] T050 [US4] Test merge success/error feedback in `dashboard/tests/component/` for both `ReplacementBanner` and `DeviceMerge` — success toast content, error toast content, banner removal on success, banner retention on failure

#### Implementation (Green)

- [ ] T051 [US4] Add `mergeDevices(oldId, newId)` function to `dashboard/src/api.ts`
- [ ] T052 [US4] Wire merge confirm in `ReplacementBanner.tsx` — call merge API, show success toast with summary (device names, reading count, conflict count), remove banner on success; show error toast and keep banner on failure
- [ ] T053 [US4] Wire merge confirm in `DeviceMerge.tsx` — call merge API, show success toast, reset form on success; show error toast on failure

**Checkpoint**: End-to-end merge flow works. Readings re-attributed, charts show continuous timeline.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Removed device visibility toggle, edge case coverage, cleanup

### Tests (Red)

- [ ] T054 [P] Test removed-device toggle in `dashboard/tests/component/` — toggle visible only when removed devices exist, defaults to true, persists in localStorage, grayed-out styling applied, hidden when toggled off
- [ ] T055 Test discovery retry with backoff integration in `local/epcube-exporter/test_exporter.py` — verify `_discover_devices()` uses `retry_with_backoff()`, retries on network error, gives up after 5 attempts
- [ ] T056 Test metadata update for unchanged devices in `local/epcube-exporter/test_exporter.py` — verify `upsert_device()` called for unchanged devices (alias/metadata may have changed)
- [ ] T057 Test chained merge scenario in `api/tests/EpCubeGraph.Api.Tests/Integration/` — device A merged into B, then B gets replaced by C, verify merge B→C works and includes A's original readings

### Implementation (Green)

- [ ] T058 [P] Add removed-device visibility toggle to dashboard — localStorage key `showRemovedDevices`, default `true`, toggle visible only when removed devices exist, grayed-out styling in `dashboard/src/app.css`
- [ ] T059 [P] Implement toggle logic in `dashboard/src/components/CurrentReadings.tsx` — fetch removed devices when toggle is on, apply grayed-out CSS class
- [ ] T060 Run `specs/124-device-discovery/quickstart.md` validation against local stack

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (schema must exist)
- **US1 (Phase 3)**: Depends on Phase 2 (pure functions, device filtering)
- **US2 (Phase 4)**: Depends on Phase 2. Can run in parallel with US1.
- **US3 (Phase 5)**: Depends on Phase 2 (device filtering). Exporter tasks depend on US2 (removal logic). API/dashboard tasks can start after Phase 2.
- **US4 (Phase 6)**: Depends on US3 (endpoints structure). Core merge logic is independent.
- **Polish (Phase 7)**: Depends on US1 + US2 (for toggle), US4 (for chained merge test)

### User Story Dependencies

- **US1 (P1)**: Independent after Phase 2 — delivers MVP (new device detection)
- **US2 (P2)**: Independent after Phase 2 — can parallel with US1
- **US3 (P2)**: Exporter part needs US2 removal logic; API/dashboard part independent after Phase 2
- **US4 (P3)**: Needs US3 endpoint structure for merge endpoint; core merge logic is self-contained

### Within Each User Story

- Tests MUST be written FIRST and confirmed to FAIL before implementation (Red-Green-Refactor)
- Exporter → API → Dashboard (data flows upstream to downstream)
- Models before services before endpoints

### Parallel Opportunities per Phase

**Phase 1**: T003, T004, T005 can run in parallel
**Phase 2**: T010, T011 can run in parallel with T006–T009 (different codebases)
**Phase 5**: T028, T029 parallel; T032, T033 parallel; exporter/API/dashboard tracks can overlap
**Phase 7**: T052, T053, T054 parallel with T055, T056

---

## Implementation Strategy

### MVP (Phase 1 + 2 + 3)
Delivers User Story 1 — automatic new device detection. The exporter discovers new devices hourly and on startup, registers them, and begins polling. This alone prevents the data loss that triggered this feature.

### Increment 2 (+ Phase 4)
Adds removed device detection. Exporter stops polling removed devices and marks them in DB.

### Increment 3 (+ Phase 5)
Adds replacement prompts (banner + Settings page). Users can see pending replacements and trigger merges.

### Increment 4 (+ Phase 6)
Adds the merge transaction. Historical data is re-attributed for a seamless timeline.

### Increment 5 (+ Phase 7)
Polish: removed device toggle, edge case coverage, quickstart validation.
