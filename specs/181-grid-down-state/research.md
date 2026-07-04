# Phase 0 Research: Grid-down state on the Current diagram

**Feature**: 181-grid-down-state · **Date**: 2026-07-03

All items below are verified against the current codebase (not historical assumptions).
There are **no open NEEDS CLARIFICATION** items — the two spec questions (Q1 stale, Q2 Fault)
and the visual directive were resolved by Steve on 2026-07-03.

---

## R1 — Where the grid-mode signal comes from

- **Decision**: Use EP Cube `systemStatus` as the source of truth, already extracted in
  `local/epcube-exporter/epcube_collector.py` `parse_device_metrics()` as
  `"system_status_raw": data.get("systemStatus", "?")`.
- **Verified**: `_STATUS_MAP` in `epcube_collector.py` maps
  `0 Standby · 1 Self-Use · 2 Backup · 3 Off-Grid · 4 Normal · 5 Fault · 6 Upgrading`.
  Today this value is only used to render `system_status` on the exporter debug snapshot;
  it is **not** persisted, exposed by the API, or shown on the dashboard.
- **Grid-down set**: `{2, 3}` (Backup, Off-Grid) — FR-003. Fault (5) / Upgrading (6) and any
  unknown code are **not** grid-down (Q2, edge cases).
- **Rationale**: single authoritative signal already flowing into the exporter; no new device
  call or parsing needed.
- **Alternatives considered**: deriving grid-down from `gridPower ≈ 0` (rejected — ambiguous
  with normal net-zero import/export and with solar-only islanding); a separate boolean field
  from the cloud API (none exists).

## R2 — How to persist it

- **Decision**: Add a new numeric reading metric **`grid_status_code`** whose value is the raw
  `systemStatus` integer, written **per poll** for the `{dev_id}_battery` device — the same
  device that already carries `grid_power_watts`, `battery_power_watts`, etc.
- **Verified**: readings are built by the pure function `build_postgres_readings(dev_id, timestamp, metrics)`
  → list of `(device_id, metric_name, timestamp, value)` tuples → written by `PostgresWriter`
  (`local/epcube-exporter/db.py`) into the `readings` table. The battery device id is
  `f"{base_id}_battery"` where `base_id = f"epcube{dev_id}"`.
- **No schema change**: `readings(device_id, metric_name, timestamp, value)` already stores
  arbitrary numeric metrics keyed by name; `grid_status_code` reuses the covering index
  `idx_readings_metric_time` / `idx_readings_device_metric_time` added in #182.
- **Stale/missing handling at write time (FR-008 / FR-002)**: `system_status_raw` defaults to
  the **string** `"?"` when `systemStatus` is absent. The `grid_status_code` tuple MUST be
  **omitted** when the value is not a valid integer, so absence of the signal yields absence of
  the reading → the API returns no current value for it → the dashboard shows no indicator.
- **Rationale**: cleanest reuse of the exporter → `readings` → `/readings/current` pipeline;
  numeric representation keeps the store schema-free of new columns and keeps the raw code
  (not a pre-derived boolean) so the `{2,3}` rule lives in exactly one place (the dashboard).
- **Alternatives considered**: a boolean `grid_down` metric written by the exporter (rejected —
  bakes the rule into ingestion, loses the raw code, and makes future states like a distinct
  Off-Grid vs Backup treatment impossible without a re-ingest); a new `system_status` column on
  `devices` (rejected — schema change, not time-series, no per-timestamp history).

## R3 — How the API exposes it

- **Decision**: **No API code change.** The generic endpoint
  `GET /api/v1/readings/current?metric=grid_status_code` already returns the latest value per
  device.
- **Verified**: `ReadingsEndpoints.HandleCurrentReadings` validates `metric` with
  `Validate.Required` + `Validate.SafeName` (a metric-name allowlist is **not** used — any safe
  name passes) and calls `PostgresMetricsStore.GetCurrentReadingsAsync(metric)`, which runs a
  `JOIN LATERAL (… ORDER BY timestamp DESC LIMIT 1)` top-1-per-device query on
  `idx_readings_device_metric_time`. `grid_status_code` flows through unchanged and returns a
  `CurrentReadingsResponse { metric, readings: [{ device_id, timestamp, value }] }`.
- **Rationale**: the endpoint is metric-agnostic and index-optimized; adding a bespoke
  grid-down field would duplicate the `{2,3}` rule server-side for zero user benefit
  (see plan Complexity Tracking).
- **Alternatives considered**: a dedicated `/readings/grid-status` or a boolean field on the
  device payload (rejected — YAGNI, extra contract surface, second home for the rule).

## R4 — Where and how the dashboard renders it

- **Decision**: Fetch `grid_status_code` in `CurrentReadings.tsx` alongside the existing six
  current metrics, derive a per-system `gridDown` boolean, thread it through `DeviceCardMetrics`,
  and render in `EnergyFlowDiagram.tsx`: **Grid symbol stroke → red (`#ef4444`)** and a
  **"Grid Down"** text label directly beneath the Grid symbol.
- **Verified**:
  - `dashboard/src/api.ts` `fetchCurrentReadings(metric)` already parameterizes the metric —
    reuse it, **no new API-client function**.
  - `CurrentReadings.tsx` `loadData()` fetches metrics via `Promise.all([... fetchCurrentReadings(...)])`
    and `buildDeviceGroups(devices, metrics)` maps each metric to a device via
    `getMetricForDevice(response, device.device)`. Offline groups are already zeroed, which
    naturally yields `gridDown = false` for offline systems.
  - `EnergyFlowDiagram.tsx` has the Grid node at `const GRID = { x: 40, y: 185 }` with the Grid
    icon stroke currently `gridActive ? (gridImporting ? '#ef4444' : '#10b981') : '#4b5563'`,
    a `"Grid"` label at `y+30`, and an `importing/exporting/idle` sublabel at `y+44`.
- **Rendering design (FR-005)**: when `m.gridDown` is true, force the Grid icon stroke to
  `#ef4444` regardless of flow direction, and render **"Grid Down"** (red, emphasized) beneath
  the Grid symbol. The label occupies the sublabel line (`y+44`) in place of
  `importing/exporting/idle` so the diagram height does not change. Grid-up renders exactly as
  today (normal stroke, no "Grid Down" label).
- **Attribution (FR-006 / US2)**: `gridDown` is computed per battery device from that device's
  own latest `grid_status_code`, so multi-system attribution is correct with no cross-leakage —
  the same per-device lookup the other metrics already use.
- **Rationale**: keeps the `{2,3}` rule in one pure helper next to the render; reuses the exact
  data path of every other current metric; no layout growth.
- **Alternatives considered**: rendering the indicator in the gauges `DeviceCard` view
  (out of scope — FR-005 is specific to the Current *diagram*); a separate banner/animation
  (out of scope).

## R5 — Freshness / stale semantics (FR-008)

- **Decision**: Show **no** grid-down indicator when the signal is stale, missing, or the group
  is offline. Do not retain a last-known grid-down state.
- **Verified**: `buildDeviceGroups` already zeroes all metrics for offline groups; a zeroed
  `grid_status_code` (0 = Standby) is not in `{2,3}` → no indicator. The exporter omits the
  reading entirely when `systemStatus` is absent (R2), so a device with no fresh signal has no
  current value to trip the rule.
- **Rationale**: mirrors the Current diagram's existing freshness behavior; never asserts
  grid-down without fresh data (Q1).

## R6 — Timezone (FR-007)

- **Decision**: The indicator itself renders no timestamp. Should any timestamp ever be shown
  alongside the grid state, it MUST use `America/New_York` via explicit
  `Intl.DateTimeFormat({ timeZone: 'America/New_York', … })` — never a bare locale default.
- **Rationale**: repo-wide non-negotiable timezone rule. Current design shows no timestamp for
  the indicator, so this is a guardrail, not a code path to add.

## R7 — Testing strategy (FR-009, TDD, 100% coverage)

- **Exporter** (`test_exporter.py`, unittest, AAA):
  - `build_postgres_readings` includes a `(f"{dev}_battery", "grid_status_code", ts, code)` tuple
    when `system_status_raw` is a valid int (assert value for 2, 3, 4).
  - The tuple is **omitted** when `system_status_raw` is `"?"` / missing / non-integer.
- **Dashboard** (Vitest, AAA):
  - Unit: pure `deriveGridDown(code)` → true for 2, 3; false for 0,1,4,5,6, unknown, undefined.
  - Unit: `buildDeviceGroups` sets `gridDown` from `grid_status_code` per device; offline → false;
    correct multi-device attribution (US2).
  - Component: `EnergyFlowDiagram` renders the Grid symbol with the red stroke and a
    "Grid Down" label when `gridDown` is true; normal stroke and no label when false.
- **API**: no changed code → covered by existing generic `/readings/current` tests. (If a
  belt-and-suspenders contract test is desired, it is optional and flagged as a decision, not a
  requirement.)
- **Rationale**: each changed line is exercised; Red is verified before Green per the
  constitution.

## Open decisions (for `/speckit.tasks` / implementation — none block planning)

1. **"Grid Down" label placement**: default design puts it on the existing sublabel line
   (`y+44`, replacing `importing/exporting/idle`) to hold diagram height constant. Alternative:
   add it as a third stacked line below the sublabel. → **Recommended: sublabel line.**
2. **`deriveGridDown` location**: a small pure helper in `dashboard/src/utils/` (e.g.
   `grid.ts`) vs. inline in `buildDeviceGroups`. → **Recommended: dedicated helper** (SRP +
   trivially unit-testable).
3. **Optional API contract test**: add one xUnit test asserting `grid_status_code` round-trips
   through `/readings/current`? → **Recommended: skip** (no changed code; existing generic tests
   cover the path). Included here only as an explicit, reversible choice.
