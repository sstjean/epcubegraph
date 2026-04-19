# Contract Change: PUT /api/v1/settings/vue_device_mapping

**Date**: 2026-04-17
**Feature**: 010-simplify-vue-mapping

## Endpoint

`PUT /api/v1/settings/vue_device_mapping`
**Auth**: Required (Entra ID JWT, `user_impersonation` scope)

## Request Body Change

### Current Format (Feature 007)

```json
{
  "value": "{\"epcube3483\":[{\"gid\":480380,\"alias\":\"Main Panel\"},{\"gid\":480544,\"alias\":\"Subpanel 1\"}]}"
}
```

### New Format (Feature 010)

```json
{
  "value": "{\"epcube3483\":{\"gid\":480380,\"alias\":\"Main Panel\"}}"
}
```

## Response

**200 OK** — Setting updated:
```json
{
  "key": "vue_device_mapping",
  "value": "{\"epcube3483\":{\"gid\":480380,\"alias\":\"Main Panel\"}}"
}
```

**400 Bad Request** — Old array format detected:
```json
{
  "type": "error",
  "category": "validation",
  "message": "Vue device mapping uses legacy array format. Please reconfigure using the Settings page."
}
```

**400 Bad Request** — Other validation errors (unchanged):
```json
{
  "type": "error",
  "category": "validation",
  "message": "Invalid vue_device_mapping: each EP Cube must map to a single object with 'gid' (number) and 'alias' (string)"
}
```

## Validation Rules

| Rule | Behavior |
|------|----------|
| Root element must be JSON object | 400 if not |
| Each value must be object (not array) | 400 with legacy format message |
| Each value must have `gid` (int64) | 400 if missing or wrong type |
| Each value must have `alias` (string) | 400 if missing or wrong type |
| No duplicate GID across EP Cubes | 400 with duplicate message |

## Breaking Change

This is a **breaking change** to the mapping format. Existing stored values in the old array format will not be accepted by PUT. The frontend migration guard detects old format and prompts reconfiguration.

No GET endpoint changes — `GET /api/v1/settings` returns whatever is stored. Format detection happens client-side.
