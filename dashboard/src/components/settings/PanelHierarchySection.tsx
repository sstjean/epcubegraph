import { useState, useEffect } from 'preact/hooks';
import { fetchVueDevices, fetchHierarchy, updateHierarchy } from '../../api';
import type { VueDeviceInfo, PanelHierarchyEntry } from '../../types';
import { errorMessage } from '../../utils/errors';

export function resolveDeviceAlias(vueDevices: VueDeviceInfo[], gid: number): string {
  return vueDevices.find((v) => v.device_gid === gid)?.display_name || String(gid);
}

type Message = { type: 'success' | 'error'; text: string } | null;

export function PanelHierarchySection() {
  const [vueDevices, setVueDevices] = useState<VueDeviceInfo[]>([]);
  const [entries, setEntries] = useState<PanelHierarchyEntry[]>([]);
  const [addParentGid, setAddParentGid] = useState('');
  const [addChildGid, setAddChildGid] = useState('');
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
        const [vueDevicesRes, hierarchyRes] = await Promise.all([
          fetchVueDevices().catch(() => ({ devices: [] as VueDeviceInfo[] })),
          fetchHierarchy().catch(() => ({ entries: [] as PanelHierarchyEntry[] })),
        ]);
        if (cancelled) return;
        setVueDevices(vueDevicesRes.devices);
        setEntries(hierarchyRes.entries);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, 'Failed to load hierarchy'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  function handleAdd() {
    setMessage(null);
    const parentGid = Number(addParentGid);
    const childGid = Number(addChildGid);
    if (!parentGid || !childGid) return;

    if (parentGid === childGid) {
      setMessage({ type: 'error', text: 'A panel cannot be its own child' });
      return;
    }

    const duplicate = entries.some(
      (e) => e.parent_device_gid === parentGid && e.child_device_gid === childGid,
    );
    if (duplicate) {
      setMessage({ type: 'error', text: 'This relationship already exists' });
      return;
    }

    setEntries((prev) => [
      ...prev,
      { id: 0, parent_device_gid: parentGid, child_device_gid: childGid },
    ]);
    setAddParentGid('');
    setAddChildGid('');
  }

  function handleRemove(parentGid: number, childGid: number) {
    setEntries((prev) =>
      prev.filter((e) => !(e.parent_device_gid === parentGid && e.child_device_gid === childGid)),
    );
    setMessage(null);
  }

  async function handleSave() {
    setMessage(null);
    setSaving(true);
    try {
      const input = entries.map((e) => ({
        parent_device_gid: e.parent_device_gid,
        child_device_gid: e.child_device_gid,
      }));
      const result = await updateHierarchy(input);
      setEntries(result.entries);
      setMessage({ type: 'success', text: 'Hierarchy saved' });
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Failed to save hierarchy') });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div class="settings-section" aria-busy="true"><h3>Panel Hierarchy</h3><p>Loading...</p></div>;

  return (
    <div class="settings-section">
      <h3>Panel Hierarchy</h3>
      {error && <p role="alert" class="settings-error">{error}</p>}
      {vueDevices.length === 0 && <p class="settings-coming-soon">No Vue devices available</p>}
      {vueDevices.length > 0 && (
        <>
          {entries.length > 0 && (
            <div class="hierarchy-entries">
              {entries.map((e) => (
                <div class="hierarchy-entry-row" key={`${e.parent_device_gid}-${e.child_device_gid}`}>
                  <span>{resolveDeviceAlias(vueDevices, e.parent_device_gid)} → {resolveDeviceAlias(vueDevices, e.child_device_gid)}</span>
                  <button
                    type="button"
                    aria-label={`Remove hierarchy entry ${e.child_device_gid}`}
                    class="mapping-remove-btn"
                    onClick={() => handleRemove(e.parent_device_gid, e.child_device_gid)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <div class="hierarchy-add-row">
            <select
              aria-label="Parent panel"
              value={addParentGid}
              onChange={(e) => setAddParentGid((e.target as HTMLSelectElement).value)}
            >
              <option value="">Parent…</option>
              {vueDevices.map((v) => (
                <option key={v.device_gid} value={String(v.device_gid)}>
                  {v.display_name}
                </option>
              ))}
            </select>
            <select
              aria-label="Child panel"
              value={addChildGid}
              onChange={(e) => setAddChildGid((e.target as HTMLSelectElement).value)}
            >
              <option value="">Child…</option>
              {vueDevices.map((v) => (
                <option key={v.device_gid} value={String(v.device_gid)}>
                  {v.display_name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleAdd}
            >
              Add
            </button>
          </div>
          <button
            type="button"
            class="settings-save"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Hierarchy'}
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
