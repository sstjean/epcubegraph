# Research: Dashboard Vue Circuit Display

**Branch**: `007-dashboard-vue-circuits` | **Date**: 2026-04-09

## R1: Vue-to-EP Cube Mapping Storage

**Decision**: Single settings key `vue_device_mapping` stored as JSON in the existing `settings` table.

**Rationale**: The settings table already exists with key-value storage. The mapping is a simple dictionary (`{epcube_device_id: [vue_gid, ...]}`) that changes rarely. Using a single key avoids a new table for a simple configuration value. The `settings` table already supports string values; the API will store the mapping as a JSON string and the dashboard will parse it client-side.

**Alternatives considered**:
- Dedicated `vue_device_mapping` table with FK columns: Rejected — overkill for a simple mapping that changes rarely. Adds migration complexity for a few rows.
- Store mapping in dashboard config/env: Rejected — not persisted, not editable at runtime.

**Implementation detail**: The Settings API will need `vue_device_mapping` added to `PollIntervalKeys` (renamed to something broader, or a separate allowed set). The validation logic differs from poll intervals — it should validate JSON structure rather than integer range.

## R2: Daily kWh Data Pipeline (Exporter → PostgreSQL → API → Dashboard)

**Decision**: New `vue_readings_daily` table written by the exporter on a configurable interval (default 5 minutes). New bulk API endpoint `GET /vue/readings/daily` returns all devices' daily kWh. Dashboard fetches this on the Circuits page.

**Rationale**: Follows the established exporter-writes/API-reads pattern from Feature 005. PyEmVue provides daily-scale queries directly from Emporia's API, so kWh values come pre-aggregated from the source rather than computing from raw 1-second data. Keeping PyEmVue calls in Python (exporter) maintains the existing architecture boundary.

**Alternatives considered**:
- Compute daily kWh from `vue_readings` in the API (SQL SUM): Rejected — would require scanning millions of 1-second rows per query. PyEmVue already provides daily aggregates from Emporia.
- Dashboard computes kWh from current readings: Rejected — would lose accumulated data when the dashboard isn't open.

**Schema** (from spec clarification):
```sql
CREATE TABLE IF NOT EXISTS vue_readings_daily (
    device_gid BIGINT NOT NULL,
    channel_num TEXT NOT NULL,
    date DATE NOT NULL,
    kwh DOUBLE PRECISION NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(device_gid, channel_num, date)
);
```

## R3: Bulk Current Readings Endpoint

**Decision**: New `GET /vue/readings/current` endpoint returning all devices' current readings in a single call.

**Rationale**: The existing per-device endpoint (`GET /vue/devices/{gid}/readings/current`) works but requires N calls for N devices. For flow cards and the Circuits page, the dashboard needs all devices at once. A bulk endpoint reduces round-trips from N to 1.

**Schema** (response):
```json
{
  "devices": [
    {
      "device_gid": 12345,
      "timestamp": 1712592000,
      "channels": [
        { "channel_num": "1,2,3", "display_name": "Main", "value": 8450.5 },
        { "channel_num": "4", "display_name": "Kitchen", "value": 1200.0 }
      ]
    }
  ]
}
```

## R4: Vue Circuit Polling Interval for Dashboard

**Decision**: Separate configurable interval, default 1 second. Implemented as a distinct polling loop in the dashboard, independent of the 30-second EP Cube polling.

**Rationale**: Vue data is real-time (1-second resolution). The EP Cube 30-second interval would be too slow for circuit-level visibility. The separate loop allows each data source to poll at its natural cadence. The interval is already defined as a setting key (`vue_poll_interval_seconds`) from Feature 006.

**Implementation detail**: The `CurrentReadings` component currently uses a single `createPollingInterval` at 30 seconds. Feature 007 needs a second polling loop for Vue data at 1-second intervals, or the component needs to read the configured interval from settings.

**Alternatives considered**:
- Single unified poll at fastest interval (1s): Rejected — would blast the EP Cube API at 1s instead of its natural 30s cadence.
- Use WebSockets/SSE from API: Rejected — YAGNI, polling works fine at 1s.

## R5: Flow Card Circuit Layout

**Decision**: Two columns flanking the Home node (left and right sides). Left column fills first, overflow goes to right. Small text (0.75em), name left-aligned / watts right-aligned on same line, tight spacing.

**Rationale**: The flow card SVG already has a clear bottom region between Gateway→Home and the Home node. Two columns fit naturally in the horizontal space flanking Home. Left-fill-first keeps the common case (few circuits) visually balanced.

**Implementation detail**: The flow card is an SVG (`380×380` viewBox). Circuit entries will be rendered as SVG `<text>` elements below the Home node area, or as HTML elements positioned absolutely over the SVG. HTML overlay is simpler for text layout and wrapping. Mains excluded (redundant with Home total), Balance included (real unmonitored load).

**Alternatives considered**:
- Single column below Home: Rejected — wastes horizontal space, gets tall with many circuits.
- Render as HTML list outside the SVG: Rejected — breaks visual containment in the card.

## R6: Circuits Page Panel Ordering

**Decision**: Top-level panels without children first (alphabetical), then parent panels each followed immediately by their children (alphabetical). Flat layout, all panels at same visual level.

**Rationale**: Matches the spec requirement (FR-014). Flat layout keeps the initial implementation simple while still conveying the hierarchy through ordering. Parents are adjacent to their children without requiring collapsible/nesting UI.

**Implementation detail**: Requires the panel hierarchy data from `GET /settings/hierarchy` to determine parent-child relationships, then sort accordingly. The dashboard already fetches hierarchy via the Settings API.

## R7: Settings Page Mapping Editor

**Decision**: Visual mapping editor on the Settings page for assigning Vue panels to EP Cube devices. Auto-discovers devices from existing API endpoints (`GET /devices` for EP Cube, `GET /vue/devices` for Vue). No manual GID entry — dropdowns or drag-drop.

**Rationale**: The spec explicitly requires a visual editor (clarification Q18-Q19). Auto-discovery from existing endpoints avoids manual GID entry errors.

**Implementation detail**: The Settings page already has independent section saves. The mapping editor becomes a new section. It fetches both device lists, renders EP Cube devices as targets with assigned Vue panels shown under each, and an unassigned pool. Save writes the JSON mapping to `PUT /settings/vue_device_mapping`.

## R8: Settings API Allowlist Extension

**Decision**: Add `vue_device_mapping` and `vue_daily_poll_interval_seconds` to the Settings API allowlist. The validation logic for `vue_device_mapping` differs from poll intervals — it validates JSON structure (object with string keys and array-of-number values) rather than integer range.

**Rationale**: The current `HandleUpdateSetting` only accepts `PollIntervalKeys`. The mapping is a different data type requiring different validation. Options: (a) separate handler for JSON settings, (b) extend the existing handler with type-aware validation.

**Decision**: Extend `HandleUpdateSetting` with a union of allowed keys, each with its own validation. Keep the single endpoint pattern.

## R9: "Today" Boundary for Daily kWh

**Decision**: User's browser local timezone. The dashboard passes the local date when fetching daily data.

**Rationale**: The spec clarification says "Always assume user's local timezone unless otherwise specified." The exporter polls Emporia's daily-scale API which returns kWh by day. The API stores the `date` column as `DATE` (no timezone). The dashboard knows the user's local date and requests data for that date.

**Implementation detail**: The API endpoint `GET /vue/readings/daily` accepts an optional `date` query parameter (ISO date string, e.g., `2026-04-09`). If omitted, returns today's data based on server timezone. The dashboard should always pass the local date explicitly.
