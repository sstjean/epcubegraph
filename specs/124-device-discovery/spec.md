# Feature Specification: Automatic Device Discovery

**Feature Branch**: `124-device-discovery`  
**Created**: 2026-05-08  
**Status**: Draft  
**Input**: User description: "I just had EP Cube come out to change a mainboard in EP Cube v2. It is no longer pulling data. We need a feature that has the ingestion code check to see if new EP Cubes are found on the account and if old ones have been removed. This needs to check hourly."

## Clarifications

### Session 2026-05-08

- Q: Should the merge treat battery and solar sub-devices as a single atomic unit or individually? → A: Atomic pair — merge both sub-devices together in one confirmation.
- Q: Should hourly device discovery and replacement/merge apply to Vue devices too, or EP Cube only? → A: EP Cube devices only.
- Q: Where should the replacement prompt appear in the dashboard? → A: Banner/toast at the top of the dashboard, visible on any page.
- Q: What backoff delay strategy for discovery retries? → A: Exponential from 30s (30, 60, 120, 240, 480s — ~15.5min total).
- Q: When merging, should conflicting readings (same timestamp+metric) be silently discarded or logged? → A: Log count of skipped conflicts, then discard old values.
- Q: Should the merge be a single database transaction or batched? → A: Single transaction (all-or-nothing).
- Q: Should the 1-hour discovery interval be configurable or hardcoded? → A: Configurable via database setting (like existing poll interval).
- Q: Where should pending replacement records be stored? → A: PostgreSQL table (new table, survives restarts, API reads it).
- Q: Should device state (active/removed/merged) be tracked via a new column on the existing devices table or a separate table? → A: Add a status column to the existing devices table.
- Q: Should removed/merged devices appear in the /devices API endpoint? → A: Filter out — /devices returns only active devices. Settings page merge UI uses a separate query that includes non-active devices.
- Q: Should replacement detection match removals+additions across consecutive discovery cycles or same cycle only? → A: Same discovery cycle only. Settings page manual merge covers cross-cycle cases.
- Q: After a merge, should the old device record be kept or deleted? → A: Keep permanently (marked as merged, audit trail).
- Q: How should the dashboard learn about pending replacement prompts? → A: Check on page load + existing 30s auto-poll cycle.
- Q: What tables need updating during a merge? → A: All references to the old device ID must be updated to the new device ID. For EP Cube devices this means: `readings` table (re-attribute device_id for both _battery and _solar sub-devices), `devices` table (mark old as merged), and the `vue_device_mapping` setting (update the EP Cube device ID key in the JSON mapping so the Vue association transfers to the new device).
- Q: Should the debug page clear its in-memory history on device list change? → A: No — the 10-minute rolling history naturally transitions. Old snapshots age out and no diagnostic context is lost.
- Q: Should removed devices be visible in dashboard charts? → A: Toggle — when a removed device exists, the dashboard shows a toggle that controls visibility. Defaults to true (shown, grayed out). When toggled off, the device is hidden from charts but data always remains in the database.
- Q: Should the removed-device visibility toggle persist across page refreshes? → A: Yes, via localStorage (no server call needed).
- Q: How should existing devices be handled when the status column is added? → A: Explicit migration script. On initial deployment there will be an old (replaced) device and a new device already in production. Blindly defaulting all to active would incorrectly mark the old device as active.
- Q: Who performs the merge — the API or the exporter? → A: The API performs the merge, triggered by the dashboard. The exporter's job is ingestion only.
- Q: Should discovery run on a separate thread or within the existing poll loop? → A: Within the existing poll loop. If an hour has elapsed since last discovery, run it before the poll. Worst-case delay is ~60s past the hour mark.
- Q: How should replacement prompts handle multiple new devices for one removed device? → A: One prompt per removed device. User selects the replacement from a dropdown of remaining unpaired new devices. If only one unpaired new device remains, show it as a label instead of a dropdown.
- Q: What should the discovery interval setting key be named? → A: `discovery_interval_seconds` (follows existing naming pattern).
- Q: What feedback should the dashboard show after a merge completes? → A: Success toast with summary — device names, reading count transferred, conflict count skipped.
- Q: How should the system handle merge transaction failures? → A: Error toast + keep the pending replacement prompt so the user can retry. Prompt is only deleted on successful merge.
- Q: On the Settings page manual merge, which devices are selectable and in what order? → A: User picks the old (removed) device first, then selects the active device to merge into. Only `removed` devices appear as the source. Merged devices are effectively active (their readings have been absorbed into the target).
- Q: Should the banner prompt and Settings page use the same or separate merge endpoints? → A: Same endpoint. SRP. Simple.
- Q: When the user dismisses a replacement prompt, should the record be kept or deleted? → A: Delete the record. Show a message informing the user they can go to the Settings page to perform the merge later.
- Q: Should the exporter compare against the DB on startup to catch changes during downtime? → A: Yes — compare the cloud API device list against active devices in the database on startup.
- Q: Should the merge confirmation dialog include a reading count preview? → A: Yes — include the count of readings to be transferred. Helps the user make an informed decision, especially with multiple replacements.
- Q: Should the banner prompt also show the reading count before confirming? → A: Yes — consistent with Settings page. Same informed-decision reasoning.
- Q: Should the reading count preview be a separate API endpoint or part of the pending replacements response? → A: Separate preview endpoint — works for both banner and Settings page.

## Background

The EP Cube exporter currently discovers devices only at startup and after re-authentication. When a physical device is replaced (e.g., mainboard swap), the cloud account receives a new device identity. The exporter continues polling the old (now-removed) device and never discovers the replacement, resulting in silent data loss until the exporter is manually restarted.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Automatic New Device Detection (Priority: P1)

As the system owner, when a technician replaces an EP Cube mainboard (or I add a new EP Cube to my account), the exporter automatically discovers the new device and begins collecting its telemetry — without any manual restart or intervention.

**Why this priority**: This is the core problem. A replaced device means zero data collection until someone notices and restarts the exporter. This directly caused data loss in production.

**Independent Test**: Simulate the cloud API returning a device list with a new device ID not previously seen. Verify the exporter starts polling and writing data for the new device within the next hourly discovery cycle.

**Acceptance Scenarios**:

1. **Given** the exporter is running and polling one device, **When** a new device appears in the cloud API device list, **Then** the exporter discovers and begins polling the new device within 1 hour.
2. **Given** a new device is discovered, **Then** the exporter registers the new device in the database and logs the discovery event.
3. **Given** a new device is discovered, **Then** telemetry data for the new device appears in subsequent poll cycles without restart.

---

### User Story 2 — Removed Device Detection (Priority: P2)

As the system owner, when a device is removed from my cloud account (e.g., old mainboard returned/decommissioned), the exporter detects its absence, stops attempting to poll it, and logs the removal.

**Why this priority**: Polling a removed device wastes cycles and may cause errors. Detecting removal keeps the system clean and avoids confusing error logs.

**Independent Test**: Simulate the cloud API returning a device list that no longer contains a previously known device. Verify the exporter stops polling that device and logs the event.

**Acceptance Scenarios**:

1. **Given** the exporter is polling two devices, **When** one device disappears from the cloud API device list, **Then** the exporter stops polling the removed device within 1 hour.
2. **Given** a device is removed, **Then** the exporter logs a message identifying the removed device.
3. **Given** a device is removed, **Then** historical data for that device remains intact in the database (no deletion of past readings).

---

### User Story 3 — Device Replacement Prompt & Manual Merge (Priority: P2)

As the system owner, when the system detects that a device has been removed and a new device has appeared (simultaneously or within a short window), the dashboard prompts me to confirm whether the new device is a replacement for the missing one. Additionally, I can go to the Settings page at any time and manually designate that an active device is a replacement for a previously known device — to fix a mistake, handle a missed detection, or merge devices that changed at different times.

**Why this priority**: Without this, a mainboard swap creates two separate device histories — the old device's data is orphaned and the new device starts with an empty timeline. The automatic prompt handles the happy path, but the Settings page fallback is essential because detection can fail (e.g., exporter was restarted between removal and addition, user accidentally dismissed the prompt, or the removal and addition happened in different discovery cycles).

**Independent Test**: (a) Trigger a simultaneous device removal + addition. Verify the dashboard displays a replacement prompt. (b) Without any automatic detection, navigate to the Settings page, select an active device, designate it as a replacement for a historical device, and verify the merge completes.

**Acceptance Scenarios**:

1. **Given** the system detects a device was removed and a new device was added, **Then** the dashboard presents a notification asking the user whether the new device is a replacement for the old one.
2. **Given** the replacement prompt is displayed, **When** the user selects "Yes", **Then** the system merges the old device's historical data into the new device record.
3. **Given** the replacement prompt is displayed, **When** the user selects "No" (or dismisses), **Then** both devices remain as separate entries — the old device is marked as removed and the new device starts with a fresh history.
4. **Given** the user has not yet responded to the replacement prompt, **Then** the new device is polled normally and collects data independently — the prompt does not block data collection.
5. **Given** the user navigates to the Settings page, **Then** the user can select a removed device and designate an active device as the merge target.
6. **Given** the user initiates a manual merge from the Settings page, **Then** the system merges the old device's historical data into the selected device — identical to the automatic prompt flow.
7. **Given** the user previously dismissed a replacement prompt, **Then** the user can still perform the merge later via the Settings page.

---

### User Story 4 — Historical Data Merge (Priority: P3)

As the system owner, when I confirm that a new device is a replacement for an old one, the system merges all historical readings from the old device into the new device so that charts and data views show a continuous timeline.

**Why this priority**: The merge makes the replacement invisible in the user experience — charts show uninterrupted history. Without it, the user sees a gap and must mentally connect two separate device timelines.

**Independent Test**: Create two devices with separate reading histories. Trigger a merge. Verify that the new device's timeline includes all readings from the old device, and the old device no longer appears as an active device.

**Acceptance Scenarios**:

1. **Given** the user confirms a replacement, **When** the merge completes, **Then** all historical readings from the old device appear under the new device in charts and data queries.
2. **Given** a merge is performed, **Then** the old device is marked as merged/retired — it no longer appears in the active device list or dashboard views.
3. **Given** a merge is performed, **Then** any readings that existed for both the old and new devices at the same timestamp are handled without data loss (new device's readings take precedence for overlapping timestamps).
4. **Given** a merge is performed, **Then** the operation is logged with details of which devices were merged and how many readings were transferred.

---

### Edge Cases

- What happens when the hourly discovery check fails due to a network error or cloud API outage? The exporter retries with increasing delay between attempts, up to a maximum of 5 tries. If all 5 attempts fail, it continues operating with its current device list and waits for the next hourly interval.
- What happens when the cloud API returns an empty device list? The exporter treats this as an error condition (logs a warning) and retains its current device list — it does not remove all devices.
- What happens when a device's metadata changes (e.g., alias renamed) but the device ID remains the same? The exporter updates the device record with the new metadata.
- What happens when discovery runs during an active poll? Discovery runs before the poll in the same loop iteration. The updated device list takes effect on the current poll cycle.
- What happens when multiple devices are removed and multiple new devices are added simultaneously? The system presents individual replacement prompts for each removed/added pair, allowing the user to match them manually.
- What happens if the user never responds to the replacement prompt? The prompt persists in the dashboard until explicitly dismissed. Both devices continue to function independently in the meantime.
- What happens if the user triggers a merge and then a second replacement occurs for the same device? The system treats the current (previously merged) device as a normal device. A new replacement prompt is offered and the merge is handled the same way — all accumulated history (including data from prior merges) is re-attributed to the newest device.
- What happens if the user tries to merge from Settings but selects the wrong old device? The merge is irreversible, so the Settings page should show a confirmation dialog with the old and new device details before executing.
- What happens if the automatic detection missed the replacement (e.g., exporter restarted between removal and addition)? The user can always perform the merge manually from the Settings page — it does not depend on a pending replacement record existing.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The exporter MUST re-query the EP Cube cloud API device list on a periodic interval, independent of the normal telemetry poll cycle. The interval MUST default to 1 hour and be configurable via a database setting. This applies to EP Cube devices only — Vue devices are out of scope.
- **FR-002**: When a previously unseen device ID appears in the cloud API response, the exporter MUST register it in the database and include it in subsequent poll cycles.
- **FR-003**: When a previously known device ID no longer appears in the cloud API response, the exporter MUST stop polling that device.
- **FR-004**: The exporter MUST NOT delete historical data (readings or device records) when a device is removed from the cloud account.
- **FR-005**: The exporter MUST log each discovery event: new device found, device removed, and device metadata updated.
- **FR-006**: If the hourly discovery check fails (network error, API error, unexpected response), the exporter MUST retry with exponential backoff starting at 30 seconds (30s, 60s, 120s, 240s, 480s), up to a maximum of 5 attempts. If all attempts fail, it MUST log the failure and continue operating with its current device list until the next hourly interval.
- **FR-007**: If the cloud API returns an empty device list, the exporter MUST treat it as an error and retain the current device list.
- **FR-008**: The discovery interval MUST NOT drift — it runs on a fixed schedule regardless of poll timing, errors, or restarts. The interval value is read from the database setting and defaults to 1 hour. Discovery is checked within the existing poll loop; the worst-case delay past the interval is one poll cycle (~60s). Note: if discovery retries exhaust the backoff window (~15.5 min), the subsequent poll in that loop iteration is delayed by the same amount.
- **FR-009**: The discovery check runs within the poll loop and does not require concurrent execution with polling. The updated device list takes effect on the current poll cycle.
- **FR-010**: When a device removal and a device addition are detected in the **same** discovery cycle, the system MUST record a pending replacement prompt for the user. Cross-cycle matching is not performed — the Settings page manual merge covers that case.
- **FR-011**: The dashboard MUST display pending replacement prompts as a banner/toast notification at the top of the page, visible on any dashboard page. Each prompt is for one removed device. The user selects the replacement from a dropdown of remaining unpaired new devices, or if only one unpaired new device exists, it is shown as a label. The prompt MUST show the count of readings that will be transferred. The user can confirm (merge) or dismiss (no merge) each prompt.
- **FR-012**: When the user confirms a replacement, the system MUST merge all historical readings from the old device into the new device. The merge MUST treat the EP Cube's sub-devices (battery and solar) as an atomic pair — both are merged together in a single confirmation. The entire merge MUST execute as a single database transaction (all-or-nothing).
- **FR-013**: During a merge, readings from the old device MUST be re-attributed to the new device across all tables and settings that reference the old device ID. This includes: the `readings` table (both `_battery` and `_solar` sub-devices), and the `vue_device_mapping` setting (update the EP Cube device ID key in the JSON so the Vue device association transfers to the new device). For any timestamp where both devices have a reading for the same metric, the new device's value MUST take precedence and the old reading MUST be discarded. The total count of skipped conflicting readings MUST be logged.
- **FR-014**: After a merge, the old device MUST be marked as `merged` in the devices table and retained permanently for audit trail. It MUST be excluded from active device lists and dashboard views.
- **FR-015**: If the user dismisses a replacement prompt (selects "No"), the pending replacement record MUST be deleted, the old device MUST be marked as removed, and the new device MUST continue independently. The dashboard MUST display a message informing the user they can go to the Settings page to perform the merge later.
- **FR-016**: Pending replacement prompts MUST NOT block data collection — the new device MUST be polled normally while the prompt is awaiting user response.
- **FR-017**: The API MUST expose endpoints for retrieving pending replacement prompts and for submitting the user's response (confirm or dismiss).
- **FR-017a**: The API MUST expose a merge preview endpoint that returns the count of readings that would be transferred for a given old/new device pair. This endpoint is used by both the banner prompt and the Settings page.
- **FR-018**: The Settings page MUST allow the user to manually initiate a merge by first selecting a removed device, then selecting an active device as the merge target. Only `removed` devices appear as the source. This triggers the same merge logic as the automatic replacement confirmation.
- **FR-019**: Manual merges from the Settings page MUST follow the same merge logic as automatic replacement confirmations (same data re-attribution, conflict resolution, and logging).
- **FR-020**: The Settings page MUST show a confirmation dialog before executing a manual merge, displaying the old device name, new device name, the count of readings that will be transferred (queried from the database), and a warning that the operation is irreversible.
- **FR-021**: The existing `GET /devices` endpoint MUST return only active devices. A separate API query MUST be available for the Settings page to retrieve non-active (removed/merged) devices for merge selection.
- **FR-022**: When a removed device exists, the dashboard MUST display a toggle to control visibility of removed devices in charts. The toggle MUST default to visible (true). When visible, removed devices MUST be shown with a grayed-out visual treatment. When toggled off, removed devices MUST be hidden from all dashboard views. Data MUST always remain in the database regardless of toggle state.
- **FR-023**: When the `status` column is added to the `devices` table (via `ALTER TABLE ADD COLUMN ... DEFAULT 'active'`), the startup discovery (FR-024) MUST compare the cloud API device list against the database and correct the status for each existing device — marking devices not present in the cloud as `removed`. No separate migration script is required.
- **FR-024**: On startup, the exporter MUST compare the cloud API device list against active devices in the database to detect additions and removals that occurred while the exporter was offline. Any changes MUST be handled the same as hourly discovery (log events, update device status, create pending replacement prompts).

### Key Entities

- **Device**: An EP Cube unit identified by a unique device ID from the cloud API. Has metadata (name, serial number, online status). Devices can appear and disappear from the cloud account over time. A `status` column on the existing `devices` table tracks state: `active`, `removed`, or `merged`. Merged devices are effectively active — their readings have been absorbed into the merge target.
- **Discovery Event**: A detected change in the device list — a new device appearing or a known device disappearing. Logged for operational visibility.
- **Pending Replacement**: A record stored in a dedicated PostgreSQL table, linking a removed device to a newly discovered device, awaiting user confirmation. Contains the old device ID, new device ID, and timestamp of detection. Survives exporter restarts. Exists until the user confirms or dismisses it. Note: manual merges from Settings do not require a pending replacement record — the user selects both devices directly.
- **Device Merge**: The act of re-attributing all historical readings from an old device to a new (replacement) device. Performed once on user confirmation. Irreversible.

## Assumptions

- The cloud API's `/home/deviceList` endpoint returns the current, complete set of devices associated with the account. If a device is replaced, the old device ID disappears and the new one appears in this list.
- The hourly interval is sufficient for device changes — mainboard replacements are rare, manual events and do not require sub-minute detection.
- The exporter runs as a long-lived process. Hourly discovery is only relevant for processes that run for more than 1 hour.
- A device replacement is a one-to-one relationship: one old device is replaced by exactly one new device.
- The user is the only person who can confirm whether a new device is a replacement — the system cannot infer this automatically because the cloud API provides no linkage between old and new device IDs.
- Merges are rare operations (mainboard replacements happen perhaps once per year) and do not need to be optimized for high frequency.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a device replacement, the exporter begins collecting data for the new device within 1 hour — no manual restart required.
- **SC-002**: Zero data loss from device replacements that occur while the exporter is running (data collection begins within the next hourly discovery cycle).
- **SC-003**: Removed devices stop being polled within 1 hour, eliminating wasted poll attempts and associated error logs.
- **SC-004**: All device list changes (additions, removals) are logged with sufficient detail for the operator to understand what changed and when.
- **SC-005**: After confirming a device replacement and completing a merge, the user sees a continuous, uninterrupted timeline in the dashboard — no gap between old device data and new device data.
- **SC-006**: Pending replacement prompts are visible to the user within 30 seconds of the discovery event being recorded, via the dashboard's existing auto-poll cycle.
