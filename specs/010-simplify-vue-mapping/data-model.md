# Data Model: Simplify Vue Device Mapping

**Date**: 2026-04-17
**Feature**: 010-simplify-vue-mapping

## Entity Changes

### Vue Device Mapping (settings table)

**Key**: `vue_device_mapping`
**Storage**: `settings` table, `value` column (jsonb)

#### Current Format (Feature 007 — being replaced)

```typescript
// TypeScript
type VueDeviceMapping = Record<string, VuePanelMapping[]>;

// Example stored JSON
{
  "epcube3483": [
    {"gid": 480380, "alias": "Main Panel"},
    {"gid": 480544, "alias": "Subpanel 1"}
  ]
}
```

#### New Format (Feature 010)

```typescript
// TypeScript
type VueDeviceMapping = Record<string, VuePanelMapping>;

// Example stored JSON
{
  "epcube3483": {"gid": 480380, "alias": "Main Panel"}
}
```

**Change**: Value per EP Cube key changes from `VuePanelMapping[]` (array) to `VuePanelMapping` (single object).

#### VuePanelMapping (unchanged)

```typescript
interface VuePanelMapping {
  gid: number;    // Emporia Vue device GID
  alias: string;  // Display name from device discovery
}
```

### Entities NOT Changing

| Entity | Table | Reason |
|--------|-------|--------|
| Panel Hierarchy | `panel_hierarchy` | No schema change. Children still resolved from here. |
| Display Name Overrides | `display_name_overrides` | No schema change. |
| Settings (other keys) | `settings` | Only `vue_device_mapping` value format changes. |
| Vue Readings | `vue_readings`, `vue_readings_daily` | No schema change. Exporter writes, API reads. |

## Validation Rules

### Server-Side (SettingsEndpoints.cs)

| Rule | Current | New |
|------|---------|-----|
| Root element | Must be JSON object | Same |
| Each EP Cube key value | Must be JSON array of objects | Must be JSON object with `gid` + `alias` |
| `gid` field | int64, required | Same |
| `alias` field | string, required | Same |
| Duplicate GID check | No GID in multiple EP Cube arrays | No GID in multiple EP Cube objects |
| Old format detection | N/A | If value is array, return 400 with migration message |

### Client-Side (type guard)

```typescript
function isValidVueDeviceMapping(parsed: unknown): parsed is VueDeviceMapping {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
  for (const value of Object.values(parsed as Record<string, unknown>)) {
    if (Array.isArray(value)) return false;  // Old format detected
    if (typeof value !== 'object' || value === null) return false;
    const panel = value as Record<string, unknown>;
    if (typeof panel.gid !== 'number' || typeof panel.alias !== 'string') return false;
  }
  return true;
}
```

## State Transitions

```
Old array format stored in DB
  → User opens Settings page
  → Frontend detects old format (Array.isArray check)
  → Shows "Vue mapping needs reconfiguration" prompt
  → User selects single parent device per EP Cube
  → Frontend saves new single-object format
  → Backend validates new format, persists
  → All consumers (Flow diagram, Circuits page) parse new format correctly
```
