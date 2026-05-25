import { useEffect, useRef, useState } from 'preact/hooks';
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
  Filler,
  Decimation,
} from 'chart.js';
import type {
  ChartConfiguration,
  ChartDataset,
  ChartOptions,
  ScriptableContext,
  TooltipItem,
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { enUS } from 'date-fns/locale';
import { fetchDevices, fetchRangeReadings, fetchGridPower } from '../api';
import type { Device, RangeReadingsResponse, TimeSeries, TimeRangeValue } from '../types';
import { withRetry } from '../utils/retry';
import { groupDevicesByAlias, getDisplayName } from '../utils/devices';
import { errorMessage } from '../utils/errors';
import { formatWatts, formatWattsAxis, formatPercent } from '../utils/formatting';
import { trackException } from '../telemetry';

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
  Decimation,
);

interface HistoricalGraphProps {
  timeRange: TimeRangeValue;
}

const METRICS = [
  'solar_instantaneous_generation_watts',
  'home_load_power_watts',
] as const;

const BATTERY_SOC_METRIC = 'battery_state_of_capacity_percent';

export const SERIES_COLORS = {
  solar: '#f5c542',
  homeLoad: '#2196f3',
  grid: '#ff5722',
  gridExport: '#4caf50',
  battery: '#4caf50',
} as const;

export function getAggregationLabel(step: number): string | null {
  if (step <= 60) return null;
  if (step <= 3600) return 'hourly';
  if (step <= 86400) return 'daily';
  return 'monthly';
}

/** Pick the Chart.js time-scale tick unit from the aggregation step. The unit
 *  controls how the x-axis labels are spaced and formatted (hourly ticks for
 *  the day view, daily ticks for the multi-day view, monthly ticks for 1y),
 *  not the data point density. */
export function getTimeUnit(step: number): 'hour' | 'day' | 'month' {
  if (step <= 3600) return 'hour';
  if (step <= 86400) return 'day';
  return 'month';
}

/** Returns true when charts should render power series as grouped vertical bars. */
export function shouldUseBars(step: number): boolean {
  return step >= 86400;
}

/** Battery % is only shown on the line views (1d / 7d). On the bar views
 *  (30d / 1y) the power series are aggregated to daily/monthly buckets and a
 *  battery line alongside them is noise, so it's omitted. */
export function shouldShowBattery(step: number): boolean {
  return step < 86400;
}

/** All dashboard timestamps are presented in Steve's home timezone regardless
 *  of where the browser is running (CI, remote dev box, etc). The exporter
 *  stores epoch-seconds in UTC; we format on the way out. */
export const DISPLAY_TIMEZONE = 'America/New_York';

/** Format a tooltip timestamp based on chart step resolution. */
export function formatTooltipTimestamp(epochSec: number, step: number): string {
  const d = new Date(epochSec * 1000);
  const tz = DISPLAY_TIMEZONE;
  if (step >= 86400) {
    return d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' });
  }
  if (step >= 3600) {
    return d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
}

/** Format an x-axis tick label in DISPLAY_TIMEZONE. The format depends on the
 *  aggregation `unit` chosen by getTimeUnit() so it matches the granularity
 *  of the data the user is looking at. */
export function formatAxisTick(epochMs: number, unit: 'hour' | 'day' | 'month'): string {
  const d = new Date(epochMs);
  const tz = DISPLAY_TIMEZONE;
  switch (unit) {
    case 'hour':
      return d.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    case 'day':
      return d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
    case 'month':
      return d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', year: 'numeric' });
  }
}

export interface Point {
  x: number;
  y: number | null;
}

export interface DeviceChartDatasets {
  solar: Point[];
  homeLoad: Point[];
  grid: Point[];
  battery: Point[];
}

function filterSeriesForDevices(response: RangeReadingsResponse, deviceIds: Set<string>): TimeSeries[] {
  return response.series.filter((s) => deviceIds.has(s.device_id));
}

/**
 * Build per-device datasets from up to four RangeReadingsResponses in order
 * [solar, homeLoad, grid, battery]. Inserts a null y at the prior boundary
 * whenever consecutive timestamps exceed 2× step (FR-005).
 */
export function buildDeviceChartData(
  responses: RangeReadingsResponse[],
  deviceIds: Set<string>,
  step: number,
): DeviceChartDatasets | null {
  const filteredSeries = responses.map((res) => filterSeriesForDevices(res, deviceIds));

  const tsSet = new Set<number>();
  for (const seriesList of filteredSeries) {
    for (const s of seriesList) {
      for (const pt of s.values) {
        tsSet.add(pt.timestamp);
      }
    }
  }

  const timestamps = Array.from(tsSet).sort((a, b) => a - b);
  if (timestamps.length === 0) return null;

  const lookups = filteredSeries.map((seriesList) => {
    const lookup = new Map<number, number>();
    for (const s of seriesList) {
      for (const pt of s.values) {
        lookup.set(pt.timestamp, pt.value);
      }
    }
    return lookup;
  });

  const points: Point[][] = lookups.map((lookup) =>
    timestamps.map((ts) => ({ x: ts * 1000, y: lookup.get(ts) ?? null })),
  );

  if (step > 0 && timestamps.length > 1) {
    const gapThreshold = step * 2;
    for (let i = timestamps.length - 1; i > 0; i--) {
      if (timestamps[i] - timestamps[i - 1] > gapThreshold) {
        for (const arr of points) {
          arr[i - 1] = { x: arr[i - 1].x, y: null };
        }
      }
    }
  }

  while (points.length < 4) points.push([]);

  return {
    solar: points[0],
    homeLoad: points[1],
    grid: points[2],
    battery: points[3],
  };
}

interface DeviceChartGroup {
  name: string;
  data: DeviceChartDatasets;
}

function gridLineGradient(context: ScriptableContext<'line'>): CanvasGradient | string {
  const { ctx, chartArea } = context.chart;
  if (!chartArea) return 'rgba(255,87,34,0.15)';
  const grad = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  grad.addColorStop(0, 'rgba(255, 87, 34, 0.25)');
  grad.addColorStop(1, 'rgba(255, 87, 34, 0)');
  return grad;
}

/** Per-bar grid color: red when net pull from grid (positive y), green when
 *  net push back to grid (negative y, i.e. export). */
export function gridBarBackgroundColor(context: ScriptableContext<'bar'>): string {
  const raw = context.raw as { y: number | null } | number | null | undefined;
  const y = typeof raw === 'number' ? raw : raw?.y;
  return y != null && y < 0 ? SERIES_COLORS.gridExport : SERIES_COLORS.grid;
}

/** Build a small HTMLCanvasElement with a diagonal split (red top-right,
 *  green bottom-left) used as the legend `pointStyle` for the Grid dataset
 *  on bar views, signalling that bars are colored per-bar by sign. Returns
 *  the canvas (or null if 2D context unavailable). Using pointStyle avoids
 *  the CanvasPattern tile-alignment artifact that shows a seam across the
 *  swatch. */
export function createGridSplitSwatch(size = 14): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // Diagonal from upper-right (size,0) to lower-left (0,size).
  // Top-left triangle (above the line) = green (grid export / negative).
  ctx.fillStyle = SERIES_COLORS.gridExport;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(size, 0);
  ctx.lineTo(0, size);
  ctx.closePath();
  ctx.fill();
  // Bottom-right triangle (below the line) = red (grid pull / positive).
  ctx.fillStyle = SERIES_COLORS.grid;
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(size, size);
  ctx.lineTo(0, size);
  ctx.closePath();
  ctx.fill();
  return canvas;
}

/** Build a solid-color HTMLCanvasElement used as the legend `pointStyle`
 *  for non-Grid series so they keep their flat square swatch when
 *  usePointStyle is enabled. */
export function createSolidSwatch(color: string, size = 14): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

function batteryGradient(context: ScriptableContext<'line'>): CanvasGradient | string {
  const { ctx, chartArea } = context.chart;
  if (!chartArea) return 'rgba(76,175,80,0.15)';
  const grad = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  grad.addColorStop(0, 'rgba(76, 175, 80, 0.25)');
  grad.addColorStop(1, 'rgba(76, 175, 80, 0)');
  return grad;
}

/** Shared options used by both bar and line chart configs. */
export function buildBaseOptions(step: number): ChartOptions {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    resizeDelay: 200,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        type: 'time',
        adapters: { date: { locale: enUS } },
        time: {
          unit: getTimeUnit(step),
          tooltipFormat: 'PPpp',
          displayFormats: {
            minute: 'HH:mm',
            hour: 'HH:mm',
            day: 'MMM d',
            week: 'MMM d',
            month: 'MMM yyyy',
            quarter: 'MMM yyyy',
            year: 'yyyy',
          },
        },
        ticks: {
          autoSkip: true,
          autoSkipPadding: 16,
          maxRotation: 0,
          source: 'auto',
          color: '#a0aec0',
          callback: (value: number | string) => {
            const ms = typeof value === 'number' ? value : Number(value);
            return formatAxisTick(ms, getTimeUnit(step));
          },
        },
        grid: { color: 'rgba(255,255,255,0.1)' },
      },
    },
    plugins: {
      decimation: {
        enabled: true,
        algorithm: 'lttb',
        samples: 500,
      },
      legend: {
        display: true,
        labels: { color: '#e2e8f0', boxWidth: 12, padding: 12 },
      },
      tooltip: {
        backgroundColor: 'rgba(26, 32, 44, 0.95)',
        titleColor: '#e2e8f0',
        bodyColor: '#e2e8f0',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        padding: 10,
        cornerRadius: 4,
        callbacks: {
          title: (items: TooltipItem<'bar' | 'line'>[]) => {
            const x = items[0]?.parsed?.x;
            if (x == null) return '';
            return formatTooltipTimestamp(x / 1000, step);
          },
          label: (item: TooltipItem<'bar' | 'line'>) => {
            const label = item.dataset.label ?? '';
            const value = item.parsed.y;
            if (value == null) return `${label}: —`;
            const formatted = label === 'Battery %' ? formatPercent(value) : formatWatts(value);
            return `${label}: ${formatted}`;
          },
        },
      },
    },
  };
}

/** Returns the three power datasets (Solar / Home Load / Grid) with the requested type. */
export function buildPowerDatasets(
  data: DeviceChartDatasets,
  type: 'bar' | 'line',
): ChartDataset[] {
  const gridFill =
    type === 'line' ? gridLineGradient : gridBarBackgroundColor;
  const gridBorder = type === 'line' ? SERIES_COLORS.grid : gridBarBackgroundColor;
  const datasets = [
    {
      type,
      label: 'Solar',
      data: data.solar as unknown as { x: number; y: number | null }[],
      backgroundColor: SERIES_COLORS.solar,
      borderColor: SERIES_COLORS.solar,
      borderWidth: type === 'line' ? 2 : 1,
      yAxisID: 'y',
      spanGaps: false,
      normalized: true,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0,
      barPercentage: 0.9,
      categoryPercentage: 0.8,
    },
    {
      type,
      label: 'Home Load',
      data: data.homeLoad as unknown as { x: number; y: number | null }[],
      backgroundColor: SERIES_COLORS.homeLoad,
      borderColor: SERIES_COLORS.homeLoad,
      borderWidth: type === 'line' ? 2 : 1,
      yAxisID: 'y',
      spanGaps: false,
      normalized: true,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0,
      barPercentage: 0.9,
      categoryPercentage: 0.8,
    },
    {
      type,
      label: 'Grid',
      data: data.grid as unknown as { x: number; y: number | null }[],
      backgroundColor: gridFill,
      borderColor: gridBorder,
      borderWidth: type === 'line' ? 2 : 1,
      fill: type === 'line',
      yAxisID: 'y',
      spanGaps: false,
      normalized: true,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0,
      barPercentage: 0.9,
      categoryPercentage: 0.8,
    },
  ];
  return datasets as unknown as ChartDataset[];
}

/** Battery overlay — always a line on the right (y1) axis. */
export function buildBatteryDataset(data: DeviceChartDatasets): ChartDataset<'line'> {
  return {
    type: 'line',
    label: 'Battery %',
    data: data.battery as unknown as { x: number; y: number | null }[],
    borderColor: SERIES_COLORS.battery,
    backgroundColor: batteryGradient,
    borderWidth: 2,
    fill: true,
    tension: 0,
    pointRadius: 0,
    pointHoverRadius: 4,
    spanGaps: false,
    normalized: true,
    yAxisID: 'y1',
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPowerAxis(): any {
  return {
    type: 'linear',
    position: 'left',
    grace: '5%',
    title: { display: true, text: 'Power', color: '#a0aec0' },
    ticks: {
      color: '#a0aec0',
      callback: (val: number | string) => formatWattsAxis(Number(val)),
    },
    grid: { color: 'rgba(255,255,255,0.1)' },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildBatteryAxis(): any {
  return {
    type: 'linear',
    position: 'right',
    min: 0,
    max: 100,
    title: { display: true, text: 'Battery %', color: SERIES_COLORS.battery },
    ticks: {
      color: SERIES_COLORS.battery,
      callback: (val: number | string) => `${val}%`,
    },
    grid: { drawOnChartArea: false },
  };
}

export function buildBarConfig(
  step: number,
  data: DeviceChartDatasets,
  deviceName: string,
): ChartConfiguration<'bar'> {
  const base = buildBaseOptions(step);
  const baseScales = base.scales as Record<string, unknown>;
  const basePlugins = base.plugins as Record<string, unknown>;
  const baseLegend = basePlugins.legend as Record<string, unknown>;
  const baseLegendLabels = baseLegend.labels as Record<string, unknown>;
  const showBattery = shouldShowBattery(step);
  const gridSwatch = createGridSplitSwatch();
  const solarSwatch = createSolidSwatch(SERIES_COLORS.solar);
  const homeLoadSwatch = createSolidSwatch(SERIES_COLORS.homeLoad);
  const batterySwatch = createSolidSwatch(SERIES_COLORS.battery);
  const options = {
    ...base,
    scales: {
      ...baseScales,
      x: {
        ...(baseScales.x as object),
        offset: true,
        bounds: 'ticks',
      },
      y: buildPowerAxis(),
      ...(showBattery ? { y1: buildBatteryAxis() } : {}),
    },
    plugins: {
      ...basePlugins,
      legend: {
        ...baseLegend,
        labels: {
          ...baseLegendLabels,
          usePointStyle: true,
          // Render the Grid swatch as a red/green diagonal-split image so it
          // signals that bars are colored per-bar by sign. Other entries get
          // a solid square canvas to keep the visual style consistent.
          generateLabels: (chart: Chart) => {
            const items = Chart.defaults.plugins.legend.labels.generateLabels(chart);
            for (const item of items) {
              switch (item.text) {
                case 'Grid':
                  if (gridSwatch) item.pointStyle = gridSwatch;
                  break;
                case 'Solar':
                  if (solarSwatch) item.pointStyle = solarSwatch;
                  break;
                case 'Home Load':
                  if (homeLoadSwatch) item.pointStyle = homeLoadSwatch;
                  break;
                case 'Battery %':
                  if (batterySwatch) item.pointStyle = batterySwatch;
                  break;
              }
            }
            return items;
          },
        },
      },
    },
  } as ChartOptions<'bar'>;
  return {
    type: 'bar',
    data: {
      datasets: [
        ...buildPowerDatasets(data, 'bar'),
        ...(showBattery ? [buildBatteryDataset(data)] : []),
      ] as ChartDataset<'bar'>[],
    },
    options,
    // @ts-expect-error — custom marker, not part of Chart.js types
    _deviceName: deviceName,
  };
}

export function buildLineConfig(
  step: number,
  data: DeviceChartDatasets,
  deviceName: string,
): ChartConfiguration<'line'> {
  const base = buildBaseOptions(step);
  const baseScales = base.scales as Record<string, unknown>;
  const showBattery = shouldShowBattery(step);
  const options = {
    ...base,
    scales: {
      ...baseScales,
      y: buildPowerAxis(),
      ...(showBattery ? { y1: buildBatteryAxis() } : {}),
    },
  } as ChartOptions<'line'>;
  return {
    type: 'line',
    data: {
      datasets: [
        ...buildPowerDatasets(data, 'line'),
        ...(showBattery ? [buildBatteryDataset(data)] : []),
      ] as ChartDataset<'line'>[],
    },
    options,
    // @ts-expect-error — custom marker
    _deviceName: deviceName,
  };
}

export function HistoricalGraph({ timeRange }: HistoricalGraphProps) {
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const chartRefs = useRef<Chart[]>([]);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [deviceCharts, setDeviceCharts] = useState<DeviceChartGroup[]>([]);

  useEffect(() => {
    let cancelled = false;

    function destroyCharts() {
      for (const c of chartRefs.current) {
        c.destroy();
      }
      chartRefs.current = [];
    }

    async function fetchData() {
      setLoading(true);
      setEmpty(false);
      setError(null);
      setRetryAttempt(0);
      destroyCharts();

      try {
        const [deviceList, solarRes, homeLoadRes, gridRes, batterySocRes] = await withRetry(
          () => Promise.all([
            fetchDevices(),
            fetchRangeReadings(METRICS[0], timeRange.start, timeRange.end, timeRange.step),
            fetchRangeReadings(METRICS[1], timeRange.start, timeRange.end, timeRange.step),
            fetchGridPower(timeRange.start, timeRange.end, timeRange.step),
            fetchRangeReadings(BATTERY_SOC_METRIC, timeRange.start, timeRange.end, timeRange.step),
          ]),
          { maxRetries: 10, onRetry: (n: number) => { if (!cancelled) setRetryAttempt(n); } },
        );

        if (cancelled) return;

        const allResponses: RangeReadingsResponse[] = [solarRes, homeLoadRes, gridRes, batterySocRes];
        const groups = groupDevicesByAlias(deviceList.devices);

        const charts: DeviceChartGroup[] = [];
        for (const [, devices] of groups) {
          const deviceIds = new Set(devices.map((d: Device) => d.device));
          const data = buildDeviceChartData(allResponses, deviceIds, timeRange.step);
          if (data) {
            charts.push({ name: getDisplayName(devices), data });
          }
        }

        if (charts.length === 0) {
          setEmpty(true);
          setLoading(false);
          return;
        }

        setDeviceCharts(charts);
        setLoading(false);
        setRetryAttempt(0);
      } catch (err) {
        if (!cancelled) {
          setError(errorMessage(err, 'Failed to load data'));
          setRetryAttempt(0);
          setLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      cancelled = true;
      destroyCharts();
    };
  }, [timeRange.start, timeRange.end, timeRange.step]);

  useEffect(() => {
    if (loading || empty || deviceCharts.length === 0) {
      return;
    }

    const useBars = shouldUseBars(timeRange.step);

    deviceCharts.forEach((chart, idx) => {
      const ctx = canvasRefs.current[idx]?.getContext('2d');
      if (!ctx) {
        const err = new Error('Chart context unavailable');
        setError(err.message);
        trackException(err);
        return;
      }
      const config = useBars
        ? buildBarConfig(timeRange.step, chart.data, chart.name)
        : buildLineConfig(timeRange.step, chart.data, chart.name);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const instance = new Chart(ctx, config as any);
      chartRefs.current.push(instance);
    });

    return () => {
      for (const c of chartRefs.current) c.destroy();
      chartRefs.current = [];
    };
  }, [deviceCharts, loading, empty, timeRange.step]);

  const aggregationLabel = getAggregationLabel(timeRange.step);

  return (
    <div class="historical-graph" aria-label="Historical energy graphs" aria-busy={loading ? 'true' : undefined}>
      {error && <p role="alert">Error: {error}</p>}
      {retryAttempt > 0 && !error && (
        <p role="status" class="retry-notice">Reconnecting… attempt {retryAttempt} of 10</p>
      )}
      {loading && !error && retryAttempt === 0 && <p>Loading…</p>}
      {empty && <p>No data available for this time range</p>}
      {!loading && !empty && aggregationLabel && (
        <p role="status" class="aggregation-notice">
          Showing {aggregationLabel} resolution
        </p>
      )}
      <div>
        {!loading && !empty && deviceCharts.map((chart, idx) => (
          <div key={chart.name} class="device-chart" aria-label={`${chart.name} energy chart`}>
            <h3>{chart.name}</h3>
            <div class="device-chart-canvas">
              <canvas
                ref={(el) => { canvasRefs.current[idx] = el; }}
                aria-label={`${chart.name} energy chart canvas`}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
