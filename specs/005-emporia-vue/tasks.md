# Tasks: Emporia Vue Energy Monitoring Integration

**Input**: Design documents from `/specs/005-emporia-vue/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-v1-vue.md, quickstart.md

**Tests**: Required — constitution mandates TDD with 100% coverage.

**Organization**: Tasks grouped by user story. US1 (ingest) → US2 (deduplication) → US3 (API). Dashboard visualization is out of scope (Feature 007).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths included in descriptions

---

## Phase 1: Setup

**Purpose**: Add pyemvue dependency, update Docker Compose, create requirements.txt, update Terraform

- [ ] T001 Create `local/epcube-exporter/requirements.txt` pinning all exporter dependencies (opencv-python-headless, pycryptodome, numpy, PyJWT[crypto], psycopg2-binary, pyemvue)
- [ ] T002 Update `local/epcube-exporter/Dockerfile` to install from requirements.txt instead of inline pip install, adding pyemvue
- [ ] T003 [P] Update `local/docker-compose.prod-local.yml` to add EMPORIA_USERNAME and EMPORIA_PASSWORD env vars to epcube-exporter service
- [ ] T004 [P] Update `local/.env.example` to add EMPORIA_USERNAME and EMPORIA_PASSWORD placeholder entries

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Flexible credential startup, Vue schema creation, Vue PostgreSQL writer — all stories depend on these

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T005 Add tests for flexible credential startup logic in `local/epcube-exporter/test_exporter.py` — test: both creds → both collectors start; only EP Cube creds → only EP Cube starts with Vue warning; only Vue creds → only Vue starts with EP Cube warning; neither → exit with error
- [ ] T006 Refactor `main()` in `local/epcube-exporter/exporter.py` to support flexible credential startup — EP Cube and Vue collectors start independently based on which credentials are configured; exit with error if neither set is provided (FR-002)
- [ ] T007 Add tests for Vue schema creation (vue_devices, vue_channels, vue_readings, vue_readings_1min tables and indexes) in `local/epcube-exporter/test_exporter.py`
- [ ] T008 Implement VuePostgresWriter class in `local/epcube-exporter/exporter.py` with `_ensure_vue_schema()` to auto-create vue_devices, vue_channels, vue_readings, vue_readings_1min tables per data-model.md schema
- [ ] T009 Add tests for VuePostgresWriter.upsert_device() and upsert_channel() methods in `local/epcube-exporter/test_exporter.py` — test insert, update, and name conflict flagging
- [ ] T010 Implement VuePostgresWriter.upsert_device() and upsert_channel() in `local/epcube-exporter/exporter.py` — upsert device metadata from PyEmVue get_devices(); upsert channel metadata with name conflict detection when display_name_overrides exist
- [ ] T011 Add tests for VuePostgresWriter.write_readings() in `local/epcube-exporter/test_exporter.py` — test batch insert, dedup on conflict, None/null value skipping, negative value storage
- [ ] T012 Implement VuePostgresWriter.write_readings() in `local/epcube-exporter/exporter.py` — batch insert readings with ON CONFLICT upsert, skip None values, store negative values as-is (FR-004)

**Checkpoint**: Foundation ready — Vue tables exist, writer can persist data, credentials are flexible

---

## Phase 3: User Story 1 — Ingest Vue Circuit Data (Priority: P1) 🎯 MVP

**Goal**: Exporter polls Emporia Vue API, authenticates, retrieves per-circuit power readings in Watts, writes to PostgreSQL, shows status on debug page

**Independent Test**: Debug page shows Vue status (devices, circuits, errors). PostgreSQL has vue_readings rows. Data is <2 minutes old.

### Tests for User Story 1

- [ ] T013 [P] [US1] Add tests for VueCollector initialization and PyEmVue login in `local/epcube-exporter/test_exporter.py` — test successful login, login failure retry on next cycle, mock PyEmVue
- [ ] T014 [P] [US1] Add tests for VueCollector.poll() in `local/epcube-exporter/test_exporter.py` — test: calls get_device_list_usage with all GIDs, unit=Watts, scale=1S, max_retry_attempts=1; writes results to VuePostgresWriter; skips None channels for offline devices; handles per-device errors without stopping (FR-003, FR-005)
- [ ] T015 [P] [US1] Add tests for Vue device/channel discovery refresh in `local/epcube-exporter/test_exporter.py` — test: calls get_devices() on startup and every N seconds (configurable, default 30min); upserts device and channel metadata; reads refresh interval from settings table (FR-003a)
- [ ] T016 [P] [US1] Add tests for Vue poll interval reading from settings table in `local/epcube-exporter/test_exporter.py` — test: reads `vue_poll_interval` key from settings table each cycle; defaults to 1s if not set; uses value from DB when set (FR-001)
- [ ] T017 [P] [US1] Add tests for rate limit fallback (1S → 1MIN scale degradation) in `local/epcube-exporter/test_exporter.py` — test: detects 429 or all-None responses; degrades to 1MIN; recovers to 1S after N successful polls (FR-001)
- [ ] T018 [P] [US1] Add tests for Vue debug page status section in `local/epcube-exporter/test_exporter.py` — test: HTML contains Vue section with last poll time, device count, circuit count, per-device online/error status, countdown (FR-006)

### Implementation for User Story 1

- [ ] T019 [US1] Implement VueCollector class in `local/epcube-exporter/exporter.py` — PyEmVue login, device discovery, poll loop state (last_poll, device_count, circuit_count, errors, scale, interval)
- [ ] T020 [US1] Implement VueCollector.poll() in `local/epcube-exporter/exporter.py` — call get_device_list_usage(gids, unit=Watts, scale=current_scale, max_retry_attempts=1); iterate channels; skip None; write to VuePostgresWriter; per-device error handling (FR-003, FR-005)
- [ ] T021 [US1] Implement device/channel discovery refresh in VueCollector in `local/epcube-exporter/exporter.py` — call get_devices() on startup then periodically (interval from settings table, default 30min); upsert to vue_devices and vue_channels; detect name conflicts with display_name_overrides (FR-003a)
- [ ] T022 [US1] Implement vue_poll_loop() function in `local/epcube-exporter/exporter.py` — background daemon thread reading interval from settings table each cycle, calling VueCollector.poll(), updating countdown state (FR-001)
- [ ] T023 [US1] Implement rate limit fallback in VueCollector in `local/epcube-exporter/exporter.py` — detect rate limiting (429/all-None), degrade 1S→1MIN, log event, auto-recover after consecutive successes (FR-001)
- [ ] T024 [US1] Implement structured logging for Vue operations in `local/epcube-exporter/exporter.py` — auth failures, API connectivity errors, per-device polling errors (FR-015)
- [ ] T025 [US1] Extend MetricsHandler debug page in `local/epcube-exporter/exporter.py` to add Vue status section — last poll time, device count (online/offline), circuit count, per-device status, current scale, countdown to next poll (FR-006)
- [ ] T026 [US1] Wire VueCollector into main() in `local/epcube-exporter/exporter.py` — create VueCollector when EMPORIA_USERNAME/PASSWORD present; start vue_poll_loop daemon thread; pass collector to MetricsHandler for debug page

**Checkpoint**: Exporter polls Vue API, writes circuit data to PostgreSQL, debug page shows Vue status

---

## Phase 4: User Story 1 — Downsampling (Priority: P1 continued)

**Goal**: Automatic 1-minute downsampling and 7-day raw data retention

**Independent Test**: After 1+ hours, vue_readings_1min has aggregated rows. After 7+ days, old vue_readings rows are deleted.

### Tests for Downsampling

- [ ] T027 [P] [US1] Add tests for downsampling job in `local/epcube-exporter/test_exporter.py` — test: aggregates vue_readings into vue_readings_1min (avg value, sample_count) per device_gid+channel_num+minute; idempotent (re-running doesn't duplicate); uses America/New_York timezone for day boundaries (FR-016)
- [ ] T028 [P] [US1] Add tests for raw data retention cleanup in `local/epcube-exporter/test_exporter.py` — test: deletes vue_readings rows older than 7 days; does not delete vue_readings_1min rows

### Implementation for Downsampling

- [ ] T029 [US1] Implement downsample_vue_readings() in `local/epcube-exporter/exporter.py` — INSERT INTO vue_readings_1min SELECT avg(value), count(*) FROM vue_readings GROUP BY device_gid, channel_num, date_trunc('minute', timestamp) for the last complete hour; ON CONFLICT update (FR-016)
- [ ] T030 [US1] Implement cleanup_old_vue_readings() in `local/epcube-exporter/exporter.py` — DELETE FROM vue_readings WHERE timestamp < NOW() - INTERVAL '7 days' (FR-016)
- [ ] T031 [US1] Implement downsampling_loop() in `local/epcube-exporter/exporter.py` — third daemon thread running downsample + cleanup every hour; wire into main()

**Checkpoint**: US1 complete — data pipeline runs end-to-end with automatic retention management

---

## Phase 5: User Story 2 — Deduplicate Nested Panel Measurements (Priority: P2)

**Goal**: API computes deduplicated panel totals at query time using panel_hierarchy; computes total home from top-level panels

**Independent Test**: GET /vue/panels/{gid}/total returns raw and deduplicated totals. raw - sum(children) = deduplicated. GET /vue/home/total returns sum of top-level panels.

### Tests for User Story 2

- [ ] T032 [P] [US2] Add unit tests for deduplication logic in `api/tests/EpCubeGraph.Api.Tests/Unit/VueEndpointsTests.cs` — test: parent_unique = parent_raw - sum(child_raw); panel with no children returns raw == deduplicated; handles missing child data gracefully
- [ ] T033 [P] [US2] Add unit tests for total home computation in `api/tests/EpCubeGraph.Api.Tests/Unit/VueEndpointsTests.cs` — test: total = sum of all panels with no parent in hierarchy; handles empty hierarchy; handles single top-level panel
- [ ] T034 [P] [US2] Add integration tests for deduplication queries against PostgreSQL in `api/tests/EpCubeGraph.Api.Tests/Integration/VueStoreTests.cs` — test: inserts hierarchy + readings, verifies deduplicated totals via SQL

### Implementation for User Story 2

- [ ] T035 [US2] Implement GetPanelTotalAsync() in `api/src/EpCubeGraph.Api/Services/PostgresVueStore.cs` — query mains channel (1,2,3) for parent, subtract children's mains using panel_hierarchy join (FR-008)
- [ ] T036 [US2] Implement GetPanelTotalRangeAsync() in `api/src/EpCubeGraph.Api/Services/PostgresVueStore.cs` — time-series version with auto-resolution step selection, join against hierarchy for deduplicated series (FR-008)
- [ ] T037 [US2] Implement GetHomeTotalAsync() in `api/src/EpCubeGraph.Api/Services/PostgresVueStore.cs` — sum mains of all panels with no parent in panel_hierarchy (FR-008a)
- [ ] T038 [US2] Implement GetHomeTotalRangeAsync() in `api/src/EpCubeGraph.Api/Services/PostgresVueStore.cs` — time-series version of total home with auto-resolution (FR-008a)
- [ ] T039 [US2] Add panel total and home total endpoints to `api/src/EpCubeGraph.Api/Endpoints/VueEndpoints.cs` — GET /vue/panels/{deviceGid}/total, GET /vue/panels/{deviceGid}/total/range, GET /vue/home/total, GET /vue/home/total/range (FR-010)

**Checkpoint**: US2 complete — panel deduplication and total home work, verifiable via API

---

## Phase 6: User Story 3 — Expose Vue Data Through API (Priority: P3)

**Goal**: Full CRUD-read API for Vue devices, channels, current readings, and time-series range queries with smart auto-resolution

**Independent Test**: GET /vue/devices returns all devices with channels. GET /vue/devices/{gid}/readings/current returns latest per-channel. GET /vue/devices/{gid}/readings/range returns time-series with correct step.

### Tests for User Story 3

- [ ] T040 [P] [US3] Add Vue response model types in `api/src/EpCubeGraph.Api/Models/Vue.cs` — VueDeviceChannel, VueDeviceInfo, VueDevicesResponse, VueChannelReading, VueCurrentReadingsResponse, VueChannelSeries, VueRangeReadingsResponse, PanelChild, PanelTotalResponse, PanelTotalRangeResponse, HomeTotalResponse, HomeTotalRangeResponse per contracts/api-v1-vue.md
- [ ] T041 [P] [US3] Add IVueStore interface in `api/src/EpCubeGraph.Api/Services/IVueStore.cs` — GetDevicesAsync, GetCurrentReadingsAsync, GetRangeReadingsAsync, GetPanelTotalAsync, GetPanelTotalRangeAsync, GetHomeTotalAsync, GetHomeTotalRangeAsync
- [ ] T042 [P] [US3] Add unit tests for VueEndpoints in `api/tests/EpCubeGraph.Api.Tests/Unit/VueEndpointsTests.cs` — test: GET /vue/devices returns device list with channels and display names; GET /vue/devices/{gid}/readings/current returns latest per-channel; 404 for unknown device; auth required (FR-009, FR-013)
- [ ] T043 [P] [US3] Add unit tests for auto-resolution step selection in `api/tests/EpCubeGraph.Api.Tests/Unit/VueEndpointsTests.cs` — test all 8 tiers: ≤30min→1s, 30min–2hr→5s, 2–8hr→15s, 8–24hr→1m, 1–7d→5m, 7–30d→15m, 30–90d→1h, >90d→4h; explicit step overrides auto
- [ ] T044 [P] [US3] Add integration tests for Vue store queries in `api/tests/EpCubeGraph.Api.Tests/Integration/VueStoreTests.cs` — test: device listing with display name resolution; current readings query; range query with aggregation; auto-select raw vs 1-min table based on age
- [ ] T045 [P] [US3] Add integration tests for display name resolution in `api/tests/EpCubeGraph.Api.Tests/Integration/VueStoreTests.cs` — test: override takes priority over channel.name; Balance channel defaults to "Unmonitored loads"; fallback chain: override → channel name → channel_num

### Implementation for User Story 3

- [ ] T046 [US3] Implement PostgresVueStore.GetDevicesAsync() in `api/src/EpCubeGraph.Api/Services/PostgresVueStore.cs` — join vue_devices + vue_channels + display_name_overrides; resolve display names with fallback chain; Balance → "Unmonitored loads" default
- [ ] T047 [US3] Implement PostgresVueStore.GetCurrentReadingsAsync() in `api/src/EpCubeGraph.Api/Services/PostgresVueStore.cs` — latest reading per channel for a device using DISTINCT ON
- [ ] T048 [US3] Implement auto-resolution step selection helper in `api/src/EpCubeGraph.Api/Services/PostgresVueStore.cs` — compute step from range width using 8-tier lookup; select source table (vue_readings vs vue_readings_1min) based on data age
- [ ] T049 [US3] Implement PostgresVueStore.GetRangeReadingsAsync() in `api/src/EpCubeGraph.Api/Services/PostgresVueStore.cs` — time-series query with aggregation to selected step; seamlessly join raw and 1-min tables when range spans 7-day boundary
- [ ] T050 [US3] Register PostgresVueStore as IVueStore in `api/src/EpCubeGraph.Api/Program.cs`
- [ ] T051 [US3] Implement VueEndpoints.MapVueEndpoints() in `api/src/EpCubeGraph.Api/Endpoints/VueEndpoints.cs` — GET /vue/devices, GET /vue/devices/{gid}/readings/current, GET /vue/devices/{gid}/readings/range with auth (FR-009, FR-013)
- [ ] T052 [US3] Register Vue endpoints in `api/src/EpCubeGraph.Api/Program.cs` — v1.MapVueEndpoints()

**Checkpoint**: US3 complete — full Vue API operational, all endpoints authenticated, auto-resolution working

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Infrastructure-as-code, final validation, documentation

- [ ] T053 [P] Update `infra/container-apps.tf` to add Emporia Key Vault secrets and environment variables (EMPORIA_USERNAME, EMPORIA_PASSWORD) to the exporter Container App
- [ ] T054 [P] Update `infra/keyvault.tf` to add azurerm_key_vault_secret resources for emporia-username and emporia-password
- [ ] T055 [P] Update `infra/variables.tf` and `infra/terraform.tfvars.example` with Emporia credential variable definitions
- [ ] T056 Run `cd local && docker compose -f docker-compose.prod-local.yml up -d --build` and verify Vue data appears in PostgreSQL within 2 minutes (quickstart.md validation)
- [ ] T057 Run `cd api && dotnet test EpCubeGraph.sln` and verify 100% coverage on all new code
- [ ] T058 Run `cd local/epcube-exporter && python -m pytest test_exporter.py -v` and verify all exporter tests pass
- [ ] T059 Run `cd infra && terraform validate` to verify Terraform changes are valid

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — can start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 (Dockerfile/requirements)
- **Phase 3 (US1 Ingest)**: Depends on Phase 2 (VuePostgresWriter, flexible credentials)
- **Phase 4 (US1 Downsampling)**: Depends on Phase 3 (VueCollector writes readings)
- **Phase 5 (US2 Deduplication)**: Depends on Phase 2 (schema exists); can run in parallel with US1 implementation
- **Phase 6 (US3 API)**: Depends on Phase 2 (schema); T040-T041 (models/interface) can start in parallel with US1/US2
- **Phase 7 (Polish)**: T053-T055 (Terraform) can run anytime; T056-T058 (validation) depend on all implementation

### User Story Dependencies

- **US1 (P1 — Ingest)**: Depends on Phase 2 only. Can be delivered as standalone MVP.
- **US2 (P2 — Deduplication)**: Depends on Phase 2. Can be developed in parallel with US1 since it queries existing panel_hierarchy table and Vue data tables.
- **US3 (P3 — API)**: Models/interface (T040-T041) have no dependencies. Store implementation depends on schema (Phase 2). Endpoints depend on store.

### Within Each User Story

- Tests MUST be written and FAIL before implementation (TDD)
- Models → Interface → Store → Endpoints (API stories)
- VuePostgresWriter → VueCollector → poll_loop → main() wiring (exporter stories)

### Parallel Opportunities

Within US1 (exporter):
- T013, T014, T015, T016, T017, T018 — all test tasks can run in parallel
- T027, T028 — downsampling tests can run in parallel

Within US2 (API deduplication):
- T032, T033, T034 — all test tasks can run in parallel

Within US3 (API):
- T040, T041 — models and interface can run in parallel with everything
- T042, T043, T044, T045 — all test tasks can run in parallel

Cross-story:
- US2 tests (T032-T034) can run in parallel with US1 implementation (T019-T026)
- US3 models/interface (T040-T041) can run in parallel with US1
- Terraform (T053-T055) can run anytime

---

## Implementation Strategy

**MVP**: Phase 1 + Phase 2 + Phase 3 (US1 Ingest) — delivers the data pipeline. Vue data flows into PostgreSQL, debug page shows status. No API yet, but data is accumulating.

**Incremental delivery**:
1. US1 (Phases 1-4): Data pipeline + downsampling — ~35 tasks
2. US2 (Phase 5): Deduplication via API — ~8 tasks
3. US3 (Phase 6): Full API surface — ~13 tasks
4. Polish (Phase 7): IaC + validation — ~7 tasks

**Suggested MVP scope**: US1 only (Phases 1-4). This delivers the core value — circuit data flowing into PostgreSQL — and enables Feature 007 dashboard work to begin reading from the database directly while the API is built.
