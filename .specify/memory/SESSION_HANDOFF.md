# Session Handoff — 2026-05-23

> **READ THIS AT START UP.** This file captures the state of work in progress
> at the end of the 2026-05-23 session so the next session can pick up cleanly.
> Delete this file (or its body) once the work it describes has landed.

## TL;DR

Issue #149 (1y view x-axis shows day-of-month instead of month/year) ballooned
into a chart-library swap. The user wants **Chart.js** to replace **uPlot** for
`HistoricalGraph.tsx`. Current uncommitted work on branch
`149-axis-month-year-labels` has been **abandoned and stashed** — do not try to
rescue it; start fresh from `main`.

## Why we're swapping uPlot for Chart.js

uPlot proved too low-level for what the user actually wants:

1. **Grouped bars**: uPlot has no native grouped/clustered bar support. Our
   workaround (`uPlot.paths.bars({ size, align: [-1, 0, 1] })`) produced
   overlapping bars because `align` controls bar→data-point anchoring, not
   inter-series offset. A custom paths renderer would be needed.
2. **X-axis padding**: bars sit flush against the chart edges. Fixable via a
   `scales.x.range()` callback but adds more bespoke code.
3. **Axis tick spacing for sparse data**: uPlot's auto-tick generator emits a
   fixed number of ticks regardless of data density. For the 1y preset with
   only 2 months of data, it emitted ~14 ticks all crammed into April. We
   patched this with `bucketAlignedSplits()` but it's another workaround.
4. **Label suppression policy churn**: month-only / month+year / dedup logic
   needed several iterations because the spec interacted badly with uPlot's
   tick density.

The user's verdict after multiple back-and-forth iterations:
> "If uPlot can't do something this simple then use something else."

## What was tried (and abandoned)

On branch `149-axis-month-year-labels` (stashed, not committed):

- Added step-aware `formatAxisDates(splits, step?)` with month-of-year dedup
- Added `bucketAlignedSplits(data)` to pin one tick per data bucket
- Added `splits` callback on the time axis (bars mode only)
- Multiple test iterations as the suppression policy changed
- Total: 5+ unit tests, all green, but **the visual result still didn't meet
  the user's bar (literal pun). Padding + grouped bars not yet attempted.**

The stash is preserved as `stash@{0}` if anyone wants to inspect the test
helpers for reference (some patterns may translate). Otherwise drop it:
`git stash drop stash@{0}`.

## What to do next session

### Option A (recommended): Chart.js migration

1. **Open a new issue** titled something like:
   > Replace uPlot with Chart.js in HistoricalGraph — grouped bars,
   > x-axis padding, proper time labels (supersedes #149)

   Reference #149 as subsumed-by.

2. **Branch**: `chart-js-historical-graph` off `main`.

3. **Install deps**:
   ```bash
   cd dashboard
   npm install chart.js chartjs-adapter-date-fns date-fns
   ```

4. **Rewrite `dashboard/src/components/HistoricalGraph.tsx`** with Chart.js.
   Required features that must be preserved (audit against current behavior):
   - **Line chart** for short ranges (`step < 86400`), one chart per device.
   - **Grouped bar chart** for long ranges (`step >= 86400`), one chart per
     device, with Solar / Home Load / Grid as three side-by-side bars per
     bucket — **no overlap**.
   - **Battery %** rendered as a line overlay on a secondary y-axis (right).
   - **Tooltip** on hover with all series values + timestamp.
   - **Gap handling**: insert nulls in series when bucket gap > 2× step.
     Chart.js handles `spanGaps: false` natively.
   - **X-axis padding**: configure `scales.x.offset: true` and/or
     `barPercentage`/`categoryPercentage` so bars never touch the edges.
     Use `time` scale with `chartjs-adapter-date-fns` for proper date labels.
   - **Time axis labels** auto-format per range (date-fns format strings or
     Chart.js `scales.x.time.displayFormats`).
   - **Dual y-axis**: Power (kW/W) on left, Battery % (0-100) on right.
   - **Series toggle via legend** (Chart.js does this natively).
   - **Multiple device charts** stacked vertically.

5. **Rewrite `dashboard/tests/component/HistoricalGraph.test.tsx`**:
   - Drop all uPlot-specific tests (formatAxisDates, bucketAlignedSplits,
     barAligns, etc).
   - Drop the `vi.mock('uplot', ...)` setup at the top.
   - Replace with Chart.js mocks: mock the `Chart` constructor and assert
     config shape (datasets, options.scales, plugin config).
   - Keep tests for pure data transforms: `buildDeviceChartData`,
     `getAggregationLabel`, `shouldUseBars`, `formatTooltipTimestamp`,
     `computeAxisSize`/`powerAxisSize` (if still used).
   - **100% coverage is non-negotiable** per the constitution. If a config
     branch is hard to cover, simplify the branch.

6. **Remove uPlot from `package.json`** once nothing references it
   (`grep -r uplot dashboard/src dashboard/tests`).

7. **Visual verification**: run the local stack
   (`docker compose -f local/docker-compose.prod-local.yml ps` should already
   be up) and visit http://localhost:5173 → History → cycle through
   1d / 7d / 30d / 1y / Custom. Expected:
   - 1d/7d: smooth line chart.
   - 30d/1y: grouped bars, padded from edges, month/year labels.
   - Battery % overlay visible.
   - Tooltip works on hover.

8. **`/speckit.specify`** is not required for this — it's a refactor of an
   existing component with a tracked bug (#149 + the new issue). Just file
   the issue, write the code, write tests, PR.

### Option B (only if Chart.js proves a bad fit)

Try **ECharts** (`echarts` package). Heavier (~150KB gzipped) but extremely
capable. Same grouped-bar story.

### Option C (NOT recommended)

Continue with uPlot and a custom paths renderer for grouped bars. The user
has already rejected this path.

## Other open work (not blocked by this)

Open issues at session end:
- **#149** — will be closed by the Chart.js PR
- **#115** — Separate Application Insights per environment (staging vs prod)
- **#52**  — Port epcube-exporter from Python to C# (longstanding, low pri)

## Session housekeeping

- Local stack is **still running**. Don't shut it down — user keeps Docker up
  between sessions. Terminals from prior session may be gone; recreate as
  needed (`cd dashboard && npm run dev` for the Vite server, etc.)
- Stash `stash@{0}` holds the abandoned uPlot work — drop when confident.
- Branch `149-axis-month-year-labels` is local-only, no remote. Either delete
  after starting Chart.js work, or keep as a reference for the test helpers.
- This handoff is on branch `docs/session-handoff-2026-05-23`. Merge it to
  main quickly so next session reads the latest.

## Lessons recorded

Already added to user memory (`/memories/`):
- Don't pattern-match from grep when verifying — check the actual rendered
  output, especially for UI changes. (Tests passing ≠ requirement met.)
- When a tool/library can't do something natively after two workarounds,
  pause and ask whether to swap it rather than pile on more workarounds.
