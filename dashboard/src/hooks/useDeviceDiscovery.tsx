import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  fetchPendingReplacements,
  dismissPendingReplacement,
  fetchMergePreview,
  mergeDevices,
} from '../api';
import type { PendingReplacement, MergeResponse } from '../types';

export interface PendingReplacementWithCount extends PendingReplacement {
  /** Number of historical readings on the old device that would transfer on merge.
   *  `null` if the merge-preview endpoint is unavailable or failed. */
  readingsToTransfer: number | null;
  /** Number of timestamps that already exist on the new device and would be skipped. */
  conflictsToSkip: number | null;
}

export interface UseDeviceDiscoveryResult {
  pending: PendingReplacementWithCount[];
  dismiss: (id: number) => Promise<void>;
  merge: (id: number, oldDeviceId: string, newDeviceId: string) => Promise<MergeResponse>;
  refresh: () => Promise<void>;
}

const POLL_INTERVAL_MS = 30_000;

export function useDeviceDiscovery(): UseDeviceDiscoveryResult {
  const [pending, setPending] = useState<PendingReplacementWithCount[]>([]);
  const mountedRef = useRef(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async () => {
    let items: PendingReplacement[];
    try {
      items = await fetchPendingReplacements();
    } catch {
      // Endpoint may be unavailable in some environments; keep current state.
      return;
    }

    const enriched = await Promise.all(items.map(async (item) => {
      try {
        const preview = await fetchMergePreview(item.old_device_id, item.new_device_id);
        return {
          ...item,
          readingsToTransfer: preview.readings_to_transfer,
          conflictsToSkip: preview.conflicts_to_skip,
        };
      } catch {
        return { ...item, readingsToTransfer: null, conflictsToSkip: null };
      }
    }));

    if (!mountedRef.current) return;
    setPending(enriched);
  }, []);

  const dismiss = useCallback(async (id: number) => {
    await dismissPendingReplacement(id);
    if (!mountedRef.current) return;
    setPending((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const merge = useCallback(async (id: number, oldDeviceId: string, newDeviceId: string) => {
    const result = await mergeDevices(oldDeviceId, newDeviceId);
    if (mountedRef.current) {
      setPending((prev) => prev.filter((p) => p.id !== id));
    }
    return result;
  }, []);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(pollRef.current!);
  }, [load]);

  return { pending, dismiss, merge, refresh: load };
}

// ── Shared context so multiple components see the same pending state and
//    coordinated dismiss/merge updates without polling lag. ──

const DeviceDiscoveryContext = createContext<UseDeviceDiscoveryResult | null>(null);

export function DeviceDiscoveryProvider({ children }: { children: ComponentChildren }) {
  const value = useDeviceDiscovery();
  return (
    <DeviceDiscoveryContext.Provider value={value}>{children}</DeviceDiscoveryContext.Provider>
  );
}

export function useDeviceDiscoveryContext(): UseDeviceDiscoveryResult {
  const ctx = useContext(DeviceDiscoveryContext);
  if (!ctx) {
    throw new Error('useDeviceDiscoveryContext must be used within DeviceDiscoveryProvider');
  }
  return ctx;
}
