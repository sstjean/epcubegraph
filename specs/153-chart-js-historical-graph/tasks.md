# Tasks: Chart.js Migration for Historical Graph

**Feature**: 153-chart-js-historical-graph
**Input**: Design documents from `/specs/153-chart-js-historical-graph/`
**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [quickstart.md](quickstart.md)
**Tests**: REQUIRED — constitution mandates TDD + 100% line coverage. Every implementation task is preceded by a failing test.
**Branch**: `153-chart-js-historical-graph` (already checked out — do **not** create a new branch).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Maps task to a spec user story (US1–US7), or `[Setup]` / `[Foundation]` / `[Cleanup]` / `[Verify]`
- All paths are repo-relative

## Scope Note

This migration is a **single-component rewrite** (`HistoricalGraph.tsx`) plus its test file. Most user stories share these two files. The "[P]" marker is therefore used for tasks in different files (e.g., `app.css` vs `package.json`); tasks editing `HistoricalGraph.tsx` or `HistoricalGraph.test.tsx` are sequential within a phase.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add Chart.js + adapter + date-fns dependencies and confirm baseline state.

- [ ] T001 [Setup] Add `chart.js@^4.5.1`, `chartjs-adapter-date-fns@^3.0.0`, and `date-fns@^4.3.0` to `dashboard/package.json` `dependencies` (do NOT remove `uplot` yet — keep both installed during migration so intermediate test runs stay green) and run `cd dashboard && npm install` to update `package-lock.json`.
- [ ] T002 [P] [Setup] Confirm `cd dashboard && npm run test:coverage` and `npm run typecheck` are green against the existing uPlot implementation BEFORE any code change (baseline gate; protects against pre-existing failures being misattributed to the migration).
- [ ] T003 [P] [Setup] Confirm the persistent local stack is up: `docker ps --filter name=local-postgres-1 --filter name=local-epcube-exporter-1` shows both Up, and `curl -fsS http://localhost:5173 >/dev/null` succeeds. Record the resulting container IDs in your scratch notes for the later visual-verification phase.

**Checkpoint**: Dependencies installed; baseline green; live stack reachable.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Rewrite the test-file mock layer and scaffold the new component skeleton so subsequent per-story tasks have a Chart.js-mocked harness to assert against. This phase is one cohesive Red→Green cycle establishing the new lifecycle; per-story phases then layer behavior on top.

**⚠️ CRITICAL**: All per-story phases below depend on T004–T010 being complete.

### Tests First (Red)

- [ ] T004 [Foundation] In `dashboard/tests/component/HistoricalGraph.test.tsx`: replace the existing `vi.mock('uplot', ...)` block with a `vi.hoisted` + `vi.mock('chart.js', ...)` block per [research.md §11](research.md) that captures every constructor invocation into `capturedConfigs: ChartConfiguration[]`, exposes a `destroySpy`, and stubs `Chart`, `LineController`, `BarController`, `LineElement`, `PointElement`, `BarElement`, `LinearScale`, `TimeScale`, `Tooltip`, `Legend`, `Filler`. Also add `vi.mock('chartjs-adapter-date-fns', () => ({}))`. Drop the `barsSpy` / `MockUPlot` / `over.offsetLeft` plumbing. Remove the `formatAxisDates`, `computeAxisSize`, `powerAxisSize` imports from the top of the file. Run the suite; it MUST fail at module-resolution / import time because `HistoricalGraph.tsx` still imports `uplot`. Record the failure mode.
- [ ] T005 [Foundation] In `dashboard/tests/component/HistoricalGraph.test.tsx`: rewrite the "renders one chart per device, stacked vertically", "labels each chart with device name via h3 heading", "each chart has aria-label with device name", "does not merge data from different devices into one chart", "renders accessible container with aria-label and aria-busy", "shows 'No data available'", "displays aggregation notice ... hourly/daily/monthly", "does not show aggregation notice when step=60s", "fetches devices, solar, home load, grid, and battery SoC metrics", "renders loading state while fetching", "re-fetches data when timeRange changes", "ignores stale fetch results when unmounted", "does not update retry count when unmounted", and "does not update error state when unmounted" tests so they no longer reference `capturedUPlotOpts` / `.uplot` selectors. Reference Chart.js artifacts: `capturedConfigs[i].data.datasets`, the canvas element (`document.querySelectorAll('canvas')`), and `destroySpy`. Tests must still fail (component not rewritten yet).

### Implementation (Green for foundation only — per-story behavior layered after)

- [ ] T006 [Foundation] In `dashboard/src/components/HistoricalGraph.tsx`: remove `import uPlot from 'uplot'` and `import 'uplot/dist/uPlot.min.css'`. Remove the `computeAxisSize`, `powerAxisSize`, `formatAxisDates`, and `BAR_STEP_THRESHOLD` exports. Add the new imports + `Chart.register(...)` block from [research.md §9](research.md) at the top of the file, and the `import 'chartjs-adapter-date-fns'` side-effect import.
- [ ] T007 [Foundation] In `dashboard/src/components/HistoricalGraph.tsx`: update `buildDeviceChartData` signature & return type so each series is `{ x: number, y: number | null }[]` in **milliseconds** (Chart.js `time` scale expects ms), keeping the existing 2× step gap-null insertion logic. Add a small TS interface `DeviceChartDatasets { solar: Point[]; homeLoad: Point[]; grid: Point[]; battery: Point[] }`. Update the per-device loop in the data-fetch `useEffect` to consume the new shape. Pure helpers (`shouldUseBars`, `getAggregationLabel`, `formatTooltipTimestamp`) remain exported, unchanged in signature.
- [ ] T008 [Foundation] In `dashboard/src/components/HistoricalGraph.tsx`: add a new exported pure helper `buildChartConfig(step: number, data: DeviceChartDatasets, deviceName: string): ChartConfiguration<'bar' | 'line'>` returning the Chart.js config shape (skeleton only — empty `datasets: []`, minimal `scales.x` time scale, no plugins yet). Per-story phases below populate `datasets`, `scales.y` / `y1`, and plugin options.
- [ ] T009 [Foundation] In `dashboard/src/components/HistoricalGraph.tsx`: replace the second `useEffect` (currently building uPlot instances) with the Chart.js lifecycle pattern from [research.md §10](research.md): `useRef<HTMLCanvasElement[]>`, a `useRef<Chart[]>` for instances, `getContext('2d')` check that calls `setError('Chart context unavailable')` on null (NFR-006), one `new Chart(ctx, buildChartConfig(...))` per device, cleanup destroys all. Replace the `<div data-chart />` per device with `<canvas ref={...} aria-label={...} />`. Keep `.device-chart` wrapper, `<h3>` heading, and `aria-label="... energy chart"` per US-6 / FR-008.
- [ ] T010 [Foundation] Run `cd dashboard && npm run test:coverage` and `npm run typecheck`. The Foundation-touched tests (T005 list) MUST now pass; per-story behavior tests added below will still be missing. Typecheck MUST be clean.

**Checkpoint**: Component compiles, mock harness captures `ChartConfiguration`s, multi-device + lifecycle + loading/empty/error/retry behavior is verified, no `uplot` imports remain in source. Per-story phases can now layer config behavior incrementally.

---

## Phase 3: User Story 1 — Correct axis labels across all zoom levels (Priority: P1) 🎯 MVP

**Goal**: Fix #149 — every range preset renders axis labels appropriate to its span (hours / day-of-week+day / day-with-month / month+year), with no bare day-of-month numbers on the 1y view.

**Independent Test**: After this phase, on the persistent local stack at <http://localhost:5173>, switching across 1d/7d/30d/1y/Custom preset must show the label formats listed in spec US-1 acceptance scenarios 1–5. Mock-level: `capturedConfigs[0].options.scales.x.time.displayFormats.month === 'MMM yyyy'`.

### Tests for User Story 1 (Red)

- [ ] T011 [US1] In `dashboard/tests/component/HistoricalGraph.test.tsx`: add a test `'configures the x-axis as a time scale with chartjs-adapter-date-fns (US-1 / fixes #149)'` asserting `capturedConfigs[0].options.scales.x.type === 'time'`, that `time.unit` is `undefined` (auto-pick), and that `time.displayFormats` contains entries for `minute`, `hour`, `day`, `week`, `month`, `quarter`, and `year` matching the strings in [research.md §1](research.md). Crucially assert `displayFormats.month === 'MMM yyyy'` (closes #149 — SC-001).
- [ ] T012 [US1] In `dashboard/tests/component/HistoricalGraph.test.tsx`: add a test `'x-axis ticks autoSkip with maxRotation=0 (US-1)'` asserting `scales.x.ticks.autoSkip === true`, `scales.x.ticks.maxRotation === 0`, and `scales.x.ticks.source === 'auto'`.
- [ ] T013 [US1] In `dashboard/tests/component/HistoricalGraph.test.tsx`: add a test `'x-axis tooltipFormat is set for hovering (US-1)'` asserting `scales.x.time.tooltipFormat` is a non-empty string (the `'PPpp'` constant from research §5).

### Implementation for User Story 1 (Green)

- [ ] T014 [US1] In `buildChartConfig` (`dashboard/src/components/HistoricalGraph.tsx`): populate `options.scales.x` per [research.md §1](research.md) — `type: 'time'`, `adapters.date.locale: enUS` (`import { enUS } from 'date-fns/locale'`), the full `displayFormats` map, `tooltipFormat: 'PPpp'`, `ticks: { autoSkip: true, autoSkipPadding: 16, maxRotation: 0, source: 'auto' }`. Tests T011–T013 MUST go green.

**Checkpoint**: SC-001 covered by mock-level assertion. Live-stack visual verification deferred to Phase 9.

---

## Phase 4: User Story 2 — Grouped bar chart for daily and longer buckets (Priority: P1)

**Goal**: When `step >= 86400`, render Solar / Home Load / Grid as three side-by-side bars per bucket. When `step < 86400`, render them as continuous lines. Tooltip lists every visible series.

**Independent Test**: On the live stack, 30d preset shows three distinct non-overlapping bars per day; 1d preset shows lines. Hovering a bucket shows all three values + bucket timestamp. Mock-level: dataset `type` flips on the step threshold.

### Tests for User Story 2 (Red)

- [ ] T015 [US2] In `dashboard/tests/component/HistoricalGraph.test.tsx`: add a test `'renders Solar / Home Load / Grid as bar datasets when step >= 86400 (US-2, FR-001)'` — set up mocks with `step: 86400`, assert `capturedConfigs[0].data.datasets[0..2]` each have `type: 'bar'`, `yAxisID: 'y'`, `barPercentage: 0.9`, `categoryPercentage: 0.8`, and `label` in `['Solar', 'Home Load', 'Grid']` in that order.
- [ ] T016 [US2] In `dashboard/tests/component/HistoricalGraph.test.tsx`: add a test `'renders Solar / Home Load / Grid as line datasets when step < 86400 (US-2, FR-001)'` — set up mocks with `step: 60`, assert the same three datasets have `type: 'line'` and `spanGaps: false`.
- [ ] T017 [US2] In `dashboard/tests/component/HistoricalGraph.test.tsx`: add a test `'tooltip callback formats title and labels for every series (US-2, FR-004)'` — invoke `capturedConfigs[0].options.plugins.tooltip.callbacks.title([{ parsed: { x: <epoch_ms> } }])` and assert it returns the same string as `formatTooltipTimestamp(epochSec, step)`. Invoke `callbacks.label(context)` for each series with a fake `context.parsed.y` and assert returned strings use `formatWatts` for power series and `formatPercent` for Battery.

### Implementation for User Story 2 (Green)

- [ ] T018 [US2] In `buildChartConfig`: add the three power datasets (Solar / Home Load / Grid) with `type: shouldUseBars(step) ? 'bar' : 'line'`, the colors from the existing `SERIES_COLORS` constants, `yAxisID: 'y'`, `barPercentage: 0.9`, `categoryPercentage: 0.8`, `spanGaps: false`, and the gradient fill for Grid (matching today's look — declare a `backgroundColor` callback receiving the chart context per [research.md §7](research.md)'s `Filler` plugin pattern; for bars use solid `backgroundColor: SERIES_COLORS[i]`). T015 + T016 go green.
- [ ] T019 [US2] In `buildChartConfig`: add `options.plugins.tooltip.callbacks.title` returning `formatTooltipTimestamp(ms/1000, step)` and `callbacks.label` dispatching on `dataset.label` to `formatWatts` or `formatPercent`. T017 goes green.

**Checkpoint**: Bar/line switching and tooltip behavior verified at mock level.

---

## Phase 5: User Story 3 — Battery % overlay on a secondary axis (Priority: P1)

**Goal**: Battery state-of-charge renders as a line on a right-side y-axis fixed to 0–100 with `%` ticks, regardless of bar/line mode for power series.

**Independent Test**: On the live stack, any range with battery data shows the right axis labeled 0–100 with `%`. Toggling Battery off in the legend hides only the battery line. Mock-level: dataset shape + `scales.y1` config asserted.

### Tests for User Story 3 (Red)

- [ ] T020 [US3] In `dashboard/tests/component/HistoricalGraph.test.tsx`: add a test `'Battery is a line dataset on yAxisID y1 regardless of step (US-3, FR-002)'` — run with both `step: 60` and `step: 86400` (two render passes via `rerender`), assert the Battery dataset in both `capturedConfigs` entries has `type: 'line'`, `yAxisID: 'y1'`, `borderColor` matching the green battery color, `fill: true`, `pointRadius: 0`, `borderWidth: 2`, `tension: 0`, `spanGaps: false`.
- [ ] T021 [US3] In `dashboard/tests/component/HistoricalGraph.test.tsx`: add a test `'scales.y1 is a right-side linear axis fixed 0..100 with % tick callback (US-3, FR-002)'` — assert `scales.y1.type === 'linear'`, `position === 'right'`, `min === 0`, `max === 100`, `grid.drawOnChartArea === false`. Invoke `scales.y1.ticks.callback(75)` and assert it returns `'75%'`.
- [ ] T022 [US3] In `dashboard/tests/component/HistoricalGraph.test.tsx`: add a test `'scales.y is a left linear axis with formatWatts tick callback (US-3, FR-002)'` — assert `scales.y.type === 'linear'`, `position === 'left'`. Invoke `scales.y.ticks.callback(1500)` and assert it equals `formatWattsAxis(1500)`.

### Implementation for User Story 3 (Green)

- [ ] T023 [US3] In `buildChartConfig`: append the Battery dataset (line, `yAxisID: 'y1'`, gradient fill via `Filler` plugin, properties from [research.md §7](research.md)). T020 goes green.
- [ ] T024 [US3] In `buildChartConfig`: add `options.scales.y` (left, linear, `formatWattsAxis` tick callback, faint grid) and `options.scales.y1` (right, linear, 0..100, `%` tick callback, `grid.drawOnChartArea: false`, green title) per [research.md §6](research.md). T021 + T022 go green.

**Checkpoint**: Dual-axis battery overlay verified.

---

## Phase 6: User Story 4 — Gap insertion when data is missing (Priority: P2)

**Goal**: Series visibly break across gaps > 2× step rather than interpolating across the missing interval.

**Independent Test**: Live stack with a known-good gap window (or seeded fixture if needed) shows broken line / missing bars across the gap. Mock-level: `buildDeviceChartData` returns nulls at gap boundaries and `spanGaps: false` propagates.

### Tests for User Story 4 (Red)

- [ ] T025 [P] [US4] In `dashboard/tests/component/HistoricalGraph.test.tsx`: under the existing `buildDeviceChartData` describe block, add `'inserts null y at the boundary when consecutive timestamps exceed 2× step (US-4, FR-005)'` — feed a response with timestamps `[0, 60, 3000]` and `step: 60`, assert the returned datasets show `y === null` at the boundary index (index 1 in the new `{x,y}[]` shape).
- [ ] T026 [P] [US4] In `dashboard/tests/component/HistoricalGraph.test.tsx`: add `'all line datasets declare spanGaps: false (US-4, FR-005)'` — render with `step: 60`, assert every line dataset in `capturedConfigs[0].data.datasets` has `spanGaps: false`.

### Implementation for User Story 4 (Green)

- [ ] T027 [US4] In `dashboard/src/components/HistoricalGraph.tsx`: confirm/preserve the existing 2× step gap-null logic inside `buildDeviceChartData` (already refactored in T007 to emit `{x,y}` objects); ensure null y-values survive the object form. T025 goes green.
- [ ] T028 [US4] In `buildChartConfig`: confirm `spanGaps: false` is set on every line dataset (Solar/HomeLoad/Grid for `step < 86400`, plus Battery always). T026 goes green.

**Checkpoint**: Gap behavior preserved end-to-end.

---

## Phase 7: User Story 5 + User Story 6 + User Story 7 — Legend toggle, multi-device, edge padding (Priority: P2/P2/P3)

These three stories share `buildChartConfig` plus the multi-device render loop already wired in T009. Grouping them avoids three trivial single-task phases on the same file.

**Goal (US-5)**: Legend clicks toggle series visibility without altering the current preset.
**Goal (US-6)**: Multi-device datasets render as N independent chart blocks (already implemented by T009 — this phase only adds explicit assertions).
**Goal (US-7)**: Bars don't touch chart edges (`scales.x.offset: true` + `bounds: 'ticks'` on bar mode).

**Independent Test**: Live stack — click each legend entry, confirm toggle + preset stability; with 2 seeded devices confirm 2 stacked chart blocks; on 7d preset confirm visible padding between leftmost/rightmost bars and plot edges.

### Tests (Red)

- [ ] T029 [US5] In `dashboard/tests/component/HistoricalGraph.test.tsx`: add `'legend plugin is enabled and onClick uses Chart.js default toggle behavior (US-5, FR-007)'` — assert `capturedConfigs[0].options.plugins.legend.display === true` and that `plugins.legend.onClick` is either `undefined` (Chart.js default = toggle) or explicitly set to `Chart.defaults.plugins.legend.onClick`.
- [ ] T030 [US6] In `dashboard/tests/component/HistoricalGraph.test.tsx`: extend the existing two-device test (already updated in T005) with an explicit assertion `expect(capturedConfigs.length).toBe(2)` after the `waitFor`, and assert each config's first dataset references that device's data (use device-specific values from `makeRangeResponse` fixtures to discriminate). Covers FR-008.
- [ ] T031 [US7] In `dashboard/tests/component/HistoricalGraph.test.tsx`: add `'scales.x.offset is true and bounds is ticks when step >= 86400 (US-7, FR-006)'` — set `step: 86400`, assert `scales.x.offset === true` and `scales.x.bounds === 'ticks'`. Add a complementary `'scales.x.offset is false when step < 86400'` for the line case.

### Implementation (Green)

- [ ] T032 [US5] In `buildChartConfig`: set `options.plugins.legend.display = true` and leave `onClick` unset (Chart.js default toggles dataset visibility, which also affects tooltip per FR-007). T029 goes green.
- [ ] T033 [US7] In `buildChartConfig`: when `shouldUseBars(step)` is true, set `options.scales.x.offset = true` and `options.scales.x.bounds = 'ticks'`; otherwise both fall back to defaults (`offset: false`, `bounds: 'data'`). T031 goes green.
- [ ] T034 [US6] No code change required (multi-device loop already implemented in T009). T030 goes green as a verification-only assertion.

**Checkpoint**: All seven user stories verified at the mock-config level.

---

## Phase 8: Cleanup & Cross-Cutting

**Purpose**: Drop uPlot completely now that all behaviors live in Chart.js.

- [ ] T035 [Cleanup] In `dashboard/package.json`: remove `"uplot": "..."` from `dependencies`. Run `cd dashboard && npm install` to update `package-lock.json`. Verify with `grep -r uplot dashboard/src dashboard/tests dashboard/package.json` — output must be empty.
- [ ] T036 [P] [Cleanup] In `dashboard/src/app.css`: remove all `.uplot`, `.uplot *`, and `.uplot-*` rules. The `.chart-tooltip*` rules stay (classname preserved). Verify with `grep -n uplot dashboard/src/app.css` — output must be empty.
- [ ] T037 [Cleanup] In `dashboard/tests/component/HistoricalGraph.test.tsx`: remove now-dead imports (`formatAxisDates`, `computeAxisSize`, `powerAxisSize` no longer exist), and any residual `barsSpy` / `MockUPlot` references missed in T004–T005. Confirm the file has zero `uplot` string occurrences.
- [ ] T038 [Cleanup] In `dashboard/src/components/HistoricalGraph.tsx`: final pass — confirm no orphan helpers, no commented-out uPlot code, no unused imports. Run `cd dashboard && npm run typecheck`.

---

## Phase 9: Verification & PR Preparation

**Purpose**: Full coverage gate, typecheck, live visual verification across all 5 presets, bundle measurement, PR description.

- [ ] T039 [Verify] Run `cd dashboard && npm run test:coverage`. Both pass criteria MUST hold: (a) all tests green; (b) **100% line coverage** for `dashboard/src/components/HistoricalGraph.tsx` (NFR-001, constitution non-negotiable, SC-005). If any line is uncovered, add a targeted test that invokes that code path before proceeding.
- [ ] T040 [Verify] Run `cd dashboard && npm run typecheck`. MUST be clean — no `tsc` errors.
- [ ] T041 [Verify] Run `cd dashboard && npm run build`. Capture the printed asset table. Compute gzipped delta vs. the baseline in [plan.md § Bundle Audit](plan.md): `delta_gzipped = new_index_js_gz + new_index_css_gz − (121.45 + 4.63) KB`. Record raw + gzipped pre/post numbers and the delta in scratch notes (will go into the PR description per T045). NFR-002 / SC-006.
- [ ] T042 [Verify] At <http://localhost:5173> against the persistent local prod-like stack (verified up in T003), visually verify each range preset and capture a screenshot per device per preset (10 screenshots if 2 devices × 5 presets):
  - **1d**: axis shows hours (e.g., `09:00`, `12:00`), three series render as lines, battery on right axis 0–100.
  - **7d**: axis shows day-of-week + day-of-month, three series render as lines (step=3600 < 86400 → lines per FR-001).
  - **30d**: axis shows day-with-month at month boundaries, three series render as **grouped bars** with visible inter-bucket gaps and visible padding from plot edges (US-7).
  - **1y**: axis shows **month + year** (`Jun 2025`, `Sep 2025`, …) — **never** bare day-of-month numbers (US-1 / SC-001 / closes #149). Grouped bars.
  - **Custom (~6 weeks)**: axis auto-picks readable granularity; no label overlap.
  Verify tooltips show all visible series, legend clicks toggle series without changing the preset, and resizing the window re-flows the charts cleanly. Save screenshots to a local folder (e.g., `/tmp/153-screenshots/`) for upload to the PR.
- [ ] T043 [P] [Verify] Inspect the rendered DOM at <http://localhost:5173>: confirm `<canvas>` elements exist inside each `.device-chart`, no `.uplot` elements remain, and `Chart.getChart(document.querySelector('canvas'))` returns a real Chart instance in the devtools console (proves the Chart.js lifecycle is live, not just compiling).
- [ ] T044 [P] [Verify] Run `grep -rn uplot dashboard/src dashboard/tests dashboard/package.json dashboard/package-lock.json | grep -v node_modules` — must return **only** transitive lockfile references that have been removed (ideally zero hits). Confirms SC-004.
- [ ] T045 [Verify] Draft the PR description in a scratch file (NOT committed): include the 10 screenshots from T042, the bundle delta table from T041, the line-coverage % from T039, an explicit "Closes #149" and "Closes #153" footer (FR-013 / SC-008), and — IF the gzipped delta exceeds +120 KB — a user-impact summary covering initial-load delta on broadband, cache amortization, and mobile cellular cost (NFR-002).

**Checkpoint**: Ready for `/speckit.analyze`, then implementation kickoff, then PR.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)** → **Phase 2 (Foundational)** → all per-story phases (3–7) → **Phase 8 (Cleanup)** → **Phase 9 (Verify)**.
- Per-story phases (3, 4, 5, 6, 7) are sequential because they all edit `HistoricalGraph.tsx` and `HistoricalGraph.test.tsx`, but in priority order: US1 (P1) → US2 (P1) → US3 (P1) → US4 (P2) → US5+US6+US7 (P2/P2/P3).

### Within Each Phase

- Tests (T0XX with "Red" subheading) MUST be added and failing **before** the corresponding implementation task (Green).
- After each Green task, re-run `cd dashboard && npm run test:coverage` locally to confirm the targeted test passes AND no regression in prior phases.

### Parallel Opportunities

- **T002 / T003** (baseline + stack check) — parallel.
- **T025 / T026** (US4 — different test blocks in the same file, but logically independent assertions; can be staged in one editor session).
- **T036** (CSS cleanup) — parallel with T035 / T037 (different files).
- **T043 / T044** (DOM inspection + grep) — parallel with T042 (visual screenshots).
- All other tasks edit `HistoricalGraph.tsx` or `HistoricalGraph.test.tsx` and must be sequential within a phase.

---

## Implementation Strategy

### MVP scope

US1 (Phase 3) alone closes #149 and is shippable. Realistically though, Phases 2–5 (Foundation + US1 + US2 + US3) are the minimum coherent ship because tearing out uPlot mid-flight would leave the bar/line + battery overlay broken. **Treat Phases 1–9 as a single atomic PR.**

### Per-phase commits

- **Phase 1**: one commit — "deps(153): add chart.js + adapter + date-fns; keep uplot during migration".
- **Phase 2**: one commit — "refactor(153): swap test mock to chart.js, scaffold Chart lifecycle (Red→Green for foundation)".
- **Phase 3 / 4 / 5 / 6 / 7**: one commit each — "feat(153): US-N — <story title>".
- **Phase 8**: one commit — "chore(153): remove uplot dependency, CSS, and stale test plumbing".
- **Phase 9**: no code commit (verification + PR draft). The bundle delta + screenshots go into the PR description.

This file itself (`tasks.md`) is the `/speckit.tasks` phase artifact and is committed as part of the planning trail — no implementation commit covers it.

### TDD discipline reminder

Per the constitution: never modify a test to make it pass. If a Red test was wrongly authored, revert the production Green change, fix the test, re-verify Red, then re-apply Green. The 5-minute debug limit applies to any single failure.

---

## Notes

- The pre-migration bundle baseline (**442.81 KB raw / 126.08 KB gzipped**) is already captured in [plan.md § Bundle Audit](plan.md) — do not re-baseline.
- The estimated post-migration gzipped delta is **+69 KB** (research §12) — comfortably under the +120 KB user-impact-summary trigger. Real number captured in T041.
- Visual verification (T042) requires the persistent local stack at <http://localhost:5173>; verified up in T003 before any code change.
- No `data-model.md` or `contracts/` exist for this feature — intentional per plan.md § Project Structure.
- All seven user stories map to a single Chart.js `ChartConfiguration` shape produced by `buildChartConfig`; assertions on the captured config (no real `Chart` instance needed at test time) are the canonical coverage strategy per research §11.
