# Feature Specification: Dashboard Settings Page

**Feature Branch**: `005-emporia-vue` (developed as prerequisite on the same branch)
**Created**: 2026-04-05
**Status**: Draft
**Input**: Dashboard Settings page for runtime configuration management. View and modify system settings without redeployment: polling intervals, panel hierarchy, device/circuit display names. Stored in PostgreSQL, exposed through API endpoints.

## User Scenarios & Testing

### User Story 1 — View and Modify Polling Intervals (Priority: P1)

As a system administrator, I want to adjust polling intervals for data sources (EP Cube exporter, Emporia Vue exporter) from the dashboard without redeploying, so I can tune data freshness vs. API load in real time.

**Why this priority**: Polling intervals are the most operationally impactful setting — too fast risks rate limiting, too slow loses data freshness. Being able to adjust without redeployment is the core value proposition of this feature.

**Independent Test**: Open the Settings page, change the Vue polling interval from 1s to 5s, confirm the exporter picks up the new interval on the next cycle. Change it back and confirm again.

**Acceptance Scenarios**:

1. **Given** the Settings page is loaded, **When** the user views polling settings, **Then** the current interval for each data source is displayed with its current value.
2. **Given** the user changes a polling interval, **When** the change is saved, **Then** the new value is persisted in the database and the exporter uses it on the next poll cycle.
3. **Given** the user enters an invalid interval (e.g., 0, negative, or exceeding maximum), **When** the user tries to save, **Then** the Settings page shows a validation error and does not persist the invalid value.

---

### User Story 2 — Manage Panel Hierarchy (Priority: P2)

As a homeowner, I want to define which electrical panels are nested under other panels from the dashboard, so the system can deduplicate overlapping power measurements without me editing config files.

**Why this priority**: Panel hierarchy is required for Feature 005 (Emporia Vue) deduplication. Without a UI to manage it, users would need direct database access or environment variable changes.

**Independent Test**: Open the Settings page, add a parent-child relationship (Main Panel → Workshop Sub-Panel), save, and verify the API returns deduplicated totals reflecting the new hierarchy.

**Acceptance Scenarios**:

1. **Given** the Settings page is loaded, **When** the user views the panel hierarchy section, **Then** it shows the current parent-child relationships between panels.
2. **Given** the user adds a new parent-child relationship, **When** the change is saved, **Then** the hierarchy is persisted and the API immediately uses it for deduplication queries.
3. **Given** the user removes a parent-child relationship, **When** the change is saved, **Then** the previously-nested panel is no longer subtracted from the parent's total.
4. **Given** the user tries to create a circular hierarchy (A→B→A), **When** the user tries to save, **Then** the Settings page shows a validation error and rejects the circular reference.

---

### User Story 3 — Rename Devices and Circuits (Priority: P3)

As a homeowner, I want to override the default device and circuit names with my own display names from the dashboard, so the UI shows meaningful labels like "Kitchen Fridge" instead of "Circuit 7."

**Why this priority**: Display names improve usability across all dashboard views. The underlying device IDs and Emporia-assigned names are preserved — only the display layer changes.

**Independent Test**: Open the Settings page, rename a circuit from its Emporia default to a custom name, save, and verify the dashboard and API responses show the new name.

**Acceptance Scenarios**:

1. **Given** the Settings page shows the device/circuit list, **When** the user views a circuit, **Then** it shows the current display name (custom if set, otherwise the Emporia default).
2. **Given** the user sets a custom display name for a circuit, **When** the change is saved, **Then** the dashboard and API responses use the custom name.
3. **Given** the user clears a custom display name, **When** the change is saved, **Then** the system reverts to the Emporia default name.

---

### Edge Cases

- What happens when the exporter reads a setting while the user is saving a change? The exporter reads the committed database value — PostgreSQL transactions ensure consistency. No partial reads.
- What happens when the Settings page is opened by two users simultaneously? Last-write-wins — the most recent save overwrites the previous. Single-user system, so this is acceptable.
- What happens when the database has no settings rows (first deployment)? The system uses hardcoded defaults and creates the rows on first save.
- What happens when a Vue device is removed from the Emporia account? Its display name override persists in the database but has no effect (no data to display). Orphaned overrides can be cleaned up manually.

## Requirements

### Functional Requirements

- **FR-001**: The dashboard MUST provide a Settings page accessible via navigation, protected by the same Entra ID authentication as other pages.
- **FR-002**: The Settings page MUST display current polling intervals for each data source (EP Cube, Emporia Vue) with the ability to modify each independently.
- **FR-003**: The Settings page MUST validate polling interval inputs: minimum 1 second, maximum 3600 seconds (1 hour). Invalid values MUST be rejected with a clear error message before saving.
- **FR-004**: The Settings page MUST display the current panel hierarchy as a parent-child tree and allow adding or removing relationships.
- **FR-005**: The Settings page MUST validate panel hierarchy changes — circular references MUST be rejected.
- **FR-006**: The Settings page MUST display all known devices and circuits with their current display names (custom override or source default) and allow editing.
- **FR-007**: Clearing a custom display name MUST revert to the source system's default name (e.g., Emporia app name).
- **FR-008**: All settings MUST be stored in PostgreSQL and exposed through authenticated API endpoints (GET to read, PUT/PATCH to update).
- **FR-009**: Settings changes MUST take effect on the next poll cycle without requiring exporter restart or redeployment.
- **FR-010**: The API MUST authenticate all settings endpoints using Microsoft Entra ID bearer tokens with `user_impersonation` scope. Unauthenticated requests MUST be rejected with HTTP 401.
- **FR-011**: The exporter(s) MUST read polling interval settings from the database on each poll cycle (or cache with a short TTL) so changes take effect promptly.

### Key Entities

- **Setting**: A key-value configuration entry. Attributes: key (unique), value (JSON), last_modified timestamp, modified_by.
- **Panel Hierarchy Entry**: A parent-child relationship between two panels. Attributes: parent_device_gid, child_device_gid.
- **Display Name Override**: A custom name for a device or circuit. Attributes: device_gid, channel_number (null for device-level), display_name.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A user can change any setting from the dashboard and see the change reflected in system behavior within one poll cycle.
- **SC-002**: All Settings page operations (load, save) complete within 500ms.
- **SC-003**: Invalid inputs are caught and rejected before reaching the database.
- **SC-004**: 100% test coverage on all new code (constitution requirement).
- **SC-005**: All settings endpoints require valid authentication. No unauthenticated access.

## Assumptions

- Single-user system — no concurrent editing conflicts to handle beyond last-write-wins.
- The exporter(s) have database read access for settings. The API has read-write access.
- Default polling intervals: EP Cube = 30 seconds, Emporia Vue = 1 second.
- Panel hierarchy only applies to Emporia Vue devices (EP Cube devices don't have nested panels).

## Dependencies

- **Feature 002 (Web Dashboard)**: COMPLETE — provides the dashboard framework, routing, and auth.
- **Feature 001 (Data Ingestor)**: COMPLETE — provides the PostgreSQL database and exporter infrastructure.

## Out of Scope

- Role-based access control for settings (single user — all authenticated users can modify all settings)
- Settings import/export
- Settings change audit log (last_modified timestamp on the entry is sufficient)
- Undo/revert for settings changes
