# Data Model: Web Dashboard for Energy Telemetry

**Branch**: `002-web-dashboard` | **Date**: 2026-03-22

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
  alias?: string;       // Human-readable name from EP Cube cloud (e.g., "Steve St Jean 3 Battery")
  manufacturer?: string;
  product_code?: string;
  uid?: string;
  online: boolean;      // true if scrape_success=1 within staleness window
}

interface DeviceListResponse {
  devices: Device[];
}
```

**Dashboard usage**: Rendered as device cards on the current readings view (US1). The system has 2 EP Cube devices, each exposing a battery and solar target (4 devices total in the API, grouped into 2 DeviceCards). The `online` field drives the offline/stale indicator (FR-006). The `class` field determines which metrics to query for each device. The `alias` field is used to group battery and solar devices into a single DeviceCard per physical EP Cube unit (see plan.md Design Decisions). When the API returns data for only 1 of the 2 physical devices, the missing device's card shows the stale-data/offline indicator (FR-006).

---

## Entity: Current Readings (API Response)

**Source**: `GET /api/v1/readings/current?metric=<name>` → latest metric values per device

```typescript
interface Reading {
  device_id: string;   // Device identifier (e.g., "epcube_battery")
  timestamp: number;   // Unix epoch seconds
  value: number;       // Numeric reading
}

interface CurrentReadingsResponse {
  metric: string;      // Metric name requested
  readings: Reading[]; // One reading per device
}
```

**Dashboard usage**: Current readings view (US1). Dashboard fetches latest values via `fetchCurrentReadings()` for each metric:
- `battery_state_of_capacity_percent` — Battery SOC (%)
- `battery_power_watts` — Battery power (W, derived from energy balance)
- `solar_instantaneous_generation_watts` — Solar generation (W)
- `home_load_power_watts` — Home load consumption (W)
- `grid_power_watts` — Grid import/export (W, via `/api/v1/grid`)
- `battery_stored_kwh` — Battery stored energy (kWh, derived from SOC × capacity)

---

## Entity: Range Readings (API Response)

**Source**: `GET /api/v1/readings/range?metric=<name>&start=<ts>&end=<ts>&step=<s>` → time-series data

```typescript
interface TimeSeriesPoint {
  timestamp: number;   // Unix epoch seconds
  value: number;       // Numeric reading
}

interface TimeSeries {
  device_id: string;           // Device identifier
  values: TimeSeriesPoint[];   // Ordered time-series points
}

interface RangeReadingsResponse {
  metric: string;      // Metric name requested
  series: TimeSeries[];// One series per device
}
```

**Dashboard usage**: Historical graphs view (US2). Dashboard fetches range data via `fetchRangeReadings()` for solar, battery, and home load metrics, plus `fetchGridPower()` for grid. The `mergeTimeSeries()` function aligns multiple series to a common timestamp array and converts to uPlot's `AlignedData` format, inserting `null` for missing data points to produce broken-line gaps (FR-008).

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

**Source**: `GET /api/v1/grid?start=<ts>&end=<ts>&step=<s>` → derived grid metric

Same response format as `RangeReadingsResponse`. Sign convention: positive = net import from grid (watts), negative = net export to grid (watts).

**Dashboard usage**: Both current readings (latest grid value via `fetchGridPower()` with no params) and historical graphs (grid power over time with start/end/step).

---

## Client-Side State (In-Memory Only)

The dashboard maintains ephemeral UI state — not persisted across sessions:

| State | Type | Default | Description |
|-------|------|---------|-------------|
| `selectedTimeRange` | `'today' \| '7d' \| '30d' \| '1y' \| 'custom'` | `'today'` | Active time range for historical graphs |
| `customStart` | `Date \| null` | `null` | Custom range start (only when `selectedTimeRange === 'custom'`) |
| `customEnd` | `Date \| null` | `null` | Custom range end |
| `isAuthenticated` | `boolean` | `false` | Whether MSAL has an active account |
| `lastRefreshed` | `Date \| null` | `null` | Timestamp of last data fetch |
| `currentView` | `'flow' \| 'gauges'` | `'flow'` | Active view mode for current readings (FR-017) |

**No persistent client-side storage**: No localStorage, no IndexedDB, no cookies for data. Session tokens stored in `sessionStorage` by MSAL.js (cleared on tab close). This is the simplest approach and avoids stale cache issues.

---

## Client-Side Telemetry (FR-020)

The dashboard integrates `@microsoft/applicationinsights-web` for client-side error telemetry. This is NOT a data entity — it's an operational concern. The SDK sends telemetry directly to Azure Application Insights (no API involvement).

**Tracked events**:
- Unhandled exceptions (`trackException`)
- Failed API calls — 4xx/5xx responses (`trackEvent` with url + status)
- Page load performance (`trackPageView`)

**Not tracked**: PII, user input, metric values, authentication tokens.

**Init**: Lazy — only when `VITE_APPINSIGHTS_CONNECTION_STRING` is set. Silent in local dev and tests.

---

## Data Flow

```
User opens dashboard
  → MSAL.js: acquireTokenSilent() or loginRedirect()
  → GET /api/v1/devices (with bearer token)
  → For each device: GET /api/v1/readings/current?metric=<metric>
  → Render current readings view

User selects time range (e.g., "Last 7 days")
  → GET /api/v1/readings/range?metric=<metric>&start=<7d-ago>&end=<now>&step=3600
  → GET /api/v1/grid?start=<7d-ago>&end=<now>&step=1h
  → Convert to uPlot data format (null for gaps → broken lines)
  → Render historical graph
  → If step > 1m, show aggregation notice

Every 30 seconds (polling, FR-012):
  → Repeat current readings queries
  → Update displayed values
  → Check staleness (> 3 minutes → show stale indicator)
```
