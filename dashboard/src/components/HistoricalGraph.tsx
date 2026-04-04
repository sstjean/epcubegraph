import { useEffect, useRef, useState } from 'preact/hooks';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { fetchDevices, fetchRangeReadings, fetchGridPower } from '../api';
import type { Device, RangeReadingsResponse, TimeSeries, TimeRangeValue } from '../types';
import { withRetry } from '../utils/retry';
import { groupDevicesByAlias, getDisplayName } from '../utils/devices';
import { formatWatts, formatPercent } from '../utils/formatting';

interface HistoricalGraphProps {
  timeRange: TimeRangeValue;
}

const METRICS = [
  'solar_instantaneous_generation_watts',
  'home_load_power_watts',
] as const;

const BATTERY_SOC_METRIC = 'battery_state_of_capacity_percent';

// Series order: Solar, Home Load, Grid, Battery %
const SERIES_LABELS = ['Solar', 'Home Load', 'Grid', 'Battery %'];
const SERIES_COLORS = ['#f5c542', '#2196f3', '#ff5722', '#4caf50'];

export function getAggregationLabel(step: number): string | null {
  if (step <= 60) return null;
  if (step <= 3600) return 'hourly';
  if (step <= 86400) return 'daily';
  return 'monthly';
}

/** Threshold for switching from line to bar chart rendering (FR-026). */
export const BAR_STEP_THRESHOLD = 86400;

/** Returns true when charts should render power series as grouped vertical bars. */
export function shouldUseBars(step: number): boolean {
  return step >= BAR_STEP_THRESHOLD;
}

/** Format a tooltip timestamp based on chart step resolution. */
export function formatTooltipTimestamp(epochSec: number, step: number): string {
  const d = new Date(epochSec * 1000);
  if (step >= 86400) {
    // Daily or monthly bars — show date only
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  if (step >= 3600) {
    // Multi-day hourly line chart — show date + time
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  // Intra-day line chart (1-minute) — time only
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Format x-axis splits as date-only labels, deduplicating so each date appears once. */
export function formatAxisDates(splits: number[]): string[] {
  let prevLabel = '';
  return splits.map((epochSec) => {
    const label = new Date(epochSec * 1000)
      .toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (label === prevLabel) return '';
    prevLabel = label;
    return label;
  });
}

/**
 * Filter a range response's series to only device_ids belonging to a device group.
 * Returns the matching TimeSeries entries.
 */
function filterSeriesForDevices(response: RangeReadingsResponse, deviceIds: Set<string>): TimeSeries[] {
  return response.series.filter((s) => deviceIds.has(s.device_id));
}

/**
 * Build aligned uPlot data for a single device group.
 * Collects timestamps from all matching series, inserts nulls for gaps > 2× step (FR-008).
 */
export function buildDeviceChartData(
  responses: RangeReadingsResponse[],
  deviceIds: Set<string>,
  step: number,
): uPlot.AlignedData | null {
  const filteredSeries = responses.map((res) => filterSeriesForDevices(res, deviceIds));

  // Collect all unique timestamps from this device's series
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

  // Build value arrays — one per metric (solar, battery, home load, grid)
  const valueArrays: Array<Array<number | null>> = filteredSeries.map((seriesList) => {
    // Merge all series for this metric into a single lookup (in case multiple device_ids match)
    const lookup = new Map<number, number>();
    for (const s of seriesList) {
      for (const pt of s.values) {
        lookup.set(pt.timestamp, pt.value);
      }
    }
    return timestamps.map((ts) => lookup.get(ts) ?? null);
  });

  // Gap detection: insert nulls at boundaries where gap > 2× step (FR-008, T055)
  if (step > 0 && timestamps.length > 1) {
    const gapThreshold = step * 2;
    // Walk timestamps in reverse to safely insert without index shifting issues
    for (let i = timestamps.length - 1; i > 0; i--) {
      if (timestamps[i] - timestamps[i - 1] > gapThreshold) {
        // Insert a null boundary point after the gap start
        for (const arr of valueArrays) {
          arr[i - 1] = null;
        }
      }
    }
  }

  return [timestamps, ...valueArrays];
}

interface DeviceChartGroup {
  name: string;
  data: uPlot.AlignedData;
}

export function HistoricalGraph({ timeRange }: HistoricalGraphProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const uplotRefs = useRef<uPlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [deviceCharts, setDeviceCharts] = useState<DeviceChartGroup[]>([]);

  useEffect(() => {
    let cancelled = false;

    function destroyCharts() {
      for (const u of uplotRefs.current) {
        u.destroy();
      }
      uplotRefs.current = [];
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
        for (const [_key, devices] of groups) {
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
          setError(err instanceof Error ? err.message : 'Failed to load data');
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

  // Render uPlot instances after deviceCharts state updates
  useEffect(() => {
    if (loading || empty || deviceCharts.length === 0) return;

    const container = chartContainerRef.current!;
    const chartDivs = container.querySelectorAll<HTMLDivElement>('[data-chart]');
    const useBars = shouldUseBars(timeRange.step);

    // For grouped bars: 3 power series each taking ~20% of the interval width
    const barAligns = [-1, 0, 1] as const;
    const barBuilders = useBars
      ? barAligns.map((align) => uPlot.paths.bars!({ size: [0.6 / 3, 64], align, gap: 1 }))
      : null;

    deviceCharts.forEach((chart, idx) => {
      const target = chartDivs[idx];

      const tooltip = document.createElement('div');
      tooltip.className = 'chart-tooltip';
      tooltip.style.display = 'none';
      target.appendChild(tooltip);

      const opts: uPlot.Options = {
        width: target.clientWidth || 800,
        height: 300,
        legend: { live: false },
        cursor: {
          points: { show: true },
        },
        hooks: {
          setCursor: [(u: uPlot) => {
            const idx = u.cursor.idx;
            if (idx == null || idx < 0) {
              tooltip.style.display = 'none';
              return;
            }
            const ts = chart.data[0][idx] as number;
            const timeLabel = formatTooltipTimestamp(ts, timeRange.step);
            let html = `<div class="chart-tooltip-time">${timeLabel}</div>`;
            for (let s = 0; s < SERIES_LABELS.length; s++) {
              const val = chart.data[s + 1]?.[idx];
              const formatted = s === 3 ? formatPercent(val as number) : formatWatts(val as number);
              html += `<div class="chart-tooltip-row"><span class="chart-tooltip-dot" style="background:${SERIES_COLORS[s]}"></span>${SERIES_LABELS[s]}: ${formatted}</div>`;
            }
            tooltip.innerHTML = html;
            tooltip.style.display = 'block';

            const left = u.cursor.left!;
            const top = u.cursor.top!;
            const plotLeft = (u.over as HTMLElement).offsetLeft;
            const plotTop = (u.over as HTMLElement).offsetTop;
            const tooltipW = tooltip.offsetWidth;
            const containerW = target.clientWidth;
            // Flip tooltip to left side if it would overflow
            const x = (plotLeft + left + tooltipW + 12 > containerW)
              ? plotLeft + left - tooltipW - 8
              : plotLeft + left + 8;
            tooltip.style.left = `${x}px`;
            tooltip.style.top = `${plotTop + top}px`;
          }],
        },
        series: [
          { label: 'Time' },
          {
            label: 'Solar', stroke: SERIES_COLORS[0], width: useBars ? 1 : 2, spanGaps: false,
            fill: useBars ? SERIES_COLORS[0] : 'rgba(245, 197, 66, 0.15)',
            ...(barBuilders && { paths: barBuilders[0] }),
          },
          {
            label: 'Home Load', stroke: SERIES_COLORS[1], width: useBars ? 1 : 2, spanGaps: false,
            ...(barBuilders && { fill: SERIES_COLORS[1], paths: barBuilders[1] }),
          },
          {
            label: 'Grid', stroke: SERIES_COLORS[2], width: useBars ? 1 : 2, spanGaps: false,
            fill: useBars
              ? SERIES_COLORS[2]
              : (u: uPlot) => {
                const canvas = u.ctx.canvas;
                const grad = u.ctx.createLinearGradient(0, 0, 0, canvas.height);
                grad.addColorStop(0, 'rgba(255, 87, 34, 0.25)');
                grad.addColorStop(1, 'rgba(255, 87, 34, 0)');
                return grad;
              },
            ...(barBuilders && { paths: barBuilders[2] }),
          },
          {
            label: 'Battery %', stroke: SERIES_COLORS[3], width: 2, spanGaps: false,
            scale: '%',
            fill: (u: uPlot) => {
              const canvas = u.ctx.canvas;
              const grad = u.ctx.createLinearGradient(0, 0, 0, canvas.height);
              grad.addColorStop(0, 'rgba(76, 175, 80, 0.25)');
              grad.addColorStop(1, 'rgba(76, 175, 80, 0)');
              return grad;
            },
          },
        ],
        scales: {
          '%': { auto: true, range: [0, 100] },
        },
        axes: [
          {
            stroke: '#a0aec0',
            grid: { stroke: 'rgba(255,255,255,0.1)' },
            ticks: { stroke: 'rgba(255,255,255,0.2)' },
            ...(useBars && {
              values: (_u: uPlot, splits: number[]) => formatAxisDates(splits),
            }),
          },
          {
            label: 'Power',
            stroke: '#a0aec0',
            grid: { stroke: 'rgba(255,255,255,0.1)' },
            ticks: { stroke: 'rgba(255,255,255,0.2)' },
            values: (_u: uPlot, splits: number[]) => splits.map(formatWatts),
          },
          {
            scale: '%',
            side: 1,
            label: 'Battery %',
            stroke: SERIES_COLORS[3],
            grid: { show: false },
            ticks: { stroke: 'rgba(76, 175, 80, 0.3)' },
            values: (_u: uPlot, splits: number[]) => splits.map((v) => `${v}%`),
          },
        ],
      };

      const instance = new uPlot(opts, chart.data, target);
      uplotRefs.current.push(instance);
    });
  }, [deviceCharts, loading, empty]);

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
      <div ref={chartContainerRef}>
        {!loading && !empty && deviceCharts.map((chart) => (
          <div key={chart.name} class="device-chart" aria-label={`${chart.name} energy chart`}>
            <h3>{chart.name}</h3>
            <div data-chart />
          </div>
        ))}
      </div>
    </div>
  );
}
