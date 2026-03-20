import { h } from 'preact';
import type { Device } from '../types';
import { formatWatts, formatPercent } from '../utils/formatting';
import { GaugeDial } from './GaugeDial';

export interface DeviceCardMetrics {
  solarWatts: number;
  batteryWatts: number;
  batteryPercent: number;
  gridWatts: number;
}

/** Max values for gauge dial scaling (residential EP Cube system) */
const SOLAR_MAX_WATTS = 12000;
const BATTERY_MAX_WATTS = 5000;
const GRID_MAX_WATTS = 10000;
const BATTERY_SOC_MAX = 100;

interface DeviceCardProps {
  device: Device;
  metrics: DeviceCardMetrics;
}

export function DeviceCard({ device, metrics }: DeviceCardProps) {
  const gridDirection = metrics.gridWatts >= 0 ? 'Import' : 'Export';

  return (
    <article aria-label={`Device ${device.device}`}>
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <h3>{device.device}</h3>
        <span
          aria-label={device.online ? 'Online' : 'Offline'}
          style={{
            display: 'inline-block',
            padding: '0.125rem 0.5rem',
            borderRadius: '9999px',
            fontSize: '0.75rem',
            fontWeight: 600,
            color: '#fff',
            backgroundColor: device.online ? '#16a34a' : '#dc2626',
          }}
        >
          {device.online ? 'Online' : 'Offline'}
        </span>
      </header>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'center', padding: '0.5rem 0' }}>
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
          max={BATTERY_MAX_WATTS}
          label="Battery Power"
          displayValue={formatWatts(metrics.batteryWatts)}
          unit={metrics.batteryWatts >= 0 ? 'charging' : 'discharging'}
          color="#3b82f6"
        />
        <GaugeDial
          value={metrics.gridWatts}
          max={GRID_MAX_WATTS}
          label={`Grid (${gridDirection})`}
          displayValue={formatWatts(metrics.gridWatts)}
          unit={gridDirection.toLowerCase()}
          color={metrics.gridWatts >= 0 ? '#ef4444' : '#10b981'}
        />
      </div>
      {device.manufacturer && <p>Manufacturer: {device.manufacturer}</p>}
    </article>
  );
}
