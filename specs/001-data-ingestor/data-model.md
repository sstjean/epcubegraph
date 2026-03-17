# Data Model: EP Cube Telemetry Data Ingestor

**Branch**: `001-data-ingestor` | **Date**: 2026-03-07

---

## Overview

This feature uses VictoriaMetrics as the sole data store. VictoriaMetrics is a time-series database that stores data in a Prometheus-compatible format — there are no relational tables or document collections. The "entities" below describe the logical data model mapped to VictoriaMetrics metrics and labels.

---

## Entity: Device

**What it represents**: An EP Cube device (1.0 or 2.0) as identified by epcube-exporter via the cloud API.

**Storage**: Not stored as a separate record. Device identity is encoded in VictoriaMetrics metric labels, populated automatically by epcube-exporter.

| Label | Source | Example | Description |
|-------|--------|---------|-------------|
| `device` | epcube-exporter config | `epcube_battery` | Unique device identifier |
| `class` | epcube-exporter config | `storage_battery` | Device class |
| `manufacturer` | `epcube_device_info` metric | `Canadian Solar` | Device manufacturer |
| `product_code` | `epcube_device_info` metric | `EP Cube 2.0` | Device model |
| `uid` | `epcube_device_info` metric | `ABC123` | Unique device ID |

**Enrichment via `epcube_device_info`**: epcube-exporter exposes a constant-value metric `epcube_device_info{device, class, manufacturer, product_code, uid} = 1` that carries device metadata as labels. The API service can query this metric to resolve device details.

**Validation rules**:
- `device` label MUST be non-empty and unique across all configured devices
- `class` MUST be one of: `storage_battery`, `home_solar`

---

## Entity: Reading (Battery Metrics)

**What it represents**: Telemetry data points from an EP Cube storage battery, polled from the EP Cube cloud API.

**Device class**: `storage_battery`

| Metric Name | Type | Unit | Description |
|-------------|------|------|-------------|
| `epcube_battery_state_of_capacity_percent` | gauge | % | State of charge (0–100) |
| `epcube_battery_net_kwh` | gauge | kWh | Net battery energy today (positive=charge, negative=discharge), calculated by epcube-exporter from cloud API energy balance fields (`solar + grid_import - backup - grid_export`) |

**Labels on every metric**: `device`, `class`

**Note**: The EP Cube cloud API does not expose instantaneous battery charge/discharge power, remaining capacity, chargeable/dischargeable capacity, cumulative charge/discharge, or working operation state. Only SoC% and daily net energy (derived from the energy balance) are available.

---

## Entity: Reading (Solar Metrics)

**What it represents**: Telemetry data points from EP Cube home solar generation.

**Device class**: `home_solar`

| Metric Name | Type | Unit | Description |
|-------------|------|------|-------------|
| `epcube_solar_instantaneous_generation_watts` | gauge | W | Current solar generation |
| `epcube_solar_cumulative_generation_kwh` | gauge | kWh | Total solar energy generated today |

**Labels on every metric**: `device`, `class`

---

## Entity: Reading (Home Load & Grid Metrics)

**What it represents**: Home load consumption and grid energy exchange, polled from the EP Cube cloud API.

**Device class**: `storage_battery` (same labels as battery)

| Metric Name | Type | Unit | Description |
|-------------|------|------|-------------|
| `epcube_home_load_power_watts` | gauge | W | Instantaneous home load (backup) power |
| `epcube_self_sufficiency_rate` | gauge | % | Self-sufficiency rate (0–100) |
| `epcube_grid_import_kwh` | gauge | kWh | Grid energy imported today |
| `epcube_grid_export_kwh` | gauge | kWh | Grid energy exported today |

**Labels on every metric**: `device`, `class`

---

## Entity: Reading (Grid Net — API Query)

**What it represents**: Net grid energy consumption, computed at query time by the API.

**Storage**: Computed by the API service at query time using PromQL.

| Metric / Query | Type | Unit | Description |
|----------------|------|------|-------------|
| `epcube_grid_import_kwh - epcube_grid_export_kwh` | gauge | kWh | Net grid energy (positive = net import, negative = net export) |

**Sign convention**: Positive = net import from grid, Negative = net export to grid.

**Implementation**: The API `/grid` endpoint executes this PromQL `query_range` against VictoriaMetrics. Grid import and export are directly available from the EP Cube cloud API — no derivation from solar/battery is needed.

---

## Entity: Scrape Health

**What it represents**: Health and status metrics for observability of the ingestion pipeline.

| Metric Name | Type | Unit | Description |
|-------------|------|------|-------------|
| `epcube_scrape_success` | gauge | boolean | 1 = last scrape succeeded, 0 = failed |
| `epcube_last_scrape_timestamp_seconds` | gauge | unix epoch | Time of last successful scrape |
| `epcube_device_info` | gauge | constant 1 | Device identity labels (manufacturer, product_code, uid) |
**Labels on every metric**: `device`, `class`

---

## Entity: Time Series

**What it represents**: A logical grouping — an ordered sequence of Readings for a given device and metric over a time range.

**Not a stored entity**: Time Series is a query concept. VictoriaMetrics returns time series via PromQL `query_range` with a specified `start`, `end`, and `step`.

**PromQL query pattern**:
```promql
epcube_battery_state_of_capacity_percent{device="epcube_battery"}[24h:1m]
```

This returns a time series of 1-minute-interval SoC readings for the last 24 hours.

---

## Relationships

```
Device (labels)
  ├── Battery Readings (storage_battery metrics)
  ├── Solar Readings (home_solar metrics)
  ├── Home Load & Grid Readings (storage_battery metrics)
  ├── Scrape Health (scrape status metrics)
  └── Grid Net (computed at query time: import - export)
```

All relationships are implicit via shared `device` label. There are no foreign keys or joins — VictoriaMetrics uses label matching.

---

## State Transitions

### Device Scrape Status

```
Unknown ──first scrape success──▶ Online (scrape_success=1)
Online ──scrape failure──▶ Offline (scrape_success=0)
Offline ──scrape success──▶ Online (scrape_success=1)
```

---

## Deduplication

VictoriaMetrics handles deduplication natively via `-dedup.minScrapeInterval=1m`. If an external remote-write client retries and sends duplicate data points (same metric, same timestamp, same value), VictoriaMetrics keeps only one copy.

---

## Retention

VictoriaMetrics is configured with `-retentionPeriod=5y`. Data older than 5 years is automatically purged during background compaction. No application-level retention logic is needed.
