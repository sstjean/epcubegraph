import { useState, useEffect, useRef } from 'preact/hooks';
import { fetchVueBulkCurrentReadings, fetchVueDailyReadings, fetchSettings, fetchHierarchy, fetchVueDevices } from '../api';
import { sortByCircuitNumber, orderPanels } from '../utils/circuits';
import type { PanelInfo } from '../utils/circuits';
import { formatWatts, formatKwh } from '../utils/formatting';
import { errorMessage, toTrackedError } from '../utils/errors';
import { isValidVueDeviceMapping } from '../hooks/useVueData';
import type {
  VueBulkCurrentReadingsResponse,
  VueBulkDailyReadingsResponse,
  VueDeviceMapping,
  VueCurrentChannel,
  VueDailyChannel,
  VueDeviceInfo,
  PanelHierarchyEntry,
} from '../types';

const MAINS_CHANNEL = '1,2,3';
const BALANCE_CHANNEL = 'Balance';

interface PanelData {
  alias: string;
  device_gid: number;
  parentGid?: number;
  channels: VueCurrentChannel[];
  dailyChannels: VueDailyChannel[];
  mainsWatts: number;
  dedupWatts: number;
  dailyKwh: number;
}

function buildPanelData(
  orderedPanels: PanelInfo[],
  currentReadings: VueBulkCurrentReadingsResponse,
  dailyReadings: VueBulkDailyReadingsResponse,
  hierarchyEntries: PanelHierarchyEntry[],
): PanelData[] {
  const childGidsOf = new Map<number, Set<number>>();
  for (const h of hierarchyEntries) {
    const children = childGidsOf.get(h.parent_device_gid) ?? new Set();
    children.add(h.child_device_gid);
    childGidsOf.set(h.parent_device_gid, children);
  }

  return orderedPanels.map((panel) => {
    const device = currentReadings.devices.find((d) => d.device_gid === panel.device_gid);
    const dailyDevice = dailyReadings.devices.find((d) => d.device_gid === panel.device_gid);
    const channels = device ? [...device.channels].sort(sortByCircuitNumber) : [];
    const dailyChannels = dailyDevice?.channels ?? [];

    const mains = channels.find((c) => c.channel_num === MAINS_CHANNEL);
    const mainsWatts = mains?.value ?? 0;

    let dedupWatts = mainsWatts;
    let childMainsTotal = 0;
    let childMainsDailyTotal = 0;
    const childGids = childGidsOf.get(panel.device_gid);
    if (childGids) {
      for (const childGid of childGids) {
        const childDevice = currentReadings.devices.find((d) => d.device_gid === childGid);
        const childMains = childDevice?.channels.find((c) => c.channel_num === MAINS_CHANNEL);
        if (childMains) {
          dedupWatts -= childMains.value;
          childMainsTotal += childMains.value;
        }
        const childDailyDevice = dailyReadings.devices.find((d) => d.device_gid === childGid);
        const childDailyMains = childDailyDevice?.channels.find((c) => c.channel_num === MAINS_CHANNEL);
        if (childDailyMains) {
          childMainsDailyTotal += childDailyMains.kwh;
        }
      }
    }

    // Dedup Balance: subtract children's mains so Unmonitored reflects only this panel's unmonitored load
    const dedupChannels = channels.map((ch) => {
      if (ch.channel_num === BALANCE_CHANNEL && childMainsTotal > 0) {
        return { ...ch, value: Math.max(0, ch.value - childMainsTotal) };
      }
      return ch;
    });

    // Dedup daily Balance kWh the same way
    const dedupDailyChannels = dailyChannels.map((ch) => {
      if (ch.channel_num === BALANCE_CHANNEL && childMainsDailyTotal > 0) {
        return { ...ch, kwh: Math.max(0, ch.kwh - childMainsDailyTotal) };
      }
      return ch;
    });

    const mainsDailyKwh = dailyChannels.find((c) => c.channel_num === MAINS_CHANNEL)?.kwh ?? 0;
    const dedupDailyKwh = Math.max(0, mainsDailyKwh - childMainsDailyTotal);

    return {
      alias: panel.alias,
      device_gid: panel.device_gid,
      parentGid: panel.parentGid,
      channels: dedupChannels,
      dailyChannels: dedupDailyChannels,
      mainsWatts,
      dedupWatts,
      dailyKwh: childGids ? dedupDailyKwh : mainsDailyKwh,
    };
  });
}

function circuitDisplayName(channelNum: string, displayName: string): string {
  if (channelNum === BALANCE_CHANNEL) return 'Unmonitored';
  return displayName;
}

const POLL_INTERVAL_MS = 1000;
const ERROR_THRESHOLD = Math.max(2, Math.ceil(10_000 / POLL_INTERVAL_MS));

export function resolvePanelsFromMapping(
  mapping: VueDeviceMapping,
  hierarchyEntries: PanelHierarchyEntry[],
  vueDevices: VueDeviceInfo[],
): PanelInfo[] {
  const allPanels: PanelInfo[] = [];
  for (const panel of Object.values(mapping)) {
    allPanels.push({ device_gid: panel.gid, alias: panel.alias });
  }

  const mappedGids = new Set(allPanels.map((p) => p.device_gid));
  for (const h of hierarchyEntries) {
    if (mappedGids.has(h.parent_device_gid) && !mappedGids.has(h.child_device_gid)) {
      const vueDevice = vueDevices.find((d: VueDeviceInfo) => d.device_gid === h.child_device_gid);
      allPanels.push({
        device_gid: h.child_device_gid,
        alias: vueDevice?.display_name ?? String(h.child_device_gid),
      });
    }
  }

  return allPanels;
}

export function CircuitsPage() {
  const [panels, setPanels] = useState<PanelData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noMapping, setNoMapping] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const consecutiveErrorsRef = useRef(0);
  const hasLoadedRef = useRef(false);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const loadData = async () => {
    try {
      const [settingsResp, hierarchyResp, currentResp, dailyResp, vueDevicesResp] = await Promise.all([
        fetchSettings(),
        fetchHierarchy().catch(() => ({ entries: [] as PanelHierarchyEntry[] })),
        fetchVueBulkCurrentReadings(),
        fetchVueDailyReadings(new Date().toISOString().slice(0, 10)),
        fetchVueDevices().catch(() => ({ devices: [] as VueDeviceInfo[] })),
      ]);

      if (!mountedRef.current) return;

      const mappingSetting = settingsResp.settings.find((s) => s.key === 'vue_device_mapping');
      if (!mappingSetting) {
        setNoMapping(true);
        setLoading(false);
        return;
      }

      let mapping: VueDeviceMapping;
      try {
        const parsed: unknown = JSON.parse(mappingSetting.value);
        if (!isValidVueDeviceMapping(parsed)) {
          toTrackedError(new Error('vue_device_mapping uses invalid or legacy array format'), 'Invalid vue_device_mapping format');
          setNoMapping(true);
          setLoading(false);
          return;
        }
        mapping = parsed;
      } catch (err) {
        toTrackedError(err, 'Malformed vue_device_mapping JSON');
        setNoMapping(true);
        setLoading(false);
        return;
      }

      const allPanels = resolvePanelsFromMapping(mapping, hierarchyResp.entries, vueDevicesResp.devices);

      const ordered = orderPanels(allPanels, hierarchyResp.entries);
      const panelData = buildPanelData(ordered, currentResp, dailyResp, hierarchyResp.entries);

      setPanels(panelData);
      setError(null);
      setNoMapping(false);
      setLoading(false);
      consecutiveErrorsRef.current = 0;
      hasLoadedRef.current = true;
    } catch (err) {
      if (!mountedRef.current) return;
      consecutiveErrorsRef.current += 1;
      const msg = errorMessage(err, 'Vue data is not yet available');
      if (!hasLoadedRef.current || consecutiveErrorsRef.current >= ERROR_THRESHOLD) {
        setError(msg);
        setPanels([]);
      }
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    pollingRef.current = setInterval(loadData, POLL_INTERVAL_MS);
    return () => clearInterval(pollingRef.current!);
  }, []);

  if (loading) return <section><h2>Circuits</h2><p>Loading...</p></section>;
  if (error && panels.length === 0) return <section><h2>Circuits</h2><p role="alert">{error}</p></section>;
  if (noMapping) return <section><h2>Circuits</h2><p>Configure Vue device mapping in Settings to see circuits.</p></section>;

  return (
    <section>
      <h2>Circuits</h2>
      {panels.map((panel) => {
        const hasChildren = panels.some((p) => p.parentGid === panel.device_gid);
        return (
          <div key={panel.device_gid} class={`panel-section${panel.parentGid ? ' panel-child' : ''}`}>
            <div class="panel-header">
              <span class="panel-name">{panel.alias}</span>
              <span class="panel-total">
                {formatWatts(hasChildren ? panel.dedupWatts : panel.mainsWatts)}
              </span>
              <span class="panel-daily">{formatKwh(panel.dailyKwh)}</span>
            </div>
            <div class="circuit-col-headers">
              <span class="circuit-col-label">Circuit</span>
              <span class="circuit-col-label-right">Now</span>
              <span class="circuit-col-label-right">Today</span>
            </div>
            {panel.channels
              .filter((ch) => ch.channel_num !== MAINS_CHANNEL)
              .sort((a, b) => {
                const balanceOrder = (ch: VueCurrentChannel) => ch.channel_num === BALANCE_CHANNEL ? 1 : 0;
                const diff = balanceOrder(a) - balanceOrder(b);
                if (diff !== 0) return diff;
                return circuitDisplayName(a.channel_num, a.display_name)
                  .localeCompare(circuitDisplayName(b.channel_num, b.display_name));
              })
              .map((ch) => {
              const daily = panel.dailyChannels.find((d) => d.channel_num === ch.channel_num);
              return (
                <div
                  key={ch.channel_num}
                  class={`circuit-row${ch.value === 0 ? ' circuit-row-zero' : ''}`}
                >
                  <span class="circuit-row-name">{circuitDisplayName(ch.channel_num, ch.display_name)}</span>
                  <span class="circuit-row-watts">{formatWatts(ch.value)}</span>
                  <span class="circuit-row-kwh">{formatKwh(daily?.kwh ?? 0)}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}
