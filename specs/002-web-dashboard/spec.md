# Feature Specification: Web Dashboard for Energy Telemetry

**Feature Branch**: `002-web-dashboard`  
**Created**: 2026-03-07  
**Status**: Revised  
**Input**: User description: "Web dashboard for viewing EP Cube energy telemetry data"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Current Energy Readings in a Browser (Priority: P1)

As the system owner, I want to open a web dashboard in my browser and immediately see the current state of my solar generation, battery charge/discharge, home load consumption, and grid import/export so that I can monitor my energy system at a glance.

The dashboard displays the latest readings from all connected EP Cube gateway devices. Data is sourced from the telemetry API provided by the data ingestor (feature 001-data-ingestor).

**Why this priority**: Seeing current readings is the most fundamental use case for the web dashboard and validates end-to-end data flow from gateway to screen.

**Independent Test**: Open the dashboard in a browser while the data ingestor is running. Verify that current solar, battery, home load, and grid values are displayed and update within one collection interval.

**Acceptance Scenarios**:

1. **Given** telemetry data exists in the store, **When** I open the web dashboard in a browser, **Then** I see current solar, battery, home load, and grid readings for each connected device.
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
5. **Given** grid power data exists for the selected time range, **When** I view the history page, **Then** a bar graph displays Grid Import (kWh), Solar Export (kWh), and Net (Export − Import) totals summed across both EP Cubes, with the Net bar colored green when positive (net producer) and red when negative (net consumer).

---

### Edge Cases

- What happens when the API is unreachable from the browser? The dashboard must display a clear connectivity error and offer a retry option.
- What happens when the data store contains gaps (e.g., from gateway downtime)? Graphs must render gaps as broken lines (discontinuous segments) rather than interpolating false data.
- What happens when the user's browser session expires? The dashboard must redirect to re-authentication without losing the current view state. Note: "offline" in the dashboard context is a data-staleness indicator (no recent data received from the API for that device), not a direct device connectivity probe.
- What happens when a very large time range is selected (e.g., 1 year)? The dashboard automatically downsamples to the appropriate resolution tier based on range duration and displays a notice that data is aggregated. Custom date ranges are not capped — they use the same tiered auto-selection as presets.
- What happens when the API returns data for only one of the two devices? The dashboard displays both device cards; the missing device uses the existing stale-data/offline indicator (FR-006) rather than introducing a separate "unavailable" state.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a web application accessible via modern web browsers (Chrome, Firefox, Safari, Edge — current and previous major version).
- **FR-002**: Dashboard MUST display current solar generation, battery charge/discharge (including remaining stored energy in kWh), home load consumption, and grid import/export readings for each of the 2 connected EP Cube devices, arranged in a side-by-side grid layout.
- **FR-003**: Dashboard MUST display readings that are no more than one collection interval old (default: 1 minute).
- **FR-004**: Dashboard MUST provide interactive historical graphs with selectable time ranges: today, last 7 days, last 30 days, last year, and custom date range.
- **FR-005**: Dashboard MUST render graphs for up to 30 days of data within 2 seconds.
- **FR-006**: Dashboard MUST clearly indicate when a device is offline or data is stale. Data is considered stale when it is older than 3× the collection interval (default: 3 minutes).
- **FR-007**: Dashboard MUST clearly indicate when no data exists for a selected time range.
- **FR-008**: Dashboard MUST honestly represent data gaps in graphs using broken lines (discontinuous segments that stop and resume around gaps); no false interpolation is permitted.
- **FR-009**: *Removed — Grafana integration descoped.*
- **FR-010**: All dashboard access MUST be authenticated per the constitution's security requirements.
- **FR-011**: Dashboard MUST consume data exclusively through the versioned API from feature 001-data-ingestor.
- **FR-012**: Dashboard MUST automatically poll for updated readings every 5 seconds to keep displayed data current without manual refresh.
- **FR-013**: Dashboard MUST apply tiered data resolution based on the selected time range: daily view at collection interval (default: 1 min), weekly view at hourly intervals, monthly view at daily intervals, yearly view at calendar month intervals. Custom date ranges MUST auto-select the closest matching tier based on range duration (≤1d → 1 min, ≤7d → 1h, ≤30d → 1d, >30d → calendar month). When data is downsampled, the dashboard MUST display a visible notice indicating the aggregation level.
- **FR-014**: Dashboard MUST handle authentication failures gracefully: when a token expires or Entra ID is unreachable mid-session, the dashboard MUST redirect to re-authentication while preserving the current view state (selected page, time range, filters).
- **FR-015**: Dashboard MUST use semantic HTML elements, support keyboard navigation, and maintain sufficient color contrast (≥4.5:1 ratio) for readability. No formal WCAG audit or automated accessibility test suite is required.
- **FR-016**: *Removed — duplicate of SC-001.*
- **FR-017**: Dashboard MUST provide an animated energy flow diagram as the default current-readings view, showing per-device energy flow between Solar, Grid, EP Cube gateway, Battery, and Home nodes. Flow lines animate directionally to indicate power flow direction, display power values (watts/kW), and dim to inactive when power is below 10 W. Battery node displays SOC ring, stored kWh, and charge/discharge state. A toggle allows switching between the flow diagram and the gauge dial view.
- **FR-018**: Dashboard UI MUST scale responsively to viewport size, adjusting layout, font sizes, and component dimensions across desktop and mobile breakpoints.
- **FR-019**: API MUST include CORS headers allowing the SWA dashboard origin to make cross-origin requests. The allowed origin MUST be configured via environment variable (not hardcoded) and MUST restrict methods to GET and headers to Authorization and Content-Type.
- **FR-020**: Dashboard MUST integrate Azure Application Insights for client-side error telemetry, capturing unhandled exceptions, failed API calls, and page load performance. The instrumentation connection string MUST be configured via environment variable.
- **FR-021**: Historical graphs MUST render one chart per EP Cube device (stacked vertically), each labeled with the device name and containing Solar, Battery, Home Load, and Grid series. Data from different devices MUST NOT be merged into a single chart.
- **FR-022**: Historical graph legends MUST display live values when the cursor hovers over the chart (time, and value per series). When the cursor is outside the chart, the legend MUST show the label and color swatch for each series.
- **FR-023**: Historical graph series colors MUST be consistent across all charts and MUST match their legend labels. The color-to-series mapping MUST be verified against the actual data series order.
- **FR-024**: Historical graph Y-axis MUST display values in kW (kilowatts) when values exceed 999 W, with one decimal place (e.g., "1.5 kW"). Values ≤999 W MUST display as whole watts (e.g., "750 W"). Legend hover values MUST use the same formatting.
- **FR-025**: History page MUST display a grid energy summary bar graph showing three bars: Grid Import (total kWh pulled from grid), Solar Export (total kWh pushed to grid), and Net (Export − Import). Values MUST be summed across all devices for the selected time period. kWh MUST be computed client-side from `grid_power_watts` time series fetched at hourly resolution (step=3600s) regardless of the historical chart's display step, to preserve the bidirectional import/export split that coarser buckets would collapse. The Net bar MUST be colored green when positive (net producer) and red when negative (net consumer). Energy values MUST NOT be rounded in computation; they MUST be displayed at 3 decimal places (watt-level precision: 1 W = 0.001 kWh) so bar widths and labels always agree. (#72)

### Key Entities

- **Dashboard View**: A configured display of current readings and/or historical graphs. Attributes: selected devices, selected measurement types, time range.
- **Graph**: A visual representation of a Time Series. Attributes: chart type (line), time range, data resolution, device filter.
- **User Session**: An authenticated browser session. Attributes: session identifier, authentication token, expiry.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Current readings are displayed within 2 seconds of opening the dashboard.
- **SC-002**: Historical graphs for up to 30 days of data render within 2 seconds. Measured from time-range selection to chart paint complete.
- **SC-003**: Displayed readings are no more than one collection interval old (default: 1 minute). Measured as delta between last API data timestamp and wall clock.
- **SC-004**: *Removed — Grafana integration descoped.*
- **SC-005**: 100% of dashboard access is authenticated; no unauthenticated access is possible.
- **SC-006**: The dashboard works correctly on Chrome, Firefox, Safari, and Edge (current and previous major version).
- **SC-007**: Grid energy summary bar graph correctly computes and displays Import, Export, and Net kWh totals from grid_power_watts time series data.

## Assumptions

- The telemetry API from feature 001-data-ingestor is available and operational.
- A single user (the system owner) is the primary consumer; multi-user dashboards are not required.
- The system has 2 EP Cube gateway devices. The dashboard layout is a fixed 2-device grid; dynamic device discovery or unlimited scaling is not required.
- The backend data store is PostgreSQL. The API uses a clean REST JSON contract — no Prometheus compatibility constraint. The dashboard consumes this API exclusively.
- Historical telemetry data is retained indefinitely (no automatic deletion or expiry). The dashboard time range presets and custom ranges may access the full history of stored data.


## Clarifications

### Session 2026-03-16

- Q: What age of data should trigger the stale/offline indicator? → A: 3× the collection interval (default: 3 minutes)
- Q: How should the dashboard keep current readings up to date? → A: Auto-poll every 5 seconds
- Q: How should data gaps be visualized in historical graphs? → A: Broken line (discontinuous segments, no connection across gaps)
- Q: What Grafana data source type should be used? → A: *Descoped — Grafana integration removed (FR-009).*
- Q: How should large time ranges beyond 30 days be handled? → A: Tiered downsampling — daily at collection interval, weekly at hourly, monthly at daily, yearly/custom >30d at calendar month — with visible aggregation notice. Custom ranges are unrestricted and auto-select the closest tier.

### Session 2026-03-19

- Q: What level of accessibility should the dashboard meet? → A: Basic accessibility — semantic HTML, keyboard navigable, sufficient color contrast. No formal WCAG audit or automated a11y test suite (single-user personal tool).

### Session 2026-03-22

- Q: How many EP Cube gateway devices should the dashboard support simultaneously? → A: 2 devices, displayed in a grid layout.
- Q: Does the data store migration change any dashboard-facing API contract? → A: Yes — migration to PostgreSQL is complete. The API was redesigned with a clean JSON format. No Prometheus compatibility needed.
- Q: What is the minimum data retention period for historical telemetry? → A: Indefinite (never delete, grow forever).
- Q: When the API returns data for only 1 of the 2 devices, how should the dashboard behave? → A: Show both cards; display the missing device as "offline" using the existing stale-data indicator (FR-006).
- Q: Should the dashboard expose any operational health signal beyond what the user sees in the UI? → A: Integrate Application Insights for client-side error telemetry.

### Session 2026-03-29

- Q: How should the bar graph handle coarse time steps (30d/1y) where AVG() collapses the import/export split? → A: Bar graph always fetches grid data at hourly resolution (step=3600s) regardless of the chart's display step. ~720 points per device for 30d is lightweight and preserves accuracy.
- Q: What should the bar graph show when there is no grid data for the period? → A: Show "No Grid Data" message when API returns empty series. Show zero-value bars when data exists but sums to zero.
- Q: What precision should kWh values use? → A: No rounding in computation. Display at 3 decimal places (watt-level precision: 1 W = 0.001 kWh). This ensures bar widths always match label text — the original 2-decimal rounding + 1-decimal display caused visible bars for values that displayed as "0.0 kWh". `formatKwh` updated globally to 3 decimals (also affects battery stored kWh on Current page).

## Dependencies

- **001-data-ingestor**: The web dashboard depends on the versioned telemetry API provided by the data ingestor feature.
