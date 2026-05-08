# Research: Automatic Device Discovery

**Feature**: 124-device-discovery
**Date**: 2026-05-08

## 1. Exporter Discovery Integration Point

**Decision**: Add discovery check inside the existing `poll_loop()` function, before `collector.poll()`.

**Rationale**: The poll loop already reads settings from the DB each cycle and runs on a background thread with full error handling. Adding a time-based discovery check here avoids a new thread and reuses the existing error-handling pattern.

**Current flow** (`poll_loop` at exporter.py:1998):
```
while True:
    read interval from DB
    update _poll_interval / _next_poll_at
    sleep(interval)
    collector.poll()
```

**New flow**:
```
while True:
    read intervals from DB (poll + discovery)
    if time_since_last_discovery >= discovery_interval:
        run_discovery_with_retry()
    update _poll_interval / _next_poll_at
    sleep(poll_interval)
    collector.poll()
```

**Alternatives considered**:
- Separate thread: Rejected — adds concurrency complexity for no benefit. Discovery is a lightweight API call.
- Timer-based (e.g., `threading.Timer`): Rejected — harder to test, drift-prone, no advantage over a simple elapsed-time check.

## 2. Discovery Comparison Logic

**Decision**: Extract a pure function `compare_device_lists(old_ids, new_devices)` that returns `(added, removed, unchanged)`.

**Rationale**: SRP — the comparison is pure logic with no side effects. Easy to test with synthetic data. The caller handles DB writes and pending replacement creation.

**Implementation pattern**:
```python
def compare_device_lists(known_ids: set[str], cloud_devices: list[dict]) -> tuple[list, list, list]:
    cloud_ids = {d["id"] for d in cloud_devices}
    added = [d for d in cloud_devices if d["id"] not in known_ids]
    removed_ids = known_ids - cloud_ids
    unchanged = [d for d in cloud_devices if d["id"] in known_ids]
    return added, list(removed_ids), unchanged
```

**Alternatives considered**:
- Inline comparison in `_discover_devices()`: Rejected — violates SRP and makes testing harder.

## 3. Settings Read Pattern for Discovery Interval

**Decision**: Follow the existing `_read_poll_interval_from_db()` pattern — a standalone function that reads `discovery_interval_seconds` from the settings table.

**Rationale**: Consistency with `_read_poll_interval_from_db()`, `_read_vue_poll_interval_from_db()`, etc. Each poll loop iteration reads the current value, so changes take effect within one poll cycle.

**Default**: 3600 seconds (1 hour). Valid range: 60–86400 (1 min to 24 hours).

**Alternatives considered**:
- Add to `PostgresWriter` class: Rejected — settings reads are stateless functions, not writer responsibilities.

## 4. Exponential Backoff for Discovery Retry

**Decision**: Implement as a pure function `retry_with_backoff(fn, max_retries=5, base_delay=30)`.

**Rationale**: Encapsulates the retry logic. Testable by injecting a mock function. The delays are: 30s, 60s, 120s, 240s, 480s (~15.5 min total worst case, well within the 1-hour window).

**Implementation pattern**:
```python
def retry_with_backoff(fn, max_retries=5, base_delay=30):
    for attempt in range(max_retries):
        try:
            return fn()
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            delay = base_delay * (2 ** attempt)
            log.warning("Discovery attempt %d failed: %s. Retrying in %ds", attempt + 1, e, delay)
            time.sleep(delay)
```

**Alternatives considered**:
- Fixed delay: Rejected — wastes time on transient failures, doesn't back off for sustained outages.
- External retry library (e.g., tenacity): Rejected — YAGNI, simple loop is sufficient for 5 retries.

## 5. Pending Replacements Table Design

**Decision**: New `pending_replacements` PostgreSQL table.

**Rationale**: Must survive exporter restarts. Must be readable by the API. The settings table stores key-value pairs, not relational records — a dedicated table is cleaner for multiple simultaneous pending prompts.

**Schema**:
```sql
CREATE TABLE IF NOT EXISTS pending_replacements (
    id SERIAL PRIMARY KEY,
    old_device_id TEXT NOT NULL,
    new_device_id TEXT NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (old_device_id, new_device_id)
);
```

**Alternatives considered**:
- Settings table (JSON array): Rejected — awkward for multiple concurrent prompts, no relational integrity.
- In-memory only: Rejected — lost on restart.

## 6. API Merge Transaction Design

**Decision**: Single API endpoint `POST /devices/merge` performs the entire operation in one PostgreSQL transaction.

**Rationale**: Merge is all-or-nothing. Rolling back partial merges would be complex and error-prone. The data volume is small (<100K readings per device per year at 60s intervals).

**Transaction steps** (all in one BEGIN/COMMIT):
1. Validate old device has status `removed`, new device has status `active`
2. Count conflicting readings (same device_id + metric_name + timestamp)
3. DELETE conflicting readings from old device (where new device already has that timestamp+metric)
4. UPDATE remaining old readings: SET device_id = new_device_id (for both `_battery` and `_solar`)
5. UPDATE `vue_device_mapping` setting: rename old EP Cube ID key → new EP Cube ID key
6. UPDATE old device status → `merged`
7. DELETE pending_replacement record (if one exists for this pair)

**Alternatives considered**:
- Batched with resume: Rejected — complexity for no benefit given the small data volume.
- Exporter performs merge: Rejected — exporter is ingestion-only, API owns data management.

## 7. Dashboard Banner Component

**Decision**: New `ReplacementBanner` component rendered between `</nav>` and `<Router>` in App.tsx.

**Rationale**: This position is visible on all pages, outside the router. The banner polls for pending replacements on the same 30s cycle as the existing data polling.

**No toast library needed**: The project uses inline `<p role="alert">` for messages. The banner is a persistent, dismissable element — not a timed toast. The success/error toasts after merge actions can use the same inline pattern.

**Alternatives considered**:
- Toast library (e.g., react-hot-toast): Rejected — YAGNI, adds a dependency for a feature that appears ~once per year.
- Settings page only: Rejected — user may not visit Settings page regularly.

## 8. Device Status Column Migration

**Decision**: Explicit migration in exporter's `_ensure_schema()` — `ALTER TABLE devices ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`.

**Rationale**: The exporter owns schema creation. `ADD COLUMN IF NOT EXISTS` is idempotent. Default `'active'` is safe for new rows. The migration script (run once on first deployment) will then compare the cloud API device list against DB devices and mark any that are not in the cloud as `removed`.

**Migration sequence**:
1. `ALTER TABLE` adds column (all existing devices get `active`)
2. Startup discovery compares cloud list vs DB (FR-024)
3. Devices not in the cloud list are marked `removed`
4. Devices in the cloud list but not in DB are registered as new
5. Same-cycle additions+removals create pending replacement prompts

This naturally handles the current production situation (old mainboard device in DB, new mainboard in cloud) without a separate migration script — the startup discovery does the work.

**Alternatives considered**:
- Separate one-time migration script: Rejected — startup discovery already does the comparison. Adding the column with default `'active'` and letting FR-024 fix the status is simpler and more testable.

## 9. Devices API Filtering

**Decision**: Modify existing `GetDevicesAsync()` to filter by `status = 'active'`. Add new `GetDevicesByStatusAsync(status)` for the Settings page.

**Rationale**: Existing consumers (dashboard charts, current readings) should only see active devices. The Settings page needs `removed` devices for merge selection.

**Alternatives considered**:
- Query parameter on existing endpoint (e.g., `?status=removed`): Viable but mixes concerns. The Settings page is the only consumer of non-active devices.
- Separate endpoint path: Cleaner separation. `GET /devices` = active only. `GET /devices?status=removed` for Settings.

**Decision revised**: Use a query parameter `?status=` on the existing endpoint. Defaults to `active` when omitted. Simplest change, no new endpoint path needed.

## 10. Dashboard Toggle for Removed Devices

**Decision**: localStorage key `showRemovedDevices`, default `true`. Toggle visible only when at least one removed device exists.

**Rationale**: Lightweight persistence, no server call. Only shows the toggle when relevant (avoids UI clutter when no devices have been removed).

**Implementation**: The dashboard's device-fetching logic checks for removed devices. If any exist and the toggle is on, it includes them in chart data with a grayed-out CSS class.
