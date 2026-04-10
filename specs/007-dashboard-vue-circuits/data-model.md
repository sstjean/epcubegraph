# Data Model: Dashboard Vue Circuit Display

**Branch**: `007-dashboard-vue-circuits` | **Date**: 2026-04-09

## Overview

Feature 007 adds one new PostgreSQL table (`vue_readings_daily`), two new API endpoints (bulk current readings, daily readings), extends the Settings API allowlist, and adds new TypeScript types and components to the dashboard. All Vue device/channel tables already exist from Feature 005.

## Physical Schema

### New Table: `vue_readings_daily`

Stores per-circuit cumulative daily kWh values polled from Emporia via PyEmVue daily-scale query.

| Column | Type | Notes |
|--------|------|-------|
| `device_gid` | `BIGINT NOT NULL` | Vue device identifier |
| `channel_num` | `TEXT NOT NULL` | Channel identifier (e.g., "1,2,3", "4", "Balance") |
| `date` | `DATE NOT NULL` | Calendar date of the reading |
| `kwh` | `DOUBLE PRECISION NOT NULL` | Cumulative energy consumed on this date |
| `updated_at` | `TIMESTAMPTZ DEFAULT NOW()` | Last upsert time |

**Constraints**:
- `UNIQUE (device_gid, channel_num, date)` — one row per device+channel+date, upserted on each poll

**Schema SQL**:
```sql
CREATE TABLE IF NOT EXISTS vue_readings_daily (
    device_gid BIGINT NOT NULL,
    channel_num TEXT NOT NULL,
    date DATE NOT NULL,
    kwh DOUBLE PRECISION NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (device_gid, channel_num, date)
);
```

### Existing Table: `settings`

New keys used by this feature:

| Key | Value Type | Default | Notes |
|-----|-----------|---------|-------|
| `vue_device_mapping` | JSON string | `{}` | Maps EP Cube device IDs to Vue panels with alias/prefix: `{"epcube3483": [{"gid": 480380, "alias": "Main Panel", "prefix": "M"}]}` |
| `vue_daily_poll_interval_seconds` | Integer string | `"300"` | How often the exporter polls PyEmVue for daily kWh |

### Existing Tables (no schema changes)

| Table | Used By | Notes |
|-------|---------|-------|
| `vue_devices` | Bulk current readings, Circuits page | Device metadata |
| `vue_channels` | Display name resolution | Channel metadata |
| `vue_readings` | Bulk current readings (latest per channel) | Raw 1-second data |
| `panel_hierarchy` | Circuits page panel ordering, deduplication | Parent-child relationships |
| `display_name_overrides` | Display name resolution | Custom names |
| `devices` | Mapping editor (EP Cube device list) | EP Cube devices |

## Logical Entities

### Vue Device Mapping

Links EP Cube devices to their associated Vue panels so the flow card knows which circuits to display per EP Cube card.

- **Storage**: `settings` table, key `vue_device_mapping`
- **Format**: JSON object — keys are EP Cube device IDs (strings), values are arrays of panel objects with `gid` (number), `alias` (string — panel display name for Circuits page), and `prefix` (string — short label prepended to circuit names on flow card when 2+ panels)
- **Example**: `{"epcube3483": [{"gid": 480380, "alias": "Main Panel", "prefix": "M"}, {"gid": 480544, "alias": "Subpanel 1", "prefix": "S1"}], "epcube5488": [{"gid": 480577, "alias": "Subpanel 2", "prefix": "S2"}]}`
- **Constraint**: Each Vue GID belongs to exactly one EP Cube device (no overlap)
- **Empty state**: `{}` or missing key — flow cards show no circuits, Circuits page shows configuration prompt

### Circuit Entry (Flow Card)

A single active circuit displayed inline on the flow diagram card.

- **Source**: Bulk current readings API filtered by vue_device_mapping
- **Fields**: display name (resolved), current watts
- **Filter**: watts > 0, excluding mains ("1,2,3") channels
- **Sort**: ascending by watts, then alphabetical by display name
- **Display name resolution**: display_name_overrides → vue_channels.name → "Channel {num}". Balance channel: "Unmonitored loads"
- **Format**: name left-aligned, watts right-aligned (using `formatWatts` — "850 W" / "1.2 kW")

### Circuit Row (Circuits Page)

A circuit entry in the full Circuits page view with current draw and daily energy.

- **Source**: Bulk current readings + daily readings APIs
- **Fields**: display name, current watts, daily kWh
- **Filter**: All circuits shown (including 0W), fixed position by circuit number
- **Sort**: Within panel — mains ("1,2,3") first, then numeric channels ascending, then Balance last
- **Display**: Name left, watts center, kWh right. Mains row bold with separator. Balance labeled "Unmonitored loads"

### Panel Section (Circuits Page)

A panel group header on the Circuits page.

- **Source**: Vue devices + panel hierarchy + current readings + daily readings
- **Fields**: panel display name, raw total watts, deduplicated total watts, daily kWh total
- **Dedup**: raw_total - SUM(child mains) for panels with children
- **Ordering**: Top-level panels without children first (alphabetical), then parent panels each followed by children (alphabetical)

### Daily Reading

A single circuit's cumulative energy for one calendar day.

- **Source**: `vue_readings_daily` table, written by exporter
- **Fields**: device_gid, channel_num, date, kwh
- **Lifecycle**: Exporter upserts on each daily poll (default every 5 minutes). Resets at midnight (new date = new row with 0 kWh growing through the day)

## Data Flow

```
Emporia Cloud API
    ↓ (PyEmVue daily scale query, every 5 min)
Exporter → vue_readings_daily table
    ↓ (API reads)
GET /vue/readings/daily → Dashboard Circuits page

Emporia Cloud API
    ↓ (PyEmVue 1S scale query, every 1 sec)
Exporter → vue_readings table
    ↓ (API reads latest per channel)
GET /vue/readings/current → Dashboard flow cards + Circuits page

Settings table (vue_device_mapping)
    ↓ (API reads)
GET /settings → Dashboard maps Vue panels to EP Cube cards
```

## Dashboard TypeScript Types

### New Types

```typescript
// Vue bulk current readings
interface VueCurrentChannel {
  channel_num: string;
  display_name: string;
  value: number;
}

interface VueDeviceCurrentReadings {
  device_gid: number;
  timestamp: number;
  channels: VueCurrentChannel[];
}

interface VueBulkCurrentReadingsResponse {
  devices: VueDeviceCurrentReadings[];
}

// Vue daily readings
interface VueDailyChannel {
  channel_num: string;
  display_name: string;
  kwh: number;
}

interface VueDeviceDailyReadings {
  device_gid: number;
  date: string;
  channels: VueDailyChannel[];
}

interface VueBulkDailyReadingsResponse {
  devices: VueDeviceDailyReadings[];
}

// Vue device info (already exists in API, needs dashboard type)
interface VueChannel {
  channel_num: string;
  name: string;
  display_name: string;
  channel_type: string | null;
}

interface VueDevice {
  device_gid: number;
  device_name: string;
  display_name: string;
  model: string;
  connected: boolean;
  last_seen: number;
  channels: VueChannel[];
}

interface VueDevicesResponse {
  devices: VueDevice[];
}

// Vue device mapping (settings)
type VueDeviceMapping = Record<string, number[]>;
```

## Volume Estimates (Circuits Page)

| Metric | Value |
|--------|-------|
| Vue devices | ~4 |
| Circuits per device | ~16 |
| Total circuits displayed | ~64 |
| Daily reading rows per day | ~64 (one per channel) |
| API calls per Circuits page load | 3 (vue devices + bulk current + daily) |
| API calls per flow card refresh (1s) | 1 (bulk current) + 1 (settings, cached) |
