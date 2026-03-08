# Data Model: EP Cube Telemetry Data Ingestor

**Branch**: `001-data-ingestor` | **Date**: 2026-03-07

---

## Overview

This feature uses VictoriaMetrics as the sole data store. VictoriaMetrics is a time-series database that stores data in a Prometheus-compatible format — there are no relational tables or document collections. The "entities" below describe the logical data model mapped to VictoriaMetrics metrics and labels.

---

## Entity: Device

**What it represents**: An EP Cube gateway device (1.0 or 2.0) as configured in echonet-exporter.

**Storage**: Not stored as a separate record. Device identity is encoded in VictoriaMetrics metric labels, populated automatically by echonet-exporter.

| Label | Source | Example | Description |
|-------|--------|---------|-------------|
| `device` | echonet-exporter `name` config | `epcube_battery` | Unique device identifier |
| `ip` | echonet-exporter `ip` config | `192.168.1.10` | LAN IP address |
| `class` | echonet-exporter `class` config | `storage_battery` | ECHONET Lite device class |
| `manufacturer` | `echonet_device_info` metric | `Canadian Solar` | From EPC 0x8A |
| `product_code` | `echonet_device_info` metric | `EP Cube 2.0` | From EPC 0x8C |
| `uid` | `echonet_device_info` metric | `ABC123` | From EPC 0x83 |

**Enrichment via `echonet_device_info`**: echonet-exporter exposes a constant-value metric `echonet_device_info{device, ip, class, manufacturer, product_code, uid} = 1` that carries device metadata as labels. The API service can query this metric to resolve device details.

**Validation rules**:
- `device` label MUST be non-empty and unique across all configured devices
- `class` MUST be one of: `storage_battery`, `home_solar`
- `ip` MUST be a valid IPv4 address

---

## Entity: Reading (Battery Metrics)

**What it represents**: Telemetry data points from an EP Cube storage battery.

**ECHONET Lite class**: `storage_battery` (EOJ 0x02-0x7D)

| Metric Name | Type | Unit | Description |
|-------------|------|------|-------------|
| `echonet_battery_state_of_capacity_percent` | gauge | % | State of charge (0–100) |
| `echonet_battery_charge_discharge_power_watts` | gauge | W | Instantaneous power (positive=charge, negative=discharge) |
| `echonet_battery_remaining_capacity_wh` | gauge | Wh | Remaining stored energy |
| `echonet_battery_chargeable_capacity_wh` | gauge | Wh | Max chargeable capacity |
| `echonet_battery_dischargeable_capacity_wh` | gauge | Wh | Max dischargeable capacity |
| `echonet_battery_cumulative_charge_wh` | counter | Wh | Cumulative energy charged (monotonic) |
| `echonet_battery_cumulative_discharge_wh` | counter | Wh | Cumulative energy discharged (monotonic) |
| `echonet_battery_working_operation_state` | gauge | code | 0x42=Charging, 0x43=Discharging, 0x44=Standby |

**Labels on every metric**: `device`, `ip`, `class`

---

## Entity: Reading (Solar Metrics)

**What it represents**: Telemetry data points from EP Cube home solar generation.

**ECHONET Lite class**: `home_solar` (EOJ 0x02-0x79)

| Metric Name | Type | Unit | Description |
|-------------|------|------|-------------|
| `echonet_solar_instantaneous_generation_watts` | gauge | W | Current solar generation |
| `echonet_solar_cumulative_generation_kwh` | counter | kWh | Total generated energy (monotonic) |

**Labels on every metric**: `device`, `ip`, `class`

---

## Entity: Reading (Derived Grid Metric)

**What it represents**: Grid import/export power derived from solar and battery readings.

**Storage**: Computed by the API service at query time using PromQL, OR pre-computed via VictoriaMetrics recording rules.

| Metric / Query | Type | Unit | Description |
|----------------|------|------|-------------|
| `grid_power_watts` (recording rule) | gauge | W | `echonet_solar_instantaneous_generation_watts - echonet_battery_charge_discharge_power_watts` |

**Sign convention**: Positive = export to grid, Negative = import from grid.

**Implementation options** (decided during implementation):
1. **PromQL at query time**: The API computes `echonet_solar_instantaneous_generation_watts - echonet_battery_charge_discharge_power_watts` on each request. Simplest, no stored data.
2. **VictoriaMetrics recording rule**: Pre-computes and stores `grid_power_watts` at regular intervals. Better for historical queries and Grafana dashboards.

---

## Entity: Scrape Health

**What it represents**: Health and status metrics for observability of the ingestion pipeline.

| Metric Name | Type | Unit | Description |
|-------------|------|------|-------------|
| `echonet_scrape_success` | gauge | boolean | 1 = last scrape succeeded, 0 = failed |
| `echonet_scrape_duration_seconds` | gauge | seconds | Duration of last scrape |
| `echonet_last_scrape_timestamp_seconds` | gauge | unix epoch | Time of last successful scrape |
| `echonet_device_info` | gauge | constant 1 | Device identity labels (manufacturer, product_code, uid) |

**Labels on every metric**: `device`, `ip`, `class`

---

## Entity: Time Series

**What it represents**: A logical grouping — an ordered sequence of Readings for a given device and metric over a time range.

**Not a stored entity**: Time Series is a query concept. VictoriaMetrics returns time series via PromQL `query_range` with a specified `start`, `end`, and `step`.

**PromQL query pattern**:
```promql
echonet_battery_state_of_capacity_percent{device="epcube_battery"}[24h:1m]
```

This returns a time series of 1-minute-interval SoC readings for the last 24 hours.

---

## Relationships

```
Device (labels)
  ├── Battery Readings (storage_battery metrics)
  ├── Solar Readings (home_solar metrics)
  ├── Scrape Health (scrape status metrics)
  └── Derived Grid (computed from solar + battery)
```

All relationships are implicit via shared `device` label. There are no foreign keys or joins — VictoriaMetrics uses label matching.

---

## State Transitions

### Battery Working Operation State

```
Standby (0x44) ──charge──▶ Charging (0x42)
Standby (0x44) ──discharge──▶ Discharging (0x43)
Charging (0x42) ──done──▶ Standby (0x44)
Discharging (0x43) ──done──▶ Standby (0x44)
```

### Device Scrape Status

```
Unknown ──first scrape success──▶ Online (scrape_success=1)
Online ──scrape failure──▶ Offline (scrape_success=0)
Offline ──scrape success──▶ Online (scrape_success=1)
```

---

## Deduplication

VictoriaMetrics handles deduplication natively via `-dedup.minScrapeInterval=1m`. If vmagent retries a remote-write and sends duplicate data points (same metric, same timestamp, same value), VictoriaMetrics keeps only one copy.

---

## Retention

VictoriaMetrics is configured with `-retentionPeriod=5y`. Data older than 5 years is automatically purged during background compaction. No application-level retention logic is needed.
