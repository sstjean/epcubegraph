# Feature Specification: Emporia Vue Energy Monitoring Integration

**Feature Branch**: `005-emporia-vue`
**Created**: 2026-04-05
**Status**: Draft
**Input**: Integrate 4 Emporia Vue devices monitoring electrical subpanels. Retrieve circuit-level power data, deduplicate overlapping measurements from nested panels, add retrieval status to the debug page, expose through the API, and display on the dashboard.

## Clarifications

### Session 2026-04-05
- Q: How should the panel hierarchy be configured? → A: Database tables managed via API and Settings page (Feature 006). Also supports device/circuit display name editing.
- Q: What unit should be stored in PostgreSQL? → A: Watts (converted from kWh at ingestion time). Consistent with EP Cube pattern.
- Q: How many API calls per poll cycle? → A: Single `get_device_list_usage` call with all device GIDs. Offline devices return `None` channels; online devices unaffected. Retries disabled to avoid blocking 1s poll loop.
- Q: What is the data retention strategy? → A: 1-second data retained for 7 days, then downsampled to 1-minute averages. Vue-specific (YAGNI — generalize when needed).
- Q: Where should deduplication happen? → A: Query time only. Raw data is the source of truth. Hierarchy changes immediately apply to all queries including historical.
- Q: What is the source of truth for circuit names? → A: Emporia app names are the default; Settings page can override with custom display names.
- Q: Should the Vue exporter share a process with EP Cube? → A: Defer to planning phase.
- Q: Should the downsampling mechanism be generic? → A: No (YAGNI). Vue-specific for now.
- Q: Is the device count hardcoded to 4? → A: No. System supports any number of Vue devices on the account.
- Q: Should the US4 NEEDS CLARIFICATION marker stay? → A: Yes — intentionally deferred.

## User Scenarios & Testing

### User Story 1 — Ingest Vue Circuit Data (Priority: P1)

As a homeowner with Emporia Vue devices monitoring my electrical panels, I want the system to automatically retrieve power readings from all Vue devices and store them in the database, so I have circuit-level visibility into my home's energy consumption.

**Why this priority**: Without data ingestion, nothing else works. This is the foundation — polling the Emporia cloud API, authenticating, retrieving per-circuit power readings, and writing them to PostgreSQL.

**Independent Test**: After deployment, the exporter debug page shows Emporia Vue retrieval status (last poll time, device count, circuit count, any errors). PostgreSQL contains circuit-level power readings from all Vue devices. Data is no more than 2 minutes old.

**Acceptance Scenarios**:

1. **Given** the exporter is configured with Emporia Vue credentials, **When** the exporter polls, **Then** it retrieves power readings for all circuits across all Vue devices and writes them to PostgreSQL.
2. **Given** a Vue device is offline or unreachable, **When** the exporter polls, **Then** it logs the error for that device but continues polling the remaining devices without interruption.
3. **Given** the Emporia cloud API authentication token expires, **When** the exporter detects the expiry, **Then** it re-authenticates automatically and resumes polling without data loss.
4. **Given** the exporter debug page is loaded, **When** Vue polling is active, **Then** the debug page shows Vue-specific status: last successful poll time, number of devices, number of circuits, and any active errors.

---

### User Story 2 — Deduplicate Nested Panel Measurements (Priority: P2)

As a homeowner whose main panel feeds downstream subpanels (some of which have their own Vue monitors), I want the system to automatically subtract nested panel draws from parent panel totals, so I see the true unique power consumption of each panel without double-counting.

**Why this priority**: Without deduplication, the total home consumption would be inflated by the overlapping measurements. This is the data integrity layer that makes the readings meaningful.

**Independent Test**: Query the API for the main panel's unique consumption. Compare it to the raw main panel reading minus the sum of all directly-monitored downstream subpanels. The values match. No circuit appears in more than one panel's unique total.

**Acceptance Scenarios**:

1. **Given** main panel monitors the feed to workshop subpanel, and workshop subpanel has its own Vue device, **When** the system computes main panel's unique draw, **Then** it subtracts workshop subpanel's total draw from main panel's total.
2. **Given** main panel also feeds pool subpanel which does NOT have a Vue device, **When** the system computes main panel's unique draw, **Then** pool subpanel's draw remains included in the main panel total (it cannot be separated).
3. **Given** the panel hierarchy is configured, **When** a new circuit is added to any Vue device, **Then** the deduplication adjusts automatically without configuration changes (it operates on the panel-level totals, not individual circuits).

---

### User Story 3 — Expose Vue Data Through an API (Priority: P3)

As a dashboard user, I want to query Vue circuit data through a REST API, so I can view circuit-level power consumption in the dashboard or any other consumer.

**Why this priority**: The API is the bridge between storage and display. Without it, the dashboard can't render Vue data. The API may be a new dedicated service, an extension to an existing service, or a combination — the architecture decision will be made during planning based on how well the data models align.

**Independent Test**: Call the API endpoints for Vue devices and circuits. Responses include per-circuit power readings, panel totals (both raw and deduplicated), and time-series data with timestamps and values.

**Acceptance Scenarios**:

1. **Given** Vue data is stored in PostgreSQL, **When** the API is queried for Vue devices, **Then** it returns a list of Vue devices with their panels and circuits.
2. **Given** Vue data is stored in PostgreSQL, **When** the API is queried for circuit-level readings, **Then** it returns time-series data with timestamps and values.
3. **Given** the panel hierarchy is configured, **When** the API is queried for a panel's deduplicated total, **Then** it returns the panel's unique consumption with nested panels subtracted.

---

### User Story 4 — Display Vue Data on the Dashboard (Priority: P4)

As a homeowner, I want to see my circuit-level energy consumption on the dashboard in various visualizations, so I can identify which circuits and appliances are consuming the most power.

**Why this priority**: This is the user-facing value. Requirements for specific visualizations will be defined later — this story captures the intent that Vue data must be displayable on a dashboard.

**Independent Test**: The dashboard shows Vue circuit data in at least one visualization format. The data refreshes automatically and matches what the API returns.

**Acceptance Scenarios**:

1. **Given** the dashboard is loaded, **When** Vue data is available, **Then** at least one view shows circuit-level power consumption from the Vue devices.
2. **Given** the dashboard displays Vue data, **When** the data refreshes, **Then** the visualization updates without manual page reload.

[NEEDS CLARIFICATION: Specific visualization types and layouts to be defined in a follow-up — Steve said "to be defined later"]

---

### Edge Cases

- What happens when one of the Vue devices is offline? The system continues ingesting from the others and marks the offline device's data as stale.
- What happens when the Emporia cloud API is completely unreachable? The exporter logs the error, retries on the next poll cycle, and the debug page shows the API connectivity failure.
- What happens when a new circuit is added to a Vue device? The system discovers it automatically on the next poll (the Emporia API returns all channels per device).
- What happens when the panel hierarchy changes (e.g., a new subpanel is added)? The hierarchy configuration must be updated manually — the system cannot infer physical wiring from the API data alone.

## Requirements

### Functional Requirements

- **FR-001**: The exporter MUST poll the Emporia Vue cloud API at a configurable interval (default: 1 second, using the `1S` scale) to retrieve power readings for all configured Vue devices in a single API call (`get_device_list_usage`). Retries MUST be disabled (`max_retry_attempts=1`) to prevent blocking the poll loop when devices return `None`. If the Emporia API rate-limits requests, the exporter MUST automatically back off to the next coarser scale (`1MIN`) and log the rate-limit event.
- **FR-002**: The exporter MUST authenticate with the Emporia cloud API using username/password credentials, with automatic token refresh on expiry.
- **FR-003**: The exporter MUST retrieve per-circuit energy readings for every channel on every configured Vue device, including the panel mains (total power in/out). The Emporia API returns kWh over the poll interval; the exporter MUST convert to watts at ingestion time (`watts = kWh / scale_hours * 1000`).
- **FR-004**: The exporter MUST write only raw Vue power readings in watts to PostgreSQL. No deduplication at write time — raw data is the source of truth.
- **FR-005**: The exporter MUST continue polling remaining Vue devices when one or more devices fail, logging errors per-device without stopping the poll cycle.
- **FR-006**: The exporter debug page MUST display Vue-specific status: last successful poll time, device count, circuit count, per-device online/error status.
- **FR-007**: The system MUST support configurable panel hierarchy stored in the database, defining which panels are nested under other panels, enabling deduplication of overlapping measurements. The hierarchy MUST be editable via the API and the dashboard Settings page without redeployment.
- **FR-008**: The API MUST compute deduplicated panel totals at query time by subtracting the total draw of all directly-monitored downstream subpanels from the parent panel's raw total, using the current panel hierarchy configuration. This ensures hierarchy changes immediately apply to all queries (including historical data) without reprocessing.
- **FR-009**: The API MUST expose Vue device and circuit data through authenticated JSON endpoints that support time-series queries.
- **FR-010**: The API MUST expose both raw and deduplicated panel totals for panels that have nested subpanels.
- **FR-011**: The dashboard MUST be able to display Vue circuit data in at least one visualization format (specific formats to be defined later).
- **FR-011a**: The dashboard Settings page MUST allow users to rename Vue devices and circuits for display purposes. Display names MUST be stored in the database and used in all dashboard views and API responses. Changes take effect without redeployment.
- **FR-012**: Vue credentials (username/password) MUST be stored securely (environment variables or Key Vault), never in source code or client-side code.
- **FR-013**: The API MUST authenticate all Vue data endpoints using Microsoft Entra ID bearer tokens with `user_impersonation` scope enforcement. Unauthenticated requests MUST be rejected with HTTP 401.
- **FR-014**: The exporter debug page MUST require authentication in Azure deployments, with a development-only auth bypass for local work.
- **FR-015**: The exporter MUST emit structured logs for authentication failures, API connectivity errors, and per-device polling errors.
- **FR-016**: The system MUST retain 1-second resolution Vue data for 7 days, then downsample to 1-minute averages for long-term storage. The downsampling process MUST run automatically without manual intervention. This is Vue-specific; generalize only when a second data source needs different retention.

### Key Entities

- **Vue Device**: An Emporia Vue energy monitor installed in an electrical panel. Attributes: device_gid (unique ID), device_name, panel_name, online status.
- **Circuit Channel**: An individual circuit monitored by a Vue device. Attributes: channel_number, channel_name, parent device, power reading (watts).
- **Panel Hierarchy**: Configuration defining which panels are downstream of other panels. Attributes: parent panel, child panels. Used for deduplication.
- **Panel Total**: Aggregated power reading for an entire panel. Two variants: raw (sum of all circuits) and deduplicated (raw minus nested panel draws).

## Success Criteria

### Measurable Outcomes

- **SC-001**: All Vue devices on the account are polled successfully and circuit data appears in PostgreSQL within 2 minutes of deployment.
- **SC-002**: Deduplicated panel totals are mathematically correct: parent_unique = parent_raw - sum(child_raw) for all configured parent-child relationships.
- **SC-003**: The exporter debug page shows Vue status within 5 seconds of loading.
- **SC-004**: API response time for Vue circuit queries is under 500ms for current readings and under 2 seconds for 30-day historical queries.
- **SC-005**: A single Vue device failure does not affect polling of the other devices.
- **SC-006**: 100% test coverage on all new code (constitution requirement).
- **SC-007**: All Vue data endpoints require valid authentication and scope. No unauthenticated data access.

## Assumptions

- The Emporia Vue cloud API (accessed via PyEmVue library) remains available and stable. There is no official Emporia developer API — the library reverse-engineers the consumer API.
- The system supports any number of Vue devices on the account. Currently 4 devices are installed: Main Panel, Sub-Panel 1, Workshop Sub-Panel, and one additional panel. Pool sub-panel does NOT have a Vue device.
- Panel hierarchy is relatively static — it changes only when physical electrical work is done. Stored in the database and managed via the Settings page.
- The PyEmVue library (Python, MIT license) handles authentication, token management, and API communication. Whether the Vue exporter shares a process with the EP Cube exporter or runs independently will be decided during planning.
- Circuit names are initially populated from the Emporia app via the API. The Settings page can override any device or circuit name with a custom display name; if no override exists, the Emporia name is used.

## Dependencies

- **Feature 006 (Dashboard Settings Page)**: MUST be implemented before Feature 005. The Settings page provides: runtime-configurable polling intervals, panel hierarchy management, and device/circuit display name editing — all stored in the database and editable without redeployment.

## Out of Scope

- Local/on-device API access (Vue devices communicate only via Emporia's cloud)
- Automatic inference of panel hierarchy from wiring (requires manual configuration)
- Specific dashboard visualization designs (US4 — to be defined later)
- Historical backfill from Emporia's stored data (future enhancement)
