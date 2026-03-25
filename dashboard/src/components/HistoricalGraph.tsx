import { useEffect, useRef, useState } from 'preact/hooks';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { fetchRangeReadings, fetchGridPower } from '../api';
import type { RangeReadingsResponse, TimeRangeValue } from '../types';
import { withRetry } from '../utils/retry';

interface HistoricalGraphProps {
  timeRange: TimeRangeValue;
}

interface SeriesInput {
  values: Array<[number, string]>;
}

/**
 * Merge multiple time series onto a shared set of timestamps.
 * Missing timestamps in a series produce null (for broken-line gaps in uPlot).
 */
export function mergeTimeSeries(
  timestamps: number[],
  series: SeriesInput[],
): Array<Array<number | null>> {
  return series.map((s) => {
    const lookup = new Map<number, number>();
    for (const [ts, v] of s.values) {
      lookup.set(ts, parseFloat(v));
    }
    return timestamps.map((ts) => lookup.get(ts) ?? null);
  });
}

const METRICS = [
  'solar_instantaneous_generation_watts',
  'battery_power_watts',
  'home_load_power_watts',
] as const;

const SERIES_LABELS = ['Solar', 'Battery', 'Home Load', 'Grid'];
const SERIES_COLORS = ['#f5c542', '#4caf50', '#2196f3', '#ff5722'];

function getAggregationLabel(step: number): string | null {
  if (step <= 60) return null;
  if (step <= 3600) return 'hourly';
  if (step <= 86400) return 'daily';
  return 'monthly';
}

export function HistoricalGraph({ timeRange }: HistoricalGraphProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setEmpty(false);
      setError(null);
      setRetryAttempt(0);

      try {
        const [solarRes, batteryRes, homeLoadRes, gridRes] = await withRetry(
          () => Promise.all([
            fetchRangeReadings(METRICS[0], timeRange.start, timeRange.end, timeRange.step),
            fetchRangeReadings(METRICS[1], timeRange.start, timeRange.end, timeRange.step),
            fetchRangeReadings(METRICS[2], timeRange.start, timeRange.end, timeRange.step),
            fetchGridPower(timeRange.start, timeRange.end, timeRange.step),
          ]),
          { maxRetries: 10, onRetry: (n: number) => { if (!cancelled) setRetryAttempt(n); } },
        );

        if (cancelled) return;

      // Collect all unique timestamps across every series
      const tsSet = new Set<number>();
      const allResponses: RangeReadingsResponse[] = [solarRes, batteryRes, homeLoadRes, gridRes];
      for (const res of allResponses) {
        for (const s of res.series) {
          for (const pt of s.values) {
            tsSet.add(pt.timestamp);
          }
        }
      }

      const timestamps = Array.from(tsSet).sort((a, b) => a - b);

      if (timestamps.length === 0) {
        setEmpty(true);
        setLoading(false);
        return;
      }

      // Convert API responses to [timestamp, stringValue] tuple format for mergeTimeSeries
      const seriesInputs: SeriesInput[] = allResponses.map((res) => ({
        values: res.series.flatMap((s) =>
          s.values.map((pt): [number, string] => [pt.timestamp, String(pt.value)]),
        ),
      }));

      const merged = mergeTimeSeries(timestamps, seriesInputs);

      const data: uPlot.AlignedData = [
        timestamps,
        ...merged,
      ];

      const opts: uPlot.Options = {
        width: chartRef.current?.clientWidth || 800,
        height: 300,
        series: [
          { label: 'Time' },
          ...SERIES_LABELS.map((label, i) => ({
            label,
            stroke: SERIES_COLORS[i],
            width: 2,
            spanGaps: false,
          })),
        ],
        axes: [
          {
            stroke: '#a0aec0',
            grid: { stroke: 'rgba(255,255,255,0.1)' },
            ticks: { stroke: 'rgba(255,255,255,0.2)' },
          },
          {
            label: 'Watts',
            stroke: '#a0aec0',
            grid: { stroke: 'rgba(255,255,255,0.1)' },
            ticks: { stroke: 'rgba(255,255,255,0.2)' },
          },
        ],
      };

      if (chartRef.current) {
        uplotRef.current = new uPlot(opts, data, chartRef.current);
      }

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
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
    };
  }, [timeRange.start, timeRange.end, timeRange.step]);

  const aggregationLabel = getAggregationLabel(timeRange.step);

  return (
    <div class="historical-graph" aria-label="Historical energy chart" aria-busy={loading ? 'true' : undefined}>
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
      <div ref={chartRef} style={loading || empty ? { display: 'none' } : undefined} />
    </div>
  );
}
