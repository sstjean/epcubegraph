# Data Model: EP Cube Telemetry Data Ingestor

**Branch**: `001-data-ingestor` | **Date**: 2026-03-27

## Overview

Feature 001 stores telemetry in PostgreSQL using two primary tables:

- `devices`: metadata per EP Cube device
- `readings`: time-series telemetry rows keyed by device, metric, and timestamp

The exporter creates these schema objects automatically and uses upserts so the data model stays stable across restarts.

## Physical Schema

### Table: `devices`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `SERIAL` | Primary key |
| `device_id` | `TEXT` | Unique external identifier |
| `device_class` | `TEXT` | `storage_battery` or `home_solar` |
| `alias` | `TEXT` | Human-readable grouping name |
| `manufacturer` | `TEXT` | Device manufacturer |
| `product_code` | `TEXT` | Product/model identifier |
| `uid` | `TEXT` | Cloud-reported unique ID |
| `created_at` | `TIMESTAMPTZ` | Row creation time |
| `updated_at` | `TIMESTAMPTZ` | Row update time |

### Table: `readings`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `BIGSERIAL` | Primary key |
| `device_id` | `TEXT` | Logical device identifier |
| `metric_name` | `TEXT` | Normalized metric name |
| `timestamp` | `TIMESTAMPTZ` | Reading time |
| `value` | `DOUBLE PRECISION` | Numeric reading value |

### Constraints and Indexes

| Name | Definition | Purpose |
|------|------------|---------|
| `devices.device_id` | Unique | Prevent duplicate device identities |
| `readings(device_id, metric_name, timestamp)` | Unique | Deduplicate telemetry writes |
| `idx_readings_device_metric_time` | `(device_id, metric_name, timestamp DESC)` | Efficient latest-reading and range queries |

## Logical Entities

### Device

Represents one EP Cube device identity as known to the cloud API and persisted in PostgreSQL.

| Field | Meaning |
|-------|---------|
| `device_id` | Stable device identifier used by the exporter and API |
| `device_class` | Device role such as battery or solar |
| `alias` | Grouping label shown to downstream clients |
| `manufacturer` | Vendor metadata |
| `product_code` | Model identifier |
| `uid` | Unique device UID from the cloud API |

### Reading

Represents a single metric sample for a device at a specific timestamp.

| Field | Meaning |
|-------|---------|
| `device_id` | Owning device |
| `metric_name` | Stored metric key |
| `timestamp` | UTC-compatible time of the reading |
| `value` | Numeric value for the sample |

### Time Series

A query-time grouping of readings for one metric and one device across a requested range.

The API returns time series in grouped JSON form rather than exposing raw table rows.

## Core Stored Metrics

The current platform depends on these core metric names being available in PostgreSQL:

- `solar_instantaneous_generation_watts`
- `battery_state_of_capacity_percent`
- `battery_power_watts`
- `battery_stored_kwh`
- `home_load_power_watts`
- `grid_power_watts`

Additional cumulative or operational metrics may also be stored, but these six are the primary contract for current downstream clients.

## API Response Models

### `CurrentReadingsResponse`

```json
{
  "metric": "battery_power_watts",
  "readings": [
    {
      "device_id": "epcube3483_battery",
      "timestamp": 1711497600,
      "value": -1250.0
    }
  ]
}
```

### `RangeReadingsResponse`

```json
{
  "metric": "grid_power_watts",
  "series": [
    {
      "device_id": "epcube3483_battery",
      "values": [
        {
          "timestamp": 1711497600,
          "value": 450.0
        }
      ]
    }
  ]
}
```

## Deduplication Rules

- The exporter uses `ON CONFLICT` writes for both `devices` and `readings`.
- A repeated reading for the same `(device_id, metric_name, timestamp)` updates the existing row rather than creating a duplicate.

## Retention

Telemetry retention is indefinite. No automatic purge policy exists in the application layer.
