# API Contract: Feature 007 Additions to EP Cube Graph API v1

**Version**: 1.0.0 | **Branch**: `007-dashboard-vue-circuits` | **Date**: 2026-04-09

## Base URL

```text
https://{host}/api/v1
```

## Authentication

All endpoints require a valid Microsoft Entra ID JWT bearer token (same as existing endpoints).

```text
Authorization: Bearer <entra-id-jwt>
```

## New Endpoints

### `GET /api/v1/vue/readings/current`

Returns the latest power reading for each channel across all Vue devices in a single call.

#### Response

```json
{
  "devices": [
    {
      "device_gid": 480380,
      "timestamp": 1712592000,
      "channels": [
        {
          "channel_num": "1,2,3",
          "display_name": "Main",
          "value": 8450.5
        },
        {
          "channel_num": "4",
          "display_name": "Kitchen Counter",
          "value": 1200.0
        },
        {
          "channel_num": "Balance",
          "display_name": "Unmonitored loads",
          "value": 320.5
        }
      ]
    },
    {
      "device_gid": 480544,
      "timestamp": 1712592000,
      "channels": [
        {
          "channel_num": "1,2,3",
          "display_name": "Main",
          "value": 3220.0
        }
      ]
    }
  ]
}
```

**Notes**:
- Returns all devices with their latest readings (same data as per-device endpoint, but bulk)
- `display_name` resolves from `display_name_overrides` → channel default name
- `timestamp` is Unix seconds of the latest reading for that device
- Devices with no readings are included with an empty `channels` array

---

### `GET /api/v1/vue/readings/daily`

Returns cumulative daily kWh per channel across all Vue devices for a given date.

#### Query Parameters

| Parameter | Type | Required | Default | Notes |
|-----------|------|----------|---------|-------|
| `date` | ISO date | Yes | — | Calendar date (e.g., `2026-04-09`). Dashboard sends the user's local date. |

#### Response

```json
{
  "date": "2026-04-09",
  "devices": [
    {
      "device_gid": 480380,
      "channels": [
        {
          "channel_num": "1,2,3",
          "display_name": "Main",
          "kwh": 42.5
        },
        {
          "channel_num": "4",
          "display_name": "Kitchen Counter",
          "kwh": 3.2
        },
        {
          "channel_num": "Balance",
          "display_name": "Unmonitored loads",
          "kwh": 8.1
        }
      ]
    }
  ]
}
```

**Notes**:
- Reads from `vue_readings_daily` table (populated by exporter)
- `display_name` resolves same way as current readings
- Devices with no daily data for the requested date are omitted
- `kwh` is cumulative from midnight (exporter's daily-scale query)

**Error**: `400 Bad Request` if `date` is not a valid ISO date string.

---

## Extended Endpoints

### `PUT /api/v1/settings/{key}` — Extended Allowlist

Two new keys are added to the settings allowlist:

| Key | Validation | Notes |
|-----|-----------|-------|
| `vue_device_mapping` | Valid JSON object: keys are strings, values are arrays of objects with `gid` (number) and `alias` (string). No duplicate GIDs across keys. | Maps EP Cube device IDs to Vue panels with display alias |
| `vue_daily_poll_interval_seconds` | Integer 1–3600 | Exporter poll interval for daily kWh data |

#### Example: Save Vue Device Mapping

```http
PUT /api/v1/settings/vue_device_mapping
Content-Type: application/json

{
  "value": "{\"epcube3483\":[{\"gid\":480380,\"alias\":\"Main Panel\"},{\"gid\":480544,\"alias\":\"Subpanel 1\"}]}"
}
```

**Validation errors**:
- `400`: "Invalid JSON in vue_device_mapping value"
- `400`: "vue_device_mapping values must be arrays of objects with gid and alias"
- `400`: "Vue device GID {gid} is mapped to multiple EP Cube devices"

---

## Dashboard Component Contracts

### Flow Card Circuit List

**Data source**: `GET /vue/readings/current` + `GET /settings` (vue_device_mapping)

**Rendering rules**:
- For each EP Cube card, look up mapped Vue GIDs from `vue_device_mapping`
- Collect channels from those devices where `value > 0`
- Exclude mains channels (`channel_num === "1,2,3"`)
- Include Balance channels (shown as "Unmonitored loads")
- Sort descending by `value` (highest first), then alphabetical by `display_name`
- Left column fills first, overflow to right column
- If 2+ Vue panels mapped to same EP Cube, all circuits from all panels are shown by `display_name` without prefix
- Style: 0.75em font, name left / watts right, tight line spacing

### Circuits Page

**Data sources**: `GET /vue/devices` + `GET /vue/readings/current` + `GET /vue/readings/daily` + `GET /settings/hierarchy`

**Panel ordering** (FR-014):
1. Top-level panels without children → alphabetical
2. Parent panels → alphabetical, each followed immediately by their children (alphabetical)

**Circuit ordering within panel** (FR-011):
1. Mains ("1,2,3") — bold, with separator below
2. Individual circuits by channel number ascending ("1", "2", "3", ...)
3. Balance — last row, labeled "Unmonitored loads"

**Panel header displays**:
- Panel display name
- Raw total watts (mains value)
- Deduplicated total watts (raw minus child mains)
- Daily kWh total (sum of all circuits' daily kWh)

**Circuit row displays**:
- Display name
- Current watts (formatted per `formatWatts`)
- Daily kWh (formatted per `formatKwh`)

### Navigation

**Route**: `/circuits`
**Nav position**: Third item — Current Readings · Circuits · Settings
