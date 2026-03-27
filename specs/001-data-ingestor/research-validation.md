# Validation Notes: EP Cube Telemetry Data Ingestor

**Date**: 2026-03-27  
**Requirement**: FR-019 — API request validation for the active `/api/v1` surface

## Scope

The current API validates request inputs for these endpoints:

| Endpoint | Parameters to Validate |
|----------|------------------------|
| `GET /readings/current` | `metric` |
| `GET /readings/range` | `metric`, `start`, `end`, `step` |
| `GET /readings/grid` | `start`, `end`, `step` |
| `GET /devices/{device}/metrics` | `device` |
| `GET /grid` | `start`, `end`, `step` |
| `GET /devices` | none |
| `GET /health` | none |

## Decision

Use explicit validation helpers in `Validate.cs` and return typed `400 Bad Request` responses with the shared `ErrorResponse` model.

## Rationale

1. Zero extra framework complexity
2. Easy unit testing for each validation rule
3. Clear reviewability at each endpoint
4. Stable error shape for clients

## Current Validation Rules

### Safe Names

Used for `metric` and `device`.

Accepted shape:

- starts with a letter or underscore
- continues with letters, digits, or underscores

Rejected examples:

- `grid power`
- `../etc/passwd`
- `metric-name`

### Timestamps

Used for `start` and `end` on the current API.

Accepted shape:

- Unix epoch seconds expressed as numeric strings

Rejected examples:

- `2026-03-27T00:00:00Z`
- `yesterday`
- empty strings when the parameter is required

### Step Values

Used for `step` on range endpoints.

Accepted shape:

- integer seconds as numeric strings

Rejected examples:

- `1m`
- `60.5`
- `hourly`

## Error Response Shape

All validation failures return:

```json
{
  "status": "error",
  "errorType": "bad_data",
  "error": "human-readable explanation"
}
```

## Endpoint Patterns

### Current Readings

```csharp
var error = Validate.Required(metric, "metric")
    ?? Validate.SafeName(metric, "metric");
```

### Range Readings

```csharp
var error = Validate.Required(metric, "metric")
    ?? Validate.SafeName(metric, "metric")
    ?? Validate.Required(start, "start")
    ?? Validate.Required(end, "end")
    ?? Validate.Required(step, "step")
    ?? Validate.Timestamp(start, "start")
    ?? Validate.Timestamp(end, "end")
    ?? Validate.StepSeconds(step, "step");
```

### Device Metrics

```csharp
var error = Validate.SafeName(device, "device");
```

## Design Notes

1. First error wins. The API returns one concrete failure rather than a list.
2. Validation lives at the API boundary, not inside the data store implementation.
3. The contract is intentionally stricter than generic parsing to keep client behavior predictable.
