# Tasks: Remove Vestigial /metrics Endpoint

**Input**: Design documents from `/specs/093-remove-vestigial-metrics/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md

**Tests**: TDD required per Constitution §IV. Tests written before implementation.

**Organization**: Tasks grouped by user story (US1, US2, US3) to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Create branch, verify baseline

- [x] T001 Verify baseline: run exporter tests (`cd local/epcube-exporter && python -m pytest test_exporter.py`) and confirm 177 pass
- [x] T002 [P] Verify baseline: run API tests (`cd api && dotnet test`) and confirm 391 pass

**Checkpoint**: All existing tests pass before any changes.

---

## Phase 2: US1 — Remove /metrics from Exporter (Priority: P1)

**Goal**: Exporter stops serving `/metrics`, removes all Prometheus text generation, keeps PostgreSQL writes and debug UI.

**Independent Test**: `GET /metrics` returns 404. `GET /health` returns 200. PostgreSQL receives readings. All exporter tests pass at 100% coverage.

### Tests for US1 (TDD — write first, verify they fail)

- [x] T003 [US1] Add test `test_metrics_returns_404` asserting `GET /metrics` returns 404 in `local/epcube-exporter/test_exporter.py`
- [x] T004 [US1] Add test `test_status_page_no_metrics_link` asserting rendered status HTML does not contain `/metrics` in `local/epcube-exporter/test_exporter.py`
- [x] T005 [US1] Add test `test_poll_no_metrics_text_attribute` asserting `EpCubeCollector` has no `_metrics_text` attribute after `poll()` in `local/epcube-exporter/test_exporter.py`
- [x] T006 [US1] Run tests and confirm T003–T005 FAIL (Red phase)

### Implementation for US1

- [x] T007 [US1] Remove `_metrics_text` field from `EpCubeCollector.__init__()` in `local/epcube-exporter/exporter.py`
- [x] T008 [US1] Remove `get_metrics()` method from `EpCubeCollector` in `local/epcube-exporter/exporter.py`
- [x] T009 [US1] Remove Prometheus label construction (`bat_labels`, `sol_labels`, `bl`, `sl`) and all `lines.append(...)` blocks from `poll()` in `local/epcube-exporter/exporter.py`
- [x] T010 [US1] Remove `lines` list, `"\n".join(lines)` assignment, and `self._metrics_text =` write from `poll()` in `local/epcube-exporter/exporter.py`
- [x] T011 [US1] Remove `/metrics` handler block from `do_GET()` in `local/epcube-exporter/exporter.py`
- [x] T012 [US1] Remove `/metrics` nav link from `_render_status_page()` in `local/epcube-exporter/exporter.py`
- [x] T013 [US1] Rename `METRICS_PORT` → `HTTP_PORT` and update all references in `local/epcube-exporter/exporter.py`
- [x] T014 [US1] Update module docstring — remove Prometheus/VictoriaMetrics/`:9250/metrics` references in `local/epcube-exporter/exporter.py`
- [x] T015 [US1] Update `EpCubeCollector` class docstring — remove "produces Prometheus metrics" in `local/epcube-exporter/exporter.py`
- [x] T016 [US1] Update `main()` log message from `"Serving metrics on :%d/metrics"` → `"Serving on :%d"` in `local/epcube-exporter/exporter.py`

### Test Cleanup for US1

- [x] T017 [US1] Remove `TestPrometheusMetrics` class (~140 lines) from `local/epcube-exporter/test_exporter.py`
- [x] T018 [US1] Remove `test_metrics_returns_200` and `test_metrics_no_auth_required` from `TestHTTPHandler` in `local/epcube-exporter/test_exporter.py`
- [x] T019 [US1] Remove `self.collector._metrics_text = ...` from `TestHTTPHandler.setUp` in `local/epcube-exporter/test_exporter.py`
- [x] T020 [US1] Replace `_metrics_text` assertions in `TestPollWithPostgres` with assertions on snapshot/history or PostgreSQL writes in `local/epcube-exporter/test_exporter.py`
- [x] T021 [US1] Run exporter tests and confirm all pass at 100% coverage (Green phase)

**Checkpoint**: Exporter tests pass. `GET /metrics` → 404. PostgreSQL writes unchanged.

---

## Phase 3: US2 — Remove Prometheus Code from Mock Exporter (Priority: P2)

**Goal**: Mock-exporter removes `_generate_metrics()`, `_labels()`, `/metrics` handler. Serves `/health`. PostgreSQL write loop unchanged.

**Independent Test**: Mock-exporter starts, writes to PostgreSQL, `GET /health` returns 200, `GET /metrics` returns 404.

### Implementation for US2

- [x] T022 [US2] Remove `_labels()` helper function from `local/mock-exporter/metrics_server.py`
- [x] T023 [US2] Remove `_generate_metrics()` function (~130 lines) from `local/mock-exporter/metrics_server.py`
- [x] T024 [US2] Replace `MetricsHandler` with a handler serving `/health` (200 OK) and 404 for all other paths in `local/mock-exporter/metrics_server.py`
- [x] T025 [US2] Update module docstring — describe as "Mock data generator, writes to PostgreSQL" in `local/mock-exporter/metrics_server.py`
- [x] T026 [US2] Update `main` block log message and server startup in `local/mock-exporter/metrics_server.py`
- [x] T027 [US2] Update comment "Track cumulative counters across scrapes" → "across write cycles" in `local/mock-exporter/metrics_server.py`
- [x] T028 [US2] Update comment "assume 60s scrape interval" → "assume 60s write interval" in `local/mock-exporter/metrics_server.py`

**Checkpoint**: Mock-exporter code is clean. No Prometheus references remain in `local/mock-exporter/`.

---

## Phase 4: US3 — Purge All Prometheus/VictoriaMetrics References (Priority: P3)

**Goal**: Zero references to Prometheus, VictoriaMetrics, vmagent, scrape_success, or last_scrape anywhere in the codebase (excluding this spec and git history).

**Independent Test**: `grep -ri 'prometheus\|victoriametrics\|vmagent\|scrape_success\|last_scrape'` returns zero matches outside `specs/093-remove-vestigial-metrics/`.

### Scripts

- [x] T029 [US3] Delete `local/deploy-local.sh` (dead file — references VictoriaMetrics services that no longer exist)
- [x] T030 [US3] Replace `/metrics` reachability check with `/health` in `local/deploy.sh` (L130-134)
- [x] T031 [US3] Update "delete the vmagent WAL data volume" → "delete data volumes" in `local/deploy.sh` (L151)
- [x] T032 [US3] Remove Prometheus comments (L265-266) and entire `/metrics` validation block (L363-382) from `infra/validate-deployment.sh`

### Infrastructure

- [x] T033 [P] [US3] Update comment in `infra/container-apps.tf` (L194): "vmagent scraping" → "liveness checks"
- [x] T034 [P] [US3] Update comment in `local/docker-compose.prod-local.yml` (L19): `/metrics` → `/health`
- [x] T035 [P] [US3] Update comment in `local/docker-compose.local.yml` (L8): "metrics" → "data"

### API

- [x] T036 [P] [US3] Remove Prometheus comment (L30) from `api/src/EpCubeGraph.Api/Models/Models.cs`
- [x] T037 [US3] Rename test `StepSeconds_PrometheusFormat_ReturnsError` → `StepSeconds_DurationFormat_ReturnsError` and update comment in `api/tests/EpCubeGraph.Api.Tests/Unit/ValidateTests.cs`
- [x] T038 [US3] Run API tests (`cd api && dotnet test`) and confirm all 391 pass

### Specs (historical docs)

- [x] T039 [P] [US3] Remove `prometheus-net.AspNetCore` from dependencies in `specs/001-data-ingestor/plan.md`
- [x] T040 [P] [US3] Remove `API /metrics via prometheus-net` line from `specs/001-data-ingestor/research.md`
- [x] T041 [P] [US3] Remove Prometheus mentions from `specs/002-web-dashboard/spec.md`
- [x] T042 [P] [US3] Update `scrape_success=1` → `last poll` reference in `specs/002-web-dashboard/data-model.md`
- [x] T043 [P] [US3] Remove Prometheus ecosystem references from `specs/002-web-dashboard/research.md`

### Verification

- [x] T044 [US3] Run full grep verification: confirm zero matches for Prometheus/VictoriaMetrics/vmagent/scrape_success/last_scrape outside `specs/093-remove-vestigial-metrics/`

**Checkpoint**: Codebase is fully purged of Prometheus/VictoriaMetrics references.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Final verification across all components

- [ ] T045 Run exporter tests: `cd local/epcube-exporter && python -m pytest test_exporter.py` — all pass, 100% coverage
- [x] T046 Run API tests: `cd api && dotnet test` — 391 pass, 100% coverage
- [x] T047 Run dashboard tests: `cd dashboard && npm run test:coverage` — 544 pass, 100% coverage
- [x] T048 Run dashboard typecheck: `cd dashboard && npm run typecheck` — zero errors

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — verify baseline first
- **US1 (Phase 2)**: Depends on Phase 1 — core exporter changes
- **US2 (Phase 3)**: Depends on Phase 1 — independent of US1 (different file)
- **US3 (Phase 4)**: Depends on US1 + US2 completion — purge requires exporter changes done
- **Polish (Phase 5)**: Depends on all phases complete

### Within US1 (Phase 2)

- T003–T005 (tests) MUST be written and FAIL before T007–T016 (implementation)
- T007–T016 (implementation) before T017–T020 (test cleanup)
- T021 (verify green) after all implementation and cleanup

### Parallel Opportunities

- T001 + T002 (baseline checks) can run in parallel
- T003–T005 (new tests) are all in the same file — sequential
- T022–T028 (US2 mock-exporter) can run in parallel with US1 after Phase 1
- T033–T036, T039–T043 (comments/docs) are all [P] — independent files, can run in parallel
- T045–T048 (final verification) are independent test suites

---

## Summary

| Metric | Value |
|--------|-------|
| Total tasks | 48 |
| Phase 1 (Setup) | 2 |
| Phase 2 (US1 — Exporter) | 19 |
| Phase 3 (US2 — Mock Exporter) | 7 |
| Phase 4 (US3 — Purge References) | 16 |
| Phase 5 (Polish) | 4 |
| Parallelizable tasks | 14 |
| Suggested MVP scope | US1 (Phase 2) — removes the core dead code |
