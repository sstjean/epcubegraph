import { useState } from 'preact/hooks';
import { useDeviceDiscoveryContext, type PendingReplacementWithCount } from '../hooks/useDeviceDiscovery';
import { errorMessage } from '../utils/errors';
import type { MergeResponse } from '../types';

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString();
}

function formatCount(n: number | null): string {
  if (n === null) return '—';
  return n.toLocaleString();
}

interface ItemFeedback {
  kind: 'success' | 'error';
  message: string;
}

function PendingItem({
  item,
  onDismiss,
  onMerge,
}: {
  item: PendingReplacementWithCount;
  onDismiss: (id: number) => Promise<void>;
  onMerge: (id: number, oldId: string, newId: string) => Promise<MergeResponse>;
}) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<ItemFeedback | null>(null);

  const handleMerge = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await onMerge(item.id, item.old_device_id, item.new_device_id);
      setFeedback({
        kind: 'success',
        message: `Merged ${item.old_device_id} → ${item.new_device_id}: transferred ${result.readings_transferred.toLocaleString()} readings (${result.conflicts_skipped.toLocaleString()} conflicts skipped).`,
      });
    } catch (err) {
      setFeedback({ kind: 'error', message: errorMessage(err, 'Merge failed') });
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      await onDismiss(item.id);
    } catch (err) {
      setFeedback({ kind: 'error', message: errorMessage(err, 'Dismiss failed') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="replacement-banner__item" role="alert">
      <div class="replacement-banner__message">
        <strong class="replacement-banner__title">A possible equipment swap was detected.</strong>
        <table class="replacement-banner__table">
          <thead>
            <tr>
              <th></th>
              <th>Last Seen</th>
              <th>Device ID</th>
              <th>Device Name</th>
              <th>Readings</th>
              <th>Duplicates</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="replacement-banner__row-label">Old device</td>
              <td>{formatTimestamp(item.old_last_seen)}</td>
              <td>{item.old_device_id}</td>
              <td>{item.old_alias ?? '—'}</td>
              <td>{formatCount(item.readingsToTransfer)}</td>
              <td rowSpan={2}>{formatCount(item.conflictsToSkip)}</td>
            </tr>
            <tr>
              <td class="replacement-banner__row-label">New device</td>
              <td>{formatTimestamp(item.new_last_seen)}</td>
              <td>{item.new_device_id}</td>
              <td>{item.new_alias ?? '—'}</td>
              <td>{formatCount(item.conflictsToSkip)}</td>
            </tr>
          </tbody>
        </table>
        {item.conflictsToSkip !== null && item.conflictsToSkip > 0 && (
          <div class="replacement-banner__note">
            Note: The new device was collecting data while the old device was still collecting data.
            This created an overlap in readings.
            <br />
            Upon Merge, the readings from the new device will
            be kept and the overlapped readings from the old device will be deleted.
          </div>
        )}
      </div>
      <p class="replacement-banner__confirm">
        Is the new device a replacement or upgrade to the old device?
      </p>
      <div class="replacement-banner__actions">
        <button type="button" onClick={handleMerge} disabled={busy}>
          Yes
        </button>
        <button type="button" onClick={handleDismiss} disabled={busy}>
          No
        </button>
      </div>
      <p class="replacement-banner__hint">
        You can also merge or dismiss from the <a href="/settings">Settings</a> page.
      </p>
      {feedback && (
        <p
          role="status"
          class={feedback.kind === 'success' ? 'settings-success' : 'settings-error'}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}

export function ReplacementBanner() {
  const { pending, dismiss, merge } = useDeviceDiscoveryContext();

  if (pending.length === 0) return null;

  return (
    <section class="replacement-banner" aria-label="Pending device replacements">
      {pending.map((item) => (
        <PendingItem key={item.id} item={item} onDismiss={dismiss} onMerge={merge} />
      ))}
    </section>
  );
}
