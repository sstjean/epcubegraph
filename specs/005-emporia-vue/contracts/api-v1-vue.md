# API Contract: Vue Endpoints (EP Cube Graph API v1)

**Version**: 1.1.0 | **Branch**: `005-emporia-vue` | **Date**: 2026-04-08

## Base URL

```text
https://{host}/api/v1
```

## Authentication

All Vue endpoints require a valid Microsoft Entra ID JWT bearer token (same as existing endpoints).

```text
Authorization: Bearer <entra-id-jwt>
```

Scope: `user_impersonation` | Auth errors: `401 Unauthorized` (invalid/missing token), `403 Forbidden` (missing scope)

## New Vue Endpoints

### `GET /api/v1/vue/devices`

Returns all known Vue devices with their channels and online status.

#### Response

```json
{
  "devices": [
    {
      "device_gid": 12345,
      "device_name": "Main Panel",
      "display_name": "Main Panel",
      "model": "VUE001",
      "connected": true,
      "last_seen": 1712592000,
      "channels": [
        {
          "channel_num": "1,2,3",
          "name": "Main",
          "display_name": "Main",
          "channel_type": "Main"
        },
        {
          "channel_num": "1",
          "name": "Kitchen",
          "display_name": "Kitchen Counter",
          "channel_type": null
        }
      ]
    }
  ]
}
```

**Notes**:
- `display_name` resolves from `display_name_overrides` → device/channel default name
- `last_seen` is a Unix timestamp (seconds)
- Channels include all circuit channels, mains (`1,2,3`), and balance

---

### `GET /api/v1/vue/devices/{deviceGid}/readings/current`

Returns the latest power reading for each channel on a specific device.

#### Path Parameters

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `deviceGid` | long | Yes | Vue device GID |

#### Response

```json
{
  "device_gid": 12345,
  "timestamp": 1712592000,
  "channels": [
    {
      "channel_num": "1,2,3",
      "display_name": "Main",
      "value": 8450.5
    },
    {
      "channel_num": "1",
      "display_name": "Kitchen Counter",
      "value": 1200.0
    }
  ]
}
```

**Error**: `404 Not Found` if `deviceGid` does not exist.

---

### `GET /api/v1/vue/devices/{deviceGid}/readings/range`

Returns time-series power readings for each channel on a specific device over a time range.

#### Path Parameters

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `deviceGid` | long | Yes | Vue device GID |

#### Query Parameters

| Parameter | Type | Required | Default | Notes |
|-----------|------|----------|---------|-------|
| `start` | ISO 8601 | Yes | — | Range start (inclusive) |
| `end` | ISO 8601 | Yes | — | Range end (exclusive) |
| `step` | string | No | auto | Bucketing step (e.g., `1s`, `1m`, `5m`, `1h`). Auto-selects based on range: <7d → raw 1s, ≥7d → 1min |
| `channels` | string | No | all | Comma-separated channel_nums to include (e.g., `1,2,3,4,5`) |

#### Response

```json
{
  "device_gid": 12345,
  "start": "2026-04-01T00:00:00Z",
  "end": "2026-04-02T00:00:00Z",
  "step": "1m",
  "series": [
    {
      "channel_num": "1,2,3",
      "display_name": "Main",
      "values": [
        { "timestamp": 1712592000, "value": 8450.5 },
        { "timestamp": 1712592060, "value": 8420.0 }
      ]
    }
  ]
}
```

**Notes**:
- For ranges within 7 days, queries `vue_readings` (1-second data, aggregated to `step`)
- For ranges beyond 7 days, queries `vue_readings_1min` (pre-aggregated)
- `step=auto` selects the finest available resolution for the requested range

---

### `GET /api/v1/vue/panels/{deviceGid}/total`

Returns the current raw and deduplicated power total for a panel.

#### Path Parameters

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `deviceGid` | long | Yes | Panel's Vue device GID |

#### Response (panel with children)

```json
{
  "device_gid": 12345,
  "display_name": "Main Panel",
  "timestamp": 1712592000,
  "raw_total_watts": 8450.5,
  "deduplicated_total_watts": 5230.5,
  "children": [
    {
      "device_gid": 23456,
      "display_name": "Workshop",
      "raw_total_watts": 3220.0
    }
  ]
}
```

#### Response (panel without children)

```json
{
  "device_gid": 23456,
  "display_name": "Workshop",
  "timestamp": 1712592000,
  "raw_total_watts": 3220.0,
  "deduplicated_total_watts": 3220.0,
  "children": []
}
```

**Notes**:
- `raw_total_watts` = mains channel (`1,2,3`) latest value
- `deduplicated_total_watts` = `raw_total_watts - SUM(child.raw_total_watts)` for all direct children in `panel_hierarchy`
- If no children exist, `deduplicated_total_watts == raw_total_watts`
- `children` array shows each direct child with its raw total

---

### `GET /api/v1/vue/panels/{deviceGid}/total/range`

Returns time-series raw and deduplicated panel totals over a time range.

#### Path Parameters

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `deviceGid` | long | Yes | Panel's Vue device GID |

#### Query Parameters

| Parameter | Type | Required | Default | Notes |
|-----------|------|----------|---------|-------|
| `start` | ISO 8601 | Yes | — | Range start (inclusive) |
| `end` | ISO 8601 | Yes | — | Range end (exclusive) |
| `step` | string | No | auto | Bucketing step |

#### Response

```json
{
  "device_gid": 12345,
  "display_name": "Main Panel",
  "start": "2026-04-01T00:00:00Z",
  "end": "2026-04-02T00:00:00Z",
  "step": "1m",
  "raw_total": [
    { "timestamp": 1712592000, "value": 8450.5 },
    { "timestamp": 1712592060, "value": 8420.0 }
  ],
  "deduplicated_total": [
    { "timestamp": 1712592000, "value": 5230.5 },
    { "timestamp": 1712592060, "value": 5200.0 }
  ]
}
```

## Updated Endpoint Summary

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /health` | No | Datastore health check (unchanged) |
| `GET /readings/current` | Yes | EP Cube latest reading per device (unchanged) |
| `GET /readings/range` | Yes | EP Cube bucketed time-series (unchanged) |
| `GET /devices` | Yes | EP Cube device inventory (unchanged) |
| `GET /devices/{device}/metrics` | Yes | EP Cube metrics for one device (unchanged) |
| `GET /grid` | Yes | Grid power time-series (unchanged) |
| `GET /settings` | Yes | All settings (unchanged) |
| `PUT /settings/{key}` | Yes | Update setting (unchanged) |
| `GET /settings/hierarchy` | Yes | Panel hierarchy (unchanged) |
| `PUT /settings/hierarchy` | Yes | Replace hierarchy (unchanged) |
| `GET /settings/display-names` | Yes | Display name overrides (unchanged) |
| `PUT /settings/display-names/{deviceGid}` | Yes | Update display names (unchanged) |
| `DELETE /settings/display-names/{deviceGid}/{channel}` | Yes | Clear display name (unchanged) |
| **`GET /vue/devices`** | **Yes** | **Vue device + channel inventory** |
| **`GET /vue/devices/{deviceGid}/readings/current`** | **Yes** | **Latest readings per channel** |
| **`GET /vue/devices/{deviceGid}/readings/range`** | **Yes** | **Time-series per channel** |
| **`GET /vue/panels/{deviceGid}/total`** | **Yes** | **Raw + deduplicated panel total (current)** |
| **`GET /vue/panels/{deviceGid}/total/range`** | **Yes** | **Raw + deduplicated panel total (time-series)** |

## Response Types

### New Types

```
VueDeviceChannel { channel_num: string, name: string, display_name: string, channel_type: string? }
VueDeviceInfo { device_gid: long, device_name: string, display_name: string, model: string, connected: bool, last_seen: long, channels: VueDeviceChannel[] }
VueDevicesResponse { devices: VueDeviceInfo[] }
VueChannelReading { channel_num: string, display_name: string, value: double }
VueCurrentReadingsResponse { device_gid: long, timestamp: long, channels: VueChannelReading[] }
VueChannelSeries { channel_num: string, display_name: string, values: TimeSeriesPoint[] }
VueRangeReadingsResponse { device_gid: long, start: string, end: string, step: string, series: VueChannelSeries[] }
PanelChild { device_gid: long, display_name: string, raw_total_watts: double }
PanelTotalResponse { device_gid: long, display_name: string, timestamp: long, raw_total_watts: double, deduplicated_total_watts: double, children: PanelChild[] }
PanelTotalRangeResponse { device_gid: long, display_name: string, start: string, end: string, step: string, raw_total: TimeSeriesPoint[], deduplicated_total: TimeSeriesPoint[] }
```

### Reused Types (from existing API)

```
TimeSeriesPoint { timestamp: long, value: double }
```
