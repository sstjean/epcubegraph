# Phase 1 Data Model: Grid-down state

**Feature**: 181-grid-down-state · **Date**: 2026-07-03

No database schema change. This feature adds one **metric name** to the existing time-series
`readings` table and one **derived boolean** computed in the dashboard.

---

## Persisted entity — Grid status reading

Stored as an ordinary row in the existing `readings` table.

| Column | Value for this feature | Notes |
|--------|------------------------|-------|
| `device_id` | `epcube{devId}_battery` | Same device that carries `grid_power_watts` etc. |
| `metric_name` | `grid_status_code` | **New** metric name. No schema change. |
| `timestamp` | poll time (UTC) | Same `now_utc` used for the other per-poll readings. |
| `value` | raw `systemStatus` integer as a double | e.g. `2.0` Backup, `3.0` Off-Grid, `4.0` Normal. |

**Write rules**

- Written **once per polling cycle**, in `build_postgres_readings()`, appended to the existing
  battery-device readings list.
- **Omitted** when `system_status_raw` is not a valid integer (missing → `"?"`, or any
  non-integer). Omission is how stale/absent maps to "no indicator" (FR-008).
- Value domain (known codes): `0 Standby · 1 Self-Use · 2 Backup · 3 Off-Grid · 4 Normal ·
  5 Fault · 6 Upgrading`. Unknown codes are persisted as-is (they simply won't match `{2,3}`).

**Indexing**: reuses `idx_readings_device_metric_time (device_id, metric_name, timestamp DESC)`
and `idx_readings_metric_time` from #182 — the `/readings/current` LATERAL top-1-per-device
lookup is already covered.

## Derived entity — Grid-down state (per system, dashboard-only)

Computed in the dashboard from the latest `grid_status_code` reading; never persisted.

```
gridDown(device) = group.online
                   && Number.isInteger(code)
                   && (code === 2 || code === 3)
   where code = latest grid_status_code value for that device (0 if absent/offline)
```

| Field | Type | Source |
|-------|------|--------|
| `gridDown` | `boolean` | `deriveGridDown(code)` applied to the battery device's latest `grid_status_code` |

- Added to `DeviceCardMetrics` (`dashboard/src/components/DeviceCard.tsx`).
- Offline groups are already zeroed by `buildDeviceGroups` → `code = 0` → `gridDown = false`.
- Attribution is per battery device (FR-006): each system's `gridDown` derives only from its
  own reading — no cross-system leakage (US2).

### State transitions (observable on the diagram)

```
   grid-up state (0/1/4/5/6/unknown/absent)
            │  systemStatus becomes 2 or 3
            ▼
   GRID DOWN  → Grid symbol red + "Grid Down" label
            │  systemStatus returns to a non-{2,3} value,
            │  OR signal goes stale/absent, OR device goes offline
            ▼
   grid-up state → normal Grid symbol, no label
```

Transitions take effect on the **next** dashboard refresh / polling cycle (SC-001).

## Contract touchpoints

| Tier | Artifact | Change |
|------|----------|--------|
| Exporter | `readings` row `metric_name = grid_status_code` | **new metric**, no schema change |
| API | `GET /readings/current?metric=grid_status_code` | **no code change** (generic endpoint) |
| Dashboard | `DeviceCardMetrics.gridDown: boolean` | **new derived field** |
| Dashboard | `EnergyFlowDiagram` Grid node | red stroke + "Grid Down" label when `gridDown` |
