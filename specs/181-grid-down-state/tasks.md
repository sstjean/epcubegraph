# Tasks: Show grid-down state on the Current diagram per system

**Input**: Design documents from `/specs/181-grid-down-state/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/grid-status-current.md ✅, quickstart.md ✅
**Parent Feature Issue**: [#181](https://github.com/sstjean/epcubegraph/issues/181) · **User Stories**: [#186](https://github.com/sstjean/epcubegraph/issues/186) (US1, P1), [#187](https://github.com/sstjean/epcubegraph/issues/187) (US2, P2)

**Tests**: REQUIRED (TDD — Red → Green per tier, 100% line coverage on changed code, FR-009).

**Organization**: Tasks are grouped by user story. **US1 is the full end-to-end vertical slice** (exporter persistence + dashboard render); **US2 adds multi-system attribution** on top of the same code paths.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 or US2 (Setup / Foundational / Polish have no story label)

## Accepted design decisions (resolve plan open items)

1. **Grid-down visual** = the Grid icon turns red (`#ef4444`) AND is overlaid with a **prohibition / "no" symbol (a circle bisected by a diagonal line, ⊘)** to distinguish it from the normal importing-red, AND **"Grid Down" text** renders on the Grid node's existing sublabel line (`y+44`), replacing the idle/importing/exporting label when grid-down — diagram height unchanged (analyze finding V1, confirmed by Steve).
2. **`deriveGridDown(code)`** lives in a NEW pure helper `dashboard/src/utils/grid.ts` (grid-down = `code ∈ {2,3}`), trivially unit-testable.
3. **No API code change** and **no new API contract test** — `/api/v1/readings/current?metric=grid_status_code` already serves any metric per device via the existing metric-agnostic LATERAL query. The `{2,3}` rule lives only in the dashboard helper.

## Path conventions (verified in code)

- Exporter: `local/epcube-exporter/epcube_collector.py` (`build_postgres_readings`), tests `local/epcube-exporter/test_exporter.py` (unittest).
- Dashboard: `dashboard/src/utils/grid.ts` (new), `dashboard/src/components/{DeviceCard,CurrentReadings,EnergyFlowDiagram}.tsx`, tests under `dashboard/tests/` (Vitest).
- API: **no change** (`api/src/EpCubeGraph.Api/`).

---

## Phase 1: Setup (Shared Baseline)

**Purpose**: Establish a clean, green baseline so Red is meaningful before TDD.

- [X] T001 Run baseline suites and record green before any change: `cd local/epcube-exporter && python -m unittest test_exporter -v`; `cd dashboard && npm run typecheck && npm run test:coverage`; `cd api && dotnet test EpCubeGraph.sln`.

**Checkpoint**: All existing suites green → safe to write failing tests.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared type shell that BOTH stories' dashboard render depends on. Keeps the tree type-checking while the derivation is added in US1.

**⚠️ CRITICAL**: US1/US2 dashboard tasks cannot compile until this is complete.

- [X] T002 Add the shared grid-down type plumbing (compiles green, no behavior yet): add `gridDown: boolean` to the `DeviceCardMetrics` interface in `dashboard/src/components/DeviceCard.tsx`; add `gridStatus: CurrentReadingsResponse` to the `MetricResponses` interface and set `gridDown: false` in BOTH the online and offline branches of `buildDeviceGroups` in `dashboard/src/components/CurrentReadings.tsx`. (depends on T001)

**Checkpoint**: `npm run typecheck` clean; `gridDown` field exists everywhere, always `false` → foundation ready.

---

## Phase 3: User Story 1 - See a per-system grid-down indicator on the Current diagram (Priority: P1) 🎯 MVP

**Goal**: End-to-end slice — the exporter persists `grid_status_code` per poll, the dashboard derives `gridDown` per system, and the Current diagram renders that system's Grid icon red with a prohibition (⊘) overlay and a "Grid Down" sublabel when `systemStatus ∈ {2,3}`; nothing shown otherwise.

**Independent Test**: Seed a current `grid_status_code` reading of 2 or 3 for a battery device → Current diagram shows the red Grid symbol + "Grid Down" for that system. Change to 4 → no indicator.

### Tests for User Story 1 (write FIRST, verify RED) ⚠️

- [X] T003 [P] [US1] Exporter Red — in `local/epcube-exporter/test_exporter.py` add AAA tests asserting `build_postgres_readings` yields `(f"{dev}_battery", "grid_status_code", ts, 2.0)` for `system_status_raw = 2` (and `3.0`, `4.0` for 3/4), and yields **no** `grid_status_code` tuple when `system_status_raw` is `"?"` / missing / non-integer. Run → FAIL. (depends on T001)
- [X] T004 [P] [US1] Dashboard unit Red — create `dashboard/tests/unit/grid.test.ts` asserting `deriveGridDown` returns `true` for 2 and 3, and `false` for 0, 1, 4, 5, 6, an unknown code, and `undefined`/`NaN`. Run → FAIL (helper not created). (depends on T001)
- [X] T005 [P] [US1] Dashboard unit Red — in `dashboard/tests/unit/buildDeviceGroups.test.ts` assert `buildDeviceGroups` sets `metrics.gridDown` from each device's latest `grid_status_code` (2/3 → true; 0/1/4/5/6 → false) and forces `gridDown === false` for offline groups. Run → FAIL. (depends on T002)
- [X] T006 [P] [US1] Component Red — in `dashboard/tests/component/` add an `EnergyFlowDiagram` test: when `gridDown` is true the Grid icon stroke is `#ef4444` AND a **prohibition overlay (a `<circle>` + diagonal `<line>`, ⊘) centered on the Grid node** is rendered AND the text **"Grid Down"** renders on the sublabel line (`y+44`, in place of importing/exporting/idle); when false the stroke uses the existing flow color, **no** prohibition overlay is present, and no "Grid Down" text appears. Run → FAIL. (depends on T002)

### Implementation for User Story 1 (make tests GREEN)

- [ ] T007 [US1] Exporter Green — in `build_postgres_readings` in `local/epcube-exporter/epcube_collector.py`, append `(bat, "grid_status_code", timestamp, int(metrics["system_status_raw"]))` guarded by an int-parse check that OMITS the tuple when `system_status_raw` is `"?"` / non-integer (extract a tiny pure int-parse guard to keep SRP). Run T003 → PASS.
- [ ] T008 [P] [US1] Create `dashboard/src/utils/grid.ts` exporting pure `deriveGridDown(code: number): boolean` = `Number.isInteger(code) && (code === 2 || code === 3)`. Run T004 → PASS.
- [ ] T009 [US1] Dashboard wire — in `dashboard/src/components/CurrentReadings.tsx` add `fetchCurrentReadings('grid_status_code')` to the `Promise.all` batch, thread its response into `MetricResponses.gridStatus` at BOTH `buildDeviceGroups` call sites (live + removed), and in the online branch set `gridDown: batteryDevice ? deriveGridDown(getMetricForDevice(metrics.gridStatus, batteryDevice.device)) : false` (import `deriveGridDown` from `../utils/grid`). Run T005 → PASS. (depends on T002, T008)
- [ ] T010 [US1] Diagram render — in `dashboard/src/components/EnergyFlowDiagram.tsx` at the Grid node (`GRID = {x:40,y:185}`), when `m.gridDown` is true: force the Grid icon stroke to `#ef4444` (regardless of flow direction), overlay a **prohibition / "no" symbol** centered on the Grid node (a red `<circle>` + a diagonal `<line>` across it, ⊘), and render the emphasized red text **"Grid Down"** on the sublabel line (`y+44`) in place of the importing/exporting/idle label; otherwise render exactly as today (no overlay). Run T006 → PASS.
- [ ] T011 [US1] US1 green gate — `cd local/epcube-exporter && python -m unittest test_exporter -v`; `cd dashboard && npm run typecheck && npm run test:coverage` (100% on changed lines); `cd api && dotnet test EpCubeGraph.sln` (no regression). Then curl the live surface locally to prove the vertical slice: `curl -s "$API/readings/current?metric=grid_status_code" | jq` returns one entry per battery device with `value ∈ 0..6`.

**Checkpoint**: US1 fully functional and independently testable — single-system grid-down indicator visible end-to-end. **This is the MVP.**

---

## Phase 4: User Story 2 - Correct per-system attribution with multiple systems (Priority: P2)

**Goal**: With multiple systems, the grid-down indicator appears ONLY on the affected system(s) — no cross-system leakage. Builds on US1's per-device derivation.

**Independent Test**: Two devices — set device A `grid_status_code = 3` and device B `= 1` → indicator on A only; B shows no indicator.

### Tests for User Story 2 (write FIRST, verify RED) ⚠️

- [ ] T012 [P] [US2] Attribution tests — in `dashboard/tests/` add: (a) a `buildDeviceGroups` multi-device test — device A code 3 → `gridDown true`, device B code 1 → `gridDown false`; both grid-down → both true; both grid-up → both false; and (b) an `EnergyFlowDiagram` multi-system render test proving the red Grid icon + prohibition (⊘) overlay + "Grid Down" appears only on the down system while the other renders normally (no overlay). Run → verify RED for any not-yet-covered attribution path (guards FR-006 / US2). (depends on T009, T010)

### Implementation for User Story 2 (make tests GREEN)

- [ ] T013 [US2] Confirm/secure per-device attribution — verify `gridDown` derives solely from each device's own `grid_status_code` via the existing per-device `getMetricForDevice(metrics.gridStatus, batteryDevice.device)` lookup in `buildDeviceGroups` (`dashboard/src/components/CurrentReadings.tsx`). If T012 exposes any cross-leakage, fix it at that single lookup (keep DRY — no duplicated rule). Run T012 → PASS.
- [ ] T014 [US2] US2 green gate — `cd dashboard && npm run typecheck && npm run test:coverage` (100% maintained across the added attribution paths).

**Checkpoint**: US1 AND US2 both pass independently — correct per-system attribution guaranteed.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Issue hygiene, manual end-to-end verification, and the final quality gate.

- [ ] T015 [P] Sync issue checklists per repo convention — copy this task list into the User Story issue bodies ([#186](https://github.com/sstjean/epcubegraph/issues/186) US1 tasks, [#187](https://github.com/sstjean/epcubegraph/issues/187) US2 tasks) as checklist items (do NOT create per-task issues); confirm the completing PR body includes "Closes #181" (FR-010).
- [ ] T016 Manual end-to-end verification per [quickstart.md](./quickstart.md): start `docker compose -f docker-compose.prod-local.yml up -d`; UPDATE (never DELETE) a fresh `grid_status_code = 3` reading; open the Current view in Chrome (Playwright), screenshot, and confirm as Steve would — affected system's Grid icon is red with the prohibition (⊘) overlay, "Grid Down" beneath it, other systems clean (US2), no console/network errors; then insert `grid_status_code = 1` and confirm the indicator clears on refresh. Timezone guardrail (FR-007): the indicator shows no timestamp; if one is ever added it MUST use `America/New_York`.
- [ ] T017 Final full-suite gate — exporter unittest green; `npm run typecheck` clean; `npm run test:coverage` at 100% on all changed dashboard code; `dotnet test EpCubeGraph.sln` green (proves the unchanged API path still round-trips `grid_status_code`).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)**: no dependencies — start immediately.
- **Foundational (T002)**: depends on T001 — BLOCKS all dashboard tasks (type shell).
- **US1 (T003–T011)**: exporter tests (T003) depend only on T001; dashboard tests/impl depend on T002. US1 is the MVP.
- **US2 (T012–T014)**: depends on US1 render being wired (T009, T010).
- **Polish (T015–T017)**: after US1 (and US2 if in scope) complete.

### Within Each User Story (TDD)

- Tests (T003–T006, T012) written and confirmed RED **before** implementation.
- Exporter persist (T007) and the pure helper (T008) before the wiring (T009) and render (T010).
- Story complete and green-gated before moving to the next priority.

### Parallel Opportunities

- **US1 tests**: T003, T004, T005, T006 are all `[P]` (distinct files) — write them together (T003/T004 need only T001; T005/T006 need T002).
- **US1 impl**: T008 (`grid.ts`) is `[P]` and can proceed while T007 (exporter) is in flight; T009 then depends on T008 + T002.
- **US2**: T012 is `[P]`.
- **Polish**: T015 is `[P]`.

## Parallel Example: User Story 1 tests

```bash
# After T002 (type shell) lands, author the four failing tests together:
#   T003 → local/epcube-exporter/test_exporter.py   (exporter tuple + omission)
#   T004 → dashboard/tests/unit/grid.test.ts        (deriveGridDown)
#   T005 → dashboard/tests/unit/buildDeviceGroups.test.ts (per-device gridDown)
#   T006 → dashboard/tests/component/EnergyFlowDiagram.test.tsx (red symbol + label)
# Verify RED:
cd local/epcube-exporter && python -m unittest test_exporter -v
cd dashboard && npm run test
```

## Implementation Strategy

- **MVP first**: complete Phase 1 → Phase 2 → **US1 (Phase 3)**. That single slice already delivers the feature's core value (a user can tell at a glance a system is on grid backup) across exporter → PostgreSQL → (unchanged) API → dashboard.
- **Incremental delivery**: layer **US2 (Phase 4)** to lock multi-system attribution, reusing US1's per-device path — no new production rule, only attribution tests plus a single-lookup safeguard.
- **No API tier work**: the metric-agnostic `/readings/current` endpoint serves `grid_status_code` unchanged; the `{2,3}` rule lives once in `deriveGridDown`.

---

## Summary

- **Total tasks**: 17 (T001–T017)
- **Setup**: 1 (T001) · **Foundational**: 1 (T002)
- **US1 (P1, MVP)**: 9 (T003–T011) — 4 tests + 5 impl/gate; exporter persist + `grid.ts` helper + dashboard fetch/derive/render
- **US2 (P2)**: 3 (T012–T014) — attribution tests + single-lookup safeguard + gate
- **Polish**: 3 (T015–T017) — issue-checklist sync, manual Chrome/Playwright E2E, final coverage gate
- **Parallelizable [P]**: T003, T004, T005, T006, T008, T012, T015
- **Independent test criteria**: US1 — seed `grid_status_code` 2/3 → red Grid + "Grid Down"; 4 → none. US2 — two devices, only the off-grid one shows the indicator.
- **Suggested MVP scope**: Phases 1–3 (through US1).
