import { useState, useEffect } from 'preact/hooks';
import { fetchDevicesByStatus, deleteDevice } from '../../api';
import type { Device } from '../../types';
import { groupDevicesByAlias, getDisplayName, getBaseDeviceId } from '../../utils/devices';
import { errorMessage } from '../../utils/errors';

interface RemovedGroup {
  cloudId: string;
  baseDeviceId: string;
  displayName: string;
  alias: string;
  updatedAt: string | null;
}

type Feedback = { type: 'success' | 'error'; cloudId: string; text: string } | null;

function buildGroups(devices: Device[]): RemovedGroup[] {
  const groupMap = groupDevicesByAlias(devices);
  return Array.from(groupMap.entries()).map(([_key, devs]) => {
    const baseDeviceId = getBaseDeviceId(devs[0]);
    const cloudId = baseDeviceId.replace(/^epcube/, '');
    // Use the latest updated_at across the group (battery + solar may differ slightly)
    let latest: string | null = null;
    for (const d of devs) {
      if (d.updated_at && (!latest || d.updated_at > latest)) latest = d.updated_at;
    }
    return {
      cloudId,
      baseDeviceId,
      displayName: getDisplayName(devs),
      alias: devs[0].alias ?? '',
      updatedAt: latest,
    };
  });
}

function disambiguate(groups: RemovedGroup[]): RemovedGroup[] {
  const allNames = groups.map((g) => g.displayName);
  const duplicates = new Set(
    allNames.filter((n, _i, arr) => arr.indexOf(n) !== arr.lastIndexOf(n)),
  );
  return groups.map((g) =>
    duplicates.has(g.displayName)
      ? { ...g, displayName: `${g.displayName} (${g.cloudId})` }
      : g,
  );
}

function formatRemovedDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function TrashIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function RemovedDevicesSection() {
  const [groups, setGroups] = useState<RemovedGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const removed = await fetchDevicesByStatus('removed').catch(() => ({ devices: [] as Device[] }));
        if (cancelled) return;
        setGroups(disambiguate(buildGroups(removed.devices)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  async function handleConfirmDelete(cloudId: string) {
    setBusyId(cloudId);
    setFeedback(null);
    try {
      const result = await deleteDevice(cloudId);
      setGroups((prev) => prev.filter((g) => g.cloudId !== cloudId));
      setFeedback({
        type: 'success',
        cloudId,
        text: `Deleted ${result.readings_deleted.toLocaleString()} readings`,
      });
      setConfirmingId(null);
    } catch (err) {
      setFeedback({ type: 'error', cloudId, text: errorMessage(err, 'Delete failed') });
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div class="settings-section" aria-busy="true"><h3>Removed Devices</h3><p>Loading...</p></div>;

  return (
    <div class="settings-section">
      <h3>Removed Devices</h3>
      {groups.length === 0 ? (
        <p class="settings-coming-soon">No removed devices.</p>
      ) : (
        <table class="removed-devices-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Cloud ID</th>
              <th>Removed Date</th>
              <th class="removed-devices-actions-col"></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.cloudId}>
                <td class="removed-devices-device-cell">
                  <div>{g.displayName}</div>
                  {g.alias && g.alias !== g.displayName && (
                    <div class="removed-devices-alias">{g.alias}</div>
                  )}
                </td>
                <td>{g.cloudId}</td>
                <td>{formatRemovedDate(g.updatedAt)}</td>
                <td class="removed-devices-actions-col">
                  {confirmingId === g.cloudId ? (
                    <div class="removed-devices-actions">
                      <button
                        type="button"
                        class="settings-save"
                        onClick={() => handleConfirmDelete(g.cloudId)}
                        disabled={busyId === g.cloudId}
                      >
                        {busyId === g.cloudId ? 'Deleting…' : 'Confirm Delete'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        disabled={busyId === g.cloudId}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      class="removed-devices-trash"
                      aria-label="Delete"
                      title="Delete"
                      onClick={() => { setConfirmingId(g.cloudId); setFeedback(null); }}
                    >
                      <TrashIcon />
                    </button>
                  )}
                  {/* Errors keep the row visible so the user can retry; success removes the row
                      and renders a top-level confirmation below the table. */}
                  {feedback && feedback.cloudId === g.cloudId && feedback.type === 'error' && (
                    <p role="alert" class="settings-error">
                      {feedback.text}
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {/* Success feedback for already-deleted rows (no row to attach to) */}
      {feedback && feedback.type === 'success' && (
        <p role="status" class="settings-success">{feedback.text}</p>
      )}
    </div>
  );
}
