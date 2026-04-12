import { useState, useEffect, useRef } from 'preact/hooks';
import { fetchVueBulkCurrentReadings, fetchVueDailyReadings, fetchSettings, fetchHierarchy } from '../api';
import { sortByCircuitNumber, orderPanels } from '../utils/circuits';
import type { PanelInfo } from '../utils/circuits';
import { formatWatts, formatKwh } from '../utils/formatting';
import { errorMessage, toTrackedError } from '../utils/errors';
import type {
  VueBulkCurrentReadingsResponse,
  VueBulkDailyReadingsResponse,
  VueDeviceMapping,
  VueCurrentChannel,
  VueDailyChannel,
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
    const childGids = childGidsOf.get(panel.device_gid);
    if (childGids) {
      for (const childGid of childGids) {
        const childDevice = currentReadings.devices.find((d) => d.device_gid === childGid);
        const childMains = childDevice?.channels.find((c) => c.channel_num === MAINS_CHANNEL);
        if (childMains) {
          dedupWatts -= childMains.value;
          childMainsTotal += childMains.value;
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

    const mainsDailyKwh = dailyChannels.find((c) => c.channel_num === MAINS_CHANNEL)?.kwh ?? 0;

    return {
      alias: panel.alias,
      device_gid: panel.device_gid,
      parentGid: panel.parentGid,
      channels: dedupChannels,
      dailyChannels,
      mainsWatts,
      dedupWatts,
      dailyKwh: mainsDailyKwh,
    };
  });
}

function circuitDisplayName(channelNum: string, displayName: string): string {
  if (channelNum === BALANCE_CHANNEL) return 'Unmonitored';
  return displayName;
}

export function CircuitsPage() {
  const [panels, setPanels] = useState<PanelData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noMapping, setNoMapping] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const loadData = async () => {
    try {
      const [settingsResp, hierarchyResp, currentResp, dailyResp] = await Promise.all([
        fetchSettings(),
        fetchHierarchy().catch(() => ({ entries: [] as PanelHierarchyEntry[] })),
        fetchVueBulkCurrentReadings(),
        fetchVueDailyReadings(new Date().toISOString().slice(0, 10)),
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
        mapping = JSON.parse(mappingSetting.value) as VueDeviceMapping;
      } catch (err) {
        toTrackedError(err, 'Malformed vue_device_mapping JSON');
        setNoMapping(true);
        setLoading(false);
        return;
      }

      const allPanels: PanelInfo[] = [];
      for (const panels of Object.values(mapping)) {
        for (const p of panels) {
          allPanels.push({ device_gid: p.gid, alias: p.alias });
        }
      }

      const ordered = orderPanels(allPanels, hierarchyResp.entries);
      const panelData = buildPanelData(ordered, currentResp, dailyResp, hierarchyResp.entries);

      setPanels(panelData);
      setError(null);
      setNoMapping(false);
      setLoading(false);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(errorMessage(err, 'Vue data is not yet available'));
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    pollingRef.current = setInterval(loadData, 1000);
    return () => clearInterval(pollingRef.current!);
  }, []);

  if (loading) return <section><h2>Circuits</h2><p>Loading...</p></section>;
  if (error) return <section><h2>Circuits</h2><p role="alert">{error}</p></section>;
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
