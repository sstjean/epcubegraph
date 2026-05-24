# Quickstart: HistoricalGraph (Chart.js)

Brief developer-facing how-to for the migrated `HistoricalGraph` component. For the design rationale, see [research.md](research.md).

## Where Chart.js is registered

Top of [`dashboard/src/components/HistoricalGraph.tsx`](../../dashboard/src/components/HistoricalGraph.tsx):

```ts
import {
  Chart,
  LineController, BarController,
  LineElement, PointElement, BarElement,
  LinearScale, TimeScale,
  Tooltip, Legend, Filler,
} from 'chart.js';
import 'chartjs-adapter-date-fns';

Chart.register(
  LineController, BarController,
  LineElement, PointElement, BarElement,
  LinearScale, TimeScale,
  Tooltip, Legend, Filler,
);
```

Registration is **per-module side effect**: it runs once when the module is first imported, no matter how many chart instances are created. To add a new Chart.js feature, add the corresponding controller/element/scale/plugin to this list.

Do **not** switch to `import { Chart } from 'chart.js/auto'`. That auto-registers everything and adds ~10–15 KB gzipped of unused code (research.md §9).

## How to add or modify a series

A series corresponds to a Chart.js `dataset`. Power datasets (Solar / Home Load / Grid) are built inside `buildPowerDatasets(data, type)`; the Battery overlay is built inside `buildBatteryDataset(data)`. Both are composed by `buildBarConfig` and `buildLineConfig` (which select the chart type based on `shouldUseBars(step)`). To add a new series:

1. Add the metric to the parallel fetches inside the data `useEffect` (mirror `solar` / `homeLoad` / `grid` / `batterySoc`).
2. Extend `buildDeviceChartData` so the new metric becomes another `{x, y}[]` array in the returned shape.
3. In the relevant helper (`buildPowerDatasets` for a watts-series on the left y-axis, `buildBatteryDataset` for a percent-series on the right y-axis, or a new helper if neither fits), append a new entry to the returned `datasets` array:

```ts
{
  type: shouldUseBars(step) ? 'bar' : 'line',   // or fix type if the series is always one kind
  label: 'My New Series',
  backgroundColor: '#abc123',
  borderColor: '#abc123',
  yAxisID: 'y',                                  // or 'y1' for the right (percent) axis
  data: deviceData.myNewSeries,
  spanGaps: false,                               // line only — keep gap behavior consistent
  // bar-only:
  barPercentage: 0.9,
  categoryPercentage: 0.8,
}
```

4. Update `tests/component/HistoricalGraph.test.tsx`: the captured `ChartConfiguration` will now have one more dataset — assert label/`yAxisID`/`type` and add a fixture entry to the mocked range responses.

To modify an existing series (color, axis assignment, gradient fill, etc.), edit the entry directly in `buildPowerDatasets` or `buildBatteryDataset`. The grouped-bar geometry is controlled by `barPercentage` × `categoryPercentage` (in `buildPowerDatasets` when `type === 'bar'`); the time-axis label format by `scales.x.time.displayFormats[unit]` (in `buildBaseOptions`).

## How to debug rendering issues

| Symptom | First thing to check |
|---|---|
| Blank canvas | Open devtools → Console. NFR-006 means any context-creation failure surfaces via the `error` state and an Application Insights event. Also check that `chartRef.current` is non-null in the React/Preact devtools. |
| Axis labels look wrong on long ranges (re-regression of #149) | Confirm `scales.x.time.displayFormats.month === 'MMM yyyy'`. Confirm `time.unit` is **not** set (must be auto). Confirm `chartjs-adapter-date-fns` side-effect import is still at the top of `HistoricalGraph.tsx`. |
| Bars overlap | You probably removed both `barPercentage` and `categoryPercentage`. Restore them, or check that you have not set `stacked: true` on `scales.x` or `scales.y`. |
| Bars touch the chart edge | `scales.x.offset` is false or missing; restore `offset: true` on bar-step configs. |
| Battery line is invisible or squashed | Confirm `yAxisID: 'y1'` on the Battery dataset and `position: 'right'` + `min: 0` + `max: 100` on `scales.y1`. |
| Gaps render as straight lines | The dataset is missing `spanGaps: false`, or `buildDeviceChartData` didn't insert a `null` at the gap boundary. Verify with the existing unit tests. |
| Tooltip values undefined | Tooltip callbacks read `context.parsed.y`; if you switched dataset shape from `{x, y}` objects to a parallel array, restore the object form. |
| Test fails with "Chart is not a constructor" | The `vi.mock('chart.js', …)` block in the test file lost its `Chart` export, or you added a new Chart.js export and the mock doesn't stub it. Add a `class {}` stub for the new name. |

For visual debugging in the live dashboard, open the persistent local stack at <http://localhost:5173>, open devtools, and inspect the chart via:

```js
// In devtools console — Chart.js attaches a registry per-canvas.
Chart.getChart(document.querySelector('canvas'));
// → returns the Chart instance; inspect .config, .data, .scales, etc.
```

## Re-running the bundle-size measurement

The pre-migration baseline is recorded in [plan.md](plan.md) § Bundle Audit. After any change that touches Chart.js imports or dependencies:

```sh
cd dashboard && npm run build
```

Vite prints a table of asset names with raw and gzipped sizes. The line to record is the `dist/assets/index-*.js` gzipped figure (CSS is negligibly affected by this migration). Compare against the baseline; if the delta exceeds +120 KB gzipped, follow NFR-002 and add a user-impact summary to the PR description.

## Running tests

```sh
cd dashboard
npm run test                  # one-shot
npm run test:coverage         # required before commit — constitution is 100% line coverage
npm run typecheck             # mirrors CI's tsc gate
```

The component test file mocks `chart.js` entirely; you do not need a real canvas or browser. To assert a specific Chart.js config field, read it from the `capturedConfigs[i]` array populated by the mock constructor.
