# Data Model: Automatic Device Discovery

**Feature**: 124-device-discovery
**Date**: 2026-05-08

## Schema Changes

### Modified Table: `devices`

Add `status` column to the existing table.

```sql
ALTER TABLE devices ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
```

**After migration:**

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | SERIAL | PRIMARY KEY | Existing |
| device_id | TEXT | NOT NULL UNIQUE | Existing — e.g., `epcube12345_battery` |
| device_class | TEXT | NOT NULL | Existing — e.g., `storage_battery`, `home_solar` |
| alias | TEXT | | Existing — device display name |
| manufacturer | TEXT | | Existing |
| product_code | TEXT | | Existing |
| uid | TEXT | | Existing — serial number |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Existing |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | Existing |
| **status** | **TEXT** | **NOT NULL DEFAULT 'active'** | **New** — `active`, `removed`, or `merged` |

**Status values:**

| Status | Meaning |
|--------|---------|
| `active` | Device is in the cloud account and being polled |
| `removed` | Device disappeared from the cloud account; historical data preserved |
| `merged` | Device's readings were re-attributed to another device; record retained for audit |

### New Table: `pending_replacements`

```sql
CREATE TABLE IF NOT EXISTS pending_replacements (
    id SERIAL PRIMARY KEY,
    old_device_id TEXT NOT NULL,
    new_device_id TEXT NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (old_device_id, new_device_id)
);
```

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | SERIAL | PRIMARY KEY | Auto-increment |
| old_device_id | TEXT | NOT NULL | The cloud device ID (NOT the `epcube{id}_battery` form) |
| new_device_id | TEXT | NOT NULL | The cloud device ID of the replacement |
| detected_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | When the exporter detected the simultaneous removal+addition |

**Lifecycle**: Created by the exporter's `_detect_replacements` step at the end of each discovery cycle. Two paths produce a row:

1. **Same-cycle**: a device disappeared from the cloud account and another appeared in the same discovery cycle with the same alias.
2. **Cross-cycle**: a previously-added device (still `status='active'`) finds an alias match against a device that was marked `removed` in an earlier cycle (`find_removed_predecessor`).

Rows are deleted when the user confirms the merge (executed via the API) or dismisses the prompt. The Settings page also exposes a manual merge UI for ad-hoc cases where the alias-based heuristic doesn't trigger.

### New Settings Key: `discovery_interval_seconds`

Stored in the existing `settings` table (key-value, JSONB value).

| Key | Default | Valid Range | Description |
|-----|---------|-------------|-------------|
| `discovery_interval_seconds` | `3600` | 60–86400 | How often the exporter re-queries the cloud API device list (seconds) |

## Entity Relationships

```
devices (status: active/removed/merged)
  │
  ├─── readings (device_id TEXT, no FK constraint)
  │      └── Merge: UPDATE device_id from old → new
  │
  └─── pending_replacements (old_device_id, new_device_id)
         └── Links two raw cloud API device IDs
         └── Deleted after user confirms or dismisses

settings (key: vue_device_mapping)
  └── JSON keys are raw cloud API device IDs
  └── Merge: rename old key → new key in JSON
```

## Merge Operation Data Flow

**Input**: `old_cloud_id` (cloud device ID, e.g., `12345`), `new_cloud_id` (cloud device ID, e.g., `67890`)

**Derived IDs**:
- `epcube{old_cloud_id}_battery` → `epcube{new_cloud_id}_battery`
- `epcube{old_cloud_id}_solar` → `epcube{new_cloud_id}_solar`

**Steps (single transaction)**:

1. Validate: old device status = `removed`, new device status = `active`
2. Count conflicts: readings where both old and new have same `(metric_name, timestamp)` for each sub-device
3. Delete conflicting old readings (new device values take precedence)
4. Update remaining old readings: `SET device_id = new_device_id`
5. Update `vue_device_mapping` setting: rename JSON key `old_cloud_id` → `new_cloud_id`
6. Update old device records: `SET status = 'merged'` (both `_battery` and `_solar`)
7. Delete `pending_replacements` row if it exists for this pair

**Output**: `{ readings_transferred: N, conflicts_skipped: M, old_device_id: ..., new_device_id: ... }`
