# Data Model: Remove Vestigial /metrics Endpoint

**Feature**: 093-remove-vestigial-metrics
**Date**: 2026-04-29

## Summary

No data model changes. This feature removes dead code — no entities are added, modified, or removed.

## Unchanged Entities

The following entities and their schemas are unaffected:

- **readings** table — exporter continues writing via `PostgresWriter.write_readings()`
- **devices** table — exporter continues upserting via `PostgresWriter.upsert_device()`
- **settings** table — no change
- **vue_readings** / **vue_readings_1min** / **vue_readings_daily** — no change
- **vue_devices** / **vue_channels** — no change

## Removed Data Flow

The following data flow is removed:

```
poll() → Prometheus text lines → _metrics_text field → GET /metrics handler → (nobody)
```

The remaining data flows are unchanged:

```
poll() → parse_device_metrics() → build_postgres_readings() → PostgresWriter → PostgreSQL
poll() → snapshot dict → _history deque → _render_status_page() → GET /status
```
