# Feature Specification: Show grid-down state on the Current diagram per system

**Feature Branch**: `181-grid-down-state`  
**Created**: 2026-07-03  
**Status**: Draft  
**Parent Feature Issue**: [#181](https://github.com/sstjean/epcubegraph/issues/181)  
**User Story Issues**: [#186](https://github.com/sstjean/epcubegraph/issues/186) (US1), [#187](https://github.com/sstjean/epcubegraph/issues/187) (US2)  
**Input**: User description: "Show grid-down state on the Current diagram per system — add a clear per-system (per-device) grid-down indicator when a system's EP Cube systemStatus is Backup (2) or Off-Grid (3), as an end-to-end slice across exporter, API, and dashboard."

## Overview

When the electrical grid goes down (outage / islanding), the dashboard's **Current** diagram currently gives no indication. A user cannot tell at a glance that a system has lost the grid and is running on battery/solar backup — and with multiple EP Cube systems, cannot tell *which* system is affected. This feature adds a clear **per-system grid-down indicator** to the Current diagram, delivered as one end-to-end vertical slice: the exporter persists each system's grid status, the API exposes the current grid-down state per system, and the Current diagram renders the indicator.

**Grid-down** is defined as the EP Cube `systemStatus` being **Backup (2)** or **Off-Grid (3)**. All other known states — Standby (0), Self-Use (1), Normal (4), Fault (5), Upgrading (6) — are treated as *not grid-down* for this indicator.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See a per-system grid-down indicator on the Current diagram (Priority: P1)

As someone monitoring my EP Cube system on the **Current** diagram, when my system's grid connection is down (Backup or Off-Grid), I see a clear per-system grid-down indicator, so I immediately know that system has lost the grid and is running on battery/solar backup. When the grid is up (Standby / Self-Use / Normal), no grid-down indicator is shown.

**Why this priority**: This is the entire point of the feature and the minimum viable slice. On its own it delivers the core value — a user can tell at a glance whether a system is on grid backup — and it exercises the full data path (exporter → store → API → dashboard). Everything else builds on it.

**Independent Test**: Seed a current reading where a device's grid status is Backup (2) or Off-Grid (3); load the Current diagram and verify the grid-down indicator appears for that device. Change the status to Normal (4) and verify no indicator is shown.

**Acceptance Scenarios**:

1. **Given** a system's latest grid status is Backup (2), **When** the Current diagram loads, **Then** that system's Grid icon turns **red** with a **prohibition (⊘) overlay** and the text **"Grid Down"** is shown directly beneath it.
2. **Given** a system's latest grid status is Off-Grid (3), **When** the Current diagram loads, **Then** that system's Grid icon turns **red** with a **prohibition (⊘) overlay** and the text **"Grid Down"** is shown directly beneath it.
3. **Given** a system's latest grid status is Standby (0), Self-Use (1) or Normal (4), **When** the Current diagram loads, **Then** no grid-down indicator is shown for that system.
4. **Given** a system was grid-down and returns to Self-Use, **When** the diagram next refreshes, **Then** the grid-down indicator clears for that system.
5. **Given** any timestamp is displayed alongside the indicator, **Then** it renders in America/New_York (Eastern).

---

### User Story 2 - Correct per-system attribution with multiple systems (Priority: P2)

As someone with **multiple** EP Cube systems, when only one system is grid-down, the grid-down indicator appears **only on that system** and the other systems show no alarm, so I can tell exactly which system lost the grid.

**Why this priority**: The feature title requires per-system correctness, and the dashboard already disambiguates multiple systems. This story guarantees the indicator is attributed to the right system when more than one device is present. It builds directly on US1 and is independently testable, but US1 already delivers value for the common single-system case, so this is P2.

**Independent Test**: With two or more devices, set one device's grid status to Off-Grid (3) and another to Self-Use (1); load the Current diagram and verify the grid-down indicator appears on the off-grid device only, while the self-use device shows no indicator.

**Acceptance Scenarios**:

1. **Given** two systems where system A is Off-Grid (3) and system B is Self-Use (1), **When** the Current diagram loads, **Then** the grid-down indicator appears on system A only and not on system B.
2. **Given** two systems both grid-down (Backup and/or Off-Grid), **When** the diagram loads, **Then** each system shows its own grid-down indicator.
3. **Given** two systems both grid-up, **When** the diagram loads, **Then** neither system shows a grid-down indicator.

---

### Edge Cases

- **Other non-grid-down states (Fault 5, Upgrading 6)**: not grid-down; no grid-down indicator is shown (treated as normal for this feature — see Assumptions).
- **Stale or missing grid status**: the diagram MUST NOT assert grid-down when a system has no recent/available grid status; the default is to show no grid-down indicator, mirroring the Current diagram's existing freshness handling (see Assumptions / open question).
- **Recovery transition**: when a system returns from Backup/Off-Grid to a grid-up state, the indicator clears on the next diagram refresh.
- **Unknown / future status code**: a status value outside the known set (0–6) is treated as *not grid-down* (no indicator).
- **Multiple systems where all are grid-down**: every affected system shows its own indicator.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The exporter MUST persist each system's grid/system status once per polling cycle in a form queryable per device and timestamp, alongside that device's existing readings.
- **FR-002**: The persisted grid status MUST use the EP Cube `systemStatus` value as the source of truth, with the standard code meanings: 0 Standby, 1 Self-Use, 2 Backup, 3 Off-Grid, 4 Normal, 5 Fault, 6 Upgrading.
- **FR-003**: "Grid down" MUST be defined as `systemStatus` ∈ {2 (Backup), 3 (Off-Grid)}. All other known states MUST be treated as *not grid-down* for the indicator.
- **FR-004**: The API MUST expose, per device, the current grid **status** — the raw persisted `systemStatus` code from that device's latest grid-status reading — on the current-readings surface consumed by the Current diagram. The grid-down derivation (status ∈ {2, 3}) is performed by the dashboard, not the API.
- **FR-005**: On the Current diagram, when a system is grid-down, that system's **Grid icon MUST be rendered in a visually distinct grid-down state**: (a) the Grid icon turns **red**; (b) a **prohibition / "no" symbol — a circle bisected by a diagonal line (⊘) — MUST be overlaid on the Grid icon**, so grid-down is unmistakable and does not read as the normal red the Grid flow already uses when importing from the grid; and (c) the text **"Grid Down" MUST be displayed directly underneath that system's Grid icon**. When the system is grid-up, the Grid icon renders in its normal style with no prohibition overlay and no "Grid Down" label.
- **FR-006**: The grid-down indicator MUST be attributed to the correct system when multiple systems are present (no cross-system leakage).
- **FR-007**: Any timestamp displayed in association with a system's grid state MUST be rendered in America/New_York (Eastern). (No-op by design for this feature — the indicator renders no timestamp; this remains a guardrail should one ever be added.)
- **FR-008**: When a system has no recent or available grid status, the Current diagram MUST NOT assert grid-down for that system (default: show no grid-down indicator).
- **FR-009**: The feature MUST be implemented test-first (TDD) with 100% line coverage across the changed exporter, API, and dashboard code, per the project constitution.
- **FR-010**: The pull request that completes this feature MUST close issue #181.

### Key Entities *(include if feature involves data)*

- **Grid status reading**: a per-device, per-timestamp telemetry value representing the system's grid/operating mode, sourced from the EP Cube `systemStatus` code. Stored via the existing readings pipeline keyed by device and time.
- **Grid-down state (derived)**: a per-system boolean = "the system's most recent grid status is Backup (2) or Off-Grid (3)". Computed from the latest grid status reading and surfaced to the dashboard.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: When a system's grid status is Backup or Off-Grid, the Current diagram shows a grid-down indicator for that system within one refresh/polling cycle.
- **SC-002**: When a system's grid status is Standby, Self-Use, or Normal, no grid-down indicator is shown for that system — zero false alarms across those states.
- **SC-003**: With multiple systems where exactly one is grid-down, the indicator appears on exactly that one system and none of the others.
- **SC-004**: A user can determine grid-up vs grid-down for each system at a glance from the Current diagram alone, without opening any other view or reading raw numbers.
- **SC-005**: Any displayed timestamp associated with a system's grid state reads in Eastern (America/New_York).
- **SC-006**: Issue #181 is closed by the merging pull request.

## Assumptions

- **Representation**: the cleanest option is a new numeric reading metric (`grid_status_code`) stored in the existing `readings` table (device_id, metric_name, timestamp, value), with the value being the raw `systemStatus` integer. This reuses the existing exporter → `readings` → `/api/v1/readings/current` pipeline and the covering index `idx_readings_metric_time` added in #182; no schema change is required. (Final naming/representation is confirmable at `/speckit.plan`.)
- **Source signal already captured**: `systemStatus` is already read in `local/epcube-exporter/epcube_collector.py` (`parse_device_metrics()` → `system_status_raw`) but is currently used only to render the exporter debug page; it is not persisted, exposed, or displayed today.
- **Grid-down set**: only codes {2, 3} trigger the indicator. Fault (5) and Upgrading (6) are treated as *not grid-down* for this feature and receive no distinct visual (confirmed — Q2).
- **Stale/missing data**: absence of recent grid status yields *no* grid-down indicator (do not assert grid-down without data), consistent with the Current diagram's existing freshness behavior (confirmed — Q1).
- **Current diagram only**: historical/graph views are out of scope for this feature.

## Clarifications *(resolved by Steve 2026-07-03)*

- **Q1 — Stale/missing grid status**: RESOLVED → show **no** grid-down indicator when grid status is stale/absent (do not assert grid-down without fresh data). No explicit "unknown" state; no last-known retention. (FR-008)
- **Q2 — Fault (5) treatment**: RESOLVED → Fault receives **no** distinct visual; this feature is grid-down-only (codes {2, 3}).
- **Visual (Steve directive)**: the grid-down indicator IS the system's **Grid icon turned red AND overlaid with a prohibition / "no" symbol (a circle bisected by a diagonal line, ⊘)**, with the text **"Grid Down" directly beneath it** on the Current screen (FR-005). The prohibition overlay + label disambiguate grid-down from the normal red the Grid flow already shows when importing from the grid (analyze finding V1, confirmed by Steve 2026-07-03).

## Out of Scope

- Historical / graph views (Current diagram only).
- Any distinct visual treatment for Fault or Upgrading beyond "not grid-down".
- Alerting/notifications (email, push) for grid-down events.
- Any grid-down styling beyond the red Grid symbol + "Grid Down" label defined in FR-005 (e.g., extra banners, sounds, animations).
