# Feature Specification: Remove Vestigial /metrics Endpoint

**Feature Branch**: `093-remove-vestigial-metrics`
**Created**: 2026-04-29
**Status**: Draft
**GitHub Issue**: [#93](https://github.com/sstjean/epcubegraph/issues/93)
**Input**: Remove the vestigial Prometheus `/metrics` endpoint from the exporter and purge all Prometheus/VictoriaMetrics references from the entire codebase.

## User Scenarios & Testing

### User Story 1 — Remove /metrics Endpoint and Prometheus Code from Exporter (Priority: P1)

The epcube-exporter still serves a Prometheus-format `/metrics` endpoint from when the system used VictoriaMetrics for scraping. VictoriaMetrics was removed but the endpoint and all its supporting Prometheus text generation code remained. No system consumes `/metrics` — all data flows through PostgreSQL. This dead code increases maintenance burden, widens the test surface, and misleads future readers about the system's data flow.

The exporter must stop serving `/metrics`, remove all Prometheus text format generation from `poll()`, and remove the `get_metrics()`/`_metrics_text` machinery.

**Why this priority**: The exporter is the primary target of issue #93. The `/metrics` handler and ~150 lines of Prometheus text generation in `poll()` are the core dead code.

**Independent Test**: After implementation, `curl http://localhost:9250/metrics` returns 404. `/health` and `/status` continue to work. PostgreSQL receives readings. All exporter tests pass at 100% coverage.

**Acceptance Scenarios**:

1. **Given** the exporter is running, **When** a client requests `GET /metrics`, **Then** the exporter returns HTTP 404.
2. **Given** the exporter is running, **When** `poll()` completes, **Then** device data is written to PostgreSQL and the debug snapshot is updated, but no Prometheus text is generated.
3. **Given** the exporter is running, **When** a client requests `GET /health`, **Then** the exporter returns HTTP 200 with `{"status": "ok"}` (unchanged behavior).
4. **Given** the exporter is running, **When** an authenticated client requests `GET /status`, **Then** the debug page renders without a `/metrics` nav link.

---

### User Story 2 — Remove Prometheus Code from Mock Exporter (Priority: P2)

The mock-exporter (`local/mock-exporter/metrics_server.py`) generates Prometheus text format via `_generate_metrics()` (~130 lines) and serves it on `/metrics`. No system scrapes this endpoint — the mock-exporter's only real purpose is `_pg_write_loop()` writing synthetic data to PostgreSQL for the `docker-compose.local.yml` test stack.

The `_generate_metrics()` function, `_labels()` helper, and `/metrics` handler must be removed. The HTTP server should serve `/health` for container liveness checks.

**Why this priority**: Secondary to the real exporter but required by Constitution §II YAGNI — dead code with no covering requirement must be removed.

**Independent Test**: Mock-exporter starts, writes data to PostgreSQL, serves `/health` returning 200. `GET /metrics` returns 404.

**Acceptance Scenarios**:

1. **Given** the mock-exporter is running with `POSTGRES_DSN` set, **When** the write loop runs, **Then** synthetic data is written to PostgreSQL (unchanged behavior).
2. **Given** the mock-exporter is running, **When** a client requests `GET /metrics`, **Then** the server returns HTTP 404.
3. **Given** the mock-exporter is running, **When** a client requests `GET /health`, **Then** the server returns HTTP 200.

---

### User Story 3 — Purge All Prometheus/VictoriaMetrics References from Codebase (Priority: P3)

Every reference to Prometheus, VictoriaMetrics, vmagent, and scrape-as-monitoring-terminology must be removed from the entire codebase: scripts, infrastructure-as-code, API code, specs, and documentation. This includes dead scripts, vestigial comments, and naming that carries Prometheus conventions.

**Why this priority**: Cleanup that depends on US1 and US2 being done first. Prevents future confusion about the system's architecture.

**Independent Test**: `grep -ri 'prometheus\|victoriametrics\|vmagent\|scrape_success\|last_scrape' --include='*.py' --include='*.sh' --include='*.tf' --include='*.cs' --include='*.yml' --include='*.md' --exclude-dir=specs/093-remove-vestigial-metrics` returns zero results (excluding this feature's spec directory and git history).

**Acceptance Scenarios**:

1. **Given** the codebase, **When** searching for "Prometheus" (case-insensitive), **Then** zero matches are found outside of this spec file and git history.
2. **Given** the codebase, **When** searching for "VictoriaMetrics" or "vmagent" (case-insensitive), **Then** zero matches are found.
3. **Given** the codebase, **When** searching for "scrape_success" or "last_scrape", **Then** zero matches are found.
4. **Given** the `local/deploy-local.sh` file, **When** checking for references from other files or CI, **Then** none exist — the file is dead code and must be deleted.
5. **Given** the deployment validation script, **When** it runs against a deployed exporter, **Then** it validates `/health` but does not check `/metrics` or Prometheus metric names.
6. **Given** the `local/deploy.sh` status check, **When** it verifies the exporter is running, **Then** it checks `/health` instead of `/metrics`.

### Edge Cases

- What happens if the debug page `/status` is bookmarked with a `/metrics` link in the nav? Users get 404 — acceptable, no action needed.
- What happens if the mock-exporter is started without `POSTGRES_DSN`? It serves `/health` but writes no data — same as today minus the `/metrics` endpoint.

## Requirements

### Functional Requirements

- **FR-001**: The exporter MUST NOT serve a `/metrics` endpoint. Requests to `/metrics` MUST return HTTP 404.
- **FR-002**: The exporter MUST continue writing device readings to PostgreSQL via `poll()` without any Prometheus text generation.
- **FR-003**: The exporter MUST continue serving `/health` (unauthenticated) and `/status` (authenticated) endpoints unchanged.
- **FR-004**: The debug status page MUST NOT contain a link to `/metrics`.
- **FR-005**: The mock-exporter MUST NOT serve a `/metrics` endpoint. Requests to `/metrics` MUST return HTTP 404.
- **FR-006**: The mock-exporter MUST continue writing synthetic data to PostgreSQL via `_pg_write_loop()` unchanged.
- **FR-007**: The mock-exporter MUST serve a `/health` endpoint returning HTTP 200 for container liveness.
- **FR-008**: The dead script `local/deploy-local.sh` MUST be deleted.
- **FR-009**: All deployment validation and status scripts MUST check `/health` instead of `/metrics`.
- **FR-010**: The constant `METRICS_PORT` MUST be renamed to `HTTP_PORT` — the port serves `/health`, `/status`, and `/vue`, not metrics.
- **FR-011**: No file in the codebase (outside of this spec and git history) MUST contain the words "Prometheus", "VictoriaMetrics", "vmagent", "scrape_success", or "last_scrape" in code, comments, or documentation.

## Success Criteria

### Measurable Outcomes

- **SC-001**: `GET /metrics` on the exporter returns HTTP 404.
- **SC-002**: `GET /health` on the exporter returns HTTP 200 with `{"status": "ok"}`.
- **SC-003**: PostgreSQL receives readings after `poll()` completes (verified by existing integration tests).
- **SC-004**: All exporter tests pass at 100% coverage after removing obsolete tests and adding new ones.
- **SC-005**: All API tests pass (391 tests, 100% coverage) — test rename does not break behavior.
- **SC-006**: `grep -ri 'prometheus\|victoriametrics\|vmagent\|scrape_success\|last_scrape'` returns zero matches in code, scripts, infra, and spec files (excluding `specs/093-remove-vestigial-metrics/`).
- **SC-007**: Net codebase reduction of ~370 lines.
- **SC-008**: `local/deploy-local.sh` does not exist on disk.
