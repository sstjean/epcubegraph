# Contract: `grid_status_code` on the current-readings surface

**Feature**: 181-grid-down-state · **Date**: 2026-07-03
**Endpoint**: `GET /api/v1/readings/current?metric=grid_status_code` — **existing, generic, no code change**

This documents how the new `grid_status_code` metric behaves over the already-shipped
current-readings contract. The API is unchanged; this contract locks the shape and the
consumer (dashboard) expectations.

---

## Request

```
GET /api/v1/readings/current?metric=grid_status_code
Authorization: Bearer <token>
```

- `metric` is validated by `Validate.Required` + `Validate.SafeName`. `grid_status_code`
  passes (letters + underscores). No metric allowlist exists.

## Response — `200 OK`

`CurrentReadingsResponse` (unchanged type). One entry per registered device that has at least
one `grid_status_code` reading; latest value per device.

```json
{
  "metric": "grid_status_code",
  "readings": [
    { "device_id": "epcube1_battery", "timestamp": 1751572800, "value": 3 },
    { "device_id": "epcube2_battery", "timestamp": 1751572800, "value": 1 }
  ]
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `metric` | string | Echoes `grid_status_code`. |
| `readings[].device_id` | string | Battery device id (`epcube{devId}_battery`). |
| `readings[].timestamp` | number (epoch seconds, UTC) | Poll time of the latest reading. |
| `readings[].value` | number | Raw `systemStatus` code: `0..6` (see data-model). |

**Grid-down derivation (consumer side)**: `gridDown = value === 2 || value === 3`.

## Absence / staleness

- A device with **no** `grid_status_code` reading (exporter omitted it because `systemStatus`
  was missing/non-integer) simply **does not appear** in `readings` → consumer treats it as
  `gridDown = false` (FR-008).
- Offline groups are zeroed by the dashboard before derivation → `gridDown = false`.

## Errors (unchanged behavior)

| Status | Condition |
|--------|-----------|
| `400 bad_data` | `metric` missing or fails `SafeName`. |
| `422 execution` | Unexpected store/query error. |

## Consumer expectations (dashboard)

- `fetchCurrentReadings('grid_status_code')` is called in the same `Promise.all` batch as the
  other six current metrics in `CurrentReadings.tsx`.
- Value is mapped per device via `getMetricForDevice(response, batteryDevice.device)`, then
  `deriveGridDown(code)` produces the boolean threaded into `DeviceCardMetrics.gridDown`.

## Contract test posture

- No API code changes → the path is covered by the existing generic `/readings/current` tests.
- An extra xUnit round-trip test for `grid_status_code` is **optional** (see research R7 /
  open decision 3) and is not required for coverage.
