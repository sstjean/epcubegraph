# Phase 0 Research: Chart.js Migration

**Feature**: 153-chart-js-historical-graph
**Date**: 2026-05-23
**Status**: Complete — all NEEDS CLARIFICATION resolved

Versions pinned in this research:

- `chart.js@4.5.1` (current stable as of 2026-05-23)
- `chartjs-adapter-date-fns@3.0.0`
- `date-fns@4.3.0`

All option names below reference Chart.js 4.x API. Some option names changed from 3.x (e.g., `category.percentage` → `categoryPercentage`); 4.x is the source of truth here.

---

## 1. The `time` scale + `chartjs-adapter-date-fns` — how it fixes #149

**Decision**: Use `scales.x.type: 'time'` with `chartjs-adapter-date-fns` registered at module init. Let Chart.js choose the time unit automatically (`time.unit` left **unset**) and provide an explicit `displayFormats` map per candidate unit. Data is `{ x: timestamp_ms, y: value }` points (not parallel arrays).

**Why this fixes #149**: The original bug — day-of-month numbers on the 1y view — happened because uPlot's tick generator emitted a fixed count of ticks regardless of unit, and the formatter only saw the raw epoch number. Chart.js's `time` scale is unit-aware: when the visible span is ~1 year it picks `unit: 'month'` and emits one tick per month, then formats each tick through `displayFormats.month` (default `'MMM yyyy'`). The "bare day number" failure mode is structurally impossible: the scale knows what unit the tick represents.

**Configuration pattern** (used by `buildBarConfig` / `buildLineConfig` via `buildBaseOptions`):

```ts
import 'chartjs-adapter-date-fns';        // side-effect registers the adapter
import { enUS } from 'date-fns/locale';

scales: {
  x: {
    type: 'time',
    offset: true,                         // see §3 — bars don't touch edges
    bounds: 'ticks',                      // see §3 — pad scale to whole tick boundaries
    adapters: {
      date: { locale: enUS },             // user's local timezone is implicit; locale controls labels
    },
    time: {
      // unit: undefined,                 // let Chart.js auto-pick
      tooltipFormat: 'PPpp',              // "May 23, 2026, 3:04:05 PM" — date-fns format
      displayFormats: {
        minute:  'HH:mm',                 // 1d / sub-day buckets
        hour:    'HH:mm',
        day:     'MMM d',                 // 7d / 30d
        week:    'MMM d',
        month:   'MMM yyyy',              // 1y — fixes #149 (always includes year)
        quarter: 'MMM yyyy',
        year:    'yyyy',
      },
    },
    ticks: {
      autoSkip: true,                     // see §4
      maxRotation: 0,                     // no diagonal labels
      source: 'auto',
    },
  },
  // y / y1 — see §6
}
```

**Why explicit `displayFormats` even though defaults exist**: The defaults are sensible but the `month` default is `'MMM yyyy'` only in some 4.x patch versions; pinning it locally guarantees SC-001 ("every visible tick on 1y includes both month and year") regardless of upstream defaults drift.

**DST**: `chartjs-adapter-date-fns` uses the user's local timezone for formatting, matching today's uPlot behavior; no special handling required for the DST edge case noted in spec.

---

## 2. Grouped bars

**Decision**: When `step >= 86400`, render three datasets (Solar / Home Load / Grid) with `type: 'bar'` against a shared time-axis. Rely on Chart.js's native grouping (default behavior for multiple bar datasets on the same scale) — **no manual offset math**. Tune `barPercentage` (bar width within its allocated slot) and `categoryPercentage` (slot width within the category) to leave inter-bucket whitespace.

```ts
datasets: [
  {
    type: 'bar',
    label: 'Solar',
    backgroundColor: '#f5c542',
    data: solarPoints,        // [{ x: ms, y: watts | null }]
    yAxisID: 'y',
    barPercentage: 0.9,       // each bar takes 90% of its slot
    categoryPercentage: 0.8,  // 3 slots together take 80% of the bucket
  },
  { type: 'bar', label: 'Home Load', backgroundColor: '#2196f3', data: homePoints, yAxisID: 'y',
    barPercentage: 0.9, categoryPercentage: 0.8 },
  { type: 'bar', label: 'Grid', backgroundColor: '#ff5722', data: gridPoints, yAxisID: 'y',
    barPercentage: 0.9, categoryPercentage: 0.8 },
  // Battery — line overlay, see §7
],
```

**Key options**:

| Option | Purpose | Value used |
|---|---|---:|
| `barPercentage` | Bar width as a fraction of its slot. | `0.9` |
| `categoryPercentage` | Combined width of all bars in one bucket, as a fraction of the bucket. | `0.8` |
| `grouped` (chart-level) | Whether bars of the same index across datasets are grouped. **Default true**. | (default) |
| `borderSkipped` | Which side of the bar omits the border. | (default `'start'`) |

`categorySpacing` and a per-dataset `offset` were considered and rejected: they are not 4.x options on bar datasets (they belong to the category scale, which we are not using — we are on a time scale). The `barPercentage` × `categoryPercentage` pair is the canonical 4.x knob for grouped-bar width.

**`offset` (axis option vs dataset option)**: `scales.x.offset: true` is the **axis** option that pads each tick by half a category so bars are centered on the tick rather than abutting the next one — used here. There is also a dataset-level `offset` for line charts that we do **not** use.

---

## 3. X-axis padding (bars don't touch chart edges) — SC-002, US-7

**Decision**: Set `scales.x.offset: true` and `scales.x.bounds: 'ticks'` on bar charts. For line charts (sub-day step) keep `offset: false` to allow the line to reach the chart edges as it does today.

| Option | Effect |
|---|---|
| `offset: true` | Adds half-a-category padding at each end of the scale. With a time scale and bar datasets, this guarantees the leftmost and rightmost bars are centered inside the plot area rather than clipped at the edge — the spec's US-7 requirement. |
| `bounds: 'ticks'` | Extends the scale range to include the first/last tick boundaries (not just the first/last data point). This avoids the "label exists but bar is cropped" failure when min/max land mid-tick. Alternative `bounds: 'data'` would tighten the range to data extents and re-introduce the edge-clipping problem. |
| `min` / `max` padding | We do **not** set these explicitly; the auto-derived range is correct once `bounds: 'ticks'` is in place. |

**Why this beats uPlot**: uPlot offered no axis-level edge padding; the existing code would need a custom `scales.x.range()` callback to inject padding. Chart.js makes it one boolean.

---

## 4. Tick density / auto-skip

**Decision**: Rely on `ticks.autoSkip: true` with a generous `maxTicksLimit` matched to the view width budget. Use `ticks.source: 'auto'` (the default for time scales) so Chart.js generates evenly-spaced ticks driven by the chosen `time.unit`.

```ts
ticks: {
  autoSkip: true,
  autoSkipPadding: 16,    // pixel gap between candidate ticks before skipping
  maxRotation: 0,         // never tilt labels (legibility)
  source: 'auto',
}
```

**`maxTicksLimit`**: We deliberately leave this unset on the time scale and let `autoSkipPadding` do the work. `maxTicksLimit` is most useful on linear scales; on time scales it can fight the unit picker (e.g., force 12 ticks across a year, defeating the month-unit auto-selection). Setting it would re-introduce the kind of brittleness #149 came from.

**`source` alternatives**:

- `'auto'` — Chart.js's tick generator. Used here. Aware of unit; produces clean boundaries.
- `'data'` — one tick per data point. Would mean ~365 ticks on the 1y view — the exact failure mode we're fixing.
- `'labels'` — only for category scales; N/A on a time scale.

---

## 5. `displayFormats` per unit + `tooltipFormat`

`displayFormats` is the map of date-fns format strings per time unit. The settings above (§1) are the final values used by `buildBaseOptions` (and inherited by both `buildBarConfig` and `buildLineConfig`). Mapping to spec acceptance criteria:

| Preset | Auto-picked `time.unit` | `displayFormats[unit]` | Sample label |
|---|---|---|---|
| 1d (step=60s) | `hour` (typical viewport) | `'HH:mm'` | `09:00` |
| 7d (step=3600s) | `day` | `'MMM d'` | `May 18` |
| 30d (step=86400s) | `day` or `week` | `'MMM d'` | `May 1`, `May 8` |
| 1y (step=86400s) | `month` | `'MMM yyyy'` | `Jun 2025` ✅ #149 |
| Custom | auto | (per range) | auto |

**`tooltipFormat: 'PPpp'`** gives a long localized date+time (date-fns long format). The existing `formatTooltipTimestamp` helper stays for the tooltip body (consistency with current tests) and is fed each series' `x` value via Chart.js's tooltip callback (`callbacks.title`).

---

## 6. Dual y-axis (left watts, right percent)

**Decision**: Two linear scales, `y` (left, watts) and `y1` (right, percent), with `y1` explicitly positioned and ranged. Battery dataset's `yAxisID: 'y1'`; all three power datasets `yAxisID: 'y'`.

```ts
scales: {
  x: { /* time scale, see §1 */ },
  y: {
    type: 'linear',
    position: 'left',
    title: { display: true, text: 'Power' },
    ticks: {
      callback: (val) => formatWattsAxis(val as number),   // reuse existing helper
    },
    grid: { color: 'rgba(255,255,255,0.1)' },
  },
  y1: {
    type: 'linear',
    position: 'right',
    min: 0,
    max: 100,
    title: { display: true, text: 'Battery %', color: '#4caf50' },
    ticks: {
      callback: (val) => `${val}%`,
    },
    grid: { drawOnChartArea: false },   // don't double-draw gridlines from the right axis
  },
}
```

`grid.drawOnChartArea: false` on `y1` is the canonical Chart.js idiom for "second axis exists for scaling only; gridlines come from the primary axis". This matches the current uPlot behavior (`grid: { show: false }` on the right axis).

---

## 7. Mixed chart types — battery line over the bar chart

**Decision**: Use a `'bar'` chart type at the chart level, and override `type: 'line'` on the Battery dataset. Chart.js supports per-dataset `type` overrides on a mixed chart; this is documented as the "mixed chart" pattern.

```ts
{
  type: 'line',
  label: 'Battery %',
  borderColor: '#4caf50',
  backgroundColor: 'rgba(76,175,80,0.25)',
  yAxisID: 'y1',
  data: batteryPoints,
  spanGaps: false,                       // see §8
  pointRadius: 0,                        // smooth line, no point dots (matches today)
  borderWidth: 2,
  fill: true,                            // gradient fill matches current uPlot look
  tension: 0.0,                          // straight segments (no Bezier smoothing — current behavior)
}
```

For sub-day ranges (`step < 86400`), all three power datasets are also `type: 'line'` and the chart-level `type` is `'line'` (produced by `buildLineConfig`, which calls `buildPowerDatasets(data, 'line')`). The lifecycle dispatches: `shouldUseBars(step) ? buildBarConfig(...) : buildLineConfig(...)`.

---

## 8. Gap handling

**Decision**: Pre-process series so any bucket gap > 2× `step` is represented by `null` at the boundary points. Each dataset declares `spanGaps: false` (line) or relies on bar datasets naturally rendering nothing for a `null` y-value.

The existing pure helper `buildDeviceChartData` already inserts these nulls (FR-005). It will be updated to output `{ x: number, y: number | null }` objects instead of parallel `AlignedData` arrays; the null-insertion logic itself is unchanged.

```ts
// Line dataset (sub-day):
{ type: 'line', spanGaps: false, ... }   // a null breaks the line

// Bar dataset (>= day):
// Bar with y == null is simply not drawn → visible gap between buckets
```

The 2× step rule and the unit tests for it (`buildDeviceChartData` tests) carry over without behavior change.

---

## 9. Tree-shaking / explicit `Chart.register(...)` strategy

**Decision**: Import `chart.js` from its slim entry (not `chart.js/auto`) and explicitly register only the components used. This keeps unused controllers (scatter, doughnut, radar, polarArea, bubble) out of the bundle.

```ts
// dashboard/src/components/HistoricalGraph.tsx — top of file
import {
  Chart,
  LineController,
  BarController,
  LineElement,
  PointElement,
  BarElement,
  LinearScale,
  TimeScale,
  Tooltip,
  Legend,
  Filler,         // for the battery gradient fill
} from 'chart.js';
import 'chartjs-adapter-date-fns';

Chart.register(
  LineController,
  BarController,
  LineElement,
  PointElement,
  BarElement,
  LinearScale,
  TimeScale,
  Tooltip,
  Legend,
  Filler,
);
```

**Rejected**: `import { Chart } from 'chart.js/auto'`. Auto-registers every controller/scale/plugin. Convenient, but adds ~30 KB raw of unused code. Spec NFR-002 doesn't gate on size, but YAGNI + measurable savings make explicit registration the right call.

`Tooltip` and `Legend` are listed because they're plugins (not always-on); `Filler` is required for the battery's `fill: true` gradient.

---

## 10. Preact integration — manual `Chart` lifecycle in `useEffect` / `useRef`

**Decision**: Manage the Chart.js lifecycle directly. Mirror the current uPlot pattern: `useRef<HTMLCanvasElement>` for the canvas, a `useRef<Chart | null>` for the instance, and a `useEffect` whose cleanup calls `chart.destroy()`. Do **not** add `react-chartjs-2` or any wrapper.

**Why no wrapper**:

1. `react-chartjs-2` pulls React into the dashboard (Preact + Preact-compat would be required) — adds bundle weight and a runtime mismatch source.
2. The wrapper's value is mostly prop-diff → chart-update wiring; we already have a one-shot config/destroy cycle keyed on `[timeRange, deviceCharts]` which is simpler and easier to test.
3. The current uPlot lifecycle is already implemented this way; pattern parity reduces refactor surface.

**Pattern**:

```tsx
const canvasRef = useRef<HTMLCanvasElement>(null);
const chartRef  = useRef<Chart | null>(null);

useEffect(() => {
  if (!canvasRef.current) return;
  const ctx = canvasRef.current.getContext('2d');
  if (!ctx) {
    // NFR-006: surface the failure, do not silently render nothing
    setError('Chart context unavailable');
    return;
  }
  const config = shouldUseBars(timeRange.step)
    ? buildBarConfig(timeRange.step, chart.data, chart.name)
    : buildLineConfig(timeRange.step, chart.data, chart.name);
  chartRef.current = new Chart(ctx, config);
  return () => {
    chartRef.current?.destroy();
    chartRef.current = null;
  };
}, [chart.data, chart.name, timeRange.step]);
```

One `useEffect` per device chart (via a child `<DeviceChartCanvas>` component or via a stable key + a `useEffect` keyed on chart identity). Final approach picked in tasks phase, but the lifecycle shape is fixed.

**Canvas element vs. wrapping `<div>`**: Chart.js requires a `<canvas>`. The existing code uses `<div data-chart>` and uPlot creates the canvas inside; we will switch to `<canvas ref={...}>` directly, which is the Chart.js 4 idiom.

---

## 11. Testing patterns — mocking the `Chart` constructor in Vitest

**Decision**: Replace the current `vi.mock('uplot', …)` with a `vi.mock('chart.js', …)` that captures every constructor invocation and exposes a `destroy()` spy. Assert config shape and lifecycle directly. The date adapter is **not** mocked; it's never reached because Chart.js itself is mocked.

```ts
// tests/component/HistoricalGraph.test.tsx
const { capturedConfigs, destroySpy } = vi.hoisted(() => ({
  capturedConfigs: [] as ChartConfiguration[],
  destroySpy: vi.fn(),
}));

vi.mock('chart.js', () => {
  class MockChart {
    static register = vi.fn();
    constructor(_ctx: unknown, config: ChartConfiguration) {
      capturedConfigs.push(config);
    }
    destroy = destroySpy;
    update = vi.fn();
  }
  return {
    Chart: MockChart,
    LineController: class {}, BarController: class {},
    LineElement: class {}, PointElement: class {}, BarElement: class {},
    LinearScale: class {}, TimeScale: class {},
    Tooltip: class {}, Legend: class {}, Filler: class {},
  };
});

vi.mock('chartjs-adapter-date-fns', () => ({}));   // side-effect import → empty stub
```

**Assertion patterns** (these replace the uPlot-style hook invocations in the current test):

| Old uPlot assertion | New Chart.js assertion |
|---|---|
| `capturedUPlotOpts[0].series[1].paths === barBuilders[0]` | `capturedConfigs[0].data.datasets[0].type === 'bar'` (for `step >= 86400`) |
| Invoke axis `values()` callback for coverage | Invoke `scales.x.ticks.callback` and `scales.y.ticks.callback` directly |
| Invoke `setCursor` hook | Invoke `plugins.tooltip.callbacks.title` and `.label` directly |
| `MockUPlot.destroy()` removes root | `destroySpy` called on unmount |

**What to drop from the existing test setup**:

- The `barsSpy` / `paths.bars` machinery — no equivalent; grouped bars are a config flag, not a paths function.
- The `over.offsetLeft` / `clientWidth` `Object.defineProperty` plumbing — Chart.js owns positioning; tooltip is no longer DOM-manipulated by us.
- The fake `ctx.createLinearGradient` — battery gradient is configured declaratively (`backgroundColor` + `Filler`), not via a `fill` callback that needs a live context.
- The `formatAxisDates` test cases — that helper is deleted (Chart.js handles dedup natively).

**What to keep**:

- All pure-helper tests (`buildDeviceChartData`, `shouldUseBars`, `getAggregationLabel`, `formatTooltipTimestamp`) — unchanged.
- The retry / loading / empty / error states — unchanged.
- Multi-device stacking — same shape; `capturedConfigs.length === N`.
- Cleanup test — assert `destroySpy` was called on unmount.

**100% coverage strategy**: invoke each ticks/tooltip callback directly inside an assertion (`config.scales!.x.ticks!.callback!(1700000000000, 0, [])`). This covers the closure bodies without needing a real `Chart` instance to drive them.

---

## 12. Bundle size — published & expected measured numbers

All numbers are **gzipped**; raw sizes in parentheses. Sources: bundlephobia entries for the pinned versions (cross-checked against `npm pack --dry-run` and the chart.js README's published table) plus this branch's pre-migration baseline.

### Per-package published gzipped sizes

| Package | Published gzipped | Notes |
|---|---:|---|
| `chart.js@4.5.1` full UMD (`chart.js/auto`) | ~83 KB (~270 KB raw) | All controllers/scales/plugins. We **do not** use this entry. |
| `chart.js@4.5.1` tree-shaken (our registered subset) | **~70–75 KB** | Estimate from the slim entry minus the unused controllers (Doughnut/Radar/PolarArea/Scatter/Bubble omitted = ~10–15 KB saved). To be verified post-build. |
| `chartjs-adapter-date-fns@3.0.0` | ~1 KB | Thin adapter; almost all weight is in `date-fns`. |
| `date-fns@4.3.0` (adapter's tree-shaken subset) | ~10–15 KB | Adapter pulls `parseISO`, `format`, `differenceIn*`, `startOf*`, `endOf*`, `add*` for unit detection. Full `date-fns` would be ~75 KB; tree-shaking matters here. |
| `uplot@1.6.31` (current) | ~16 KB (~45 KB raw) | Removed by this migration. |

### Net estimated delta on this dashboard

```text
+ chart.js (tree-shaken)            ≈ +72 KB
+ chartjs-adapter-date-fns          ≈  +1 KB
+ date-fns (tree-shaken via adapter) ≈ +12 KB
- uplot                             ≈ -16 KB
─────────────────────────────────────────
≈ +69 KB gzipped
```

Comfortably below the +120 KB user-impact-summary trigger from NFR-002. Real number to be recorded in PR per `plan.md` § Bundle Audit step 2.

### What blows the budget if we're sloppy

- Importing `chart.js/auto` instead of the slim entry: **+10–15 KB** gzipped (auto-registers all controllers).
- Importing `date-fns` directly (`import * as df from 'date-fns'`) anywhere in the dashboard: **+60 KB** (defeats tree-shaking). Already a non-issue since we only use it transitively.
- Adding `react-chartjs-2` + `react` + `react-dom` shims for Preact: **+45 KB**. Decision §10 rules this out.

### Verification step (post-implementation)

```sh
cd dashboard && npm run build
ls -lh dist/assets/*.js dist/assets/*.css
# Vite already reports gzipped sizes in the build output table.
```

Diff against the pre-migration baseline recorded in `plan.md`.

---

## Summary of decisions for plan.md → tasks.md

- **Date adapter**: `chartjs-adapter-date-fns` + `date-fns@4`.
- **Lifecycle**: manual `new Chart` / `chart.destroy()` in `useEffect`. No `react-chartjs-2`.
- **Registration**: explicit `Chart.register(...)` of 10 components (no `chart.js/auto`).
- **Time axis**: `type: 'time'`, `offset: true`, `bounds: 'ticks'`, explicit `displayFormats` with `'MMM yyyy'` for `month` (fixes #149).
- **Grouped bars**: native (multiple `type: 'bar'` datasets on same scale), tuned with `barPercentage: 0.9`, `categoryPercentage: 0.8`.
- **Dual y-axis**: `y` (left, watts) + `y1` (right, 0–100 %), `drawOnChartArea: false` on `y1`.
- **Mixed type**: chart `type: 'bar'` for `step >= 86400`, with Battery dataset `type: 'line'` overlay. Chart `type: 'line'` for sub-day step (all four datasets line).
- **Gaps**: `spanGaps: false` + null y in pre-processed data (existing `buildDeviceChartData` keeps its 2×step rule, switches output shape to `{x,y}` points).
- **Bundle**: estimated +69 KB gzipped — measure and record in PR.
- **Testing**: `vi.mock('chart.js', …)` captures `ChartConfiguration`; invoke ticks/tooltip callbacks directly for coverage; drop `paths.bars` / `formatAxisDates` / gradient `fill` callback test machinery.
