import { useEffect, useState } from 'preact/hooks';
import { fetchGridPower } from '../api';
import { computeGridEnergy } from '../utils/gridEnergy';
import { formatKwh } from '../utils/formatting';
import { withRetry } from '../utils/retry';
import { errorMessage } from '../utils/errors';
import type { TimeRangeValue } from '../types';
import type { GridEnergySummary as GridEnergySummaryData } from '../utils/gridEnergy';

interface GridEnergySummaryProps {
  timeRange: TimeRangeValue;
}

export function GridEnergySummary({ timeRange }: GridEnergySummaryProps) {
  const [data, setData] = useState<GridEnergySummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        // Always fetch at hourly resolution (3600s) to preserve the
        // bidirectional import/export split that coarser buckets collapse.
        const ENERGY_STEP = 3600;
        const gridRes = await withRetry(
          () => fetchGridPower(timeRange.start, timeRange.end, ENERGY_STEP),
          { maxRetries: 3 },
        );
        if (cancelled) return;

        const summary = computeGridEnergy(gridRes, ENERGY_STEP);
        setData(summary);
      } catch (err) {
        if (!cancelled) {
          setError(errorMessage(err, 'Failed to load grid energy data'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [timeRange.start, timeRange.end, timeRange.step]);

  if (error) return <p role="alert" class="grid-energy-error">Error: {error}</p>;
  if (loading || !data) return <p class="grid-energy-loading">Loading grid energy…</p>;
  if (!data.hasData) return <p class="grid-energy-empty">No Grid Data</p>;

  const maxBar = Math.max(data.importKwh, data.exportKwh, Math.abs(data.netKwh), 0.01);
  const netIsPositive = data.netKwh >= 0;

  return (
    <div class="grid-energy-summary" aria-label="Grid energy summary">
      <h3>Grid Energy</h3>
      <div class="grid-energy-bars">
        <BarRow
          label="Grid Import"
          value={data.importKwh}
          maxValue={maxBar}
          colorClass="bar-import"
        />
        <BarRow
          label="Solar Export"
          value={data.exportKwh}
          maxValue={maxBar}
          colorClass="bar-export"
        />
        <BarRow
          label="Net"
          value={data.netKwh}
          maxValue={maxBar}
          minValue={-maxBar}
          colorClass={netIsPositive ? 'bar-net-positive' : 'bar-net-negative'}
        />
      </div>
    </div>
  );
}

interface BarRowProps {
  label: string;
  value: number;
  maxValue: number;
  colorClass: string;
  minValue?: number;
}

function BarRow({ label, value, maxValue, colorClass, minValue = 0 }: BarRowProps) {
  const widthPercent = (Math.abs(value) / maxValue) * 100;

  return (
    <div class="bar-row">
      <span class="bar-label">{label}</span>
      <div class="bar-track">
        <div
          class={`bar-fill ${colorClass}`}
          style={{ width: `${widthPercent}%` }}
          role="meter"
          aria-label={label}
          aria-valuenow={value}
          aria-valuemin={minValue}
          aria-valuemax={maxValue}
        />
      </div>
      <span class="bar-value">{formatKwh(value)}</span>
    </div>
  );
}
