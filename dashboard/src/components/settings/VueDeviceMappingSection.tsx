import { useState, useEffect } from 'preact/hooks';
import { fetchSettings, updateSetting, fetchDevices, fetchVueDevices, fetchHierarchy } from '../../api';
import type { Device, VueDeviceInfo, VuePanelMapping, PanelHierarchyEntry } from '../../types';
import { groupDevicesByAlias, getDisplayName, getBaseDeviceId } from '../../utils/devices';
import { errorMessage, toTrackedError } from '../../utils/errors';
import { isValidVueDeviceMapping } from '../../hooks/useVueData';

interface EpCubeGroup {
  baseDeviceId: string;
  displayName: string;
  devices: Device[];
}

export function buildEpcubeGroups(devices: Device[]): EpCubeGroup[] {
  const groupMap = groupDevicesByAlias(devices);
  return Array.from(groupMap.entries()).map(([_key, devs]) => ({
    baseDeviceId: getBaseDeviceId(devs[0]),
    displayName: getDisplayName(devs),
    devices: devs,
  }));
}

export function initializeMapping(
  groups: EpCubeGroup[],
  rawMapping: string | undefined,
): Record<string, VuePanelMapping | undefined> {
  const mapping: Record<string, VuePanelMapping | undefined> = {};
  for (const g of groups) mapping[g.baseDeviceId] = undefined;
  if (rawMapping) {
    try {
      const parsed: unknown = JSON.parse(rawMapping);
      if (isValidVueDeviceMapping(parsed)) {
        for (const [key, panel] of Object.entries(parsed)) {
          if (key in mapping) {
            mapping[key] = panel;
          }
        }
      } else {
        toTrackedError(new Error('vue_device_mapping uses legacy array format'), 'Invalid vue_device_mapping format');
      }
    } catch (err) {
      toTrackedError(err, 'Malformed vue_device_mapping JSON');
    }
  }
  return mapping;
}

function resolveDeviceAlias(vueDevices: VueDeviceInfo[], gid: number): string {
  return vueDevices.find((v) => v.device_gid === gid)?.display_name || String(gid);
}

type Message = { type: 'success' | 'error'; text: string } | null;

export function VueDeviceMappingSection() {
  const [epcubeGroups, setEpcubeGroups] = useState<EpCubeGroup[]>([]);
  const [vueDevices, setVueDevices] = useState<VueDeviceInfo[]>([]);
  const [hierarchyEntries, setHierarchyEntries] = useState<PanelHierarchyEntry[]>([]);
  const [mapping, setMapping] = useState<Record<string, VuePanelMapping | undefined>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [settingsRes, devicesRes, vueDevicesRes, hierarchyRes] = await Promise.all([
          fetchSettings(),
          fetchDevices().catch(() => ({ devices: [] as Device[] })),
          fetchVueDevices().catch(() => ({ devices: [] as VueDeviceInfo[] })),
          fetchHierarchy().catch(() => ({ entries: [] as PanelHierarchyEntry[] })),
        ]);
        if (cancelled) return;
        const vals: Record<string, string> = {};
        for (const s of settingsRes.settings) vals[s.key] = s.value;
        setVueDevices(vueDevicesRes.devices);
        setHierarchyEntries(hierarchyRes.entries);
        const groups = buildEpcubeGroups(devicesRes.devices);
        setEpcubeGroups(groups);
        setMapping(initializeMapping(groups, vals.vue_device_mapping));
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, 'Failed to load settings'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  function getAllAssignedGids(): Set<number> {
    const gids = new Set<number>();
    for (const panel of Object.values(mapping)) {
      if (panel) gids.add(panel.gid);
    }
    return gids;
  }

  function handleSelectDevice(deviceId: string, gidStr: string) {
    const gid = Number(gidStr);
    if (!gid) {
      setMapping((prev) => ({ ...prev, [deviceId]: undefined }));
      setMessage(null);
      return;
    }
    const alias = resolveDeviceAlias(vueDevices, gid);
    setMapping((prev) => ({
      ...prev,
      [deviceId]: { gid, alias },
    }));
    setMessage(null);
  }

  async function handleSave() {
    setMessage(null);
    setError(null);
    setSaving(true);
    try {
      const filtered: Record<string, VuePanelMapping> = {};
      for (const [key, panel] of Object.entries(mapping)) {
        if (panel) filtered[key] = panel;
      }
      await updateSetting('vue_device_mapping', JSON.stringify(filtered));
      setMessage({ type: 'success', text: 'Device mapping saved' });
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Failed to save') });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div class="settings-section" aria-busy="true"><h3>Vue Device Mapping</h3><p>Loading...</p></div>;

  return (
    <div class="settings-section">
      <h3>Vue Device Mapping</h3>
      {error && <p role="alert" class="settings-error">{error}</p>}
      {epcubeGroups.length === 0 && <p class="settings-coming-soon">No EP Cube devices found</p>}
      {epcubeGroups.length > 0 && vueDevices.length === 0 && <p class="settings-coming-soon">No Vue devices available</p>}
      {epcubeGroups.length > 0 && vueDevices.length > 0 && (
        <>
          {epcubeGroups.map((group) => {
            const assignedGids = getAllAssignedGids();
            const childGids = new Set(hierarchyEntries.map((h) => h.child_device_gid));
            const panel = mapping[group.baseDeviceId];
            const eligible = vueDevices.filter(
              (v) => !childGids.has(v.device_gid) && (!assignedGids.has(v.device_gid) || v.device_gid === panel?.gid),
            );
            return (
              <div class="mapping-device" key={group.baseDeviceId}>
                <h4>{group.displayName}</h4>
                <select
                  aria-label={`Select Vue device for ${group.displayName}`}
                  value={panel ? String(panel.gid) : ''}
                  onChange={(e) => handleSelectDevice(group.baseDeviceId, (e.target as HTMLSelectElement).value)}
                >
                  <option value="">None</option>
                  {eligible.map((v) => (
                    <option key={v.device_gid} value={String(v.device_gid)}>
                      {v.display_name}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
          <button
            type="button"
            class="settings-save"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Mapping'}
          </button>
          {message && (
            <p role={message.type === 'error' ? 'alert' : 'status'} class={message.type === 'error' ? 'settings-error' : 'settings-success'}>
              {message.text}
            </p>
          )}
        </>
      )}
    </div>
  );
}
