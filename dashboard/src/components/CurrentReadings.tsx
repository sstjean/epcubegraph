import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { fetchDevices, fetchInstantQuery } from '../api';
import { DeviceCard } from './DeviceCard';
import type { DeviceCardMetrics } from './DeviceCard';
import type { Device } from '../types';
import { createPollingInterval, clearPollingInterval } from '../utils/polling';
import { formatRelativeTime } from '../utils/formatting';

interface DeviceWithMetrics {
  device: Device;
  metrics: DeviceCardMetrics;
}

export function CurrentReadings() {
  const [devices, setDevices] = useState<DeviceWithMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<number>(0);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = async () => {
    try {
      const deviceList = await fetchDevices();
      const devicesWithMetrics: DeviceWithMetrics[] = await Promise.all(
        deviceList.devices.map(async (device) => {
          const queries = [
            'epcube_battery_state_of_capacity_percent',
            'epcube_battery_power_watts',
            'epcube_solar_instantaneous_generation_watts',
            'epcube_grid_power_watts',
          ];
          const results = await Promise.all(queries.map((q) => fetchInstantQuery(q)));
          const getValue = (index: number): number => {
            const result = results[index]?.data?.result?.[0];
            return result ? parseFloat(result.value[1]) : 0;
          };
          return {
            device,
            metrics: {
              batteryPercent: getValue(0),
              batteryWatts: getValue(1),
              solarWatts: getValue(2),
              gridWatts: getValue(3),
            },
          };
        })
      );
      setDevices(devicesWithMetrics);
      setLastRefreshed(Date.now() / 1000);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    pollingRef.current = createPollingInterval(loadData);
    return () => {
      if (pollingRef.current) clearPollingInterval(pollingRef.current);
    };
  }, []);

  return (
    <section aria-busy={loading ? 'true' : undefined}>
      <h2>Current Readings</h2>
      {error && <p role="alert" style={{ color: '#dc2626' }}>Error: {error}</p>}
      {loading && !error && <p>Loading devices…</p>}
      {!loading && !error && devices.length === 0 && <p>No devices found.</p>}
      {devices.map(({ device, metrics }) => (
        <DeviceCard key={device.device} device={device} metrics={metrics} />
      ))}
      {lastRefreshed > 0 && (
        <p>Last updated: {formatRelativeTime(lastRefreshed)}</p>
      )}
    </section>
  );
}
