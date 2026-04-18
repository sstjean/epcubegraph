# Feature Specification: Simplify Vue Device Mapping

**Feature Branch**: `010-simplify-vue-mapping`
**Created**: 2026-04-15
**Updated**: 2026-04-17
**Status**: Draft
**Input**: Simplify Vue Device Mapping to one top-level parent Vue device per EP Cube, replacing the multi-panel array format.

## Scope Summary

Most of the behavior described in the original spec draft was already implemented across Features 005, 006, and 007. This feature's **actual new work** is:

1. **Change the mapping format** from `Record<string, VuePanelMapping[]>` (array of panels per EP Cube) to `Record<string, VuePanelMapping>` (single parent device per EP Cube)
2. **Add migration guard** that detects old array-format mappings and prompts the user to reconfigure

Everything else — hierarchy-driven child resolution, Balance dedup, panel-prefixed Unmonitored labels, dropdown filtering, circuit ordering — is already shipping in production.

## Assumptions

- The existing `vue_device_mapping` setting (Feature 007) currently maps each EP Cube to an array of Vue panel objects (`[{gid, alias}]`). This feature changes that shape to a single parent device per EP Cube.
- The existing `panel_hierarchy` table already stores parent-child device relationships. Children are already resolved automatically from it.
- "Balance" channel means the unmonitored portion of a panel — the difference between the mains total and the sum of individually monitored circuits.
- The Flow diagram already correctly subtracts child panel mains from the parent's Balance (implemented in Feature 007).
- When a Vue device appears as a child in `panel_hierarchy`, it is already excluded from the mapping dropdown (implemented in Feature 007).

## User Scenarios & Testing

### User Story 1 — Simplified Mapping Configuration (Priority: P1)

As a homeowner configuring my dashboard, I want to assign a single top-level Vue device (the parent panel) to each EP Cube, so the configuration is simpler and eliminates the possibility of manually listing child panels that cause double-counting.

**What's changing**: The mapping editor currently allows assigning multiple Vue panels per EP Cube. This changes to a single parent device selection. Child resolution, dropdown filtering, and dedup are already implemented.

**Independent Test**: Open the Settings page mapping editor. Select one parent device per EP Cube. Save. Verify the stored format is `{"epcube3483": {"gid": 480380, "alias": "Main Panel"}}` (object, not array).

**Acceptance Scenarios**:

1. **Given** the Settings page mapping editor is open, **When** the user views the Vue device dropdown for an EP Cube, **Then** only Vue devices that do not appear as `child_device_gid` in the panel hierarchy are listed. *(Already implemented — no change needed.)*
2. **Given** a parent Vue device is assigned to an EP Cube, **When** the mapping is saved, **Then** the stored mapping contains only the single parent device GID as an object (not an array of panels). *(New — format change.)*
3. **Given** a parent Vue device has children in the panel hierarchy, **When** the dashboard resolves which circuits belong to an EP Cube, **Then** it includes circuits from the parent and all its descendant devices. *(Already implemented — no change needed.)*
4. **Given** a stored mapping uses the old array format, **When** the user opens the Settings page, **Then** a warning is displayed and the user is prompted to reconfigure. *(New — migration guard.)*

---

### User Story 2 — Accurate Flow Diagram Unmonitored Calculation *(Already Implemented)*

> **No code changes required.** This user story documents existing behavior implemented in Feature 007. Retained for completeness and regression testing.

As a homeowner viewing the Flow diagram, I want the Unmonitored load for each panel to correctly subtract child panel totals from the parent's Balance, so the displayed Unmonitored value represents only the truly unmonitored circuits on that specific panel.

**Current implementation**: `EnergyFlowDiagram.tsx` already performs `Balance - SUM(child mains)` and skips display when result ≤ 0.

**Acceptance Scenarios** *(all passing today)*:

1. **Given** a parent panel has a Balance of 3000W and two child panels with mains of 800W and 500W, **When** the Flow diagram renders, **Then** the parent panel's Unmonitored shows 1700W (3000 - 800 - 500).
2. **Given** a parent panel has no children in the hierarchy, **When** the Flow diagram renders, **Then** the parent panel's Unmonitored equals the Balance channel value (no subtraction).
3. **Given** a child panel also has its own Balance channel, **When** the Flow diagram renders, **Then** the child panel's Unmonitored shows its own Balance value independently (no nesting of deductions).

---

### User Story 3 — Panel-Prefixed Unmonitored Labels *(Already Implemented)*

> **No code changes required.** This user story documents existing behavior implemented in Feature 007. Retained for completeness and regression testing.

As a homeowner viewing the Flow diagram with multiple panels, I want each panel's Unmonitored circuit to be prefixed with the panel name, so I can distinguish which panel has unmonitored load at a glance.

**Current implementation**: `derivePanelPrefix()` in `circuits.ts` extracts first letter + digits from the alias. `EnergyFlowDiagram.tsx` applies it as `"${prefix}: Unmonitored"` when multiple panels exist.

**Acceptance Scenarios** *(all passing today)*:

1. **Given** the parent panel has alias "M" and a Balance channel, **When** the Flow diagram renders, **Then** the Unmonitored entry for that panel displays "M: Unmonitored".
2. **Given** a child panel has alias "S1" and a Balance channel, **When** the Flow diagram renders, **Then** the Unmonitored entry for that panel displays "S1: Unmonitored".
3. **Given** a panel has no alias configured, **When** the Flow diagram renders, **Then** the Unmonitored entry uses the Vue device name from the Emporia app as the prefix (e.g., "Main Panel: Unmonitored").

---

### Edge Cases

- What happens when a child panel is removed from the hierarchy? The parent's Unmonitored value increases (no longer subtracting that child). The previously-child device reappears in the mapping dropdown. If the removed child was implicitly included under the parent's EP Cube, it stops showing on that EP Cube's Flow card until explicitly mapped.
- What happens when a mapped parent device is deleted from Vue? The mapping becomes stale. The Settings page shows a warning that the mapped device no longer exists. The Flow card shows no circuits for that EP Cube until remapped.
- What happens when the Unmonitored calculation goes negative? Display 0W — a negative Unmonitored means child panel mains exceed the parent's Balance, which indicates a measurement discrepancy. Log as a warning but do not show negative values to the user.
- What happens with deeply nested hierarchies (grandchildren)? The Unmonitored subtraction applies only to direct children's mains. Grandchildren are subtracted from their own parent (the child panel), not from the grandparent. Each level handles its own deduction independently.
- What happens during migration from the old mapping format? On first load, if the stored mapping uses the old array format, the system treats it as invalid and prompts the user to reconfigure. No automatic migration — the user selects the correct parent device.

## Requirements

### Functional Requirements

#### New — Requires Implementation

- **FR-001**: The `vue_device_mapping` setting MUST store a single parent Vue device GID per EP Cube device, replacing the current array-of-panels format. New format: `{"epcube3483": {"gid": 480380, "alias": "Main Panel"}}`. Changes required in: `types.ts` (type definition), `SettingsPage.tsx` (editor UI), `useVueData.ts` (parser + type guard), `CircuitsPage.tsx` (parser), `EnergyFlowDiagram.tsx` (parser), `SettingsEndpoints.cs` (server-side validation). Note: `api.ts` uses a generic `updateSetting(key, value)` string PUT — no change needed.
- **FR-008**: If a stored `vue_device_mapping` value uses the old array format, the system MUST treat it as invalid and display a prompt to reconfigure. No silent fallback to broken behavior. Validation needed in both frontend parse paths and backend validation.

#### Already Implemented — No Changes Required

> These requirements document existing behavior from Features 005/006/007. They are retained as regression contracts. The existing tests cover them.

- **FR-002** *(implemented)*: The system resolves all child Vue devices for a mapped parent from the `panel_hierarchy` table automatically. Implementation: `EnergyFlowDiagram.tsx` resolvedGids loop, `CircuitsPage.tsx` child map.
- **FR-003** *(implemented)*: The mapping editor dropdown excludes Vue devices that appear as `child_device_gid` in the `panel_hierarchy` table. Implementation: `SettingsPage.tsx` childGids filter.
- **FR-004** *(implemented)*: The Flow diagram's Unmonitored value for each panel is calculated as: `Balance channel watts - SUM(direct child panels' mains channel watts)`. If the result is ≤ 0, the entry is skipped. Implementation: `EnergyFlowDiagram.tsx` Balance dedup block + `CircuitsPage.tsx` dedupChannels.
- **FR-005** *(implemented)*: Each panel's Unmonitored entry in the Flow diagram is prefixed with the panel's alias via `derivePanelPrefix()`, followed by a colon and "Unmonitored". Implementation: `EnergyFlowDiagram.tsx` + `circuits.ts`.
- **FR-006** *(implemented)*: When the dashboard resolves circuits for an EP Cube's Flow card, it includes circuits from the mapped parent device AND all its descendants in the panel hierarchy. Implementation: `EnergyFlowDiagram.tsx` resolvedGids.
- **FR-007** *(implemented)*: The Circuits page panel ordering and deduplication logic works correctly using the hierarchy to determine parent-child relationships. Implementation: `orderPanels()` in `circuits.ts` + Balance dedup in `CircuitsPage.tsx`.
- **FR-009** *(implemented)*: No Vue device GID can be mapped to more than one EP Cube. Implementation: `SettingsEndpoints.cs` seenGids HashSet validation.

### Key Entities

- **Vue Device Mapping**: Links one EP Cube device to one top-level Vue parent device. Stored in the `settings` table as a JSON object. Children are resolved from the hierarchy, not stored in the mapping.
- **Panel Hierarchy**: Existing table storing parent-child relationships between Vue devices. Used to resolve descendants and filter the mapping dropdown.
- **Balance Channel**: A virtual channel on each Vue device representing the difference between the mains total and individually monitored circuits. This is the raw "unmonitored" value before child panel deduction.
- **Unmonitored Value (deduplicated)**: The Balance channel watts minus the sum of direct child panel mains watts. Represents the truly unmonitored consumption on a specific panel.

## Success Criteria

### Measurable Outcomes

- **SC-001** *(already passing)*: The mapping editor shows only eligible (non-child) Vue devices in the dropdown — verified by comparing dropdown options against the panel hierarchy.
- **SC-002** *(already passing)*: Flow diagram Unmonitored values match the formula `Balance - SUM(child mains)` for every panel with children — verified by comparing displayed values to direct database queries.
- **SC-003** *(already passing)*: No circuits appear in more than one EP Cube's Flow card — verified by cross-checking all displayed circuits against the hierarchy.
- **SC-004** *(already passing)*: Each Unmonitored entry on the Flow diagram is prefixed with the panel name — verified visually on dashboards with 2+ panels per EP Cube.
- **SC-005**: Users can complete the mapping configuration (select parent device, save) in under 30 seconds per EP Cube.
- **SC-006** *(already passing)*: Total home consumption displayed on the dashboard matches the sum of all top-level panel mains — no double-counting from overlapping child panels.
- **SC-007** *(new)*: Stored mapping uses single-object format — verified by reading `vue_device_mapping` setting from the database after save.
- **SC-008** *(new)*: Old array-format mapping is detected and user is prompted to reconfigure — verified by storing old format and loading the dashboard.
