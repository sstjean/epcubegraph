# API Contract: EP Cube Graph API v1

**Version**: 1.0.0 | **Branch**: `001-data-ingestor` | **Date**: 2026-03-27

## Base URL

```text
https://{host}/api/v1
```

## Authentication

All telemetry endpoints require a valid Microsoft Entra ID JWT bearer token.

```text
Authorization: Bearer <entra-id-jwt>
```

### Validation

- Algorithm: RS256
- Issuer: `https://login.microsoftonline.com/{tenant_id}/v2.0`
- Audience: `api://{app_client_id}`
- Scope: `user_impersonation`
- Expiry and activation claims must be valid

### Auth Errors

| Status | Condition |
|--------|-----------|
| `401 Unauthorized` | Missing token, expired token, invalid signature, wrong audience, wrong issuer |
| `403 Forbidden` | Valid token without the required scope |

## Common Error Response

```json
{
  "status": "error",
  "errorType": "bad_data",
  "error": "Invalid value for 'metric'"
}
```

## Endpoint Summary

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /health` | No | Datastore health check |
| `GET /readings/current` | Yes | Latest reading per device for one metric |
| `GET /readings/range` | Yes | Bucketed time-series per device for one metric |
| `GET /devices` | Yes | Device inventory |
| `GET /devices/{device}/metrics` | Yes | Metrics available for one device |
| `GET /grid` | Yes | Grid power time-series |

## `GET /api/v1/health`

Checks PostgreSQL reachability.

### Success Response

```json
{
  "status": "healthy",
  "datastore": "ok"
}
```

### Failure Response

```json
{
  "status": "unhealthy",
  "datastore": "unreachable"
}
```

## `GET /api/v1/readings/current`

Returns the latest reading per device for a metric.

### Query Parameters

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `metric` | string | Yes | Safe metric name such as `grid_power_watts` |

### Example Response

```json
{
  "metric": "grid_power_watts",
  "readings": [
    {
      "device_id": "epcube3483_battery",
      "timestamp": 1711497600,
      "value": 450.0
    }
  ]
}
```

## `GET /api/v1/readings/range`

Returns bucketed readings for one metric grouped by device.

### Query Parameters

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `metric` | string | Yes | Safe metric name |
| `start` | string | Yes | Unix epoch seconds |
| `end` | string | Yes | Unix epoch seconds |
| `step` | string | Yes | Integer seconds |

### Example Request

```text
GET /api/v1/readings/range?metric=battery_power_watts&start=1711494000&end=1711497600&step=60
```

### Example Response

```json
{
  "metric": "battery_power_watts",
  "series": [
    {
      "device_id": "epcube3483_battery",
      "values": [
        {
          "timestamp": 1711494000,
          "value": -1250.0
        },
        {
          "timestamp": 1711494060,
          "value": -1310.0
        }
      ]
    }
  ]
}
```

Empty result sets return HTTP 200 with an empty `series` array.

## `GET /api/v1/devices`

Returns all known devices and online state.

### Example Response

```json
{
  "devices": [
    {
      "device": "epcube3483_battery",
      "class": "storage_battery",
      "manufacturer": "Canadian Solar",
      "product_code": "EP Cube 2.0",
      "uid": "ABC123",
      "online": true,
      "alias": "EP Cube 2.0"
    }
  ]
}
```

## `GET /api/v1/devices/{device}/metrics`

Returns the metric names currently available for one device.

### Path Parameters

| Parameter | Type | Notes |
|-----------|------|-------|
| `device` | string | Safe device identifier |

### Example Response

```json
{
  "device": "epcube3483_battery",
  "metrics": [
    "battery_power_watts",
    "battery_state_of_capacity_percent",
    "battery_stored_kwh",
    "grid_power_watts",
    "home_load_power_watts"
  ]
}
```

If no metrics exist for the device, the endpoint returns `404 Not Found`.

## `GET /api/v1/grid`

Returns grid power time series. All parameters are optional with smart defaults.

### Query Parameters

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `start` | string | No | Unix epoch seconds; defaults to 24 hours ago |
| `end` | string | No | Unix epoch seconds; defaults to now |
| `step` | string | No | Integer seconds; defaults to `60` |

### Example Response

```json
{
  "metric": "grid_power_watts",
  "series": [
    {
      "device_id": "epcube3483_battery",
      "values": [
        {
          "timestamp": 1711497600,
          "value": 450.0
        }
      ]
    }
  ]
}
```

## Validation Rules

- `metric` and `device` must match the API safe-name rules.
- `start` and `end` must be Unix epoch seconds when provided.
- `step` must be an integer number of seconds when provided.
- Invalid inputs return `400 Bad Request`.
- Execution failures return `422 Unprocessable Entity`.
