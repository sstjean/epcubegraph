import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { fetchDevices, fetchInstantQuery } from '../api';
import { DeviceCard } from './DeviceCard';
import type { DeviceCardMetrics } from './DeviceCard';
import type { Device, InstantQueryResponse } from '../types';
import { createPollingInterval, clearPollingInterval } from '../utils/polling';
import { formatRelativeTime } from '../utils/formatting';

export interface DeviceGroup {
  name: string;
  online: boolean;
  devices: Device[];
  metrics: DeviceCardMetrics;
}

/** Extract the base alias (e.g. "EP Cube v2") from a device's alias or id. */
function getGroupName(device: Device): string {
  if (device.alias) {
    return device.alias.replace(/\s*(Battery|Solar)$/i, '').trim();
  }
  // Fallback: format raw device id into readable name (epcube3483 → EP Cube 3483)
  const base = device.device.replace(/_(battery|solar)$/, '');
  const match = base.match(/^epcube(\d+)$/i);
  return match ? `EP Cube ${match[1]}` : base;
}

/** Find the metric value for a given device name from an instant query response. */
function getMetricForDevice(response: InstantQueryResponse, deviceName: string): number {
  const match = response.data?.result?.find((r) => r.metric.device === deviceName);
  return match ? parseFloat(match.value[1]) : 0;
}

export function CurrentReadings() {
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<number>(0);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = async () => {
    try {
      const [deviceList, batterySOC, batteryPower, solar, grid, homeLoad, batteryStored] = await Promise.all([
        fetchDevices(),
        fetchInstantQuery('epcube_battery_state_of_capacity_percent'),
        fetchInstantQuery('epcube_battery_power_watts'),
        fetchInstantQuery('epcube_solar_instantaneous_generation_watts'),
        fetchInstantQuery('epcube_grid_power_watts'),
        fetchInstantQuery('epcube_home_load_power_watts'),
        fetchInstantQuery('epcube_battery_stored_kwh'),
      ]);

      // Group devices by base alias
      const groupMap = new Map<string, Device[]>();
      for (const device of deviceList.devices) {
        const groupName = getGroupName(device);
        const existing = groupMap.get(groupName) ?? [];
        existing.push(device);
        groupMap.set(groupName, existing);
      }

      const deviceGroups: DeviceGroup[] = Array.from(groupMap.entries()).map(
        ([name, devices]) => {
          const batteryDevice = devices.find((d) => d.class === 'storage_battery');
          const solarDevice = devices.find((d) => d.class === 'home_solar');
          const online = devices.some((d) => d.online);

          return {
            name,
            online,
            devices,
            metrics: {
              batteryPercent: batteryDevice
                ? getMetricForDevice(batterySOC, batteryDevice.device)
                : 0,
              batteryStoredKwh: batteryDevice
                ? getMetricForDevice(batteryStored, batteryDevice.device)
                : 0,
              batteryWatts: batteryDevice
                ? getMetricForDevice(batteryPower, batteryDevice.device)
                : 0,
              solarWatts: solarDevice
                ? getMetricForDevice(solar, solarDevice.device)
                : 0,
              homeLoadWatts: batteryDevice
                ? getMetricForDevice(homeLoad, batteryDevice.device)
                : 0,
              gridWatts: batteryDevice
                ? -getMetricForDevice(grid, batteryDevice.device)
                : 0,
            },
          };
        },
      );

      setGroups(deviceGroups);
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
      {error && <p role="alert">Error: {error}</p>}
      {loading && !error && <p class="status-message">Loading devices…</p>}
      {!loading && !error && groups.length === 0 && <p class="status-message">No devices found.</p>}
      <div class="device-cards">
        {groups.map((group) => (
          <DeviceCard key={group.name} name={group.name} online={group.online} metrics={group.metrics} />
        ))}
      </div>
      {lastRefreshed > 0 && (
        <p class="last-updated">Last updated: {formatRelativeTime(lastRefreshed)}</p>
      )}
    </section>
  );
}
