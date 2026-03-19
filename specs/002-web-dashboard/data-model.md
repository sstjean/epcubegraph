# Data Model: Web Dashboard for Energy Telemetry

**Branch**: `002-web-dashboard` | **Date**: 2026-03-16

---

## Overview

The web dashboard is a stateless SPA — it has no local data store. All data is fetched from the Feature 001 API at runtime. The "entities" below describe the TypeScript interfaces that model the API responses consumed by the dashboard.

The dashboard does not define new data entities — it consumes the data model defined in [Feature 001's data model](../001-data-ingestor/data-model.md) and [API contract](../001-data-ingestor/contracts/api-v1.md).

---

## Entity: Device (API Response)

**Source**: `GET /api/v1/devices` → `DeviceListResponse.devices[]`

```typescript
interface Device {
  device: string;       // Unique identifier (e.g., "epcube_battery")
  class: string;        // "storage_battery" or "home_solar"
  manufacturer?: string;
  product_code?: string;
  uid?: string;
  online: boolean;      // true if scrape_success=1 within staleness window
}

interface DeviceListResponse {
  devices: Device[];
}
```

**Dashboard usage**: Rendered as device cards on the current readings view (US1). The `online` field drives the offline/stale indicator (FR-006). The `class` field determines which metrics to query for each device.

---

## Entity: Instant Query Result (API Response)

**Source**: `GET /api/v1/query?query=<promql>` → Prometheus instant vector

```typescript
interface InstantQueryResponse {
  status: 'success' | 'error';
  data: {
    resultType: 'vector';
    result: Array<{
      metric: Record<string, string>;  // Labels (device, class, __name__, etc.)
      value: [number, string];          // [unix_timestamp, value_string]
    }>;
  };
  errorType?: string;
  error?: string;
}
```

**Dashboard usage**: Current readings view (US1). Dashboard issues instant queries for the latest values of key metrics per device:
- `epcube_battery_state_of_capacity_percent` — Battery SOC (%)
- `epcube_battery_power_watts` — Battery power (W)
- `epcube_solar_instantaneous_generation_watts` — Solar generation (W)
- `epcube_grid_power_watts` — Grid import/export (W, via `/api/v1/grid`)

---

## Entity: Range Query Result (API Response)

**Source**: `GET /api/v1/query_range?query=<promql>&start=<ts>&end=<ts>&step=<duration>` → Prometheus range matrix

```typescript
interface RangeQueryResponse {
  status: 'success' | 'error';
  data: {
    resultType: 'matrix';
    result: Array<{
      metric: Record<string, string>;
      values: Array<[number, string]>;  // [[unix_ts, value_str], ...]
    }>;
  };
  errorType?: string;
  error?: string;
}
```

**Dashboard usage**: Historical graphs view (US2). Dashboard issues range queries for time-series data over the selected range. The `values` array maps directly to uPlot's data format after conversion:

```typescript
// Convert API response to uPlot data format
function toUPlotData(result: RangeQueryResult): uPlot.AlignedData {
  const timestamps = result.values.map(([ts]) => ts);
  const values = result.values.map(([, v]) => parseFloat(v));
  return [timestamps, values];
}
```

**Time range presets**:
| Preset | Start | End | Step |
|--------|-------|-----|------|
| Today | start of today (local) | now | 1m |
| Last 7 days | now - 7d | now | 1h |
| Last 30 days | now - 30d | now | 1d |
| Last year | now - 365d | now | calendar month |
| Custom | user-selected | user-selected | auto-tiered (see below) |

**Step auto-selection**: Custom ranges use the same tiered resolution as presets, selected by range duration: ≤1 day → 1m (60s), ≤7 days → 1h (3600s), ≤30 days → 1d (86400s), >30 days → calendar month. No cap on custom range length.

**Aggregation notice**: When step exceeds the collection interval (1 minute), the dashboard displays a visible notice indicating the aggregation level (e.g., "Data shown at hourly resolution").

---

## Entity: Grid Power (Convenience Endpoint)

**Source**: `GET /api/v1/grid?start=<ts>&end=<ts>&step=<duration>` → derived grid metric

Same response format as `RangeQueryResponse`. Sign convention: positive = net import from grid (kWh), negative = net export to grid (kWh).

**Dashboard usage**: Both current readings (latest grid value) and historical graphs (grid power over time).

---

## Entity: Device Metrics (API Response)

**Source**: `GET /api/v1/devices/{device}/metrics`

```typescript
interface DeviceMetricsResponse {
  device: string;
  metrics: string[];  // Available metric names for this device
}
```

**Dashboard usage**: Determines which readings/graphs to show for each device type. Battery devices have ~8 metrics, solar devices have ~2 metrics.

---

## Entity: Health (API Response)

**Source**: `GET /api/v1/health` (unauthenticated)

```typescript
interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  victoriametrics: 'reachable' | 'unreachable';
}
```

**Dashboard usage**: Connectivity indicator (edge case: API unreachable). Dashboard polls health endpoint to show/hide connectivity error banner (FR-006).

---

## Entity: Error Response (API Response)

**Source**: Any endpoint returning 400, 401, 403, 404, 422, or 503

```typescript
interface ErrorResponse {
  status: 'error';
  errorType: string;   // "bad_data", "execution", etc.
  error: string;       // Human-readable message
}
```

**Dashboard usage**: Displayed in error banners or toast notifications. User-facing messages are derived from the `error` field.

---

## Client-Side State (In-Memory Only)

The dashboard maintains ephemeral UI state — not persisted across sessions:

| State | Type | Default | Description |
|-------|------|---------|-------------|
| `selectedTimeRange` | `'today' \| '7d' \| '30d' \| '1y' \| 'custom'` | `'today'` | Active time range for historical graphs |
| `customStart` | `Date \| null` | `null` | Custom range start (only when `selectedTimeRange === 'custom'`) |
| `customEnd` | `Date \| null` | `null` | Custom range end |
| `isAuthenticated` | `boolean` | `false` | Whether MSAL has an active account |
| `isApiReachable` | `boolean` | `true` | Health endpoint reachability |
| `lastRefreshed` | `Date \| null` | `null` | Timestamp of last data fetch |

**No persistent client-side storage**: No localStorage, no IndexedDB, no cookies for data. Session tokens stored in `sessionStorage` by MSAL.js (cleared on tab close). This is the simplest approach and avoids stale cache issues.

---

## Data Flow

```
User opens dashboard
  → MSAL.js: acquireTokenSilent() or loginRedirect()
  → GET /api/v1/devices (with bearer token)
  → For each device: GET /api/v1/query?query=<latest-metric>
  → Render current readings view

User selects time range (e.g., "Last 7 days")
  → GET /api/v1/query_range?query=<metric>&start=<7d-ago>&end=<now>&step=1h
  → GET /api/v1/grid?start=<7d-ago>&end=<now>&step=1h
  → Convert to uPlot data format (null for gaps → broken lines)
  → Render historical graph
  → If step > 1m, show aggregation notice

Every 30 seconds (polling, FR-012):
  → Repeat current readings queries
  → Update displayed values
  → Check staleness (> 3 minutes → show stale indicator)
```
