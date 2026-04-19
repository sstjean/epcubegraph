# Research: Simplify Vue Device Mapping

**Date**: 2026-04-17
**Feature**: 010-simplify-vue-mapping

## Research Questions

### RQ-1: What is the full blast radius of the format change?

**Decision**: 6 production files + 5 test files need format updates.

**Rationale**: Exhaustive codebase search found every occurrence of `vue_device_mapping`, `VueDeviceMapping`, and `VuePanelMapping`. The mapping is self-contained within the dashboard + API settings layer. The exporter does NOT read or write this setting.

**Production files**:
1. `dashboard/src/types.ts` — type definition: `VuePanelMapping[]` → `VuePanelMapping`
2. `dashboard/src/hooks/useVueData.ts` — parser + format validation
3. `dashboard/src/components/SettingsPage.tsx` — editor UI (multi-panel → single select)
4. `dashboard/src/components/CircuitsPage.tsx` — parser (array iteration → direct access)
5. `dashboard/src/components/EnergyFlowDiagram.tsx` — parser (array iteration → direct access)
6. `api/src/EpCubeGraph.Api/Endpoints/SettingsEndpoints.cs` — server-side validation

**Test files**:
1. `dashboard/tests/unit/useVueData.test.ts`
2. `dashboard/tests/component/SettingsPage.test.tsx`
3. `dashboard/tests/component/CircuitsPage.test.tsx`
4. `dashboard/tests/component/EnergyFlowDiagram.test.tsx`
5. `api/tests/EpCubeGraph.Api.Tests/Integration/SettingsEndpointTests.cs`

**Alternatives considered**: None — the format change is the scope of this feature.

---

### RQ-2: Should migration be automatic or manual?

**Decision**: Manual — user selects the correct parent device.

**Rationale**: Automatic migration would require choosing which panel in the array is the "parent." This is a semantic decision the system cannot make — a 3-panel array could have any of them as the parent. The spec explicitly states: "No automatic migration — the user selects the correct parent device."

**Implementation**: When the frontend parses `vue_device_mapping` and detects an array value (old format), it sets the mapping as invalid and shows a reconfiguration prompt on the Settings page. The backend rejects PUT requests with array-format values via a 400 response.

**Alternatives considered**:
- Auto-migrate by picking the first element: rejected — incorrect semantic assumption.
- Auto-migrate by checking hierarchy for parentage: rejected — over-engineering for a one-time migration on a single-user system.

---

### RQ-3: Should the SettingsPage editor switch from multi-add to dropdown?

**Decision**: Change from "add panels to list" to a single dropdown selection per EP Cube.

**Rationale**: The current UI has an "assign panel" button that appends to an array, with individual panel alias editing and removal. With single-device mapping, this becomes a simple `<select>` dropdown showing eligible (non-child) Vue devices. The alias comes from the selected device's `display_name` and is not user-editable in the mapping (the display name override system handles custom names).

**Alternatives considered**:
- Keep the add/remove UI but limit to 1 item: rejected — misleading UX, implies multi-select is possible.

---

### RQ-4: Does the API need a new endpoint or does the existing PUT /settings/{key} suffice?

**Decision**: Existing endpoint suffices. The `HandleUpdateVueDeviceMapping` handler already routes `vue_device_mapping` to custom validation. Only the validation logic inside that handler changes.

**Rationale**: The API already has a dedicated code path (`HandleUpdateVueDeviceMapping`) that validates the JSON structure. Changing from `EnumerateArray()` to checking for an object with `gid` + `alias` properties is a contained change within that handler.

**Alternatives considered**: None — a new endpoint is unnecessary per YAGNI.

---

### RQ-5: What format validation should the frontend add?

**Decision**: Add a type guard function `isValidVueDeviceMapping(parsed: unknown): parsed is VueDeviceMapping` in `useVueData.ts` that:
1. Checks each value is an object (not an array) with `gid` (number) and `alias` (string)
2. Returns false for old array format, triggering the reconfiguration prompt

**Rationale**: Currently the frontend does `JSON.parse(value) as VueDeviceMapping` with no structural validation. A type guard prevents silent acceptance of the old format and provides a single source of truth for format checks. Placing it in `useVueData.ts` co-locates it with the hook that parses the mapping — the primary consumer. The guard is exported so `CircuitsPage.tsx` and `SettingsPage.tsx` (which have their own independent parse paths) can import it rather than duplicating validation logic.

**Alternatives considered**:
- Inline checks at each parse site: rejected — duplicated logic across 3 files.
- Runtime schema library (zod, etc.): rejected — over-engineering for 2 fields.
