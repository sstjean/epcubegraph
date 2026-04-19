import { useState, useEffect, useRef } from 'preact/hooks';
import { fetchDevices, fetchCurrentReadings } from '../api';
import { DeviceCard } from './DeviceCard';
import { EnergyFlowDiagram } from './EnergyFlowDiagram';
import type { DeviceCardMetrics } from './DeviceCard';
import type { Device, CurrentReadingsResponse } from '../types';
import { createPollingInterval, clearPollingInterval } from '../utils/polling';
import { formatRelativeTime } from '../utils/formatting';
import { withRetry } from '../utils/retry';
import { groupDevicesByAlias, getDisplayName, getBaseDeviceId } from '../utils/devices';
import { errorMessage } from '../utils/errors';
import { useVueData } from '../hooks/useVueData';

export interface DeviceGroup {
  name: string;
  baseDeviceId: string;
  online: boolean;
  devices: Device[];
  metrics: DeviceCardMetrics;
}

/** Self-contained component that ticks every second to update relative time. */
function RelativeTime({ epoch }: { epoch: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return <>{formatRelativeTime(epoch)}</>;
}



/** Find the metric value for a given device name from a current readings response. */
function getMetricForDevice(response: CurrentReadingsResponse, deviceName: string): number {
  const match = response.readings?.find((r) => r.device_id === deviceName);
  return match ? match.value : 0;
}

export interface MetricResponses {
  batterySOC: CurrentReadingsResponse;
  batteryPower: CurrentReadingsResponse;
  batteryStored: CurrentReadingsResponse;
  solar: CurrentReadingsResponse;
  grid: CurrentReadingsResponse;
  homeLoad: CurrentReadingsResponse;
}

export function buildDeviceGroups(devices: Device[], metrics: MetricResponses): DeviceGroup[] {
  const groupMap = groupDevicesByAlias(devices);
  return Array.from(groupMap.entries()).map(([_key, devs]) => {
    const name = getDisplayName(devs);
    const baseDeviceId = getBaseDeviceId(devs[0]);
    const batteryDevice = devs.find((d) => d.class === 'storage_battery');
    const solarDevice = devs.find((d) => d.class === 'home_solar');
    const online = devs.some((d) => d.online);

    return {
      name,
      baseDeviceId,
      online,
      devices: devs,
      metrics: {
        batteryPercent: batteryDevice ? getMetricForDevice(metrics.batterySOC, batteryDevice.device) : 0,
        batteryStoredKwh: batteryDevice ? getMetricForDevice(metrics.batteryStored, batteryDevice.device) : 0,
        batteryWatts: batteryDevice ? getMetricForDevice(metrics.batteryPower, batteryDevice.device) : 0,
        solarWatts: solarDevice ? getMetricForDevice(metrics.solar, solarDevice.device) : 0,
        homeLoadWatts: batteryDevice ? getMetricForDevice(metrics.homeLoad, batteryDevice.device) : 0,
        gridWatts: batteryDevice ? getMetricForDevice(metrics.grid, batteryDevice.device) : 0,
      },
    };
  });
}

export function CurrentReadings() {
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<number>(0);
  const [view, setView] = useState<'gauges' | 'flow'>('flow');
  const [retryAttempt, setRetryAttempt] = useState(0);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryingRef = useRef(false);
  const { vueCurrentReadings, vueDeviceMapping, vueDevices, vueError, hierarchyEntries } = useVueData();

  const loadData = async () => {
    if (retryingRef.current) return;
    retryingRef.current = true;
    setRetryAttempt(0);

    try {
      const [deviceList, batterySOC, batteryPower, solar, grid, homeLoad, batteryStored] = await withRetry(
        () => Promise.all([
          fetchDevices(),
          fetchCurrentReadings('battery_state_of_capacity_percent'),
          fetchCurrentReadings('battery_power_watts'),
          fetchCurrentReadings('solar_instantaneous_generation_watts'),
          fetchCurrentReadings('grid_power_watts'),
          fetchCurrentReadings('home_load_power_watts'),
          fetchCurrentReadings('battery_stored_kwh'),
        ]),
        { maxRetries: 10, onRetry: setRetryAttempt },
      );

      // Group devices by base alias
      const deviceGroups = buildDeviceGroups(deviceList.devices, {
        batterySOC, batteryPower, batteryStored, solar, grid, homeLoad,
      });

      setGroups(deviceGroups);
      setLastRefreshed(Date.now() / 1000);
      setError(null);
      setRetryAttempt(0);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load data'));
      setRetryAttempt(0);
    } finally {
      setLoading(false);
      retryingRef.current = false;
    }
  };

  useEffect(() => {
    loadData();
    pollingRef.current = createPollingInterval(loadData);
    return () => clearPollingInterval(pollingRef.current!);
  }, []);

  return (
    <section aria-busy={loading ? 'true' : undefined}>
      <div class="device-card-header">
        <h2>Current Readings</h2>
        <div class="view-toggle" role="group" aria-label="View mode">
          <button
            type="button"
            class={view === 'flow' ? 'active' : ''}
            aria-pressed={view === 'flow'}
            onClick={() => setView('flow')}
          >
            Flow
          </button>
          <button
            type="button"
            class={view === 'gauges' ? 'active' : ''}
            aria-pressed={view === 'gauges'}
            onClick={() => setView('gauges')}
          >
            Gauges
          </button>
        </div>
      </div>
      {error && <p role="alert">Error: {error}</p>}
      {vueError && <p role="status" class="vue-error-notice">Vue circuits: {vueError}</p>}
      {retryAttempt > 0 && !error && (
        <p role="status" class="retry-notice">Reconnecting… attempt {retryAttempt} of 10</p>
      )}
      {loading && !error && retryAttempt === 0 && <p class="status-message">Loading devices…</p>}
      {!loading && !error && groups.length === 0 && <p class="status-message">No devices found.</p>}
      {view === 'flow' && groups.length > 0 && (
        <EnergyFlowDiagram groups={groups} vueCurrentReadings={vueCurrentReadings} vueDeviceMapping={vueDeviceMapping} vueDevices={vueDevices} hierarchyEntries={hierarchyEntries} />
      )}
      {view === 'gauges' && (
        <div class="device-cards">
          {groups.map((group) => (
            <DeviceCard key={group.name} name={group.name} online={group.online} metrics={group.metrics} />
          ))}
        </div>
      )}
      {lastRefreshed > 0 && (
        <p class="last-updated">Last updated: <RelativeTime epoch={lastRefreshed} /></p>
      )}
    </section>
  );
}
