# Feature Specification: Web Dashboard for Energy Telemetry

**Feature Branch**: `002-web-dashboard`  
**Created**: 2026-03-07  
**Status**: Draft  
**Input**: User description: "Web dashboard for viewing EP Cube energy telemetry data with Grafana integration"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Current Energy Readings in a Browser (Priority: P1)

As the system owner, I want to open a web dashboard in my browser and immediately see the current state of my solar generation, battery charge/discharge, and grid import/export so that I can monitor my energy system at a glance.

The dashboard displays the latest readings from all connected EP Cube gateway devices. Data is sourced from the telemetry API provided by the data ingestor (feature 001-data-ingestor).

**Why this priority**: Seeing current readings is the most fundamental use case for the web dashboard and validates end-to-end data flow from gateway to screen.

**Independent Test**: Open the dashboard in a browser while the data ingestor is running. Verify that current solar, battery, and grid values are displayed and update within one collection interval.

**Acceptance Scenarios**:

1. **Given** telemetry data exists in the store, **When** I open the web dashboard in a browser, **Then** I see current solar, battery, and grid readings for each connected device.
2. **Given** the ingestor has just collected new data, **When** I view the dashboard, **Then** the displayed readings are no more than one collection interval old (default: 1 minute).
3. **Given** a device is offline and no recent data exists (data older than 3× the collection interval, default 3 minutes), **When** I view the dashboard, **Then** the device is shown with a clear "offline" or "stale data" indicator rather than displaying misleading values.

---

### User Story 2 - View Historical Energy Graphs (Priority: P2)

As the system owner, I want to view historical graphs of my energy data over selectable time ranges so that I can identify trends, compare days, and review past performance.

The dashboard provides interactive graphs (e.g., line charts) showing solar generation, battery activity, and grid usage over time. I can select predefined ranges (today, last 7 days, last 30 days, last year) or a custom date range.

**Why this priority**: Historical graphing is the primary analytical value of the system and the main reason for storing data long-term.

**Independent Test**: With at least 7 days of data in the store, select each predefined time range and verify the graph renders correctly with accurate data points.

**Acceptance Scenarios**:

1. **Given** at least 7 days of historical data exists, **When** I select a 7-day time range, **Then** a graph displays solar, battery, and grid data over that period.
2. **Given** at least 30 days of historical data exists, **When** I select a 30-day time range, **Then** the graph renders within 2 seconds.
3. **Given** I select a custom date range, **When** the graph renders, **Then** it shows only data within the specified range.
4. **Given** no data exists for a requested time range, **When** I view that range, **Then** the interface clearly indicates no data is available rather than showing a blank or misleading graph.

---

### User Story 3 - View Data via Grafana Dashboards (Priority: P3)

As the system owner, I want to use Grafana to create custom dashboards for my energy data so that I can leverage Grafana's rich visualisation and alerting capabilities as an alternative or complement to the native web dashboard.

The system exposes a data source compatible with Grafana so that Grafana can query the same telemetry data without custom middleware.

**Why this priority**: Grafana provides powerful, flexible dashboarding that may better suit advanced monitoring needs, but the native dashboard must work first.

**Independent Test**: Configure Grafana to connect to the data source, create a basic dashboard with a time-series panel, and verify it displays the same data as the native web dashboard.

**Acceptance Scenarios**:

1. **Given** Grafana is configured with the Infinity plugin to connect to the telemetry REST API, **When** I open a Grafana dashboard, **Then** I can visualise the same telemetry data with Grafana's charting tools.
2. **Given** I create a Grafana panel for solar generation over the last 7 days, **When** the panel renders, **Then** the data matches what the native web dashboard shows for the same range.
3. **Given** Grafana is connected, **When** I set up an alert threshold on battery level, **Then** Grafana can trigger alerts based on the telemetry data.

---

### Edge Cases

- What happens when the API is unreachable from the browser? The dashboard must display a clear connectivity error and offer a retry option.
- What happens when the data store contains gaps (e.g., from gateway downtime)? Graphs must render gaps as broken lines (discontinuous segments) rather than interpolating false data.
- What happens when the user's browser session expires? The dashboard must redirect to re-authentication without losing the current view state.
- What happens when a very large time range is selected (e.g., 1 year)? The dashboard automatically downsamples to the appropriate resolution tier based on range duration and displays a notice that data is aggregated. Custom date ranges are not capped — they use the same tiered auto-selection as presets.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a web application accessible via modern web browsers (Chrome, Firefox, Safari, Edge — current and previous major version).
- **FR-002**: Dashboard MUST display current solar generation, battery charge/discharge, and grid import/export readings for each connected device.
- **FR-003**: Dashboard MUST display readings that are no more than one collection interval old (default: 1 minute).
- **FR-004**: Dashboard MUST provide interactive historical graphs with selectable time ranges: today, last 7 days, last 30 days, last year, and custom date range.
- **FR-005**: Dashboard MUST render graphs for up to 30 days of data within 2 seconds.
- **FR-006**: Dashboard MUST clearly indicate when a device is offline or data is stale. Data is considered stale when it is older than 3× the collection interval (default: 3 minutes).
- **FR-007**: Dashboard MUST clearly indicate when no data exists for a selected time range.
- **FR-008**: Dashboard MUST honestly represent data gaps in graphs using broken lines (discontinuous segments that stop and resume around gaps); no false interpolation is permitted.
- **FR-009**: System MUST expose telemetry data via the existing versioned REST API in a format compatible with Grafana's Infinity plugin (generic JSON/REST data source). No separate Grafana-specific endpoint is required.
- **FR-010**: All dashboard access MUST be authenticated per the constitution's security requirements.
- **FR-011**: Dashboard MUST consume data exclusively through the versioned API from feature 001-data-ingestor.
- **FR-012**: Dashboard MUST automatically poll for updated readings at half the collection interval (default: every 30 seconds) to keep displayed data current without manual refresh.
- **FR-013**: Dashboard MUST apply tiered data resolution based on the selected time range: daily view at collection interval (default: 1 min), weekly view at hourly intervals, monthly view at daily intervals, yearly view at calendar month intervals. Custom date ranges MUST auto-select the closest matching tier based on range duration (≤1d → 1 min, ≤7d → 1h, ≤30d → 1d, >30d → calendar month). When data is downsampled, the dashboard MUST display a visible notice indicating the aggregation level.

### Key Entities

- **Dashboard View**: A configured display of current readings and/or historical graphs. Attributes: selected devices, selected measurement types, time range.
- **Graph**: A visual representation of a Time Series. Attributes: chart type (line, bar), time range, data resolution, device filter.
- **User Session**: An authenticated browser session. Attributes: session identifier, authentication token, expiry.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Current readings are displayed within 2 seconds of opening the dashboard.
- **SC-002**: Historical graphs for up to 30 days of data render within 2 seconds.
- **SC-003**: The dashboard displays readings that are no more than one collection interval old (default: 1 minute).
- **SC-004**: Grafana can query and display the same telemetry data using the Infinity plugin against the versioned REST API without custom middleware.
- **SC-005**: 100% of dashboard access is authenticated; no unauthenticated access is possible.
- **SC-006**: The dashboard works correctly on Chrome, Firefox, Safari, and Edge (current and previous major version).

## Assumptions

- The telemetry API from feature 001-data-ingestor is available and operational.
- A single user (the system owner) is the primary consumer; multi-user dashboards are not required.
- Grafana will be self-hosted or hosted on Azure alongside the server components.
- The native web dashboard and Grafana are complementary — the user may use either or both.

## Clarifications

### Session 2026-03-16

- Q: What age of data should trigger the stale/offline indicator? → A: 3× the collection interval (default: 3 minutes)
- Q: How should the dashboard keep current readings up to date? → A: Auto-poll every half collection interval (default: 30 seconds)
- Q: How should data gaps be visualized in historical graphs? → A: Broken line (discontinuous segments, no connection across gaps)
- Q: What Grafana data source type should be used? → A: Existing REST API via Grafana Infinity plugin (generic JSON/REST)
- Q: How should large time ranges beyond 30 days be handled? → A: Tiered downsampling — daily at collection interval, weekly at hourly, monthly at daily, yearly/custom >30d at calendar month — with visible aggregation notice. Custom ranges are unrestricted and auto-select the closest tier.

## Dependencies

- **001-data-ingestor**: The web dashboard depends on the versioned telemetry API provided by the data ingestor feature.
