# API Contract: Device Discovery & Merge

**Feature**: 124-device-discovery
**Date**: 2026-05-08
**Base URL**: `/api/v1`

## Modified Endpoints

### `GET /devices`

**Change**: Add optional `status` query parameter. Defaults to `active` when omitted.

**Query Parameters**:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | `active` | Filter by device status: `active`, `removed`, `merged`, or `all` |

**Response** (unchanged shape):

```json
[
  {
    "device_id": "epcube12345_battery",
    "device_class": "storage_battery",
    "alias": "EP Cube",
    "manufacturer": "Canadian Solar",
    "product_code": "EP Cube (devType=2)",
    "uid": "SG12345",
    "online": true
  }
]
```

**Note**: When `status=all`, the response includes a `status` field on each device:

```json
{
  "device_id": "epcube12345_battery",
  "status": "removed",
  ...
}
```

### `PUT /settings/{key}`

**Change**: Add `discovery_interval_seconds` to the allowed keys list. Same validation as other poll interval keys (integer, 60–86400).

## New Endpoints

### `GET /devices/pending-replacements`

Returns all pending replacement prompts awaiting user action.

**Response**:

```json
[
  {
    "id": 1,
    "old_device_id": "12345",
    "new_device_id": "67890",
    "detected_at": "2026-05-08T14:30:00Z"
  }
]
```

### `GET /devices/merge-preview`

Returns the count of readings that would be transferred for a given device pair.

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `old_device_id` | string | Yes | Raw cloud API device ID of the old (removed) device |
| `new_device_id` | string | Yes | Raw cloud API device ID of the new (active) device |

**Response**:

```json
{
  "old_device_id": "12345",
  "new_device_id": "67890",
  "readings_to_transfer": 45230,
  "conflicts_to_skip": 12
}
```

**Errors**:

| Status | Condition |
|--------|-----------|
| 400 | Missing required parameters |
| 404 | Old or new device not found |
| 422 | Old device is not `removed`, or new device is not `active` |

### `POST /devices/merge`

Executes the device merge. Single transaction, all-or-nothing.

**Request body**:

```json
{
  "old_device_id": "12345",
  "new_device_id": "67890"
}
```

**Success response** (200):

```json
{
  "old_device_id": "12345",
  "new_device_id": "67890",
  "readings_transferred": 45218,
  "conflicts_skipped": 12
}
```

**Errors**:

| Status | Condition |
|--------|-----------|
| 400 | Missing or invalid request body |
| 404 | Old or new device not found |
| 422 | Old device is not `removed`, or new device is not `active` |
| 500 | Transaction failed (rolled back, no data changed) |

### `POST /devices/pending-replacements/{id}/dismiss`

Dismisses a pending replacement prompt without merging.

**Response** (200):

```json
{
  "dismissed": true,
  "old_device_id": "12345",
  "new_device_id": "67890"
}
```

**Errors**:

| Status | Condition |
|--------|-----------|
| 404 | Pending replacement not found |

## Auth

All new endpoints require Entra ID JWT with `user_impersonation` scope (same as existing endpoints).

## Rate Limiting

No additional rate limiting. Merge is a rare operation (~once per year).
