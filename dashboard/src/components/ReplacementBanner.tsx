import { useState } from 'preact/hooks';
import { useDeviceDiscovery, type PendingReplacementWithCount } from '../hooks/useDeviceDiscovery';
import { errorMessage } from '../utils/errors';
import type { MergeResponse } from '../types';

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
        <strong>Possible device replacement detected.</strong>{' '}
        Device <code>{item.old_device_id}</code> was removed and{' '}
        device <code>{item.new_device_id}</code> appeared in the same discovery cycle.{' '}
        Merging would transfer <strong>{formatCount(item.readingsToTransfer)}</strong>{' '}
        readings ({formatCount(item.conflictsToSkip)} conflicts skipped).
      </div>
      <div class="replacement-banner__actions">
        <button type="button" onClick={handleMerge} disabled={busy}>
          Merge
        </button>
        <button type="button" onClick={handleDismiss} disabled={busy}>
          Dismiss
        </button>
      </div>
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
  const { pending, dismiss, merge } = useDeviceDiscovery();

  if (pending.length === 0) return null;

  return (
    <section class="replacement-banner" aria-label="Pending device replacements">
      {pending.map((item) => (
        <PendingItem key={item.id} item={item} onDismiss={dismiss} onMerge={merge} />
      ))}
    </section>
  );
}
