# Feature Specification: EP Cube Telemetry Data Ingestor

**Feature Branch**: `001-data-ingestor`  
**Created**: 2026-03-07  
**Status**: Draft  
**Feature Issue**: [#3](https://github.com/sstjean/epcubegraph/issues/3)  
**User Story Issues**: [US1 #9](https://github.com/sstjean/epcubegraph/issues/9) · [US2 #10](https://github.com/sstjean/epcubegraph/issues/10) · [US3 #11](https://github.com/sstjean/epcubegraph/issues/11)  
**Input**: User description: "Build a data ingestor that pulls telemetry from EP Cube 1.0 and EP Cube 2.0 Gateway devices and stores it for downstream consumption via API."

## Clarifications

### Session 2026-03-07

- Q: How does the Azure-hosted ingestor reach the EP Cube gateway devices — local network polling, cloud API, or hybrid? → A: Cloud API polling via epcube-exporter — a Python-based Prometheus exporter that authenticates with the EP Cube cloud API (monitoring-us.epcube.com), polls device telemetry via HTTPS, and exposes metrics on an HTTP `/metrics` endpoint in Prometheus format. No local network access to EP Cube gateways is needed.
- Q: How do metrics get from epcube-exporter to the data store? → A: The data store scrapes epcube-exporter directly within the same Azure Container Apps environment.
- Q: Which Azure backend should store the metrics? → A: Azure SQL Database (serverless) for long-term storage. *(Migration pending — currently VictoriaMetrics, being replaced.)*
- Q: How should the data store ingestion path be authenticated? → A: Internal-only access within the Container Apps environment. No external ingestion path.
- Q: What data retention period should the data store enforce? → A: Indefinite — all historical data is retained permanently. No automatic purging.
- Q: Should grid import/export metrics be in scope, and if so, how are they obtained? → A: The EP Cube cloud API provides daily grid import and export energy totals directly (`gridElectricityFrom`, `gridElectricityTo`). No derivation from solar/battery and no additional ECHONET Lite device class or smart meter is needed.
- Q: Should SC-002 ("zero data loss during 1-hour outage") be revised given ECHONET Lite's instantaneous-only nature? → A: Reword — zero data loss due to Azure-side interruptions (the data store retries scrapes on schedule); gaps during cloud API outages are logged and expected.
- Q: How should the downstream API (US2) authenticate client requests? → A: Entra ID (OAuth 2.0) — clients obtain short-lived JWT tokens via Microsoft Entra ID; the API validates the JWT on every request.
- Q: Should the API restrict which queries authenticated clients can execute? → A: Unrestricted passthrough — the API validates required parameter presence (e.g., `query` non-empty) but does not filter metric names or cap time ranges.
- Q: Should edge cases for firmware format changes, storage quota exhaustion, and clock drift have formal FRs? → A: Deferred to external components — epcube-exporter handles format parsing, storage retention is indefinite (no purge), and timestamps are stored as UTC Unix epoch independent of gateway clocks. No new FRs needed.
- Q: How should authorization be implemented for a single-user system? → A: Scope validation only — require the `user_impersonation` scope claim in every JWT. Any valid Entra ID token with that scope is authorized. No app roles or per-endpoint policies needed.
- Q: What level of observability should the API tier provide? → A: Structured logging plus health metrics — use ASP.NET Core's built-in `ILogger` with structured JSON output, and expose a `/metrics` endpoint via `prometheus-net` for self-monitoring. No distributed tracing.
- Q: Should the 2-second API query performance target (SC-003) be formally tested? → A: Single integration test — seed 30 days of synthetic data, assert query returns within 2 seconds. Runs in CI alongside other integration tests.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ingest Telemetry from EP Cube Gateways (Priority: P1)

As the system owner, I want telemetry data from my EP Cube 1.0 and EP Cube 2.0 Gateway devices to be automatically collected and stored so that I have a continuous, reliable record of my solar, battery, and grid activity without manual intervention.

The ingestor receives telemetry from epcube-exporter (which polls both device types via the EP Cube cloud API) and persists readings in the data store on Azure. Grid import/export values are provided directly by the EP Cube cloud API (`gridElectricityFrom`, `gridElectricityTo`) — no derivation from solar/battery and no separate grid meter device is required. Data collection runs on the epcube-exporter poll schedule and handles temporary cloud API unavailability gracefully — epcube-exporter logs failures and auto-re-authenticates on 401, and the data store retries scrapes on the next interval.

**Why this priority**: Without data ingestion, no other feature (graphing, historical review, mobile access) can function. This is the foundational data pipeline.

**Independent Test**: Deploy the ingestor against a gateway (or a simulated gateway endpoint) and verify that readings appear in the data store at the expected intervals. Confirm data accuracy by comparing stored values to raw gateway output.

**Acceptance Scenarios**:

1. **Given** an EP Cube 1.0 device is reporting to the cloud, **When** the ingestor runs its scheduled collection cycle, **Then** solar, battery, and grid readings are stored with accurate timestamps.
2. **Given** an EP Cube 2.0 device is reporting to the cloud, **When** the ingestor runs its scheduled collection cycle, **Then** solar, battery, and grid readings are stored with accurate timestamps.
3. **Given** the cloud API is temporarily unreachable, **When** the ingestor attempts to collect data, **Then** the failure is logged, no partial or corrupt data is stored, and the ingestor retries on the next cycle.
4. **Given** the ingestor has been running for 24 hours, **When** the stored data is reviewed, **Then** there are no gaps in readings except where the cloud API was confirmed unavailable.
5. **Given** both EP Cube 1.0 and 2.0 devices are reporting simultaneously, **When** the ingestor runs, **Then** data from both devices is collected and stored without interference or data mixing.

---

### User Story 2 - Expose Telemetry via Versioned API (Priority: P2)

As a downstream consumer (web dashboard or mobile app), I need a versioned API to query stored telemetry data so that any client application can retrieve readings without direct data store access.

The API supports querying by time range, device, and measurement type. All requests are authenticated per the constitution's security requirements.

**Why this priority**: The API is the integration point for all client applications. Without it, the stored data is inaccessible to users.

**Independent Test**: Issue authenticated API requests for various time ranges, devices, and measurement types. Verify correct data is returned and that unauthenticated requests are rejected.

**Acceptance Scenarios**:

1. **Given** telemetry data exists in the store, **When** an authenticated client queries the API for a specific device and time range, **Then** the correct readings are returned.
2. **Given** an unauthenticated request is made to the API, **When** the server processes it, **Then** the request is rejected with HTTP 401 (missing/invalid token) or HTTP 403 (valid token, insufficient scope).
3. **Given** the API is queried for a time range with no data, **When** the response is returned, **Then** it returns HTTP 200 with an empty `data` array (not an error).

---

### User Story 3 - Cloud-Deployed Ingestion Stack (Priority: P1)

As the system owner, I want epcube-exporter deployed as a Container App in the same Azure Container Apps environment, so that the entire system runs in Azure with a single deployment command and no local infrastructure required.

The repository provides a Dockerfile for epcube-exporter which is built, pushed to ACR, and deployed as a Container App. The data store scrapes it via internal networking. External ingress is enabled for browser access to the debug status page and health endpoint, authenticated via Entra ID JWT (same app registration as the API). EP Cube cloud credentials are stored in Key Vault and injected as Container App secrets.

**Why this priority**: The constitution mandates that all data ingestion services run as Docker containers. Running in Azure Container Apps eliminates the need for any local infrastructure.

**Independent Test**: Run `infra/deploy.sh` and verify epcube-exporter polls the EP Cube cloud API, the data store scrapes it, and metrics appear within two scrape cycles.

**Acceptance Scenarios**:

1. **Given** valid EP Cube cloud credentials in `terraform.tfvars`, **When** `infra/deploy.sh` is run, **Then** epcube-exporter and the data store are deployed and telemetry begins flowing.
2. **Given** the epcube-exporter Container App is running, **When** it crashes, **Then** Azure Container Apps restarts it automatically and polling resumes.
3. **Given** the Dockerfile in the repository, **When** `deploy.sh` builds and pushes the image, **Then** a reproducible container image is built from source and stored in ACR.
4. **Given** a fresh deployment, **When** the user configures only `terraform.tfvars` (environment name, EP Cube credentials), **Then** no other manual setup is required.

---

### Edge Cases

- What happens when the cloud API changes its response format? *Handled by epcube-exporter* — epcube-exporter parses cloud API JSON responses; format changes would surface as poll failures logged by epcube-exporter. No custom detection in this system.
- What happens when the data store reaches its storage quota? Data retention is indefinite (FR-014). Storage growth must be monitored; if the backing store nears capacity, manual intervention (expand volume or migrate to a larger tier) is required.
- What happens when the ingestor collects a duplicate reading (e.g., after a retry)? Duplicate readings for the same timestamp and device must be deduplicated.
- What happens when clock drift between the cloud API and the server causes timestamp discrepancies? Timestamps are stored as UTC Unix epoch at scrape time, independent of cloud API timestamps. Clock drift on the Azure Container Apps host is managed by Azure.
- What happens when both gateways report data for overlapping metrics? The system must store data attributed to the correct device without merging or overwriting.
- What happens when an Azure Container App runs out of ephemeral storage? The data store uses persistent storage; the container must log errors and avoid silent data loss.
- What happens when an Azure Container App is restarted? Container Apps MUST auto-restart and resume scraping/polling without manual intervention or data corruption.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST ingest telemetry from EP Cube 1.0 devices via epcube-exporter, which polls the EP Cube cloud API (monitoring-us.epcube.com) over HTTPS and exposes Prometheus-format metrics.
- **FR-002**: System MUST ingest telemetry from EP Cube 2.0 devices via the same epcube-exporter instance.
- **FR-003**: System MUST collect the following metrics exposed by epcube-exporter (which polls the EP Cube cloud API):
  - **Battery** (`storage_battery` class): state of charge (%), net energy today (kWh, positive=charge/negative=discharge).
  - **Solar** (`home_solar` class): instantaneous generation (W), cumulative generation today (kWh).
  - **Home load**: backup/home supply power (W), self-sufficiency rate (%).
  - **Grid**: grid import energy today (kWh), grid export energy today (kWh).
- **FR-003a**: System MUST expose grid energy balance via the API. The EP Cube cloud API provides daily grid energy totals (`gridElectricityFrom`, `gridElectricityTo`) directly; no derivation is required. The API `/grid` endpoint MUST compute import minus export and return the net grid balance as a single time series (positive = net import from grid, negative = net export to grid).
- **FR-004**: ~~DEPRECATED~~ — Internal-only ingestion; no external write path. Deprecated 2026-03-17.
- **FR-005**: System MUST store all received readings in the data store deployed on Azure, preserving device identifier, metric name, value, labels, and UTC timestamp.
- **FR-006**: System MUST retry failed collection attempts on the next scheduled cycle and log each failure with the reason.
- **FR-007**: System MUST deduplicate readings that have the same device, metric name, and timestamp.
- **FR-008**: System MUST expose a versioned API that serves telemetry data for consumption by downstream clients, querying the data store.
- **FR-009**: System MUST support querying stored data by time range, device, and metric name.
- **FR-010**: System MUST authenticate all API requests using Microsoft Entra ID (OAuth 2.0). Clients MUST obtain short-lived JWT tokens from Entra ID; the API MUST validate the JWT signature, audience, issuer, and expiry on every request. Requests with missing, expired, or invalid tokens MUST be rejected with HTTP 401.
- **FR-010a**: System MUST authorize all API requests by requiring the `user_impersonation` scope claim in the JWT. Requests with a valid token that lacks the required scope MUST be rejected with HTTP 403. No additional role-based or per-endpoint authorization policies are required for this single-user system.
- **FR-011**: System MUST normalise all timestamps to UTC before storage.
- **FR-012**: ~~DEPRECATED~~ — No external write path. Deprecated 2026-03-17.
- **FR-013**: ~~DEPRECATED~~ — No external write path. Deprecated 2026-03-17.
- **FR-014**: System MUST retain all ingested data indefinitely. No automatic purging or time-based expiration is applied.
- **FR-015**: Ingestion services (epcube-exporter) MUST be packaged as Docker containers with Dockerfiles committed to the repository and deployed to Azure Container Apps.
- **FR-016**: EP Cube cloud credentials MUST be stored in Azure Key Vault and injected into the epcube-exporter Container App as secrets.
- **FR-017**: Container Apps auto-restart on failure. *Note: This is an Azure Container Apps platform guarantee (always-on, not configurable). No implementation required; documented for completeness.*
- **FR-018**: ~~DEPRECATED~~ — Merged into SC-005, which provides the same requirement with a measurable outcome. Deprecated 2026-03-17.
- **FR-019**: The API MUST validate all incoming request parameters for presence and type (e.g., `query` parameter is non-empty, timestamps are valid RFC3339 or Unix epoch, `step` is a valid duration, path parameters match expected format). Invalid parameters MUST be rejected with HTTP 400. Query content is passed through to the data store without restriction after authentication; the data store handles query syntax validation.
- **FR-020**: The API MUST emit structured JSON logs via ASP.NET Core's built-in `ILogger`. Logs MUST include: authentication failures (401/403), data store query errors, and request durations for all endpoints.
- **FR-021**: The API MUST expose a `/metrics` endpoint in Prometheus exposition format (via `prometheus-net`) for self-monitoring. This endpoint MUST be unauthenticated and MUST NOT expose telemetry data. Metrics MUST include HTTP request count, request duration histogram, and active connection count.
- **FR-022**: The epcube-exporter MUST expose a `/health` endpoint that returns HTTP 200 with `{"status":"ok"}` when healthy, or HTTP 503 with `{"status":"unhealthy","reasons":[...]}` when unhealthy. The health check MUST report unhealthy if no successful poll has occurred in 5 minutes or if 5 or more consecutive poll errors have occurred. This endpoint MUST be unauthenticated.
- **FR-023**: The epcube-exporter MUST expose a debug status page at `/` and `/status` showing the last 10 poll snapshots with per-device telemetry values, uptime, poll count, error count, and a health chiclet. When deployed to Azure, this endpoint MUST be authenticated via OAuth 2.0 Authorization Code flow with PKCE against the same Entra ID app registration as the API: browser users are redirected to `/login`, which initiates the Microsoft Entra ID authorization flow; the `/.auth/callback` endpoint exchanges the authorization code for tokens and creates a signed session cookie; subsequent requests are authenticated via session cookie. API clients (non-browser) without a valid session cookie or Bearer JWT MUST receive HTTP 401. In local development, authentication MUST be bypassed via the `EPCUBE_DISABLE_AUTH` environment variable.
- **FR-024**: The epcube-exporter Container App MUST be deployed with external ingress to allow browser access to the debug status page. The exporter MUST be configured with an OAuth client secret (stored in Key Vault), redirect URI (`/.auth/callback`), and Entra ID tenant/client/audience environment variables. The Entra ID app registration MUST include the exporter's callback URL as a Web redirect URI.

### Key Entities

- **Device**: Represents an EP Cube device (1.0 or 2.0) as identified by epcube-exporter via the cloud API. Attributes: unique device ID, device class (`storage_battery` or `home_solar`), status (online/offline), device metadata (manufacturer, product code, UID).
- **Reading**: A single telemetry data point scraped from epcube-exporter. Attributes: device reference, metric name (e.g., `epcube_battery_state_of_capacity_percent`), value, unit (W, Wh, kWh, %, or state code), UTC timestamp.
- **Time Series**: An ordered collection of Readings for a given device and metric over a time range, stored in the data store and queryable via the API. Used for downstream graphing and API responses.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Telemetry data is collected from both EP Cube 1.0 and 2.0 gateways with no more than one missed scrape cycle per 24-hour period under normal network conditions (EP Cube cloud API responsive within 30 seconds, Azure Container Apps environment healthy and not restarting).
- **SC-002**: Zero data loss due to Azure-side interruptions — data store continuity MUST show no gaps exceeding 2× the scrape interval (2 minutes) during Azure-side events (Container App restarts, platform maintenance). The data store persists all successfully scraped data to persistent storage. Gaps during cloud API outages are expected and MUST be logged with timestamps for observability. Validated by: (1) data is stored on persistent storage (survives container restarts), and (2) post-deployment smoke test confirms data continuity.
- **SC-003**: API queries for up to 30 days of data return results within 2 seconds. Validated by an integration test that seeds 30 days of synthetic data and asserts query latency <2s.
- **SC-004**: 100% of API endpoints are authenticated; no unauthenticated access to telemetry data is possible.
- **SC-005**: The entire system can be deployed from scratch using only `infra/deploy.sh` and a `terraform.tfvars` file, with telemetry flowing within 5 minutes.

## Assumptions

- EP Cube 1.0 and 2.0 devices report telemetry to the Canadian Solar cloud API (monitoring-us.epcube.com), which epcube-exporter polls over HTTPS.
- epcube-exporter is deployed as a Container App in the Azure Container Apps environment, authenticating with EP Cube cloud credentials stored in Key Vault.
- The data store is deployed within the same Container Apps environment with internal-only access.
- A single-node data store is sufficient for a single-user personal telemetry system; clustering is not required.
- A single user (the system owner) is the primary consumer; multi-user access control is not required for this feature.
- An Entra ID app registration is provisioned for the API; client applications (web, iPhone, iPad) use the same Entra ID tenant to obtain OAuth 2.0 tokens.
- Data retention is indefinite; all historical data is retained permanently.
- Client applications (web dashboard, iPhone app, iPad app) are separate features that consume this API.
