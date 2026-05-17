import { useState, useEffect, useRef } from 'preact/hooks';
import { fetchDevices, fetchDevicesByStatus, fetchCurrentReadings } from '../api';
import { DeviceCard } from './DeviceCard';
import { EnergyFlowDiagram } from './EnergyFlowDiagram';
import type { DeviceCardMetrics } from './DeviceCard';
import type { Device, CurrentReadingsResponse } from '../types';
import { createPollingInterval, clearPollingInterval } from '../utils/polling';
import { formatRelativeTime } from '../utils/formatting';
import { withRetry } from '../utils/retry';
import { groupDevicesByAlias, getDisplayName, getBaseDeviceId, getDisplayNameFromMeta } from '../utils/devices';
import { errorMessage } from '../utils/errors';
import { useVueData } from '../hooks/useVueData';
import { useDeviceDiscoveryContext } from '../hooks/useDeviceDiscovery';

export interface DeviceGroup {
  name: string;
  baseDeviceId: string;
  online: boolean;
  devices: Device[];
  metrics: DeviceCardMetrics;
  pendingMergeNote?: string;
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

    // When the group is offline, the /readings/current endpoint still returns
    // the last-known values from when it WAS online. Those values are stale
    // and would be misleading to display, so zero everything for offline groups.
    const groupMetrics: DeviceCardMetrics = online
      ? {
          batteryPercent: batteryDevice ? getMetricForDevice(metrics.batterySOC, batteryDevice.device) : 0,
          batteryStoredKwh: batteryDevice ? getMetricForDevice(metrics.batteryStored, batteryDevice.device) : 0,
          batteryWatts: batteryDevice ? getMetricForDevice(metrics.batteryPower, batteryDevice.device) : 0,
          solarWatts: solarDevice ? getMetricForDevice(metrics.solar, solarDevice.device) : 0,
          homeLoadWatts: batteryDevice ? getMetricForDevice(metrics.homeLoad, batteryDevice.device) : 0,
          gridWatts: batteryDevice ? getMetricForDevice(metrics.grid, batteryDevice.device) : 0,
        }
      : {
          batteryPercent: 0,
          batteryStoredKwh: 0,
          batteryWatts: 0,
          solarWatts: 0,
          homeLoadWatts: 0,
          gridWatts: 0,
        };

    return {
      name,
      baseDeviceId,
      online,
      devices: devs,
      metrics: groupMetrics,
    };
  });
}

export function CurrentReadings() {
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [removedGroups, setRemovedGroups] = useState<DeviceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<number>(0);
  const [view, setView] = useState<'gauges' | 'flow'>('flow');
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [showRemoved, setShowRemoved] = useState(() => {
    const stored = localStorage.getItem('showRemovedDevices');
    return stored === null ? true : stored === 'true';
  });
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryingRef = useRef(false);
  const { vueCurrentReadings, vueDeviceMapping, vueDevices, vueError, hierarchyEntries } = useVueData();
  const { pending: pendingReplacements } = useDeviceDiscoveryContext();

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

      // Fetch removed devices separately (non-blocking)
      try {
        const removedList = await fetchDevicesByStatus('removed');
        const removedDeviceGroups = buildDeviceGroups(removedList.devices, {
          batterySOC, batteryPower, batteryStored, solar, grid, homeLoad,
        });
        setRemovedGroups(removedDeviceGroups);
      } catch {
        setRemovedGroups([]);
      }

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

  const handleToggleRemoved = () => {
    const next = !showRemoved;
    setShowRemoved(next);
    localStorage.setItem('showRemovedDevices', String(next));
  };

  // Annotate device groups with the "pending merge" note ONLY when both the
  // old and new devices would resolve to the same display name on the card
  // (otherwise the user can tell them apart from the title alone).
  const annotatedGroups: DeviceGroup[] = groups.map((group) => {
    const match = pendingReplacements.find(
      (p) => `epcube${p.new_device_id}` === group.baseDeviceId,
    );
    if (!match) return group;
    const oldTitle = getDisplayNameFromMeta(match.old_product_code, match.old_alias);
    const newTitle = getDisplayNameFromMeta(match.new_product_code, match.new_alias);
    if (!oldTitle || !newTitle || oldTitle !== newTitle) return group;
    return {
      ...group,
      pendingMergeNote: 'These are the new device readings.  The old device is offline.',
    };
  });

  // Hide removed-device cards that have a pending replacement: the user is being
  // asked to decide its fate via the banner, and showing a duplicate-titled card
  // alongside the active replacement is confusing. Once the pending replacement
  // is dismissed (kept) or merged (deleted), the card visibility updates.
  const pendingOldDeviceIds = new Set(
    pendingReplacements.map((p) => `epcube${p.old_device_id}`),
  );
  const visibleRemovedGroups = removedGroups.filter(
    (group) => !pendingOldDeviceIds.has(group.baseDeviceId),
  );

  // Disambiguate duplicate display names across all visible groups (active + removed)
  // by appending the device ID. Necessary because devices can share product_code
  // (e.g. two "EP Cube v2" units) and the same alias.
  const nameCounts = new Map<string, number>();
  for (const g of annotatedGroups) nameCounts.set(g.name, (nameCounts.get(g.name) ?? 0) + 1);
  for (const g of visibleRemovedGroups) nameCounts.set(g.name, (nameCounts.get(g.name) ?? 0) + 1);
  const disambiguate = (g: DeviceGroup): DeviceGroup => {
    if ((nameCounts.get(g.name) ?? 0) <= 1) return g;
    const id = g.baseDeviceId.replace(/^epcube/, '');
    return { ...g, name: `${g.name} (${id})` };
  };
  const displayedActiveGroups = annotatedGroups.map(disambiguate);
  const displayedRemovedGroups = visibleRemovedGroups.map(disambiguate);

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
      {visibleRemovedGroups.length > 0 && (
        <label class="removed-toggle">
          <input type="checkbox" checked={showRemoved} onChange={handleToggleRemoved} aria-label="Show removed devices" />
          Show removed devices
        </label>
      )}
      {retryAttempt > 0 && !error && (
        <p role="status" class="retry-notice">Reconnecting… attempt {retryAttempt} of 10</p>
      )}
      {loading && !error && retryAttempt === 0 && <p class="status-message">Loading devices…</p>}
      {!loading && !error && groups.length === 0 && <p class="status-message">No devices found.</p>}
      {view === 'flow' && groups.length > 0 && (
        <EnergyFlowDiagram groups={displayedActiveGroups} vueCurrentReadings={vueCurrentReadings} vueDeviceMapping={vueDeviceMapping} vueDevices={vueDevices} hierarchyEntries={hierarchyEntries} />
      )}
      {view === 'gauges' && (
        <div class="device-cards">
          {displayedActiveGroups.map((group) => (
            <DeviceCard key={group.name} name={group.name} online={group.online} metrics={group.metrics} pendingMergeNote={group.pendingMergeNote} />
          ))}
          {showRemoved && displayedRemovedGroups.map((group) => (
            <div key={`removed-${group.name}`} class="device-removed">
              <DeviceCard name={group.name} online={group.online} metrics={group.metrics} />
            </div>
          ))}
        </div>
      )}
      {view === 'flow' && showRemoved && displayedRemovedGroups.length > 0 && (
        <EnergyFlowDiagram groups={displayedRemovedGroups} vueCurrentReadings={vueCurrentReadings} vueDeviceMapping={vueDeviceMapping} vueDevices={vueDevices} hierarchyEntries={hierarchyEntries} removed />
      )}
      {lastRefreshed > 0 && (
        <p class="last-updated">Last updated: <RelativeTime epoch={lastRefreshed} /></p>
      )}
    </section>
  );
}
