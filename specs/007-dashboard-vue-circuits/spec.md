# Feature Specification: Dashboard Vue Circuit Display

**Feature Branch**: `007-dashboard-vue-circuits`
**Created**: 2026-04-08
**Status**: Draft
**Input**: Show Vue circuits in the empty areas of the EP Cube flow diagram cards. Display only circuits with >0 watts, ordered ascending by watts, showing the circuit name/alias and watt value. Also add a dedicated page showing circuits grouped by panel (MVP — basic structure, will evolve).

## User Scenarios & Testing

### User Story 1 — Display Active Vue Circuits in Flow Diagram (Priority: P1)

As a homeowner viewing the Current Readings page in Flow mode, I want to see which electrical circuits are actively consuming power, displayed in the empty areas at the bottom of each EP Cube flow diagram card, so I can quickly identify what's drawing power in my home alongside the solar/grid/battery overview.

**Why this priority**: This is the entire feature — showing circuit-level consumption data inline with the existing energy flow visualization. Without this, Vue circuit data has no visibility on the main dashboard view.

**Independent Test**: Load the dashboard Current Readings page in Flow mode. The two areas flanking the Home node (bottom-left and bottom-right of each EP Cube card) show a list of Vue circuits that are currently drawing power. Each circuit shows its name and watt value. Circuits with 0 watts or less are not shown. When multiple circuits are active, they are ordered ascending by watts (lowest first).

**Acceptance Scenarios**:

1. **Given** Vue devices are reporting circuit data and the dashboard is in Flow mode, **When** the Current Readings page loads, **Then** the empty areas at the bottom-left and bottom-right of each EP Cube card display a list of active Vue circuits.
2. **Given** multiple circuits have >0 watts, **When** the circuit list renders, **Then** circuits are ordered ascending by watt value (lowest consumption first).
3. **Given** a circuit is consuming power, **When** its entry appears in the list, **Then** it shows the circuit's display name (alias if configured, otherwise the default name from the Emporia app) and its current power draw formatted as watts or kW (using the existing formatting convention: e.g., "850 W" or "1.2 kW").
4. **Given** a circuit has 0 watts or negative watts, **When** the circuit list renders, **Then** that circuit is not shown in the list.
5. **Given** the dashboard auto-refreshes data, **When** new circuit readings arrive, **Then** the circuit list updates without manual page reload — circuits may appear, disappear, or reorder as consumption changes.

---

### User Story 2 — Circuits by Panel Page (Priority: P2)

As a homeowner, I want a dedicated page on the dashboard that shows all my Vue circuits grouped by panel in a fixed layout, so I can see a complete breakdown of every circuit — including what's idle — with both current draw and how much energy each circuit has consumed today.

**Why this priority**: The flow diagram inline view (US1) shows only active circuits for at-a-glance awareness. This page provides the full organized view — every circuit on every panel, in a stable position — for when the user wants to dig deeper. This is the initial view; additional views of the data will be added over time.

**Independent Test**: Navigate to the Circuits page from the dashboard navigation. Each Vue device (panel) appears as a section with its name. Under each panel, all circuits are listed in a fixed position ordered by circuit number. Each circuit shows its display name, current power draw (watts/kW), and cumulative energy consumption for the current day (kWh). Circuits drawing 0 watts still appear in their fixed position but show 0 W.

**Acceptance Scenarios**:

1. **Given** Vue devices are reporting data, **When** the user navigates to the Circuits page, **Then** each panel appears as a labeled section containing all of its circuits (not just active ones).
2. **Given** a panel has circuits, **When** the panel section renders, **Then** circuits are listed in a fixed position ordered by circuit number (e.g., "1,2,3" mains first, then "1", "2", "3", etc.).
3. **Given** a circuit is drawing power, **When** its row renders, **Then** it shows the display name, current power draw (formatted as W or kW), and cumulative energy consumed today (formatted as kWh).
4. **Given** a circuit is drawing 0 watts, **When** its row renders, **Then** it still appears in its fixed position showing 0 W for current draw and its cumulative daily total (which may be >0 if it was active earlier today).
5. **Given** the panel hierarchy is configured, **When** the Circuits page renders, **Then** each panel shows both its raw total and its deduplicated total (raw minus nested panel draws) in the panel header.
6. **Given** the dashboard auto-refreshes, **When** new data arrives, **Then** the Circuits page updates without manual reload.

---

### User Story 3 — Graceful Display When No Circuits Are Active (Priority: P3)

As a homeowner, when no Vue circuits are drawing power (e.g., everything is off or Vue devices are offline), I want the flow diagram and Circuits page to display cleanly without empty boxes or layout artifacts, so the dashboard doesn't look broken.

**Why this priority**: Edge-case handling for a clean user experience. Without this, the dashboard may show empty containers or broken layout when there's nothing to display.

**Independent Test**: With all Vue devices offline or all circuits at 0 watts, the EP Cube flow cards render identically to how they look today — no empty boxes, no "no data" placeholders, no layout shifts. The Circuits page shows all panels and circuits in their fixed positions with 0 W values.

**Acceptance Scenarios**:

1. **Given** no Vue circuits have >0 watts, **When** the flow diagram renders, **Then** the circuit list areas are not visible — the card looks the same as before this feature was implemented.
2. **Given** Vue data is unavailable (API error or Feature 005 not yet deployed), **When** the flow diagram renders, **Then** the card renders normally without errors or visible degradation.
3. **Given** no Vue circuits have >0 watts, **When** the Circuits page renders, **Then** all panels and circuits still appear in their fixed positions showing 0 W — the layout is stable.
4. **Given** Vue data is completely unavailable, **When** the Circuits page renders, **Then** the page shows a brief message indicating Vue data is not yet available.

---

### Edge Cases

- What happens when a Vue device goes offline mid-session? On the flow card, circuits from that device disappear from the active list. On the Circuits page, the panel and all circuits remain in their fixed positions but show stale values (last known reading). No error shown to the user.
- What happens when there are many active circuits (e.g., 30+)? In the flow card: show all active circuits, letting the card grow, since the typical active count is small. On the Circuits page: all circuits always appear in their fixed positions — the page scrolls naturally.
- What happens when the display name override is set for a circuit? The overridden name is shown instead of the Emporia app name (both in flow cards and on the Circuits page).
- What happens when two circuits have the same watt value? In the flow card (sorted by watts): they appear adjacent, secondary sort alphabetical by name. On the Circuits page: irrelevant — circuits are in fixed positions by circuit number.
- What happens when a new panel is added to the hierarchy? The Circuits page picks it up on the next data refresh — no configuration needed in the dashboard.
- What happens at midnight when the cumulative daily total resets? The daily total resets to 0 kWh at the start of the new day (midnight local time). No manual action needed.

## Requirements

### Functional Requirements

- **FR-001**: The dashboard MUST display active Vue circuits (power > 0 watts) in the empty areas at the bottom-left and bottom-right of each EP Cube flow diagram card on the Current Readings Flow view.
- **FR-002**: Each circuit entry MUST show the circuit's display name and its current power reading. The display name resolves from: display name override (if configured) → Emporia app channel name → channel number.
- **FR-003**: Power values MUST be formatted consistently with the existing dashboard convention (e.g., "850 W" for values under 1000, "1.2 kW" for values at or above 1000).
- **FR-004**: When multiple circuits are active, they MUST be ordered ascending by watt value (lowest consumption first). Circuits with equal watt values MUST be ordered alphabetically by display name.
- **FR-005**: Circuits with 0 watts or negative watts MUST NOT appear in the list.
- **FR-006**: The circuit list MUST update automatically when the dashboard refreshes data, without requiring a manual page reload.
- **FR-007**: When no circuits are active or Vue data is unavailable, the circuit display areas MUST be hidden — the flow diagram card MUST render identically to its pre-feature appearance.
- **FR-008**: The circuit display MUST use the same visual style (font, colors, spacing) as the existing flow diagram to maintain visual consistency.
- **FR-009**: The dashboard MUST provide a dedicated Circuits page accessible from the main navigation that shows all Vue circuits grouped by panel (Vue device).
- **FR-010**: Each panel section on the Circuits page MUST display the panel's display name and its current power totals: raw total and deduplicated total (if the panel has children in the hierarchy).
- **FR-011**: Within each panel section, all circuits MUST be listed in a fixed position ordered by circuit number (mains "1,2,3" first, then individual circuits "1", "2", "3", etc., then "Balance"). Circuits do not reorder based on watt values.
- **FR-012**: Each circuit row on the Circuits page MUST show: the circuit's display name, its current power draw (formatted as W or kW per FR-003), and its cumulative energy consumption for the current day (formatted as kWh).
- **FR-013**: Circuits drawing 0 watts MUST still appear in their fixed position on the Circuits page, showing 0 W for current draw and their cumulative daily total.
- **FR-014**: Panels on the Circuits page MUST be listed in a consistent order (alphabetical by display name).
- **FR-015**: The Circuits page MUST auto-refresh on the same polling interval as the rest of the dashboard.
- **FR-016**: The cumulative daily energy total MUST represent the sum of energy consumed by each circuit from midnight (local time) to the current time.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Active Vue circuits appear in the flow diagram cards within 2 seconds of page load when Vue data is available.
- **SC-002**: Circuit list correctly orders by ascending watt value — verifiable by comparing displayed order to API response data.
- **SC-003**: Circuits at 0 watts never appear in the displayed list.
- **SC-004**: 100% test coverage on all new dashboard code (constitution requirement).
- **SC-005**: Flow diagram cards render identically to pre-feature appearance when no Vue data is present — no layout regression.
- **SC-006**: Circuits page loads and displays all panels with all circuits within 2 seconds.
- **SC-007**: Circuits page correctly groups circuits under their parent panel — no circuit appears under the wrong panel.
- **SC-008**: Circuit positions on the Circuits page remain stable across data refreshes — circuits do not jump or reorder.
- **SC-009**: Cumulative daily energy values are displayed for each circuit and update on each refresh.

## Assumptions

- Feature 005 (Emporia Vue energy monitoring) is fully implemented and the Vue API endpoints are available before this feature begins.
- The dashboard already fetches data on a polling interval (currently 30 seconds for EP Cube data). Vue circuit data will be fetched on the same or similar interval.
- The existing `formatKw()` utility function handles the W/kW formatting threshold correctly.
- The number of simultaneously active circuits is typically small enough (under 20) that a simple list without pagination is sufficient. If this assumption proves wrong, truncation can be added later.
- The two areas (bottom-left and bottom-right of each card) naturally split the circuit list — the exact split logic (e.g., by Vue device, left-then-right fill, or single list spanning both areas) will be determined during planning.
- The Circuits page is the initial view of circuit data. Additional views and visualizations will be added in future iterations as needs evolve.
- Cumulative daily energy data is available from the Vue API (using a daily scale query) or computed from stored 1-second/1-minute readings. The exact data source will be determined during planning.

## Dependencies

- **Feature 005 (Emporia Vue Energy Monitoring)**: MUST be implemented first. Provides the Vue API endpoints (`GET /api/v1/vue/devices`, `GET /api/v1/vue/devices/{deviceGid}/readings/current`) that this feature consumes.

## Out of Scope

- Historical circuit data views (charts, trends, time-series) — those belong to Feature 005 User Story 4.
- Circuit grouping by panel within the flow card — the flow card shows a flat list; the Circuits page shows grouped view.
- Gauge view integration — this feature targets Flow view only.
- Settings page for configuring which circuits appear — all active circuits (>0 watts) are shown automatically.
- Advanced Circuits page features (expandable/collapsible panels, search/filter, sparklines, cost estimates) — deferred to future iterations.
- Additional views of circuit data (charts, comparisons, time-of-day patterns) — this spec covers only the initial tabular view.
