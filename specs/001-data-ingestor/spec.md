# Feature Specification: EP Cube Telemetry Data Ingestor

**Feature Branch**: `001-data-ingestor`  
**Created**: 2026-03-07  
**Status**: Revised  
**Feature Issue**: [#3](https://github.com/sstjean/epcubegraph/issues/3)  
**User Story Issues**: [US1 #9](https://github.com/sstjean/epcubegraph/issues/9) · [US2 #10](https://github.com/sstjean/epcubegraph/issues/10) · [US3 #11](https://github.com/sstjean/epcubegraph/issues/11)  
**Input**: User description: "Build a data ingestor that pulls telemetry from EP Cube 1.0 and EP Cube 2.0 gateway devices and stores it for downstream consumption via API."

## Clarifications

### Session 2026-03-07

- Q: How does the ingestor reach EP Cube devices? → A: Through the Canadian Solar cloud API (`monitoring-us.epcube.com`) over HTTPS. No local network access to the gateways is required.
- Q: Where is telemetry stored? → A: In PostgreSQL. Local development uses PostgreSQL 17 in Docker Compose. Azure deployments use Azure Database for PostgreSQL Flexible Server with private runtime access.
- Q: How is data written into storage? → A: `epcube-exporter` writes device metadata and telemetry readings directly to PostgreSQL after each successful poll.
- Q: How long is data retained? → A: Indefinitely.
- Q: How are client requests authenticated? → A: Microsoft Entra ID bearer tokens with `user_impersonation` scope enforcement.
- Q: What API shape do clients consume? → A: A clean JSON REST contract under `/api/v1` for health, devices, current readings, range readings, and grid readings.
- Q: How is grid power handled? → A: `grid_power_watts` is stored directly and exposed through `/api/v1/grid`.
- Q: What observability is required? → A: Structured JSON logs for the API, an unauthenticated operational `/metrics` endpoint for the API, and exporter `/health` plus authenticated debug status pages.

## User Scenarios & Testing

### User Story 1 - Ingest Telemetry from EP Cube Gateways (Priority: P1)

As the system owner, I want telemetry data from my EP Cube 1.0 and EP Cube 2.0 gateway devices to be automatically collected and stored so that I have a continuous, reliable record of my solar, battery, load, and grid activity without manual intervention.

The exporter authenticates to the cloud API, polls both gateway generations on a schedule, normalizes the readings, and writes them into PostgreSQL.

**Why this priority**: Without ingestion, no downstream client can function.

**Independent Test**: Run the exporter with valid credentials and verify that both `devices` and `readings` are populated in PostgreSQL.

**Acceptance Scenarios**:

1. **Given** an EP Cube 1.0 gateway is reporting to the cloud, **When** the exporter polls, **Then** the resulting readings are written to PostgreSQL with correct timestamps.
2. **Given** an EP Cube 2.0 gateway is reporting to the cloud, **When** the exporter polls, **Then** those readings are written without interfering with the 1.0 device data.
3. **Given** the cloud API is temporarily unavailable, **When** a poll fails, **Then** the failure is logged and the next poll cycle retries without corrupting stored data.
4. **Given** the same reading is encountered more than once for the same device, metric, and timestamp, **When** the exporter writes it, **Then** only one logical row is retained.

---

### User Story 2 - Expose Telemetry via Versioned API (Priority: P2)

As a downstream consumer, I need a versioned API to query stored telemetry data so that web and mobile clients can read current and historical telemetry without direct database access.

The API exposes device inventory, device metric discovery, current readings, bucketed range readings, grid readings, and datastore health using `/api/v1` endpoints backed by PostgreSQL.

**Why this priority**: The API is the contract boundary for every client application.

**Independent Test**: Issue authenticated requests to each `/api/v1` endpoint against seeded PostgreSQL data and verify that the JSON responses match the published contract.

**Acceptance Scenarios**:

1. **Given** telemetry data exists in PostgreSQL, **When** an authenticated client requests current or historical readings, **Then** the API returns the expected JSON payloads grouped by device.
2. **Given** an unauthenticated request is made to a telemetry endpoint, **When** the API processes it, **Then** the request is rejected with HTTP 401 or HTTP 403 according to token validity and scope.
3. **Given** no rows exist for a requested time range, **When** the API responds, **Then** it returns HTTP 200 with an empty readings or series collection rather than an error.
4. **Given** PostgreSQL is unreachable, **When** `/api/v1/health` is called, **Then** it returns HTTP 503 with `datastore: "unreachable"`.

---

### User Story 3 - Cloud-Deployed Ingestion Stack (Priority: P1)

As the system owner, I want the exporter, API, and managed PostgreSQL backing services deployed in Azure so that the full ingestion path runs in the cloud with reproducible infrastructure.

Azure deployment provisions a Container Apps environment for the API and exporter, Azure Database for PostgreSQL Flexible Server for storage, Key Vault for secrets, and the required network resources for private runtime access.

**Why this priority**: The constitution requires Azure-hosted server-side components and reproducible deployments.

**Independent Test**: Run `infra/deploy.sh`, confirm the managed PostgreSQL server is created, confirm the exporter writes data, and confirm the API reports healthy.

**Acceptance Scenarios**:

1. **Given** valid EP Cube credentials and Azure access, **When** `infra/deploy.sh` completes successfully, **Then** the managed PostgreSQL server, exporter, and API are deployed and connected.
2. **Given** the exporter container crashes, **When** Azure Container Apps restarts it, **Then** polling resumes without manual intervention.
3. **Given** a fresh environment, **When** only the documented deployment inputs are provided, **Then** no manual infrastructure creation is required outside the scripted deployment flow.

---

### Edge Cases

- What happens if the cloud API changes shape? The exporter must fail loudly in logs rather than writing malformed data.
- What happens if PostgreSQL is temporarily unavailable? The API must surface execution errors and `/health` must report the datastore as unreachable.
- What happens if one device stops reporting while another continues? Freshness remains device-specific so downstream clients can mark only the stale device as offline.
- What happens if a large historical query is requested? The API must aggregate into requested step buckets and still satisfy the published performance target.
- What happens if the exporter restarts? Schema verification and upsert behavior must allow the process to resume without manual repair.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST ingest telemetry from EP Cube 1.0 devices through `epcube-exporter`.
- **FR-002**: The system MUST ingest telemetry from EP Cube 2.0 devices through the same exporter process.
- **FR-003**: The system MUST persist core telemetry metrics required by downstream clients, including solar generation, battery state of charge, battery power, stored battery energy, home load power, and grid power.
- **FR-004**: Device metadata MUST be stored in a dedicated `devices` table and kept current through exporter upserts.
- **FR-005**: Telemetry readings MUST be stored in PostgreSQL with device identifier, metric name, timestamp, and numeric value.
- **FR-006**: Failed collection attempts MUST be logged and retried on the next scheduled poll cycle.
- **FR-007**: Duplicate readings for the same device, metric name, and timestamp MUST be deduplicated at write time.
- **FR-008**: The system MUST expose a versioned REST API for downstream clients at `/api/v1`.
- **FR-009**: The API MUST support current and range queries by metric, time range, and device grouping, plus device inventory and device metric discovery.
- **FR-010**: The API MUST authenticate telemetry requests using Microsoft Entra ID bearer tokens.
- **FR-010a**: The API MUST authorize telemetry requests by requiring the `user_impersonation` scope claim.
- **FR-011**: The system MUST normalize stored timestamps as UTC-compatible PostgreSQL `TIMESTAMPTZ` values and return Unix epoch timestamps in JSON responses.
- **FR-012**: The exporter MUST create required PostgreSQL schema objects automatically when starting against an empty database.
- **FR-013**: The Azure runtime path to PostgreSQL MUST remain private to the application network topology.
- **FR-014**: The system MUST retain ingested telemetry indefinitely.
- **FR-015**: The exporter MUST be packaged as a reproducible Docker container committed to the repository.
- **FR-016**: EP Cube cloud credentials and PostgreSQL connection strings MUST be stored in Azure Key Vault for Azure deployments.
- **FR-017**: Cloud runtime components MUST restart automatically on failure using Azure platform behavior.
- **FR-018**: The API MUST expose an operational `/metrics` endpoint and MUST NOT expose user telemetry through that endpoint.
- **FR-019**: The API MUST validate incoming metric names, timestamps, and step values, rejecting invalid requests with HTTP 400.
- **FR-020**: The API MUST emit structured JSON logs for auth failures, execution failures, and request handling.
- **FR-021**: The exporter MUST expose `/health` returning HTTP 200 when healthy and HTTP 503 when unhealthy.
- **FR-022**: The exporter MUST expose authenticated debug status pages at `/` and `/status` in Azure, with development-only auth bypass available for local work.
- **FR-023**: The exporter Container App MUST be deployed with external ingress for its debug page and health endpoint.
- **FR-024**: The API MUST provide `/health`, `/readings/current`, `/readings/range`, `/devices`, `/devices/{device}/metrics`, and `/grid`.

### Key Entities

- **Device**: A persisted EP Cube device record with `device_id`, `device_class`, `alias`, `manufacturer`, `product_code`, and `uid`.
- **Reading**: A persisted telemetry row with `device_id`, `metric_name`, `timestamp`, and `value`.
- **CurrentReadingsResponse**: API response containing a metric name and the latest reading per device.
- **RangeReadingsResponse**: API response containing a metric name and grouped time-series points per device.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Telemetry from both EP Cube 1.0 and 2.0 devices is written successfully under normal operating conditions with no more than one missed poll cycle per 24 hours.
- **SC-002**: Stored telemetry survives process restarts and remains queryable after exporter or API restarts.
- **SC-003**: API queries for up to 30 days of data return within 2 seconds.
- **SC-004**: All telemetry endpoints require valid authentication and scope.
- **SC-005**: The Azure stack can be deployed from repository scripts and configuration alone, with telemetry flowing within 5 minutes of deployment completion.

## Assumptions

- EP Cube devices report through the Canadian Solar cloud API.
- A single user is the primary consumer of the system.
- PostgreSQL is the authoritative telemetry store in both local and Azure environments.
- Web and mobile clients consume only the published REST API and never access the database directly.
