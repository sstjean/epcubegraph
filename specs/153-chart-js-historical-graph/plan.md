# Implementation Plan: Chart.js Migration for Historical Graph

**Branch**: `153-chart-js-historical-graph` | **Date**: 2026-05-23 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from [spec.md](spec.md)

## Summary

Replace the uPlot charting library in `dashboard/src/components/HistoricalGraph.tsx` with Chart.js 4.x (using `chartjs-adapter-date-fns` for time-axis formatting) to fix the long-range axis-label bug (#149), gain native grouped bars and x-axis padding, and shed the hand-rolled bar-offset / tick-density workarounds. The component continues to manage chart lifecycle manually via Preact `useRef` + `useEffect` (no `react-chartjs-2`), uses explicit `Chart.register(...)` to keep only the controllers/elements/scales/plugins it needs, and preserves every behavior covered today by `HistoricalGraph.test.tsx` (line vs grouped bar by step, battery overlay on secondary axis, 2× step gap insertion, legend toggling, multi-device stacking, full unmount cleanup, 100% line coverage).

The migration is presentation-only: no API, schema, or data-contract changes. The full design rationale, configuration patterns, and rejected alternatives live in [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript 5.8 (strict), Preact 10.x, Vite ~6.4, Vitest 4.x
**Primary Dependencies (added)**: `chart.js@^4.5.1`, `chartjs-adapter-date-fns@^3.0.0`, `date-fns@^4.3.0`
**Primary Dependencies (removed)**: `uplot@^1.6.31` + `uplot/dist/uPlot.min.css` import
**Storage**: N/A (frontend-only change; API contract `/api/historical` unchanged)
**Testing**: Vitest + `@testing-library/preact` + `happy-dom`. Replace the existing `vi.mock('uplot', …)` with a `vi.mock('chart.js', …)` that captures the constructor config and exposes a `destroy()` spy. The date adapter is mocked indirectly (Chart.js never actually constructs in tests).
**Target Platform**: Modern evergreen browsers per existing `browserslist` (last 2 Chrome/Firefox/Safari/Edge).
**Project Type**: Web — dashboard SPA (`dashboard/`).
**Performance Goals**: NFR-003 — initial render of one device chart with ~400 daily buckets < 200 ms on developer machine. Constitution graph standard (< 2 s for 30 days) is comfortably preserved.
**Constraints**: NFR-001 100% line coverage (constitution non-negotiable). NFR-002 bundle-size delta is **measured & reported, not gated** (see Bundle Audit below). NFR-006 no silent fallback on Chart.js init failure.
**Scale/Scope**: Single component rewrite (`HistoricalGraph.tsx` ~310 lines) + its test (`HistoricalGraph.test.tsx`). N device charts per page (today: 2 in seeded local stack).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Simplicity | PASS | Net simpler: Chart.js handles grouped bars, x-padding, tick density, and time labels natively — deletes hand-rolled bar-offset math and `formatAxisDates` dedupe helper. |
| II. YAGNI | PASS | No speculative features. Only register the Chart.js components actually used (`LineController`, `BarController`, `LineElement`, `PointElement`, `BarElement`, `LinearScale`, `TimeScale`, `Tooltip`, `Legend`, `Filler`). No `react-chartjs-2` wrapper. |
| III. Single Responsibility | PASS | Refactor preserves the existing split: pure data helpers (`buildDeviceChartData`, `shouldUseBars`, `getAggregationLabel`, `formatTooltipTimestamp`) stay independently testable. New tiny helper `buildChartConfig(step, datasetData, deviceName) → ChartConfiguration` extracted so the test can assert config shape without invoking the (mocked) constructor. |
| IV. TDD (NON-NEGOTIABLE) | PASS | TDD enforced in tasks phase: each behavior test rewritten (Red) before the corresponding Chart.js config wired up (Green). 100% line coverage required by CI. |
| Local type-check parity | PASS | `npm run typecheck` already runs `tsc --noEmit`; Chart.js ships first-class TS types. |
| Platform constraints | PASS | Frontend-only; no Azure surface affected. |

**No violations** → Complexity Tracking table is empty.

## Bundle Audit (NFR-002)

Per the spec: bundle size is an **audit point, not a hard budget**. Measured and reported in the PR description; only flagged for user-impact summary if delta exceeds +120 KB gzipped.

**Pre-migration baseline** (captured 2026-05-23 from `cd dashboard && npm run build` on this branch, pre-change):

| Asset | Raw | Gzipped |
|---|---:|---:|
| `dist/assets/index-*.js` | 421.43 KB | 121.45 KB |
| `dist/assets/index-*.css` | 21.38 KB | 4.63 KB |
| **Total app bundle** | **442.81 KB** | **126.08 KB** |

(`uplot` contributes ~45 KB raw / ~16 KB gzipped of the JS total per public bundlephobia figures — used only by `HistoricalGraph.tsx`.)

**Expected post-migration ballpark** (from [research.md §11](research.md) — verify after build):

- Tree-shaken `chart.js` (registered controllers/elements/scales/plugins only): ~70–90 KB gzipped.
- `chartjs-adapter-date-fns`: ~1 KB gzipped (thin adapter shim).
- `date-fns` tree-shaken to the adapter's parse/format/diff helpers: ~10–15 KB gzipped.
- Removed `uplot`: ~16 KB gzipped saved.

→ **Estimated net gzipped delta: +65 KB to +90 KB** (well below +120 KB trigger). To be confirmed by post-implementation build.

**Procedure**:

1. (DONE) Capture baseline above before any code change.
2. After implementation, run `cd dashboard && npm run build` and record new gzipped JS+CSS bundle sizes in the PR description.
3. Compute `delta = post − pre` (gzipped).
4. If `delta > +120 KB` gzipped, the PR description MUST additionally include a user-impact note covering: initial-load delta on a typical broadband connection, cache amortization (delta only paid on first visit / dashboard release), and mobile cellular cost. No automatic fail.

## Project Structure

### Documentation (this feature)

```text
specs/153-chart-js-historical-graph/
├── spec.md             # Feature specification (already authored)
├── plan.md             # This file
├── research.md         # Chart.js deep-dive (Phase 0 output)
├── quickstart.md       # Developer how-to (Phase 1 output)
├── checklists/         # Pre-existing requirements checklist
└── tasks.md            # Phase 2 output (created by /speckit.tasks — not yet)
```

**Intentionally NOT created**:

- `data-model.md` — N/A. No persisted entities. The Chart.js series/dataset/bucket types are runtime-only TypeScript interfaces documented inline and in research.md. The spec's "Key Entities" section already names them; a separate data-model adds no value.
- `contracts/` — N/A. No API surface changes. `/api/historical`, `RangeReadingsResponse`, and `TimeSeries` are unchanged and remain documented under `api/` and `dashboard/src/types.ts`.

### Source Code (repository root)

Changes are confined to `dashboard/`:

```text
dashboard/
├── package.json                                # Add chart.js + chartjs-adapter-date-fns + date-fns; remove uplot
├── src/
│   ├── components/
│   │   └── HistoricalGraph.tsx                 # REWRITTEN — Chart.js lifecycle, buildChartConfig helper
│   └── app.css                                 # Remove .uplot-* rules; .chart-tooltip rules retained (classname stable)
└── tests/
    └── component/
        └── HistoricalGraph.test.tsx            # REWRITTEN — vi.mock('chart.js'), assert captured config shape
```

No other dashboard file references `uplot` — verified by `grep -r uplot dashboard/src dashboard/tests`; only the three touch points above appear.

**Structure Decision**: The dashboard already follows a flat `src/components` / `tests/component` layout. No new directories. Pure data helpers stay co-located in `HistoricalGraph.tsx` (existing pattern) and remain individually `export`ed for unit testing. The new pure helper `buildChartConfig(step, datasetData, deviceName): ChartConfiguration<'bar' | 'line'>` is added in the same file so the test can assert config shape without driving a (mocked) `Chart` constructor.

## Phase 0 — Outline & Research

See [research.md](research.md). All NEEDS CLARIFICATION items are resolved there. Topics covered (per #153 deliverables and the user's plan brief):

1. `time` scale + `chartjs-adapter-date-fns` config — fixes #149.
2. Grouped bars (`barPercentage`, `categoryPercentage`, mixed `type` per dataset).
3. X-axis padding (`scales.x.offset: true`, `bounds: 'ticks'`).
4. Tick density (`ticks.autoSkip`, `maxTicksLimit`, `ticks.source`).
5. `displayFormats` per time unit + `tooltipFormat`.
6. Dual y-axis (`scales.y` left + `scales.y1` right, `position: 'right'`).
7. Mixed chart type for battery overlay (`type: 'line'` dataset inside a bar chart).
8. Gap handling (`spanGaps: false` + null data).
9. Tree-shakable `Chart.register(...)` strategy.
10. Preact integration pattern (manual lifecycle, no `react-chartjs-2`).
11. Vitest mocking pattern for the `Chart` constructor.
12. Bundle-size analysis with measured ballpark numbers and tree-shaking implications.

## Phase 1 — Design & Contracts

**Prerequisites**: research.md complete (it is).

1. **Data model** — N/A (see Project Structure note). Runtime types continue to use `RangeReadingsResponse` / `TimeSeries` from `dashboard/src/types.ts` unchanged.

2. **Interface contracts** — N/A. No external interface changes. The only "contract" introduced is the Chart.js `ChartConfiguration` object shape returned by the new `buildChartConfig` helper, which is exercised directly by the test file (assert on captured config) rather than a separate contract artifact. The contract surface a developer needs is documented in [research.md](research.md) and [quickstart.md](quickstart.md).

3. **Quickstart** — see [quickstart.md](quickstart.md). Covers: where Chart.js is registered, how to add or modify a series, how to enable/disable a Chart.js plugin, how to debug rendering issues, and how to re-run the bundle-size measurement.

4. **Agent context update** — run `.specify/scripts/bash/update-agent-context.sh copilot` to record `chart.js` / `chartjs-adapter-date-fns` / `date-fns` in `.github/copilot-instructions.md` Active Technologies.

**Re-evaluated Constitution Check (post-design)**: still PASS on all gates. No new abstractions introduced; the one new helper (`buildChartConfig`) is a pure config-shape function justified by SRP (separates config construction from `new Chart(...)` invocation so the test can assert shape directly).

## Complexity Tracking

*Empty — no Constitution violations to justify.*
