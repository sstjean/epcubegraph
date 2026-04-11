# Feature Specification: Dashboard Vue Circuit Display

**Feature Branch**: `007-dashboard-vue-circuits`
**Created**: 2026-04-08
**Status**: Clarified
**Input**: Show Vue circuits in the empty areas of the EP Cube flow diagram cards. Display only circuits with >0 watts, ordered descending by watts (highest first), showing the circuit name/alias and watt value. Also add a dedicated page showing circuits grouped by panel (MVP — basic structure, will evolve).

## User Scenarios & Testing

### User Story 1 — Display Active Vue Circuits in Flow Diagram (Priority: P1)

As a homeowner viewing the Current Readings page in Flow mode, I want to see which electrical circuits are actively consuming power, displayed in the empty areas at the bottom of each EP Cube flow diagram card, so I can quickly identify what's drawing power in my home alongside the solar/grid/battery overview.

**Why this priority**: This is the entire feature — showing circuit-level consumption data inline with the existing energy flow visualization. Without this, Vue circuit data has no visibility on the main dashboard view.

**Independent Test**: Load the dashboard Current Readings page in Flow mode. The two areas flanking the Home node (bottom-left and bottom-right of each EP Cube card) show a list of Vue circuits that are currently drawing power. Each circuit shows its name and watt value. Circuits with 0 watts or less are not shown. When multiple circuits are active, they are ordered descending by watts (highest first).

**Acceptance Scenarios**:

1. **Given** Vue devices are reporting circuit data and the dashboard is in Flow mode, **When** the Current Readings page loads, **Then** the empty areas at the bottom-left and bottom-right of each EP Cube card display a list of active Vue circuits.
2. **Given** multiple circuits have >0 watts, **When** the circuit list renders, **Then** circuits are ordered descending by watt value (highest consumption first). Circuits with equal watt values are ordered alphabetically by display name.
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
5. **Given** the panel hierarchy is configured, **When** the Circuits page renders, **Then** each panel header shows the deduplicated total (raw minus nested panel draws). Children's totals are shown on their own panel sections.
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
- What happens when there are many active circuits (e.g., 30+)? In the flow card: show a maximum of 30 circuits (15 per column). Circuits beyond the cap are truncated (highest-watt circuits shown first). On the Circuits page: all circuits always appear in their fixed positions — the page scrolls naturally.
- What happens when the display name override is set for a circuit? The overridden name is shown instead of the Emporia app name (both in flow cards and on the Circuits page).
- What happens when two circuits have the same watt value? In the flow card (sorted by watts): they appear adjacent, secondary sort alphabetical by name. On the Circuits page: irrelevant — circuits are in fixed positions by circuit number.
- What happens when a new panel is added to the hierarchy? The Circuits page picks it up on the next data refresh — no configuration needed in the dashboard.
- What happens at midnight when the cumulative daily total resets? The daily total resets to 0 kWh at the start of the new day (midnight local time). No manual action needed.

## Requirements

### Functional Requirements

- **FR-001**: The dashboard MUST display active Vue circuits (power > 0 watts) in two columns flanking the Home node (left and right sides) of each EP Cube flow diagram card on the Current Readings Flow view. Each EP Cube card shows only circuits from Vue panels mapped to that EP Cube device via the `vue_device_mapping` setting.
- **FR-002**: Each circuit entry MUST show the circuit's display name and its current power reading. The display name resolves from: display name override (if configured) → Emporia app channel name → channel number.
- **FR-003**: Power values MUST be formatted using the existing `formatWatts()` utility function (W for values under 1000, kW for values at or above 1000). Daily energy values MUST use the existing `formatKwh()` utility.
- **FR-004**: When multiple circuits are active, they MUST be ordered descending by watt value (highest consumption first). Circuits with equal watt values MUST be ordered alphabetically by display name. The flow card MUST display a maximum of 30 circuits (15 per column); circuits beyond the cap are truncated.
- **FR-005**: Circuits with 0 watts or negative watts MUST NOT appear in the list.
- **FR-006**: The circuit list MUST update automatically when the dashboard refreshes data, without requiring a manual page reload.
- **FR-007**: When no circuits are active or Vue data is unavailable, the circuit display areas MUST be hidden — the flow diagram card MUST render identically to its pre-feature appearance.
- **FR-008**: The circuit display MUST use the same visual style (font, colors, spacing) as the existing flow diagram to maintain visual consistency.
- **FR-009**: The dashboard MUST provide a dedicated Circuits page accessible from the main navigation that shows all Vue circuits grouped by panel (Vue device).
- **FR-010**: Each panel section on the Circuits page MUST display the panel's display name and its deduplicated power total (raw minus nested panel draws). If the panel has no children, the deduplicated total equals the raw total — show the single value without a "deduplicated" label.
- **FR-011**: Within each panel section, all circuits MUST be listed in a fixed position ordered by circuit number (mains "1,2,3" first, then individual circuits "1", "2", "3", etc., then "Balance"). Circuits do not reorder based on watt values.
- **FR-012**: Each circuit row on the Circuits page MUST show: the circuit's display name, its current power draw (formatted as W or kW per FR-003), and its cumulative energy consumption for the current day (formatted as kWh).
- **FR-013**: Circuits drawing 0 watts MUST still appear in their fixed position on the Circuits page, showing 0 W for current draw and their cumulative daily total.
- **FR-014**: Panels on the Circuits page MUST be ordered: top-level panels without children first (alphabetical), then parent panels each followed immediately by their children (alphabetical).
- **FR-015**: The Circuits page MUST auto-refresh on the same polling interval as the rest of the dashboard.
- **FR-016**: The cumulative daily energy total MUST represent the sum of energy consumed by each circuit from midnight (local time) to the current time.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Active Vue circuits appear in the flow diagram cards within 2 seconds of page load when Vue data is available.
- **SC-002**: Circuit list correctly orders by descending watt value (highest first) — verifiable by comparing displayed order to API response data.
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
- The existing `formatWatts()` utility function handles the W/kW formatting threshold correctly.
- The number of simultaneously active circuits is typically small enough (under 20) that a simple list without pagination is sufficient. If this assumption proves wrong, truncation can be added later.
- The two areas (bottom-left and bottom-right of each card) naturally split the circuit list — the exact layout (single list or split) will be determined during planning.
- A `vue_device_mapping` setting in the settings table maps each EP Cube device to its associated Vue panel GIDs. Each Vue panel belongs to exactly one EP Cube. No overlap.
- The Circuits page is the initial view of circuit data. Additional views and visualizations will be added in future iterations as needs evolve.
- Cumulative daily energy data is sourced from a `vue_readings_daily` table written by the exporter (PyEmVue daily-scale poll). The API endpoint `GET /vue/devices/{gid}/readings/daily` reads from this table.

## Dependencies

- **Feature 005 (Emporia Vue Energy Monitoring)**: MUST be implemented first. Provides the Vue API endpoints (`GET /api/v1/vue/devices`, `GET /api/v1/vue/devices/{deviceGid}/readings/current`) that this feature consumes.

## Clarifications

### Session 2026-04-09
- Q: How should the dashboard get cumulative daily kWh per circuit? → A: New API endpoint `GET /vue/devices/{gid}/readings/daily` backed by PyEmVue daily-scale query, returning per-circuit kWh directly from Emporia.
- Q: How should active circuits be split across the flow diagram areas? → A: Each EP Cube card shows only the circuits from Vue panels mapped to that EP Cube. Mapping stored in settings table (e.g. `vue_device_mapping` key: `{epcube_device_id: [vue_gid, ...]}`), configurable via Settings page. No overlap — each Vue panel belongs to exactly one EP Cube.
- Q: How should the API get daily-scale kWh data from Emporia? → A: Exporter polls PyEmVue at daily scale, writes per-circuit daily kWh to a `vue_readings_daily` table in PostgreSQL. API reads from that table. Keeps PyEmVue in Python, follows existing exporter-writes/API-reads pattern.
- Q: What defines "today" for the daily kWh boundary? → A: User's browser local timezone for display purposes. API follows the same UTC/DateTimeOffset pattern as EP Cube endpoints — no timezone logic server-side. Dashboard computes the local date and passes it explicitly as a `date` query parameter. API has no server-side "today" default.
- Q: Where exactly should the circuit list render within the flow card? → A: Two columns flanking the Home node (left and right sides).
- Q: How should circuits be split between the two columns? → A: Left column fills first, overflow goes to right. All circuit names use `display_name` directly without any prefix.
- Q: What format for the Vue-to-EPCube mapping? → A: Single settings key `vue_device_mapping` with JSON. Each EP Cube maps to an array of objects with `gid` and `alias`: `{"epcube3483": [{"gid": 480380, "alias": "Main Panel"}, {"gid": 480544, "alias": "Subpanel 1"}]}`. The `alias` is the panel display name on the Circuits page.
- Q: How frequently should the exporter poll for daily kWh totals? → A: Configurable via settings table (key `vue_daily_poll_interval_seconds`, default 300 = 5 minutes).
- Q: Should mains row be visually distinct on the Circuits page? → A: Yes — mains row bold with a subtle separator line below it, individual circuits in normal weight.
- Q: Should Balance (unmonitored loads) be shown on the Circuits page? → A: Yes — show as the last circuit row, labeled "Unmonitored loads".
- Q: Should mains and Balance be shown in the flow card circuit list? → A: Exclude mains (it's the total of circuits+balance, redundant). Show Balance — it's still real load (unmonitored circuits).
- Q: Where should the Circuits page link appear in navigation? → A: Third top-level nav item: Current Readings · Circuits · Settings.
- Q: What schema for vue_readings_daily table? → A: `device_gid BIGINT, channel_num TEXT, date DATE, kwh DOUBLE PRECISION, updated_at TIMESTAMPTZ DEFAULT NOW()` with `UNIQUE(device_gid, channel_num, date)`. Exporter upserts on each daily poll.
- Q: Should Vue circuit data refresh on the same 30s interval as EP Cube? → A: No — separate interval, hardcoded to 1 second. Vue data is current/real-time. Not user-configurable for now (YAGNI).
- Q: Should the Circuits page panel header show daily kWh total? → A: Yes — panel header shows both current watts (raw + dedup) and daily kWh total (sum of all circuits).
- Q: Should the flow card circuit list show daily kWh alongside watts? → A: No — current watts only. Flow card is for real-time at-a-glance. Daily kWh belongs on the Circuits page.
- Q: Should the daily kWh API return all devices or per-device? → A: All devices in one call: `GET /vue/readings/daily` — returns all devices' daily kWh in a single response.
- Q: Should we add a bulk current readings endpoint? → A: Yes — add `GET /vue/readings/current` returning all devices' current readings in one call.
- Q: Should this feature include Settings page UI for the vue_device_mapping? → A: Yes — include a visual mapping editor on the Settings page for assigning Vue panels to EP Cube devices.
- Q: How should the mapping editor discover devices? → A: Auto-discover from existing API endpoints (`GET /devices` for EP Cube, `GET /vue/devices` for Vue). Show dropdowns/drag-drop, no manual GID entry.
- Q: Should child panels be nested under parents on the Circuits page? → A: Flat layout, all panels at same level. Ordering: top-level panels without children first (alphabetical), then parent panels each followed immediately by their children (alphabetical).
- Q: Should vue_device_mapping be added to the Settings API allowlist? → A: Yes — add to allowlisted keys so the Settings page can save it.
- Q: How should flow card circuit entries be sized? → A: Small text (0.75em), name left-aligned / watts right-aligned on same line, tight spacing.
- Q: What happens when vue_device_mapping is empty/unconfigured? → A: Flow card shows no circuits (same as no Vue data, FR-007). Circuits page shows "Configure Vue device mapping in Settings to see circuits."

## Out of Scope

- Historical circuit data views (charts, trends, time-series) — those belong to Feature 005 User Story 4.
- Circuit grouping by panel within the flow card — the flow card shows a flat list; the Circuits page shows grouped view.
- Gauge view integration — this feature targets Flow view only.
- Settings page for configuring which circuits appear — all active circuits (>0 watts) are shown automatically.
- Advanced Circuits page features (expandable/collapsible panels, search/filter, sparklines, cost estimates) — deferred to future iterations.
- Additional views of circuit data (charts, comparisons, time-of-day patterns) — this spec covers only the initial tabular view.
