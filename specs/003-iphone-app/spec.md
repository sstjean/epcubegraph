# Feature Specification: iPhone App for Energy Telemetry

**Feature Branch**: `003-iphone-app`  
**Created**: 2026-03-07  
**Status**: Draft  
**Input**: User description: "Native iPhone application for viewing EP Cube energy telemetry data"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Current Energy Readings on iPhone (Priority: P1)

As the system owner, I want to open an app on my iPhone and immediately see the current state of my solar generation, battery charge/discharge, and grid import/export so that I can monitor my energy system on the go.

The iPhone app connects to the telemetry API (feature 001-data-ingestor) and displays the latest readings for all connected EP Cube gateway devices. The interface is optimised for the iPhone screen size and touch interaction.

**Why this priority**: Seeing current readings is the primary use case and validates end-to-end connectivity from the server API to the mobile device.

**Independent Test**: Open the app on an iPhone while the data ingestor is running. Verify current solar, battery, and grid values are displayed and refresh within one collection interval.

**Acceptance Scenarios**:

1. **Given** telemetry data exists in the store, **When** I open the iPhone app, **Then** I see current solar, battery, and grid readings for each connected device.
2. **Given** the ingestor has just collected new data, **When** I view the app, **Then** the displayed readings are no more than one collection interval old (default: 5 minutes).
3. **Given** a device is offline and no recent data exists, **When** I view the app, **Then** the device is shown with a clear "offline" or "stale data" indicator.

---

### User Story 2 - View Historical Energy Graphs on iPhone (Priority: P2)

As the system owner, I want to view historical graphs of my energy data on my iPhone so that I can check trends and past performance while away from my desk.

The app provides interactive graphs showing solar generation, battery activity, and grid usage over selectable time ranges (today, last 7 days, last 30 days, custom range). Graphs are touch-friendly with pinch-to-zoom and swipe gestures.

**Why this priority**: Historical data analysis on mobile makes the app meaningfully useful beyond a simple status display.

**Independent Test**: With at least 7 days of data in the store, select each predefined time range on the iPhone and verify graphs render correctly.

**Acceptance Scenarios**:

1. **Given** at least 7 days of historical data exists, **When** I select a 7-day time range, **Then** a graph displays solar, battery, and grid data over that period.
2. **Given** at least 30 days of historical data exists, **When** I select a 30-day time range, **Then** the graph renders within 3 seconds on a typical mobile connection.
3. **Given** I select a custom date range, **When** the graph renders, **Then** it shows only data within the specified range.
4. **Given** no data exists for a requested time range, **When** I view that range, **Then** the app clearly indicates no data is available.

---

### User Story 3 - Offline Handling on iPhone (Priority: P3)

As the system owner, I want the iPhone app to handle network interruptions gracefully so that I still have some visibility into my energy system even when my phone is offline.

When the device has no network connectivity, the app displays a clear offline indicator and shows the most recently cached data with a timestamp indicating when it was last updated.

**Why this priority**: Reliable offline behaviour ensures the app is usable in areas with intermittent connectivity and avoids confusing the user with stale-looking data.

**Independent Test**: Load the app while online (to populate cache), then enable airplane mode and reopen the app. Verify the offline indicator appears and cached data is visible.

**Acceptance Scenarios**:

1. **Given** the device has no network connectivity, **When** I open the iPhone app, **Then** I see a clear offline indicator.
2. **Given** the device is offline and cached data exists, **When** I view the app, **Then** previously loaded readings are displayed with a "last updated" timestamp.
3. **Given** the device was offline and connectivity is restored, **When** the app detects the network, **Then** it automatically refreshes to show current data.

---

### Edge Cases

- What happens when the authentication token expires while the app is in the background? The app must prompt for re-authentication without losing the current view context.
- What happens when the API returns an unexpected error? The app must display a user-friendly error message and offer retry.
- What happens when the iPhone is in Low Power Mode? The app must still function correctly, though background refresh may be reduced.
- What happens when the user force-quits and relaunches the app? The app must restore to the last viewed screen or default to the current readings view.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: App MUST be a native iPhone application targeting a currently supported iOS version.
- **FR-002**: App MUST display current solar generation, battery charge/discharge, and grid import/export readings for each connected device.
- **FR-003**: App MUST display readings that are no more than one collection interval old (default: 5 minutes) when online.
- **FR-004**: App MUST provide interactive historical graphs with selectable time ranges: today, last 7 days, last 30 days, and custom date range.
- **FR-005**: App MUST render graphs for up to 30 days of data within 3 seconds on a typical mobile connection.
- **FR-006**: App MUST clearly indicate when a device is offline or data is stale.
- **FR-007**: App MUST display a clear offline indicator when the device has no network connectivity.
- **FR-008**: App MUST cache the most recent data for offline viewing with a "last updated" timestamp.
- **FR-009**: App MUST automatically refresh data when connectivity is restored after an offline period.
- **FR-010**: All API access MUST be authenticated per the constitution's security requirements.
- **FR-011**: App MUST consume data exclusively through the versioned API from feature 001-data-ingestor.

### Key Entities

- **Device Summary**: A compact view of an EP Cube gateway's current status. Attributes: device name, model, current readings, online/offline status.
- **Reading Display**: A formatted presentation of a telemetry value. Attributes: measurement type, value, unit, timestamp, freshness indicator.
- **Graph View**: An interactive chart of historical data. Attributes: time range, selected devices, measurement types, zoom level.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Current readings load within 3 seconds on a typical mobile connection.
- **SC-002**: Historical graphs for up to 30 days of data render within 3 seconds.
- **SC-003**: The app displays readings that are no more than one collection interval old when online.
- **SC-004**: Cached data is available within 1 second when the device is offline.
- **SC-005**: 100% of API access is authenticated; no unauthenticated requests are made by the app.
- **SC-006**: The app functions correctly on all iPhone models running a currently supported iOS version.

## Assumptions

- The telemetry API from feature 001-data-ingestor is available and operational.
- A single user (the system owner) is the primary consumer; multi-user accounts are not required.
- The app will be distributed via TestFlight or direct installation (App Store distribution is out of scope for this feature unless specified).
- iPhone-specific design only; iPad support is a separate feature (004-ipad-app).

## Dependencies

- **001-data-ingestor**: The iPhone app depends on the versioned telemetry API provided by the data ingestor feature.
