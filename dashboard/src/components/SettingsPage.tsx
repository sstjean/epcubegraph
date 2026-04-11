import { useState, useEffect } from 'preact/hooks';
import { fetchSettings, updateSetting, fetchDevices, fetchVueDevices, fetchHierarchy } from '../api';
import type { Device, VueDeviceInfo, VuePanelMapping, PanelHierarchyEntry } from '../types';
import { groupDevicesByAlias, getDisplayName, getBaseDeviceId } from '../utils/devices';

const POLL_SETTINGS = [
  { key: 'epcube_poll_interval_seconds', label: 'EP Cube Polling Interval', default: '30', disabled: false },
  { key: 'vue_poll_interval_seconds', label: 'Emporia Vue Polling Interval', default: '1', disabled: true },
] as const;

interface EpCubeGroup {
  baseDeviceId: string;
  displayName: string;
  devices: Device[];
}

export function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [epcubeGroups, setEpcubeGroups] = useState<EpCubeGroup[]>([]);
  const [vueDevices, setVueDevices] = useState<VueDeviceInfo[]>([]);
  const [hierarchyEntries, setHierarchyEntries] = useState<PanelHierarchyEntry[]>([]);
  const [mapping, setMapping] = useState<Record<string, VuePanelMapping[]>>({});

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
        for (const ps of POLL_SETTINGS) {
          if (!(ps.key in vals)) vals[ps.key] = ps.default;
        }
        setValues(vals);
        setVueDevices(vueDevicesRes.devices);
        setHierarchyEntries(hierarchyRes.entries);

        // Group EP Cube devices by base alias
        const groupMap = groupDevicesByAlias(devicesRes.devices);
        const groups: EpCubeGroup[] = Array.from(groupMap.entries()).map(([_key, devices]) => ({
          baseDeviceId: getBaseDeviceId(devices[0]),
          displayName: getDisplayName(devices),
          devices,
        }));
        setEpcubeGroups(groups);

        // Initialize mapping with all EP Cube groups, then overlay saved values
        const initMapping: Record<string, VuePanelMapping[]> = {};
        for (const g of groups) initMapping[g.baseDeviceId] = [];
        const rawMapping = vals.vue_device_mapping;
        if (rawMapping) {
          try {
            const parsed = JSON.parse(rawMapping) as Record<string, VuePanelMapping[]>;
            for (const [key, panels] of Object.entries(parsed)) {
              if (key in initMapping) {
                initMapping[key] = panels;
              }
            }
          } catch {
            // Malformed JSON — treat as empty mapping
          }
        }
        setMapping(initMapping);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  function handleChange(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
    setSuccess(null);
  }

  function validate(val: string): string | null {
    const n = Number(val);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return 'Must be a whole number';
    if (n < 1) return 'Minimum is 1 second';
    if (n > 3600) return 'Maximum is 3600 seconds';
    return null;
  }

  async function handleSavePolling() {
    setError(null);
    setSuccess(null);

    // Validate all editable fields — use same fallback as rendered input
    for (const ps of POLL_SETTINGS) {
      if (ps.disabled) continue;
      const err = validate(values[ps.key] ?? ps.default);
      if (err) {
        setError(`${ps.label}: ${err}`);
        return;
      }
    }

    setSaving(true);
    try {
      for (const ps of POLL_SETTINGS) {
        if (ps.disabled) continue;
        await updateSetting(ps.key, values[ps.key] ?? ps.default);
      }
      setSuccess('Polling intervals saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // ── Mapping editor handlers ──

  function getAllAssignedGids(): Set<number> {
    const gids = new Set<number>();
    for (const panels of Object.values(mapping)) {
      for (const p of panels) gids.add(p.gid);
    }
    return gids;
  }

  function handleAssignPanel(deviceId: string, gidStr: string) {
    const gid = Number(gidStr);
    if (!gid) return;
    const vue = vueDevices.find((v) => v.device_gid === gid)!;
    setMapping((prev) => ({
      ...prev,
      [deviceId]: [...prev[deviceId], { gid, alias: vue.display_name }],
    }));
    setSuccess(null);
  }

  function handleRemovePanel(deviceId: string, gid: number) {
    setMapping((prev) => ({
      ...prev,
      [deviceId]: prev[deviceId].filter((p) => p.gid !== gid),
    }));
    setSuccess(null);
  }

  function handleMappingFieldChange(deviceId: string, gid: number, field: 'alias', value: string) {
    setMapping((prev) => ({
      ...prev,
      [deviceId]: prev[deviceId].map((p) =>
        p.gid === gid ? { ...p, [field]: value } : p,
      ),
    }));
    setSuccess(null);
  }

  async function handleSaveMapping() {
    setError(null);
    setSuccess(null);
    setSavingMapping(true);
    try {
      // Only include devices with assigned panels
      const filtered: Record<string, VuePanelMapping[]> = {};
      for (const [key, panels] of Object.entries(mapping)) {
        if (panels.length > 0) filtered[key] = panels;
      }
      await updateSetting('vue_device_mapping', JSON.stringify(filtered));
      setSuccess('Device mapping saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingMapping(false);
    }
  }

  if (loading) return <section aria-busy="true"><h2>Settings</h2><p>Loading...</p></section>;

  return (
    <section aria-label="Settings">
      <h2>Settings</h2>

      {error && <p role="alert" class="settings-error">{error}</p>}
      {success && <p role="status" class="settings-success">{success}</p>}

      <div class="settings-section">
        <h3>Polling Intervals</h3>
        <div class="settings-fields">
          {POLL_SETTINGS.map((ps) => (
            <div class="settings-field" key={ps.key}>
              <label for={ps.key}>
                {ps.label} (seconds)
                {ps.disabled && <span class="settings-coming-soon"> — Coming in Feature 005</span>}
              </label>
              <input
                id={ps.key}
                type="number"
                min="1"
                max="3600"
                value={values[ps.key] ?? ps.default}
                disabled={ps.disabled}
                onInput={(e) => handleChange(ps.key, (e.target as HTMLInputElement).value)}
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          class="settings-save"
          onClick={handleSavePolling}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Polling Intervals'}
        </button>
      </div>

      <div class="settings-section">
        <h3>Vue Device Mapping</h3>
        {epcubeGroups.length === 0 && <p class="settings-coming-soon">No EP Cube devices found</p>}
        {epcubeGroups.length > 0 && vueDevices.length === 0 && <p class="settings-coming-soon">No Vue devices available</p>}
        {epcubeGroups.length > 0 && vueDevices.length > 0 && (
          <>
            {epcubeGroups.map((group) => {
              const assignedGids = getAllAssignedGids();
              const childGids = new Set(hierarchyEntries.map((h) => h.child_device_gid));
              const unassigned = vueDevices.filter(
                (v) => !assignedGids.has(v.device_gid) && !childGids.has(v.device_gid),
              );
              const panels = mapping[group.baseDeviceId];
              return (
                <div class="mapping-device" key={group.baseDeviceId}>
                  <h4>{group.displayName}</h4>
                  <div class="mapping-assigned">
                    {panels.map((p) => (
                      <div class="mapping-panel-row" key={p.gid}>
                        <input
                          type="text"
                          aria-label={`Alias for panel ${p.gid}`}
                          value={p.alias}
                          onInput={(e) => handleMappingFieldChange(group.baseDeviceId, p.gid, 'alias', (e.target as HTMLInputElement).value)}
                        />
                        <button
                          type="button"
                          aria-label={`Remove panel ${p.gid}`}
                          class="mapping-remove-btn"
                          onClick={() => handleRemovePanel(group.baseDeviceId, p.gid)}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  <select
                    aria-label={`Add Vue panel to ${group.displayName}`}
                    value=""
                    onChange={(e) => handleAssignPanel(group.baseDeviceId, (e.target as HTMLSelectElement).value)}
                  >
                    <option value="">Add Vue panel…</option>
                    {unassigned.map((v) => (
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
              onClick={handleSaveMapping}
              disabled={savingMapping}
            >
              {savingMapping ? 'Saving...' : 'Save Mapping'}
            </button>
          </>
        )}
      </div>

      <div class="settings-section">
        <h3>Panel Hierarchy</h3>
        <p class="settings-coming-soon">Coming in Feature 005 — requires Emporia Vue devices</p>
      </div>

      <div class="settings-section">
        <h3>Display Names</h3>
        <p class="settings-coming-soon">Coming in Feature 005 — requires Emporia Vue devices</p>
      </div>
    </section>
  );
}
