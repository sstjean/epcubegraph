# API Contract: EP Cube Graph API v1

**Version**: 1.0.0 | **Branch**: `001-data-ingestor` | **Date**: 2026-03-07

---

## Base URL

```
https://{host}/api/v1
```

---

## Authentication

All endpoints require a valid **Microsoft Entra ID JWT** bearer token (FR-010).

```
Authorization: Bearer <entra-id-jwt>
```

**Validation** (performed on every request):
- Algorithm: RS256
- Issuer: `https://login.microsoftonline.com/{tenant_id}/v2.0`
- Audience: `api://{app_client_id}`
- Scope: `user_impersonation`
- Expiry: Token must not be expired (`exp` claim)
- Not-before: Token must be active (`nbf` claim)

**Error responses**:
| Status | Condition |
|--------|-----------|
| `401 Unauthorized` | Missing, expired, invalid signature, wrong audience/issuer |
| `403 Forbidden` | Valid token but insufficient scope |

---

## Endpoints

### GET /api/v1/devices

List all known devices with their metadata.

**Description**: Returns device identity information from `echonet_device_info` metrics stored in VictoriaMetrics. Each device entry includes the labels exposed by epcube-exporter.

**Response**: `200 OK`

```json
{
  "devices": [
    {
      "device": "epcube_battery",
      "class": "storage_battery",
      "manufacturer": "Canadian Solar",
      "product_code": "EP Cube 2.0",
      "uid": "ABC123",
      "online": true
    },
    {
      "device": "epcube_solar",
      "class": "home_solar",
      "manufacturer": "Canadian Solar",
      "product_code": "EP Cube 2.0",
      "uid": "ABC123",
      "online": true
    }
  ]
}
```

**Implementation**: Queries `echonet_device_info` and `echonet_scrape_success` from VictoriaMetrics.

---

### GET /api/v1/query

Execute an instant PromQL query against VictoriaMetrics (FR-008).

**Query parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | PromQL expression |
| `time` | string | no | Evaluation timestamp (RFC3339 or Unix epoch). Defaults to now. |

**Response**: `200 OK`

```json
{
  "status": "success",
  "data": {
    "resultType": "vector",
    "result": [
      {
        "metric": {
          "__name__": "echonet_battery_state_of_capacity_percent",
          "device": "epcube_battery",
          "class": "storage_battery"
        },
        "value": [1709827200, "85"]
      }
    ]
  }
}
```

**Error responses**:

| Status | Condition |
|--------|-----------|
| `400 Bad Request` | Invalid PromQL syntax or missing `query` parameter |
| `422 Unprocessable Entity` | Valid PromQL but query execution error |

---

### GET /api/v1/query_range

Execute a range PromQL query for time-series data (FR-008, FR-009).

**Query parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | PromQL expression |
| `start` | string | yes | Start timestamp (RFC3339 or Unix epoch) |
| `end` | string | yes | End timestamp (RFC3339 or Unix epoch) |
| `step` | string | yes | Query resolution step (e.g., `1m`, `5m`, `1h`) |

**Example request**:

```
GET /api/v1/query_range?query=echonet_battery_state_of_capacity_percent{device="epcube_battery"}&start=2026-03-06T00:00:00Z&end=2026-03-07T00:00:00Z&step=5m
```

**Response**: `200 OK`

```json
{
  "status": "success",
  "data": {
    "resultType": "matrix",
    "result": [
      {
        "metric": {
          "__name__": "echonet_battery_state_of_capacity_percent",
          "device": "epcube_battery",
          "class": "storage_battery"
        },
        "values": [
          [1709683200, "72"],
          [1709683500, "73"],
          [1709683800, "74"]
        ]
      }
    ]
  }
}
```

**Empty result**: When no data exists for the given range, the response returns `"result": []` (not an error).

```json
{
  "status": "success",
  "data": {
    "resultType": "matrix",
    "result": []
  }
}
```

**Error responses**:

| Status | Condition |
|--------|-----------|
| `400 Bad Request` | Missing required parameters or invalid PromQL |
| `422 Unprocessable Entity` | `start` > `end`, or step too small |

---

### GET /api/v1/series

Find metric series matching a set of label matchers.

**Query parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `match[]` | string | yes | Series selector (repeatable). E.g., `echonet_battery_state_of_capacity_percent{device="epcube_battery"}` |
| `start` | string | no | Start timestamp |
| `end` | string | no | End timestamp |

**Response**: `200 OK`

```json
{
  "status": "success",
  "data": [
    {
      "__name__": "echonet_battery_state_of_capacity_percent",
      "device": "epcube_battery",
      "class": "storage_battery"
    }
  ]
}
```

---

### GET /api/v1/labels

List all label names.

**Response**: `200 OK`

```json
{
  "status": "success",
  "data": ["__name__", "class", "device", "manufacturer", "product_code", "uid"]
}
```

---

### GET /api/v1/label/{name}/values

List values for a specific label.

**Path parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Label name (e.g., `device`) |

**Response**: `200 OK`

```json
{
  "status": "success",
  "data": ["epcube_battery", "epcube_solar"]
}
```

---

### GET /api/v1/health

Health check endpoint (unauthenticated).

**Response**: `200 OK`

```json
{
  "status": "healthy",
  "victoriametrics": "reachable"
}
```

**Response**: `503 Service Unavailable`

```json
{
  "status": "unhealthy",
  "victoriametrics": "unreachable"
}
```

---

## Convenience Endpoints

These are higher-level endpoints that wrap PromQL queries for common use cases. They simplify client integration.

### GET /api/v1/devices/{device}/metrics

List available metrics for a specific device.

**Path parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `device` | string | Device identifier (e.g., `epcube_battery`) |

**Response**: `200 OK`

```json
{
  "device": "epcube_battery",
  "metrics": [
    "echonet_battery_state_of_capacity_percent",
    "echonet_battery_charge_discharge_power_watts",
    "echonet_battery_remaining_capacity_wh",
    "echonet_battery_chargeable_capacity_wh",
    "echonet_battery_dischargeable_capacity_wh",
    "echonet_battery_cumulative_charge_wh",
    "echonet_battery_cumulative_discharge_wh",
    "echonet_battery_working_operation_state"
  ]
}
```

**Error responses**:

| Status | Condition |
|--------|-----------|
| `404 Not Found` | No metrics found for the specified device |

---

### GET /api/v1/grid

Get the derived grid power (FR-003a).

**Query parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `start` | string | no | Start timestamp (defaults to 24h ago) |
| `end` | string | no | End timestamp (defaults to now) |
| `step` | string | no | Resolution step (defaults to `1m`) |

**Response**: `200 OK`

```json
{
  "status": "success",
  "data": {
    "resultType": "matrix",
    "result": [
      {
        "metric": {
          "__name__": "grid_power_watts"
        },
        "values": [
          [1709683200, "350"],
          [1709683500, "-120"],
          [1709683800, "500"]
        ]
      }
    ]
  }
}
```

**Sign convention**: Positive = export to grid, Negative = import from grid.

**Implementation**: Executes PromQL `echonet_solar_instantaneous_generation_watts - echonet_battery_charge_discharge_power_watts`.

---

## Remote-Write Ingestion Endpoint (Internal)

This endpoint is served by **vmauth → VictoriaMetrics**, not the C# API.

### POST /api/v1/write

Accepts Prometheus remote-write protocol (protobuf + snappy compressed).

**Authentication**: Pre-shared bearer token (FR-012, FR-013).

```
Authorization: Bearer <remote-write-token>
```

**Request body**: Prometheus remote-write protobuf (snappy-compressed `WriteRequest`).

**Response**: `204 No Content` (success, no body)

**Error responses**:

| Status | Condition |
|--------|-----------|
| `401 Unauthorized` | Missing or invalid bearer token |
| `400 Bad Request` | Invalid protobuf or decompression failure |

---

## Common Response Envelope

All PromQL-passthrough endpoints (`/query`, `/query_range`, `/series`, `/labels`, `/label/{name}/values`) return the standard Prometheus HTTP API response format:

```json
{
  "status": "success" | "error",
  "data": { ... },
  "errorType": "...",
  "error": "..."
}
```

When `status` is `"error"`, the `errorType` and `error` fields describe the failure.

---

## C# Response Models

```csharp
using System.Text.Json.Serialization;

public record DeviceInfo(
    [property: JsonPropertyName("device")] string Device,
    [property: JsonPropertyName("class")] string DeviceClass,  // "storage_battery" or "home_solar"
    [property: JsonPropertyName("manufacturer")] string? Manufacturer = null,
    [property: JsonPropertyName("product_code")] string? ProductCode = null,
    [property: JsonPropertyName("uid")] string? Uid = null,
    [property: JsonPropertyName("online")] bool Online = false);

public record DeviceListResponse(
    [property: JsonPropertyName("devices")] IReadOnlyList<DeviceInfo> Devices);

public record HealthResponse(
    [property: JsonPropertyName("status")] string Status,           // "healthy" or "unhealthy"
    [property: JsonPropertyName("victoriametrics")] string VictoriaMetrics); // "reachable" or "unreachable"

public record DeviceMetricsResponse(
    [property: JsonPropertyName("device")] string Device,
    [property: JsonPropertyName("metrics")] IReadOnlyList<string> Metrics);

public record ErrorResponse(
    [property: JsonPropertyName("status")] string Status,       // always "error"
    [property: JsonPropertyName("errorType")] string ErrorType,  // "bad_data", "execution", etc.
    [property: JsonPropertyName("error")] string Error);         // human-readable message
```

`ErrorResponse` is used for all error responses (400, 422) across PromQL-passthrough and convenience endpoints. It matches the Prometheus error envelope so clients have one error-handling path.

PromQL-passthrough endpoints return raw VictoriaMetrics JSON (not wrapped in custom models) to preserve compatibility with Grafana and other Prometheus-ecosystem tools.

---

## Self-Monitoring Endpoint

### GET /metrics

Prometheus-format metrics for self-monitoring (FR-021). **Unauthenticated** — served outside the `/api/v1` auth group.

**Response**: `200 OK` (content-type: `text/plain; version=0.0.4; charset=utf-8`)

```
# HELP http_requests_received_total Provides the count of HTTP requests that have been processed.
# TYPE http_requests_received_total counter
http_requests_received_total{code="200",method="GET",controller="",action=""} 42
# HELP http_request_duration_seconds The duration of HTTP requests processed by an ASP.NET Core application.
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{code="200",method="GET",controller="",action="",le="0.001"} 38
...
# HELP process_cpu_seconds_total Total user and system CPU time spent in seconds.
# TYPE process_cpu_seconds_total counter
process_cpu_seconds_total 1.23
```

**Note**: This endpoint exposes only HTTP performance counters and process metrics — no telemetry data. Served by `prometheus-net.AspNetCore` via `app.MapMetrics()`.

---

## Input Validation (FR-019)

All endpoints validate incoming query/path parameters for presence and type before forwarding to VictoriaMetrics. Invalid input returns `400 Bad Request` with the `ErrorResponse` envelope:

```json
{
  "status": "error",
  "errorType": "bad_data",
  "error": "'query' is required"
}
```

**Validation rules**:

| Parameter type | Validation | Error example |
|---|---|---|
| Required string (`query`) | Non-null, non-whitespace | `'query' is required` |
| Timestamp (`start`, `end`, `time`) | RFC3339 or Unix epoch (when provided) | `'start' must be a valid RFC3339 timestamp or Unix epoch` |
| Duration (`step`) | Matches `^\d+[smhd]$` (when provided) | `'step' must be a valid duration (e.g., 1m, 5m, 1h, 1d)` |
| Safe name (`device`, `name`) | Matches `^[a-zA-Z_][a-zA-Z0-9_]*$` | `'device' contains invalid characters` |

---

## Rate Limiting

No rate limiting for v1 (single-user system). May be added in future versions if needed.

## Versioning

API versioned via URL path prefix (`/api/v1`). Breaking changes require a new version (`/api/v2`).
