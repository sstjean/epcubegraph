# Quickstart: Automatic Device Discovery

**Feature**: 124-device-discovery
**Date**: 2026-05-08

## Prerequisites

- Docker Compose local stack running (`docker-compose.prod-local.yml`)
- PostgreSQL accessible via `POSTGRES_DSN`
- EP Cube cloud account with at least one device

## Verify Discovery Works

### 1. Check exporter logs for discovery

After deploying the feature, the exporter logs discovery events on startup and hourly:

```
INFO  Startup discovery: comparing cloud devices against database...
INFO    Device: EP Cube (id=67890, sn=SG67890, online=1) — NEW
INFO    Device: id=12345 — REMOVED (no longer in cloud account)
INFO  Discovery complete: 1 added, 1 removed, 0 unchanged
INFO  Pending replacement created: old=12345, new=67890
```

### 2. Check the dashboard for a replacement prompt

Navigate to the dashboard. A banner should appear at the top:

> **Device replacement detected**: "EP Cube" (id=12345) was removed and "EP Cube" (id=67890) was added. Is this a replacement? (45,230 readings to transfer) [Yes] [No]

### 3. Confirm or dismiss

- **Yes**: Merges old readings into new device. Success toast shows transfer count.
- **No**: Dismisses the prompt. Message reminds you to use Settings page if needed later.

### 4. Manual merge from Settings

If the prompt was dismissed or not generated:

1. Navigate to Settings page
2. In the "Device Merge" section, select the removed device from the dropdown
3. Select the active target device
4. Review the reading count and confirmation dialog
5. Click "Merge" to execute

### 5. Verify merge results

After merge:
- Charts show continuous timeline (no gap between old and new device data)
- Old device no longer appears in device list
- `GET /api/v1/devices?status=merged` shows the old device with `"status": "merged"`

## Configuration

### Discovery interval

Default: 1 hour (3600 seconds). Change via Settings page or API:

```bash
curl -X PUT https://epcube-api.devsbx.xyz/api/v1/settings/discovery_interval_seconds \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": "1800"}'
```

### Removed device visibility toggle

In the dashboard, a toggle appears when removed devices exist. Defaults to visible (grayed out). State persists in localStorage.

## API Quick Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/devices` | GET | Active devices (add `?status=removed` or `?status=all`) |
| `/devices/pending-replacements` | GET | List pending replacement prompts |
| `/devices/merge-preview?old_device_id=X&new_device_id=Y` | GET | Preview merge reading counts |
| `/devices/merge` | POST | Execute device merge |
| `/devices/pending-replacements/{id}/dismiss` | POST | Dismiss a prompt |
| `/settings/discovery_interval_seconds` | PUT | Update discovery interval |

## Testing Locally

Run tests to validate:

```bash
cd local && python -m pytest epcube-exporter/test_exporter.py -v
cd api && dotnet test EpCubeGraph.sln
cd dashboard && npm run test:coverage
```
