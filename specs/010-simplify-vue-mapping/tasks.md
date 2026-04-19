# Tasks: Simplify Vue Device Mapping

**Input**: Design documents from `/specs/010-simplify-vue-mapping/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/settings-mapping.md, quickstart.md

**Tests**: Required — TDD enforced per constitution. Tests MUST fail before implementation.

**Organization**: Two phases of new work (US1 = format change, migration guard). US2 and US3 are already implemented — listed as regression verification only.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1)
- Exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Type definition change that all other tasks depend on

- [x] T001 Update `VueDeviceMapping` type from `Record<string, VuePanelMapping[]>` to `Record<string, VuePanelMapping>` in `dashboard/src/types.ts`

---

## Phase 2: User Story 1 — Simplified Mapping Configuration (Priority: P1) 🎯 MVP

**Goal**: Change mapping format from array to single object across all consumers. Add migration guard for old format.

**Independent Test**: Save a single parent device per EP Cube via Settings. Verify stored format is `{"epcube3483": {"gid": 480380, "alias": "Main Panel"}}`. Verify old array format triggers reconfiguration prompt.

### Tests for User Story 1

> **Write these tests FIRST, ensure they FAIL before implementation**

- [x] T002 [P] [US1] Unit tests for `isValidVueDeviceMapping` type guard + update `useVueData` hook tests for new mapping format in `dashboard/tests/unit/useVueData.test.ts` — type guard: old array format returns false, new object format returns true, edge cases (null, empty, missing fields); hook: old format sets mapping undefined + tracks error
- [x] T003 [P] [US1] Update SettingsPage component tests for single-select editor in `dashboard/tests/component/SettingsPage.test.tsx` — single device dropdown, save produces object format, old format shows reconfigure prompt
- [x] T004 [P] [US1] Update CircuitsPage component tests for new mapping parser in `dashboard/tests/component/CircuitsPage.test.tsx` — mock data uses single-object format, old format shows reconfigure prompt (uses imported `isValidVueDeviceMapping`)
- [x] T005 [P] [US1] Update EnergyFlowDiagram component tests for new mapping parser in `dashboard/tests/component/EnergyFlowDiagram.test.tsx` — mock data uses single-object format
- [x] T006 [P] [US1] Update API integration tests for new validation logic in `api/tests/EpCubeGraph.Api.Tests/Integration/SettingsEndpointTests.cs` — valid single-object format returns 200, old array format returns 400 with migration message

### Implementation for User Story 1

- [x] T007 [US1] Implement and export `isValidVueDeviceMapping` type guard in `dashboard/src/hooks/useVueData.ts` and wire into the hook's parse path — validates object format, rejects array format, sets mapping to undefined + tracks error if old format detected. Exported so CircuitsPage and SettingsPage can import it (single source of truth per RQ-5).
- [x] T008 [P] [US1] Update `EnergyFlowDiagram` parser from array iteration to direct object access in `dashboard/src/components/EnergyFlowDiagram.tsx` — `panels.map(p => p.gid)` → single `panel.gid`
- [x] T009 [P] [US1] Update `CircuitsPage` parser from array iteration to direct object access in `dashboard/src/components/CircuitsPage.tsx` — `for (const panels of Object.values(mapping))` → direct panel extraction, import `isValidVueDeviceMapping` from `useVueData.ts` to detect old format and show reconfigure prompt
- [x] T010 [P] [US1] Update `SettingsPage` editor from multi-panel add/remove to single-select dropdown in `dashboard/src/components/SettingsPage.tsx` — one `<select>` per EP Cube, save produces single-object format, import `isValidVueDeviceMapping` from `useVueData.ts` to detect old format and show reconfigure banner. Note: SettingsPage has 4 hardcoded `VuePanelMapping[]` references (lines 30, 68, 73, 178) that must be changed to `VuePanelMapping` — these don't use the type alias so T001 won't catch them.
- [x] T011 [P] [US1] Update API `HandleUpdateVueDeviceMapping` validation from array to single-object format in `api/src/EpCubeGraph.Api/Endpoints/SettingsEndpoints.cs` — reject array values with 400 + migration message, validate object has `gid` (int64) + `alias` (string)

**Checkpoint**: US1 complete — mapping format changed end-to-end, old format rejected with clear messaging

---

## Phase 3: Regression Verification

**Purpose**: Confirm already-implemented behavior (US2 + US3) still works after the format change

> These are NOT new implementations — they verify existing behavior from Features 005/006/007 is not broken by the format change.

- [x] T012 Run full dashboard test suite: `cd dashboard && npm run typecheck && npm run test:coverage` — verify 100% all metrics
- [x] T013 Run full API test suite with coverage: 391 tests, 100% line + branch + method
- [ ] T014 Manual smoke test per quickstart.md: verify Flow diagram Balance dedup, panel-prefixed Unmonitored labels, Circuits page panel ordering

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Final verification and cleanup

- [ ] T015 Run quickstart.md manual testing workflow end-to-end with real data stack
- [ ] T016 Update spec.md status from Draft to Complete
- [ ] T017 Update project summary in `/memories/repo/PROJECT_SUMMARY.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — T001 starts immediately
- **User Story 1 (Phase 2)**: T001 MUST complete first (type change)
  - All tests (T002–T006) can run in parallel — they write to different files
  - Implementation (T007–T011) depends on tests being written and failing
  - T007 covers type guard + hook wiring (both in useVueData.ts), must complete before T008–T010 (they import the exported guard)
  - T008, T009, T010 can parallel after T007 (different files, all import shared guard)
  - T011 is independent (API, different language/framework)
- **Regression (Phase 3)**: After all Phase 2 implementation complete
- **Polish (Phase 4)**: After Phase 3 passes

### Parallel Opportunities

```
T001 ──→ T002 ──→ T007
    ├──→ T003 ──→ T010
    ├──→ T004 ──→ T009
    ├──→ T005 ──→ T008
    └──→ T006 ──→ T011 (fully independent — C# / API)
```

**Maximum parallelism**: T002–T006 can all run simultaneously (5 test files, no dependencies between them). T008–T011 can run simultaneously after T007 (they import its exported guard).

---

## Implementation Strategy

### MVP Scope

User Story 1 (Phase 2) is the entire feature. US2 and US3 are already implemented — regression verification only, no new code.

### Incremental Delivery

1. **Type change** (T001) — foundation for everything
2. **Tests** (T002–T006) — TDD: write failing tests first
3. **Type guard + hook** (T007) — core validation in useVueData.ts, exported for consumers
4. **Frontend parsers + API** (T008–T011) — all consumers updated, import shared guard
5. **Regression + Polish** (T012–T017) — verify and ship

### Task Summary

- **Total tasks**: 17
- **US1 tasks**: 11 (5 test + 5 impl + 1 setup)
- **Regression tasks**: 3
- **Polish tasks**: 3
- **Parallel opportunities**: 5 test tasks simultaneous, 4 impl tasks simultaneous
