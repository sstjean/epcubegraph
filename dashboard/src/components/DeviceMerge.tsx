import { useState, useEffect, useMemo } from 'preact/hooks';
import { fetchDevicesByStatus, fetchMergePreview, fetchPendingReplacements, mergeDevices } from '../api';
import type { Device, MergePreviewResponse, PendingReplacement } from '../types';
import { groupDevicesByAlias, getDisplayName, getBaseDeviceId } from '../utils/devices';
import { errorMessage } from '../utils/errors';

interface DeviceGroup {
  /** Raw cloud device id (e.g. "100" extracted from "epcube100_battery"). */
  cloudId: string;
  displayName: string;
  /** Earliest created_at across the device's sub-rows (battery/solar). */
  addedAt?: string;
}

function formatAddedAt(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function buildGroups(devices: Device[]): DeviceGroup[] {
  const map = groupDevicesByAlias(devices);
  const groups: DeviceGroup[] = [];
  for (const devs of map.values()) {
    const base = getBaseDeviceId(devs[0]);              // e.g. "epcube100"
    const cloudId = base.replace(/^epcube/, '');         // e.g. "100"
    if (!cloudId) continue;
    // Earliest created_at across battery/solar sub-devices.
    const dates = devs.map((d) => d.created_at).filter((s): s is string => !!s).sort();
    groups.push({ cloudId, displayName: getDisplayName(devs), addedAt: dates[0] });
  }
  return groups;
}

export function DeviceMerge() {
  const [removedGroups, setRemovedGroups] = useState<DeviceGroup[]>([]);
  const [activeGroups, setActiveGroups] = useState<DeviceGroup[]>([]);
  const [pending, setPending] = useState<PendingReplacement[]>([]);
  const [oldId, setOldId] = useState('');
  const [newId, setNewId] = useState('');
  const [preview, setPreview] = useState<MergePreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeFeedback, setMergeFeedback] = useState<
    { kind: 'success' | 'error'; message: string } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchDevicesByStatus('removed').catch(() => ({ devices: [] as Device[] })),
      fetchDevicesByStatus('active').catch(() => ({ devices: [] as Device[] })),
      fetchPendingReplacements().catch(() => [] as PendingReplacement[]),
    ]).then(([removedRes, activeRes, pendingRes]) => {
      if (cancelled) return;
      setRemovedGroups(buildGroups(removedRes.devices));
      setActiveGroups(buildGroups(activeRes.devices));
      setPending(pendingRes);
    });
    return () => { cancelled = true; };
  }, []);

  // Filter the target dropdown to the device(s) flagged as suggested replacements
  // for the currently-selected source. If no pending row exists, fall back to the
  // full active list (manual merge path).
  const pendingMatches = useMemo(
    () => (oldId ? pending.filter((p) => p.old_device_id === oldId) : []),
    [oldId, pending],
  );
  const suggestedTargets = useMemo(() => {
    if (!oldId || pendingMatches.length === 0) return activeGroups;
    const allowed = new Set(pendingMatches.map((m) => m.new_device_id));
    return activeGroups.filter((g) => allowed.has(g.cloudId));
  }, [oldId, activeGroups, pendingMatches]);

  // Auto-select only when there is exactly one *suggested* (pending) target.
  // Never auto-select on the manual fallback path.
  useEffect(() => {
    if (pendingMatches.length === 1 && suggestedTargets.length === 1 &&
        newId !== suggestedTargets[0].cloudId) {
      setNewId(suggestedTargets[0].cloudId);
    } else if (newId && !suggestedTargets.some((g) => g.cloudId === newId)) {
      // Selected target no longer in the allowed list (e.g. source changed).
      setNewId('');
    }
  }, [pendingMatches, suggestedTargets, newId]);

  useEffect(() => {
    if (!oldId || !newId) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setLoadingPreview(true);
    setPreviewError(null);
    fetchMergePreview(oldId, newId)
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
        setLoadingPreview(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(errorMessage(err, 'Merge preview unavailable'));
        setLoadingPreview(false);
      });
    return () => { cancelled = true; };
  }, [oldId, newId]);

  return (
    <div class="settings-section device-merge">
      <h3>Device Merge</h3>
      <p class="settings-help">
        Re-attribute historical readings from a removed device to its active replacement.
      </p>

      {removedGroups.length === 0 ? (
        <p class="settings-help">No removed devices available to merge.</p>
      ) : (
        <>
          <div class="settings-fields">
            <div class="settings-field">
              <label for="merge-old">Removed device (source)</label>
              <select
                id="merge-old"
                value={oldId}
                onChange={(e) => setOldId((e.target as HTMLSelectElement).value)}
              >
                <option value="">Choose a removed device…</option>
                {removedGroups.map((g) => {
                  const added = formatAddedAt(g.addedAt);
                  return (
                    <option key={g.cloudId} value={g.cloudId}>
                      {g.displayName} (id={g.cloudId}{added ? `, added ${added}` : ''})
                    </option>
                  );
                })}
              </select>
            </div>

            <div class="settings-field">
              <label for="merge-new">Active device (target)</label>
              <select
                id="merge-new"
                value={newId}
                onChange={(e) => setNewId((e.target as HTMLSelectElement).value)}
                disabled={!oldId}
              >
                <option value="">Choose an active device…</option>
                {suggestedTargets.map((g) => {
                  const added = formatAddedAt(g.addedAt);
                  return (
                    <option key={g.cloudId} value={g.cloudId}>
                      {g.displayName} (id={g.cloudId}{added ? `, added ${added}` : ''})
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {oldId && newId && (
            <div class="device-merge__confirmation" role="region" aria-label="Merge confirmation">
              {loadingPreview && <p>Loading merge preview…</p>}
              {previewError && (
                <p role="alert" class="settings-error">{previewError}</p>
              )}
              {preview && (
                <>
                  <p>
                    Merging will transfer{' '}
                    <strong>{preview.readings_to_transfer.toLocaleString()}</strong> readings{' '}
                    and skip <strong>{preview.conflicts_to_skip.toLocaleString()}</strong>{' '}
                    conflicting timestamps.
                  </p>
                  <p class="settings-warning">
                    <strong>Warning:</strong> This action cannot be undone. The old device will
                    be marked <code>merged</code> and its readings reassigned to the new device.
                  </p>
                  <button
                    type="button"
                    class="settings-save"
                    disabled={merging}
                    onClick={async () => {
                      setMerging(true);
                      setMergeFeedback(null);
                      try {
                        const result = await mergeDevices(oldId, newId);
                        setMergeFeedback({
                          kind: 'success',
                          message: `Merged ${result.old_device_id} → ${result.new_device_id}: transferred ${result.readings_transferred.toLocaleString()} readings (${result.conflicts_skipped.toLocaleString()} conflicts skipped).`,
                        });
                        // Reset selection so the user can perform another merge
                        setOldId('');
                        setNewId('');
                        // Refresh device lists (old device is now 'merged', not 'removed')
                        const [removedRes, activeRes] = await Promise.all([
                          fetchDevicesByStatus('removed').catch(() => ({ devices: [] as Device[] })),
                          fetchDevicesByStatus('active').catch(() => ({ devices: [] as Device[] })),
                        ]);
                        setRemovedGroups(buildGroups(removedRes.devices));
                        setActiveGroups(buildGroups(activeRes.devices));
                      } catch (err) {
                        setMergeFeedback({ kind: 'error', message: errorMessage(err, 'Merge failed') });
                      } finally {
                        setMerging(false);
                      }
                    }}
                  >
                    {merging ? 'Merging…' : 'Merge devices'}
                  </button>
                </>
              )}
            </div>
          )}
          {mergeFeedback && (
            <p
              role="status"
              class={mergeFeedback.kind === 'success' ? 'settings-success' : 'settings-error'}
            >
              {mergeFeedback.message}
            </p>
          )}
        </>
      )}
    </div>
  );
}
