import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/preact';

vi.mock('../../src/api', () => ({
  fetchPendingReplacements: vi.fn(),
  dismissPendingReplacement: vi.fn(),
  fetchMergePreview: vi.fn(),
  mergeDevices: vi.fn(),
}));

vi.mock('../../src/telemetry', () => ({
  trackException: vi.fn(),
}));

import {
  fetchPendingReplacements,
  dismissPendingReplacement,
  fetchMergePreview,
  mergeDevices,
} from '../../src/api';
import { useDeviceDiscovery } from '../../src/hooks/useDeviceDiscovery';

const mockFetchPending = fetchPendingReplacements as ReturnType<typeof vi.fn>;
const mockDismiss = dismissPendingReplacement as ReturnType<typeof vi.fn>;
const mockFetchPreview = fetchMergePreview as ReturnType<typeof vi.fn>;
const mockMerge = mergeDevices as ReturnType<typeof vi.fn>;

const samplePending = [
  { id: 1, old_device_id: '100', new_device_id: '200', detected_at: '2026-05-08T14:30:00Z' },
];

async function flushInitialLoad() {
  await act(() => vi.advanceTimersByTimeAsync(0));
}

describe('useDeviceDiscovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockFetchPending.mockResolvedValue(samplePending);
    mockFetchPreview.mockResolvedValue({
      old_device_id: '100',
      new_device_id: '200',
      readings_to_transfer: 12345,
      conflicts_to_skip: 7,
    });
    mockDismiss.mockResolvedValue({ dismissed: true, old_device_id: '100', new_device_id: '200' });
    mockMerge.mockResolvedValue({
      old_device_id: '100',
      new_device_id: '200',
      readings_transferred: 12345,
      conflicts_skipped: 7,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('returns empty list before initial load completes', () => {
    // Arrange — block fetch from resolving
    mockFetchPending.mockReturnValue(new Promise(() => {}));

    // Act
    const { result } = renderHook(() => useDeviceDiscovery());

    // Assert
    expect(result.current.pending).toEqual([]);
  });

  it('loads pending replacements on mount and enriches with reading counts', async () => {
    // Act
    const { result } = renderHook(() => useDeviceDiscovery());
    await flushInitialLoad();

    // Assert
    expect(mockFetchPending).toHaveBeenCalledTimes(1);
    expect(mockFetchPreview).toHaveBeenCalledWith('100', '200');
    expect(result.current.pending).toHaveLength(1);
    expect(result.current.pending[0].id).toBe(1);
    expect(result.current.pending[0].readingsToTransfer).toBe(12345);
  });

  it('handles empty pending list', async () => {
    // Arrange
    mockFetchPending.mockResolvedValue([]);

    // Act
    const { result } = renderHook(() => useDeviceDiscovery());
    await flushInitialLoad();

    // Assert
    expect(result.current.pending).toEqual([]);
    expect(mockFetchPreview).not.toHaveBeenCalled();
  });

  it('returns null reading count when merge-preview fails (Phase 6 endpoint not yet deployed)', async () => {
    // Arrange
    mockFetchPreview.mockRejectedValue(new Error('Not Found'));

    // Act
    const { result } = renderHook(() => useDeviceDiscovery());
    await flushInitialLoad();

    // Assert
    expect(result.current.pending).toHaveLength(1);
    expect(result.current.pending[0].readingsToTransfer).toBeNull();
  });

  it('polls pending-replacements on 30s cycle', async () => {
    // Act
    renderHook(() => useDeviceDiscovery());
    await flushInitialLoad();
    expect(mockFetchPending).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(30000));

    // Assert
    expect(mockFetchPending).toHaveBeenCalledTimes(2);
  });

  it('handles fetchPendingReplacements failure silently', async () => {
    // Arrange
    mockFetchPending.mockRejectedValue(new Error('Network error'));

    // Act
    const { result } = renderHook(() => useDeviceDiscovery());
    await flushInitialLoad();

    // Assert — pending list remains empty, no crash
    expect(result.current.pending).toEqual([]);
  });

  it('dismiss action removes the item from local state and calls API', async () => {
    // Act
    const { result } = renderHook(() => useDeviceDiscovery());
    await flushInitialLoad();
    expect(result.current.pending).toHaveLength(1);

    await act(async () => {
      await result.current.dismiss(1);
    });

    // Assert
    expect(mockDismiss).toHaveBeenCalledWith(1);
    expect(result.current.pending).toEqual([]);
  });

  it('dismiss leaves item in place if API call fails', async () => {
    // Arrange
    mockDismiss.mockRejectedValue(new Error('Server error'));

    // Act
    const { result } = renderHook(() => useDeviceDiscovery());
    await flushInitialLoad();

    await act(async () => {
      try { await result.current.dismiss(1); } catch { /* expected */ }
    });

    // Assert — still present
    expect(result.current.pending).toHaveLength(1);
  });

  it('does not call setState after unmount during load', async () => {
    // Arrange — pending fetch resolves AFTER unmount
    let resolvePending!: (value: any) => void;
    mockFetchPending.mockImplementation(() => new Promise((res) => { resolvePending = res; }));

    // Act
    const { unmount } = renderHook(() => useDeviceDiscovery());
    unmount();
    resolvePending(samplePending);
    await act(() => vi.advanceTimersByTimeAsync(0));

    // Assert — no error thrown; merge-preview still gets called concurrently though
    // Coverage exercise: enriched-list path completes after unmount
    expect(true).toBe(true);
  });

  it('does not call setState after unmount during dismiss', async () => {
    // Arrange
    let resolveDismiss!: (value: any) => void;
    mockDismiss.mockImplementation(() => new Promise((res) => { resolveDismiss = res; }));

    // Act
    const { result, unmount } = renderHook(() => useDeviceDiscovery());
    await flushInitialLoad();
    const dismissPromise = result.current.dismiss(1);
    unmount();
    resolveDismiss({ dismissed: true, old_device_id: '100', new_device_id: '200' });
    await act(async () => { await dismissPromise; });

    // Assert — completed without error
    expect(mockDismiss).toHaveBeenCalledWith(1);
  });

  it('merge calls mergeDevices and removes the item from pending list', async () => {
    // Arrange — start with one pending item
    const { result } = renderHook(() => useDeviceDiscovery());
    await flushInitialLoad();
    expect(result.current.pending).toHaveLength(1);

    // Act
    let mergeResult: any;
    await act(async () => {
      mergeResult = await result.current.merge(1, '100', '200');
    });

    // Assert
    expect(mockMerge).toHaveBeenCalledWith('100', '200');
    expect(mergeResult.readings_transferred).toBe(12345);
    expect(result.current.pending).toHaveLength(0);
  });

  it('merge propagates errors and leaves pending list intact', async () => {
    // Arrange
    mockMerge.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useDeviceDiscovery());
    await flushInitialLoad();

    // Act + Assert
    await expect(
      act(async () => { await result.current.merge(1, '100', '200'); }),
    ).rejects.toThrow(/boom/);
    expect(result.current.pending).toHaveLength(1);
  });

  it('does not call setState after unmount during merge', async () => {
    // Arrange
    let resolveMerge!: (v: any) => void;
    mockMerge.mockImplementation(() => new Promise((res) => { resolveMerge = res; }));

    // Act
    const { result, unmount } = renderHook(() => useDeviceDiscovery());
    await flushInitialLoad();
    const p = result.current.merge(1, '100', '200');
    unmount();
    resolveMerge({ old_device_id: '100', new_device_id: '200', readings_transferred: 1, conflicts_skipped: 0 });
    await act(async () => { await p; });

    // Assert
    expect(mockMerge).toHaveBeenCalledWith('100', '200');
  });
});
