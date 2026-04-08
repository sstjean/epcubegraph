# Research: Emporia Vue Energy Monitoring Integration

**Branch**: `005-emporia-vue` | **Date**: 2026-04-08

## R1: PyEmVue Library — API Patterns & Authentication

### Decision: Use PyEmVue 0.18.x for Emporia Vue cloud API access

### Rationale
PyEmVue is the only maintained Python library for the Emporia Vue API. It wraps the consumer-facing API that the Emporia mobile app uses (reverse-engineered, no official developer API). MIT licensed, actively maintained.

### Key Findings

**Authentication**:
- Uses AWS Cognito IDP (us-east-2) for username/password authentication
- Returns `id_token`, `access_token`, `refresh_token`
- Library handles token refresh automatically on every API request (checks JWT `exp` claim)
- On 401 response, library auto-refreshes and retries
- Supports `token_storage_file` for persisting tokens to disk (auto-updated on refresh)
- For the exporter: use `login(username, password)` — no token file needed (container is ephemeral)

**Device Discovery** (`get_devices()`):
- Returns `list[VueDevice]` with `device_gid`, `device_name`, `model`, `firmware`, `channels`, `connected`, `offline_since`
- Each `VueDevice` has a `channels` list of `VueDeviceChannel` objects
- Channel attributes: `device_gid`, `channel_num`, `name`, `channel_multiplier`, `channel_type_gid`
- Call once at startup and periodically to discover new devices/circuits

**Usage Retrieval** (`get_device_list_usage()`):
- Parameters: `deviceGids` (list of ints), `instant` (datetime, default=now), `scale` (string), `unit` (string)
- Returns `dict[int, VueUsageDevice]` keyed by device_gid
- Each `VueUsageDevice` has `channels` dict keyed by channel_num string
- Channel `"1,2,3"` = mains (three-phase total), `"1"` through `"16"` = individual circuits, `"Balance"` = calculated remainder
- Usage value is in requested unit (KilowattHours for `1S` scale → convert to watts: `kWh / (1/3600) * 1000`)
- **Offline devices**: `channel.usage = None` for all channels
- **Retry behavior**: Library retries up to `max_retry_attempts` (default 5) with exponential backoff when any channel returns None
- **For 1-second polling**: Set `max_retry_attempts=1` to avoid blocking the poll loop (spec FR-001)

**Scales**: `1S`, `1MIN`, `15MIN`, `1H`, `1D`, `1W`, `1MON`, `1Y`
**Units**: `KilowattHours`, `Dollars`, `AmpHours`, `Voltage`, etc.

**kWh to Watts conversion** (spec FR-003):
```python
# Scale 1S means the kWh value represents 1 second of energy
# watts = kWh / scale_hours * 1000
# For 1S: scale_hours = 1/3600
watts = usage_kwh * 3600 * 1000  # = usage_kwh * 3_600_000
```

**Rate Limiting**: No documented hard rate limits, but the spec requires automatic fallback from `1S` to `1MIN` scale if rate-limited (FR-001). Rate limiting manifests as HTTP 429 or empty/None responses.

### Alternatives Considered
- **Direct HTTP to Emporia API**: More control but requires maintaining auth, API surface, and error handling manually. PyEmVue already handles all of this.
- **Emporia local API**: Doesn't exist — Vue devices communicate only via Emporia's cloud.

---

## R2: Exporter Architecture — Same Process vs. Separate Container

### Decision: Add Vue polling as a second daemon thread in the existing epcube-exporter process

### Rationale
The existing exporter already uses Python threading successfully:
- Main thread: HTTP server (`serve_forever()`)
- Background thread: EP Cube poll loop (`poll_loop()` → `collector.poll()`)
- Thread safety: Uses `threading.Lock()` to protect shared state

Adding a second daemon thread for Vue polling follows the same proven pattern. The Vue thread runs independently at its own interval (1 second) without affecting the EP Cube loop (60 seconds).

**Benefits of same process**:
- Single Dockerfile, single container — simpler deployment
- Shared PostgreSQL connection pattern (each collector gets its own `PostgresWriter`)
- Shared HTTP server for debug page (add Vue status alongside EP Cube status)
- Single set of environment variables
- No Docker Compose changes needed (just add Vue env vars)

**Risks and mitigations**:
- **GIL contention**: PyEmVue makes HTTP calls (I/O-bound), which release the GIL. No CPU-bound contention expected.
- **Thread crash isolation**: If the Vue thread crashes, EP Cube continues (daemon threads are independent). The poll loop has a `try/except` that logs and continues.
- **Startup order**: Vue login can fail independently of EP Cube login. Vue thread should start even if EP Cube is not configured (and vice versa for future flexibility).

### Alternatives Considered
- **Separate container**: More isolation but doubles the deployment surface (two Dockerfiles, two Container App revisions, two sets of env vars). Overkill for a threaded Python process that handles I/O-bound work.
- **asyncio**: Would require rewriting the existing exporter. Too much churn for this feature.

---

## R3: Data Storage — Separate Tables for Vue Data

### Decision: New `vue_devices` and `vue_readings` tables (not reusing EP Cube's `devices`/`readings`)

### Rationale
Vue data has fundamentally different characteristics from EP Cube data:
- **Identity model**: Vue uses `device_gid` (integer) + `channel_num` (string like `"1,2,3"`); EP Cube uses `device_id` (string like `"epcube3483_battery"`) + `metric_name` (string)
- **Resolution**: Vue is 1-second vs. EP Cube 60-second
- **Retention**: Vue needs 7-day raw + downsampling; EP Cube is indefinite
- **Volume**: ~60 circuits × 1 reading/second = ~5.2M rows/day vs. EP Cube ~6 metrics × 1 reading/minute = ~8.6K rows/day (600x difference)

Separate tables allow:
- Vue-specific indexes optimized for high-write, time-range queries
- Independent retention policies (7-day cleanup without touching EP Cube data)
- Cleaner data model (no overloaded columns)
- Future: TimescaleDB hypertable candidates if needed

### Alternatives Considered
- **Reuse `readings` table**: Would work structurally but conflates two very different data sources, makes retention policies complex, and writes 600x more into a table not designed for it.

---

## R4: Downsampling — Application-Level Periodic Job

### Decision: Application-level downsampling in the exporter, running on a periodic schedule

### Rationale

The spec requires 1-second data retained for 7 days, then downsampled to 1-minute averages (FR-016). Three options were evaluated:

**Option 1: pg_cron (PostgreSQL extension)** ❌
- Azure Flexible Server supports pg_cron, but it's not currently enabled in Terraform
- Adds infrastructure complexity (extension configuration, Terraform changes)
- Harder to test locally (need extension installed in Docker postgres:17-alpine)
- Good for mature systems but overkill for this use case

**Option 2: Application-level periodic job (exporter)** ✅
- The exporter already runs 24/7 in the container
- Add a third daemon thread that runs once per hour:
  1. INSERT INTO `vue_readings_1min` SELECT avg(value) FROM `vue_readings` GROUP BY device_gid, channel_num, minute
  2. DELETE FROM `vue_readings` WHERE timestamp < NOW() - INTERVAL '7 days'
- Easy to test: mock the PostgresWriter, verify SQL
- Works identically in local Docker and Azure
- No Terraform changes

**Option 3: Query-time aggregation only** ❌
- No actual downsampling — compute 1-minute averages on the fly
- Won't reduce storage (7+ days of 1-second data = ~36M+ rows)
- Query performance degrades as data accumulates
- Doesn't satisfy FR-016 ("data retained for 7 days, then downsampled")

### Downsampling Schema
```sql
CREATE TABLE IF NOT EXISTS vue_readings_1min (
    device_gid BIGINT NOT NULL,
    channel_num TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    sample_count INTEGER NOT NULL,
    UNIQUE (device_gid, channel_num, timestamp)
);
```

The `sample_count` field enables weighted re-aggregation for longer time ranges.

### Alternatives Considered
- **TimescaleDB continuous aggregates**: Most elegant but requires TimescaleDB extension. Adding a third-party extension to Azure Flexible Server and local Docker adds significant complexity. YAGNI until volume demands it.

---

## R5: Query-Time Deduplication — SQL Pattern

### Decision: Subtract child panel totals from parent panel totals using the existing `panel_hierarchy` table at query time

### Rationale
The `panel_hierarchy` table (Feature 006) already stores parent-child relationships:
```sql
-- panel_hierarchy schema (already exists)
parent_device_gid BIGINT NOT NULL,
child_device_gid BIGINT NOT NULL,
UNIQUE (parent_device_gid, child_device_gid)
```

Deduplication formula: `parent_unique = parent_raw - SUM(child_raw)`
Where:
- `parent_raw` = sum of parent's mains channel (`1,2,3`)
- `child_raw` = sum of each child's mains channel (`1,2,3`)

**SQL pattern** (computed in the API, not stored):
```sql
-- Get parent's raw total
SELECT value FROM vue_readings
WHERE device_gid = @parent AND channel_num = '1,2,3' AND timestamp = @ts

-- Get sum of children's raw totals
SELECT SUM(value) FROM vue_readings r
JOIN panel_hierarchy h ON h.child_device_gid = r.device_gid
WHERE h.parent_device_gid = @parent AND r.channel_num = '1,2,3' AND r.timestamp = @ts
```

This is computed at query time per spec FR-008 — hierarchy changes immediately apply to all queries (including historical).

### Alternatives Considered
- **Write-time deduplication**: Would lock in the hierarchy at write time, making hierarchy changes not retroactive. Rejected by spec (FR-004: "write only raw data").
- **Materialized views**: Adds PostgreSQL complexity and doesn't handle hierarchy changes retroactively.

---

## R6: Vue Debug Page Extension

### Decision: Extend existing debug page with a second status section for Vue

### Rationale
The exporter's debug page (`:9250/` HTML page) already shows EP Cube status (last poll, errors, countdown). Adding a Vue section follows the same pattern:
- Vue last poll time
- Device count (online/offline breakdown)
- Circuit count
- Per-device status (online/error)
- Vue poll interval
- Vue countdown to next poll

The `MetricsHandler` HTTP handler already renders HTML with collector state. Add a `VueCollector` state section alongside.

### Alternatives Considered
- **Separate debug endpoint** (e.g., `/vue`): Fragments the debug experience. One page showing all exporter status is simpler.

---

## R7: Rate Limit Fallback — Scale Degradation

### Decision: Track consecutive rate-limit events and degrade from `1S` to `1MIN` scale with automatic recovery

### Rationale
Per FR-001: "If the Emporia API rate-limits requests, the exporter MUST automatically back off to the next coarser scale (`1MIN`) and log the rate-limit event."

**Implementation**:
- Detect rate limiting: HTTP 429 from the API, or all channels returning None after max_retry_attempts
- On rate limit: switch scale from `1S` to `1MIN`, log the event
- After N successful polls at `1MIN`, attempt to return to `1S`
- The scale change only affects the `get_device_list_usage` call parameter; the kWh→watts conversion adjusts for the new scale automatically (`1MIN` scale_hours = 1/60)

### Alternatives Considered
- **Fixed `1MIN` scale always**: Loses 1-second granularity unnecessarily
- **Exponential backoff on poll interval**: Doesn't address the API's preferred granularity; just delays requests
