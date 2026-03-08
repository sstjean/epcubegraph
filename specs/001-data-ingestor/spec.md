# Feature Specification: EP Cube Telemetry Data Ingestor

**Feature Branch**: `001-data-ingestor`  
**Created**: 2026-03-07  
**Status**: Draft  
**Input**: User description: "Build a data ingestor that pulls telemetry from EP Cube 1.0 and EP Cube 2.0 Gateway devices and stores it for downstream consumption via API."

## Clarifications

### Session 2026-03-07

- Q: How does the Azure-hosted ingestor reach the EP Cube gateway devices — local network polling, cloud API, or hybrid? → A: Local network polling via [echonet-exporter](https://github.com/styygeli/echonet-exporter) — a Go-based Prometheus exporter that polls EP Cube devices over ECHONET Lite (UDP port 3610) on the LAN and exposes metrics on an HTTP `/metrics` endpoint in Prometheus format.
- Q: How do metrics get from the local echonet-exporter to the Azure-hosted ingestor? → A: Prometheus remote write — a local Prometheus or vmagent instance scrapes echonet-exporter and remote-writes to an Azure-hosted time-series backend (e.g., VictoriaMetrics or Azure Monitor).
- Q: Which Azure time-series backend should receive the remote-written metrics? → A: VictoriaMetrics deployed as a single container on Azure Container Apps, accepting Prometheus remote-write and queryable via PromQL.
- Q: How should the VictoriaMetrics remote-write endpoint be authenticated? → A: Pre-shared bearer token in the Authorization header; token stored in Azure Key Vault and injected into Container Apps as a secret.
- Q: What data retention period should VictoriaMetrics enforce? → A: 5 years (`-retentionPeriod=5y`).
- Q: Should grid import/export metrics be in scope, and if so, how are they obtained? → A: Derived grid — calculate grid import/export from solar generation and battery charge/discharge power. No additional ECHONET Lite device class or smart meter needed.
- Q: Should SC-002 ("zero data loss during 1-hour outage") be revised given ECHONET Lite’s instantaneous-only nature? → A: Reword — zero data loss due to Azure-side interruptions (vmagent WAL buffers); gaps during LAN/gateway outages are logged and expected.
- Q: How should the downstream API (US2) authenticate client requests? → A: Entra ID (OAuth 2.0) — clients obtain short-lived JWT tokens via Microsoft Entra ID; the API validates the JWT on every request.
- Q: Should the API restrict which PromQL queries authenticated clients can execute? → A: Unrestricted passthrough — any valid PromQL is allowed after JWT auth. The API validates required parameter presence (e.g., `query` non-empty) but does not filter metric names or cap time ranges. VictoriaMetrics handles malformed query errors.
- Q: Should edge cases for firmware format changes, storage quota exhaustion, and clock drift have formal FRs? → A: Deferred to external components — echonet-exporter handles format parsing, VictoriaMetrics handles storage via 5-year retention, and VictoriaMetrics stores Unix timestamps independent of gateway clocks. No new FRs needed.
- Q: How should authorization be implemented for a single-user system? → A: Scope validation only — require the `user_impersonation` scope claim in every JWT. Any valid Entra ID token with that scope is authorized. No app roles or per-endpoint policies needed.
- Q: What level of observability should the API tier provide? → A: Structured logging plus Prometheus health metrics — use ASP.NET Core’s built-in `ILogger` with structured JSON output, and expose a `/metrics` endpoint via `prometheus-net` for self-monitoring in Grafana. No distributed tracing.
- Q: Should the 2-second API query performance target (SC-003) be formally tested? → A: Single integration test — seed 30 days of synthetic data in Testcontainers VictoriaMetrics, assert `query_range` returns within 2 seconds. Runs in CI alongside other integration tests.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ingest Telemetry from EP Cube Gateways (Priority: P1)

As the system owner, I want telemetry data from my EP Cube 1.0 and EP Cube 2.0 Gateway devices to be automatically collected and stored so that I have a continuous, reliable record of my solar, battery, and grid activity without manual intervention.

The ingestor receives telemetry from echonet-exporter (which polls both gateway device types over ECHONET Lite on the LAN) via Prometheus remote-write through a local vmagent. It persists readings in VictoriaMetrics on Azure. Grid import/export values are derived from solar generation and battery power — no separate grid meter device is required. Data collection runs on the echonet-exporter scrape schedule and handles temporary gateway unavailability gracefully — echonet-exporter logs scrape failures, and vmagent buffers writes in its WAL if the Azure endpoint is temporarily unreachable.

**Why this priority**: Without data ingestion, no other feature (graphing, historical review, mobile access) can function. This is the foundational data pipeline.

**Independent Test**: Deploy the ingestor against a gateway (or a simulated gateway endpoint) and verify that readings appear in the data store at the expected intervals. Confirm data accuracy by comparing stored values to raw gateway output.

**Acceptance Scenarios**:

1. **Given** an EP Cube 1.0 Gateway is online and reachable, **When** the ingestor runs its scheduled collection cycle, **Then** solar, battery, and grid readings are stored with accurate timestamps.
2. **Given** an EP Cube 2.0 Gateway is online and reachable, **When** the ingestor runs its scheduled collection cycle, **Then** solar, battery, and grid readings are stored with accurate timestamps.
3. **Given** a gateway is temporarily unreachable, **When** the ingestor attempts to collect data, **Then** the failure is logged, no partial or corrupt data is stored, and the ingestor retries on the next cycle.
4. **Given** the ingestor has been running for 24 hours, **When** the stored data is reviewed, **Then** there are no gaps in readings except where a gateway was confirmed offline.
5. **Given** both EP Cube 1.0 and 2.0 gateways are online simultaneously, **When** the ingestor runs, **Then** data from both devices is collected and stored without interference or data mixing.

---

### User Story 2 - Expose Telemetry via Versioned API (Priority: P2)

As a downstream consumer (web dashboard, Grafana, or mobile app), I need a versioned API to query stored telemetry data so that any client application can retrieve readings without direct data store access.

The API supports querying by time range, device, and measurement type. All requests are authenticated per the constitution's security requirements.

**Why this priority**: The API is the integration point for all client applications. Without it, the stored data is inaccessible to users.

**Independent Test**: Issue authenticated API requests for various time ranges, devices, and measurement types. Verify correct data is returned and that unauthenticated requests are rejected.

**Acceptance Scenarios**:

1. **Given** telemetry data exists in the store, **When** an authenticated client queries the API for a specific device and time range, **Then** the correct readings are returned.
2. **Given** an unauthenticated request is made to the API, **When** the server processes it, **Then** the request is rejected with an appropriate error.
3. **Given** the API is queried for a time range with no data, **When** the response is returned, **Then** it clearly indicates an empty result set (not an error).

---

### User Story 3 - Containerized Local Ingestion Stack (Priority: P1)

As the system owner, I want echonet-exporter and vmagent to be packaged as Docker containers with a Docker Compose configuration so that the entire local ingestion stack can be deployed on any LAN-connected device with a single `docker compose up` command.

The repository provides Dockerfiles for echonet-exporter and a Docker Compose file that orchestrates echonet-exporter and vmagent together. Configuration (device IPs, scrape intervals, remote-write URL, bearer token) is supplied via environment variables or a `.env` file. The containers auto-restart on failure.

**Why this priority**: The constitution (v1.5.0) mandates that all local data ingestion services run as Docker containers. This is a prerequisite for deploying the ingestion pipeline.

**Independent Test**: Run `docker compose up` on a LAN-connected device, verify echonet-exporter polls the EP Cube gateways, and confirm metrics appear in the Azure-hosted VictoriaMetrics within two scrape cycles.

**Acceptance Scenarios**:

1. **Given** a LAN-connected device with Docker installed, **When** the user runs `docker compose up -d` with a valid `.env` file, **Then** echonet-exporter and vmagent containers start and begin polling/forwarding telemetry.
2. **Given** the containers are running, **When** an echonet-exporter container crashes, **Then** Docker restarts it automatically and scraping resumes without manual intervention.
3. **Given** the Dockerfiles in the repository, **When** `docker compose build` is executed, **Then** reproducible container images are built from source with no external dependencies beyond the base images.
4. **Given** a fresh deployment, **When** the user configures only the `.env` file (device IPs, remote-write URL, bearer token), **Then** no other manual installation or configuration is required.

---

### Edge Cases

- What happens when a gateway firmware update changes the data format? *Handled by echonet-exporter* — echonet-exporter parses ECHONET Lite responses; format changes would surface as scrape failures logged by echonet-exporter. No custom detection in this system.
- What happens when the data store reaches its storage quota? *Handled by VictoriaMetrics* — the 5-year retention policy (`-retentionPeriod=5y`, FR-014) automatically purges old data. VictoriaMetrics logs storage warnings natively.
- What happens when the ingestor collects a duplicate reading (e.g., after a retry)? Duplicate readings for the same timestamp and device must be deduplicated.
- What happens when clock drift between the gateway and the server causes timestamp discrepancies? *Handled by VictoriaMetrics* — VictoriaMetrics stores Unix timestamps attached by vmagent at scrape time, independent of gateway clocks. Significant clock drift on the Docker host would affect vmagent's timestamps but is an operational concern, not an application-level one.
- What happens when both gateways report data for overlapping metrics? The system must store data attributed to the correct device without merging or overwriting.
- What happens when the Docker host runs out of disk space? The containers must log the error and avoid silent data loss; vmagent's WAL must not corrupt.
- What happens when the Docker Compose stack is restarted after a power outage? Containers must auto-start and resume scraping/forwarding without manual intervention or data corruption.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST ingest telemetry from EP Cube 1.0 Gateway devices via [echonet-exporter](https://github.com/styygeli/echonet-exporter), which polls devices over ECHONET Lite (UDP port 3610) on the local network and exposes Prometheus-format metrics.
- **FR-002**: System MUST ingest telemetry from EP Cube 2.0 Gateway devices via the same echonet-exporter instance.
- **FR-003**: System MUST collect the following metrics exposed by echonet-exporter:
  - **Battery** (`storage_battery` class): state of charge (%), charge/discharge power (W), remaining capacity (Wh), chargeable/dischargeable capacity (Wh), cumulative charge/discharge (Wh), working operation state.
  - **Solar** (`home_solar` class): instantaneous generation (W), cumulative generation (kWh).
- **FR-003a**: System MUST derive grid import/export power by calculating: `grid = solar_generation - battery_charge_discharge_power - household_consumption`. When household consumption is not directly metered, grid is approximated as `grid ≈ solar_generation - battery_charge_discharge_power` (positive = export, negative = import). This derived metric MUST be stored alongside raw battery and solar readings.
- **FR-004**: System MUST accept telemetry via Prometheus remote-write protocol from a local vmagent/Prometheus instance that scrapes echonet-exporter.
- **FR-005**: System MUST store all received readings in a VictoriaMetrics instance deployed on Azure Container Apps, preserving device identifier, metric name, value, labels, and UTC timestamp.
- **FR-006**: System MUST retry failed collection attempts on the next scheduled cycle and log each failure with the reason.
- **FR-007**: System MUST deduplicate readings that have the same device, metric name, and timestamp.
- **FR-008**: System MUST expose a versioned API that serves telemetry data for consumption by downstream clients, querying VictoriaMetrics via PromQL.
- **FR-009**: System MUST support querying stored data by time range, device, and metric name.
- **FR-010**: System MUST authenticate all API requests using Microsoft Entra ID (OAuth 2.0). Clients MUST obtain short-lived JWT tokens from Entra ID; the API MUST validate the JWT signature, audience, issuer, and expiry on every request. Requests with missing, expired, or invalid tokens MUST be rejected with HTTP 401.
- **FR-010a**: System MUST authorize all API requests by requiring the `user_impersonation` scope claim in the JWT. Requests with a valid token that lacks the required scope MUST be rejected with HTTP 403. No additional role-based or per-endpoint authorization policies are required for this single-user system.
- **FR-011**: System MUST normalise all timestamps to UTC before storage.
- **FR-012**: System MUST authenticate remote-write ingestion requests using a pre-shared bearer token validated against a secret stored in Azure Key Vault.
- **FR-013**: System MUST reject remote-write requests that lack a valid bearer token with HTTP 401.
- **FR-014**: System MUST enforce a 5-year data retention period in VictoriaMetrics (`-retentionPeriod=5y`); data older than 5 years is automatically purged.
- **FR-015**: Local ingestion services (echonet-exporter and vmagent) MUST be packaged as Docker containers with Dockerfiles committed to the repository.
- **FR-016**: The repository MUST include a Docker Compose file that orchestrates echonet-exporter and vmagent, using environment variables or a `.env` file for configuration (device IPs, scrape intervals, remote-write URL, bearer token).
- **FR-017**: Docker containers MUST be configured with `restart: unless-stopped` to auto-recover from crashes and host reboots.
- **FR-018**: The Docker Compose configuration MUST NOT require any manual installation steps beyond `docker compose up`; all dependencies MUST be resolved within the container images.
- **FR-019**: The API MUST validate all incoming request parameters for presence and type (e.g., `query` parameter is non-empty, timestamps are valid RFC3339 or Unix epoch, `step` is a valid duration, path parameters match expected format). Invalid parameters MUST be rejected with HTTP 400. PromQL query content is passed through to VictoriaMetrics without restriction after authentication; VictoriaMetrics handles PromQL syntax validation.
- **FR-020**: The API MUST emit structured JSON logs via ASP.NET Core’s built-in `ILogger`. Logs MUST include: authentication failures (401/403), VictoriaMetrics query errors, and request durations for all endpoints.
- **FR-021**: The API MUST expose a `/metrics` endpoint in Prometheus exposition format (via `prometheus-net`) for self-monitoring. This endpoint MUST be unauthenticated and MUST NOT expose telemetry data. Metrics MUST include HTTP request count, request duration histogram, and active connection count.

### Key Entities

- **Device**: Represents an EP Cube gateway (1.0 or 2.0) as configured in echonet-exporter. Attributes: unique identifier (echonet-exporter `name`), device class (`storage_battery` or `home_solar`), IP address on LAN, status (online/offline), device metadata (manufacturer, product code, UID from `echonet_device_info`).
- **Reading**: A single telemetry data point scraped from echonet-exporter. Attributes: device reference, metric name (e.g., `echonet_battery_state_of_capacity_percent`), value, unit (W, Wh, kWh, %, or state code), UTC timestamp.
- **Time Series**: An ordered collection of Readings for a given device and metric over a time range, stored in VictoriaMetrics and queryable via PromQL. Used for downstream graphing and API responses.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Telemetry data is collected from both EP Cube 1.0 and 2.0 gateways with no more than one missed cycle per 24-hour period under normal network conditions.
- **SC-002**: Zero data loss due to Azure-side interruptions — vmagent’s write-ahead log (WAL) buffers metrics during Azure endpoint unavailability and replays them on recovery. Gaps during LAN or gateway outages are inherent to ECHONET Lite’s instantaneous-only reporting and MUST be logged with timestamps for observability.
- **SC-003**: API queries for up to 30 days of data return results within 2 seconds. Validated by an integration test that seeds 30 days of synthetic data in VictoriaMetrics (via Testcontainers) and asserts `query_range` latency <2s.
- **SC-004**: 100% of API endpoints are authenticated; no unauthenticated access to telemetry data is possible.
- **SC-005**: The local ingestion stack can be deployed on a fresh Docker-capable device using only `docker compose up` and a `.env` file, with telemetry flowing to Azure within 5 minutes.

## Assumptions

- EP Cube 1.0 and 2.0 gateways support the ECHONET Lite protocol over UDP and are polled by echonet-exporter running on the owner's local network.
- echonet-exporter is deployed and configured on a LAN-connected device (e.g., Raspberry Pi, NAS) with Docker installed, running as a Docker container per constitution v1.5.0.
- A local vmagent instance runs alongside echonet-exporter as a Docker container, configured to scrape `/metrics` at a regular interval and remote-write to the Azure-hosted VictoriaMetrics endpoint over HTTPS.
- VictoriaMetrics single-node is sufficient for a single-user personal telemetry system; clustering is not required.
- The remote-write bearer token is provisioned in Azure Key Vault and configured in the local vmagent as an Authorization header value.
- A single user (the system owner) is the primary consumer; multi-user access control is not required for this feature.
- An Entra ID app registration is provisioned for the API; client applications (web, iPhone, iPad) use the same Entra ID tenant to obtain OAuth 2.0 tokens.
- Data retention is set to 5 years; data older than 5 years is automatically purged by VictoriaMetrics.
- Client applications (web dashboard, Grafana, iPhone app, iPad app) are separate features that consume this API.
