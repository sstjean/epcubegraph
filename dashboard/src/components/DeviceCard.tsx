import { h } from 'preact';
import { formatWatts, formatPercent } from '../utils/formatting';
import { GaugeDial } from './GaugeDial';

export interface DeviceCardMetrics {
  solarWatts: number;
  batteryWatts: number;
  batteryPercent: number;
  gridWatts: number;
  homeLoadWatts: number;
}

/** Max values for gauge dial scaling (residential EP Cube system) */
const SOLAR_MAX_WATTS = 12000;
const BATTERY_POWER_MIN_WATTS = -20000;
const BATTERY_POWER_MAX_WATTS = 20000;
const HOME_LOAD_MAX_WATTS = 10000;
const GRID_MIN_WATTS = -20000;
const GRID_MAX_WATTS = 20000;
const BATTERY_SOC_MAX = 100;

interface DeviceCardProps {
  name: string;
  online: boolean;
  metrics: DeviceCardMetrics;
}

export function DeviceCard({ name, online, metrics }: DeviceCardProps) {
  const gridDirection = metrics.gridWatts >= 0 ? 'Import' : 'Export';

  return (
    <article class="device-card" aria-label={`Device ${name}`}>
      <header class="device-card-header">
        <h3>{name}</h3>
        <span
          aria-label={online ? 'Online' : 'Offline'}
          class={`badge ${online ? 'badge-online' : 'badge-offline'}`}
        >
          {online ? 'Online' : 'Offline'}
        </span>
      </header>
      <div class="gauge-grid">
        <GaugeDial
          value={metrics.solarWatts}
          max={SOLAR_MAX_WATTS}
          label="Solar"
          displayValue={formatWatts(metrics.solarWatts)}
          unit="generation"
          color="#f59e0b"
        />
        <GaugeDial
          value={metrics.batteryPercent}
          max={BATTERY_SOC_MAX}
          label="Battery SOC"
          displayValue={formatPercent(metrics.batteryPercent)}
          unit="charge"
          color="#22c55e"
        />
        <GaugeDial
          value={metrics.batteryWatts}
          min={BATTERY_POWER_MIN_WATTS}
          max={BATTERY_POWER_MAX_WATTS}
          label="Battery Power"
          displayValue={formatWatts(metrics.batteryWatts)}
          unit={metrics.batteryWatts >= 0 ? 'charging' : 'discharging'}
          color="#3b82f6"
        />
        <GaugeDial
          value={metrics.homeLoadWatts}
          max={HOME_LOAD_MAX_WATTS}
          label="Home Load"
          displayValue={formatWatts(metrics.homeLoadWatts)}
          unit="consumption"
          color="#a855f7"
        />
        <GaugeDial
          value={metrics.gridWatts}
          min={GRID_MIN_WATTS}
          max={GRID_MAX_WATTS}
          label={`Grid (${gridDirection})`}
          displayValue={formatWatts(Math.abs(metrics.gridWatts))}
          unit={gridDirection.toLowerCase()}
          color={metrics.gridWatts >= 0 ? '#ef4444' : '#10b981'}
        />
      </div>
    </article>
  );
}
