# Data Model: Emporia Vue Energy Monitoring

**Branch**: `005-emporia-vue` | **Date**: 2026-04-08

## Overview

Feature 005 adds two new tables for Vue circuit telemetry (`vue_devices`, `vue_readings`) and one for downsampled data (`vue_readings_1min`). These live alongside the existing EP Cube tables (`devices`, `readings`) and settings tables (`settings`, `panel_hierarchy`, `display_name_overrides`) in the same `epcubegraph` database.

## Physical Schema

### Table: `vue_devices`

Stores metadata for each Emporia Vue device discovered via the API.

| Column | Type | Notes |
|--------|------|-------|
| `device_gid` | `BIGINT` | Primary key — Emporia's unique device identifier |
| `device_name` | `TEXT` | Name from Emporia app (e.g., "Main Panel") |
| `model` | `TEXT` | Model number (e.g., "VUE001") |
| `firmware` | `TEXT` | Firmware version |
| `connected` | `BOOLEAN` | Last known online status |
| `last_seen` | `TIMESTAMPTZ` | Last time device reported data |
| `created_at` | `TIMESTAMPTZ` | Row creation time |
| `updated_at` | `TIMESTAMPTZ` | Row update time |

**Constraints**:
- `PRIMARY KEY (device_gid)`

### Table: `vue_channels`

Stores metadata for each circuit channel on each Vue device.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `SERIAL` | Primary key |
| `device_gid` | `BIGINT NOT NULL` | FK → `vue_devices.device_gid` |
| `channel_num` | `TEXT NOT NULL` | Channel identifier (e.g., "1,2,3", "1", "Balance") |
| `name` | `TEXT` | Name from Emporia app (e.g., "Kitchen", "Main") |
| `channel_multiplier` | `DOUBLE PRECISION` | Multiplier for usage calculations |
| `channel_type` | `TEXT` | Channel type (e.g., "Main", "FiftyAmp") |
| `created_at` | `TIMESTAMPTZ` | Row creation time |
| `updated_at` | `TIMESTAMPTZ` | Row update time |

**Constraints**:
- `UNIQUE (device_gid, channel_num)` — one channel per device+number
- `FOREIGN KEY (device_gid) REFERENCES vue_devices(device_gid)`

### Table: `vue_readings`

Stores raw 1-second power readings per circuit channel. High-write table — retention is 7 days.

| Column | Type | Notes |
|--------|------|-------|
| `device_gid` | `BIGINT NOT NULL` | Device identifier |
| `channel_num` | `TEXT NOT NULL` | Channel identifier |
| `timestamp` | `TIMESTAMPTZ NOT NULL` | Reading time (1-second resolution) |
| `value` | `DOUBLE PRECISION NOT NULL` | Power in watts |

**Constraints**:
- `UNIQUE (device_gid, channel_num, timestamp)` — deduplicates writes
- No FK to `vue_devices` (write performance — no join needed on insert)

**Indexes**:
- `idx_vue_readings_device_channel_time ON vue_readings (device_gid, channel_num, timestamp DESC)` — efficient latest-reading and range queries
- `idx_vue_readings_time ON vue_readings (timestamp)` — efficient retention cleanup

### Table: `vue_readings_1min`

Stores downsampled 1-minute average power readings. Created by the periodic downsampling job after 7 days. Retained indefinitely.

| Column | Type | Notes |
|--------|------|-------|
| `device_gid` | `BIGINT NOT NULL` | Device identifier |
| `channel_num` | `TEXT NOT NULL` | Channel identifier |
| `timestamp` | `TIMESTAMPTZ NOT NULL` | Minute-aligned timestamp |
| `value` | `DOUBLE PRECISION NOT NULL` | Average power in watts over the minute |
| `sample_count` | `INTEGER NOT NULL` | Number of 1-second samples in this average |

**Constraints**:
- `UNIQUE (device_gid, channel_num, timestamp)` — one row per device+channel+minute

**Indexes**:
- `idx_vue_readings_1min_device_channel_time ON vue_readings_1min (device_gid, channel_num, timestamp DESC)` — matches raw table pattern for consistent query plans

### Existing Tables (no changes)

| Table | Changes |
|-------|---------|
| `devices` | None — EP Cube devices only |
| `readings` | None — EP Cube readings only |
| `settings` | None — may add Vue-specific settings keys |
| `panel_hierarchy` | None — already stores parent/child device_gid relationships for Vue deduplication |
| `display_name_overrides` | None — already stores device_gid + channel_number overrides |

## Schema Creation

Tables are auto-created by the exporter's `PostgresWriter` on startup (same pattern as EP Cube):

```sql
CREATE TABLE IF NOT EXISTS vue_devices (
    device_gid BIGINT PRIMARY KEY,
    device_name TEXT,
    model TEXT,
    firmware TEXT,
    connected BOOLEAN DEFAULT TRUE,
    last_seen TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vue_channels (
    id SERIAL PRIMARY KEY,
    device_gid BIGINT NOT NULL REFERENCES vue_devices(device_gid),
    channel_num TEXT NOT NULL,
    name TEXT,
    channel_multiplier DOUBLE PRECISION,
    channel_type TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (device_gid, channel_num)
);

CREATE TABLE IF NOT EXISTS vue_readings (
    device_gid BIGINT NOT NULL,
    channel_num TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    UNIQUE (device_gid, channel_num, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_vue_readings_device_channel_time
    ON vue_readings (device_gid, channel_num, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_vue_readings_time
    ON vue_readings (timestamp);

CREATE TABLE IF NOT EXISTS vue_readings_1min (
    device_gid BIGINT NOT NULL,
    channel_num TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    sample_count INTEGER NOT NULL,
    UNIQUE (device_gid, channel_num, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_vue_readings_1min_device_channel_time
    ON vue_readings_1min (device_gid, channel_num, timestamp DESC);
```

## Logical Entities

### Vue Device
Represents a physical Emporia Vue energy monitor installed in an electrical panel.

- **Source**: PyEmVue `get_devices()` → `VueDevice`
- **Identity**: `device_gid` (integer assigned by Emporia)
- **Display name**: Falls through: `display_name_overrides` → `vue_devices.device_name` → `"Device {device_gid}"`

### Circuit Channel
An individual circuit breaker monitored by a Vue device.

- **Source**: PyEmVue `VueDeviceChannel` + `VueDeviceChannelUsage`
- **Identity**: `(device_gid, channel_num)` — channel_num is a string like `"1,2,3"`, `"4"`, or `"Balance"`
- **Special channels**:
  - `"1,2,3"` = mains (split-phase panel total, not three-phase despite the naming)
  - `"1"`, `"2"` = individual hot legs (real measurements, not redundant)
  - `"Balance"` = calculated remainder (total minus monitored circuits) — displayed as "Unmonitored loads" on the dashboard
  - Other numeric strings = individual circuit breakers
- **Display name**: Falls through: `display_name_overrides` → `vue_channels.name` → `"Channel {channel_num}"`. For Balance channel, default display name is "Unmonitored loads".

### Panel Hierarchy (existing)
Defines parent-child relationships between panels for deduplication.

- **Table**: `panel_hierarchy` (already exists from Feature 006)
- **Key**: `(parent_device_gid, child_device_gid)` — both reference `vue_devices.device_gid`
- **Usage**: At query time, subtract child mains (`1,2,3`) from parent mains to get deduplicated total
- **Total home**: Sum of all top-level panel mains (panels with no parent). Accounts for split-phase services where no single device monitors the full entry.
- **Current topology**: 300A split-phase → Leg 1 (Device 1, with children Device 2 + Device 4) + Leg 2 (Device 3, independent)

### Reading
A single power measurement at a point in time.

- **Source**: PyEmVue `get_device_list_usage()` → `VueDeviceChannelUsage.usage`
- **Storage**: `vue_readings` (1-second, 7-day retention) or `vue_readings_1min` (1-minute averages, indefinite)
- **Unit**: Watts (requested directly from Emporia API in `Watts` unit — no kWh conversion)
- **Negative values**: Stored as-is. Negative watts represent bidirectional power flow (solar backfeed, battery discharge).
- **Null handling**: Offline devices return `None` from the API → skip write, log warning

## Data Volume Estimates

| Metric | Value |
|--------|-------|
| Devices | ~4 |
| Circuits per device | ~16 (including mains, balance) |
| Total channels | ~64 |
| Readings per second | ~64 |
| Readings per day | ~5.5M |
| Readings per 7 days (raw) | ~38.5M |
| 1-minute rows per day | ~92K |
| 1-minute rows per year | ~33.6M |

## Relationships

```
vue_devices (1) ──< vue_channels (many)
vue_devices (1) ──< vue_readings (many, via device_gid)
vue_devices (1) ──< vue_readings_1min (many, via device_gid)
panel_hierarchy ──> vue_devices (parent_device_gid, child_device_gid)
display_name_overrides ──> vue_devices (device_gid) + vue_channels (channel_number)
```
