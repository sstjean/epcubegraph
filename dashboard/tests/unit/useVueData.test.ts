import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/preact';

vi.mock('../../src/api', () => ({
  fetchVueBulkCurrentReadings: vi.fn(),
  fetchSettings: vi.fn(),
  fetchHierarchy: vi.fn(),
}));

vi.mock('../../src/telemetry', () => ({
  trackException: vi.fn(),
}));

import { fetchVueBulkCurrentReadings, fetchSettings, fetchHierarchy } from '../../src/api';
import { trackException } from '../../src/telemetry';
import { useVueData, isValidVueDeviceMapping } from '../../src/hooks/useVueData';

const mockFetchVueReadings = fetchVueBulkCurrentReadings as ReturnType<typeof vi.fn>;
const mockFetchSettings = fetchSettings as ReturnType<typeof vi.fn>;
const mockFetchHierarchy = fetchHierarchy as ReturnType<typeof vi.fn>;
const mockTrackException = trackException as ReturnType<typeof vi.fn>;

const vueReadingsResponse = {
  devices: [
    { device_gid: 123, timestamp: 1000, channels: [{ channel_num: '1,2,3', display_name: 'Main', watts: 500 }] },
  ],
};

const settingsResponse = {
  settings: [
    { key: 'vue_device_mapping', value: '{"panel1":{"gid":123,"alias":"Main Panel"}}' },
  ],
};

const hierarchyResponse = {
  entries: [{ id: 1, parent_device_gid: 100, child_device_gid: 123 }],
};

/** Flush the initial useEffect calls and their resolved promises. */
async function flushInitialLoad() {
  await act(() => vi.advanceTimersByTimeAsync(0));
}

describe('useVueData', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockFetchVueReadings.mockResolvedValue(vueReadingsResponse);
    mockFetchSettings.mockResolvedValue(settingsResponse);
    mockFetchHierarchy.mockResolvedValue(hierarchyResponse);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('returns initial state before data loads', () => {
    // Arrange: block all fetches from resolving
    mockFetchVueReadings.mockReturnValue(new Promise(() => {}));
    mockFetchSettings.mockReturnValue(new Promise(() => {}));
    mockFetchHierarchy.mockReturnValue(new Promise(() => {}));

    // Act
    const { result } = renderHook(() => useVueData());

    // Assert
    expect(result.current.vueCurrentReadings).toBeUndefined();
    expect(result.current.vueDeviceMapping).toBeUndefined();
    expect(result.current.vueError).toBeNull();
    expect(result.current.hierarchyEntries).toEqual([]);
  });

  it('loads vue readings on mount', async () => {
    // Act
    const { result } = renderHook(() => useVueData());
    await flushInitialLoad();

    // Assert
    expect(mockFetchVueReadings).toHaveBeenCalledTimes(1);
    expect(result.current.vueCurrentReadings).toEqual(vueReadingsResponse);
    expect(result.current.vueError).toBeNull();
  });

  it('loads settings and hierarchy on mount', async () => {
    // Act
    const { result } = renderHook(() => useVueData());
    await flushInitialLoad();

    // Assert
    expect(mockFetchSettings).toHaveBeenCalledTimes(1);
    expect(mockFetchHierarchy).toHaveBeenCalledTimes(1);
    expect(result.current.hierarchyEntries).toEqual(hierarchyResponse.entries);
    expect(result.current.vueDeviceMapping).toEqual({ panel1: { gid: 123, alias: 'Main Panel' } });
  });

  it('polls vue readings every 1 second', async () => {
    // Arrange
    renderHook(() => useVueData());
    await flushInitialLoad();
    vi.clearAllMocks();
    mockFetchVueReadings.mockResolvedValue(vueReadingsResponse);

    // Act — advance 3 seconds
    await act(() => vi.advanceTimersByTimeAsync(3000));

    // Assert
    expect(mockFetchVueReadings).toHaveBeenCalledTimes(3);
  });

  it('polls settings/hierarchy every 60 seconds', async () => {
    // Arrange
    renderHook(() => useVueData());
    await flushInitialLoad();
    vi.clearAllMocks();
    mockFetchSettings.mockResolvedValue(settingsResponse);
    mockFetchHierarchy.mockResolvedValue(hierarchyResponse);

    // Act — advance 120 seconds
    await act(() => vi.advanceTimersByTimeAsync(120_000));

    // Assert
    expect(mockFetchSettings).toHaveBeenCalledTimes(2);
    expect(mockFetchHierarchy).toHaveBeenCalledTimes(2);
  });

  it('sets vueError and tracks exception when readings fetch fails', async () => {
    // Arrange
    const error = new Error('Network error');
    mockFetchVueReadings.mockRejectedValue(error);

    // Act
    const { result } = renderHook(() => useVueData());
    await flushInitialLoad();

    // Assert
    expect(result.current.vueError).toBe('Network error');
    expect(mockTrackException).toHaveBeenCalledWith(error);
  });

  it('sets vueError with fallback message for non-Error throws', async () => {
    // Arrange
    mockFetchVueReadings.mockRejectedValue('string error');

    // Act
    const { result } = renderHook(() => useVueData());
    await flushInitialLoad();

    // Assert
    expect(result.current.vueError).toBe('Vue readings unavailable');
    expect(mockTrackException).toHaveBeenCalledWith(expect.any(Error));
  });

  it('clears vueError on successful readings after failure', async () => {
    // Arrange — first call fails, second succeeds
    mockFetchVueReadings.mockRejectedValueOnce(new Error('Temporary failure'));
    mockFetchVueReadings.mockResolvedValue(vueReadingsResponse);

    // Act
    const { result } = renderHook(() => useVueData());
    await flushInitialLoad();
    expect(result.current.vueError).toBe('Temporary failure');

    // Tick forward 1 second for next poll
    await act(() => vi.advanceTimersByTimeAsync(1000));

    // Assert
    expect(result.current.vueError).toBeNull();
    expect(result.current.vueCurrentReadings).toEqual(vueReadingsResponse);
  });

  it('sets vueDeviceMapping to undefined when setting is missing', async () => {
    // Arrange
    mockFetchSettings.mockResolvedValue({ settings: [] });

    // Act
    const { result } = renderHook(() => useVueData());
    await flushInitialLoad();

    // Assert
    expect(result.current.vueDeviceMapping).toBeUndefined();
  });

  it('sets vueDeviceMapping to undefined when JSON parse fails', async () => {
    // Arrange
    mockFetchSettings.mockResolvedValue({
      settings: [{ key: 'vue_device_mapping', value: 'not valid json' }],
    });

    // Act
    const { result } = renderHook(() => useVueData());
    await flushInitialLoad();

    // Assert
    expect(result.current.vueDeviceMapping).toBeUndefined();
    expect(mockTrackException).toHaveBeenCalled();
  });

  it('catches hierarchy fetch errors gracefully and defaults to empty entries', async () => {
    // Arrange
    mockFetchHierarchy.mockRejectedValue(new Error('hierarchy down'));

    // Act
    const { result } = renderHook(() => useVueData());
    await flushInitialLoad();

    // Assert
    expect(result.current.hierarchyEntries).toEqual([]);
  });

  it('tracks exception when settings fetch fails', async () => {
    // Arrange
    const error = new Error('settings fetch failed');
    mockFetchSettings.mockRejectedValue(error);

    // Act
    renderHook(() => useVueData());
    await flushInitialLoad();

    // Assert
    expect(mockTrackException).toHaveBeenCalledWith(error);
  });

  it('tracks exception for non-Error settings failures via toTrackedError', async () => {
    // Arrange
    mockFetchSettings.mockRejectedValue('string failure');

    // Act
    renderHook(() => useVueData());
    await flushInitialLoad();

    // Assert — toTrackedError wraps non-Errors and always tracks
    expect(mockTrackException).toHaveBeenCalledWith(expect.any(Error));
  });

  it('clears polling intervals on unmount', async () => {
    // Arrange
    const { unmount } = renderHook(() => useVueData());
    await flushInitialLoad();
    vi.clearAllMocks();

    // Act
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(5000));

    // Assert — no further fetches after unmount
    expect(mockFetchVueReadings).not.toHaveBeenCalled();
    expect(mockFetchSettings).not.toHaveBeenCalled();
  });

  it('does not track errors when readings reject after unmount', async () => {
    // Arrange — readings reject after unmount
    let rejectReadings!: (err: Error) => void;
    mockFetchVueReadings.mockReturnValue(new Promise((_r, rej) => { rejectReadings = rej; }));

    const { unmount } = renderHook(() => useVueData());

    // Act — unmount, then reject the in-flight fetch
    unmount();
    vi.clearAllMocks();
    rejectReadings(new Error('late failure'));
    await act(() => vi.advanceTimersByTimeAsync(0));

    // Assert — toTrackedError should not be called post-unmount
    expect(mockTrackException).not.toHaveBeenCalled();
  });

  it('does not update state when readings resolve after unmount', async () => {
    // Arrange — readings resolve after unmount
    let resolveReadings!: (v: typeof vueReadingsResponse) => void;
    mockFetchVueReadings.mockReturnValue(new Promise((r) => { resolveReadings = r; }));

    const { result, unmount } = renderHook(() => useVueData());

    // Act — unmount, then resolve
    unmount();
    resolveReadings(vueReadingsResponse);
    await act(() => vi.advanceTimersByTimeAsync(0));

    // Assert — readings not applied
    expect(result.current.vueCurrentReadings).toBeUndefined();
  });

  it('does not update state when settings resolve after unmount', async () => {
    // Arrange — settings resolve after unmount
    let resolveSettings!: (v: typeof settingsResponse) => void;
    mockFetchSettings.mockReturnValue(new Promise((r) => { resolveSettings = r; }));

    const { result, unmount } = renderHook(() => useVueData());

    // Act — unmount, then resolve settings
    unmount();
    resolveSettings(settingsResponse);
    await act(() => vi.advanceTimersByTimeAsync(0));

    // Assert — mapping not applied
    expect(result.current.vueDeviceMapping).toBeUndefined();
  });

  it('does not track errors when settings reject after unmount', async () => {
    // Arrange — settings reject after unmount
    let rejectSettings!: (err: Error) => void;
    mockFetchSettings.mockReturnValue(new Promise((_r, rej) => { rejectSettings = rej; }));

    const { unmount } = renderHook(() => useVueData());

    // Act — unmount, then reject settings
    unmount();
    vi.clearAllMocks();
    rejectSettings(new Error('late settings failure'));
    await act(() => vi.advanceTimersByTimeAsync(0));

    // Assert — toTrackedError should not be called post-unmount
    expect(mockTrackException).not.toHaveBeenCalled();
  });

  it('sets vueDeviceMapping to undefined and tracks error when old array format is detected', async () => {
    // Arrange — old array format
    mockFetchSettings.mockResolvedValue({
      settings: [{ key: 'vue_device_mapping', value: '{"panel1":[{"gid":123,"alias":"Main Panel"}]}' }],
    });

    // Act
    const { result } = renderHook(() => useVueData());
    await flushInitialLoad();

    // Assert — mapping rejected, error tracked
    expect(result.current.vueDeviceMapping).toBeUndefined();
    expect(mockTrackException).toHaveBeenCalled();
  });
});

describe('isValidVueDeviceMapping', () => {
  it('returns true for valid single-object format', () => {
    // Arrange
    const input = { epcube3483: { gid: 480380, alias: 'Main Panel' } };

    // Act
    const result = isValidVueDeviceMapping(input);

    // Assert
    expect(result).toBe(true);
  });

  it('returns true for empty object (no mappings)', () => {
    // Arrange
    const input = {};

    // Act
    const result = isValidVueDeviceMapping(input);

    // Assert
    expect(result).toBe(true);
  });

  it('returns true for multiple EP Cube mappings', () => {
    // Arrange
    const input = {
      epcube3483: { gid: 480380, alias: 'Main Panel' },
      epcube9999: { gid: 480544, alias: 'Subpanel 1' },
    };

    // Act
    const result = isValidVueDeviceMapping(input);

    // Assert
    expect(result).toBe(true);
  });

  it('returns false for old array format', () => {
    // Arrange
    const input = { epcube3483: [{ gid: 480380, alias: 'Main Panel' }] };

    // Act
    const result = isValidVueDeviceMapping(input);

    // Assert
    expect(result).toBe(false);
  });

  it('returns false for null', () => {
    // Act
    const result = isValidVueDeviceMapping(null);

    // Assert
    expect(result).toBe(false);
  });

  it('returns false for non-object (string)', () => {
    // Act
    const result = isValidVueDeviceMapping('not an object');

    // Assert
    expect(result).toBe(false);
  });

  it('returns false for array at root', () => {
    // Act
    const result = isValidVueDeviceMapping([{ gid: 1, alias: 'x' }]);

    // Assert
    expect(result).toBe(false);
  });

  it('returns false when gid is missing', () => {
    // Arrange
    const input = { epcube3483: { alias: 'Main Panel' } };

    // Act
    const result = isValidVueDeviceMapping(input);

    // Assert
    expect(result).toBe(false);
  });

  it('returns false when alias is missing', () => {
    // Arrange
    const input = { epcube3483: { gid: 480380 } };

    // Act
    const result = isValidVueDeviceMapping(input);

    // Assert
    expect(result).toBe(false);
  });

  it('returns false when gid is not a number', () => {
    // Arrange
    const input = { epcube3483: { gid: '480380', alias: 'Main Panel' } };

    // Act
    const result = isValidVueDeviceMapping(input);

    // Assert
    expect(result).toBe(false);
  });

  it('returns false when alias is not a string', () => {
    // Arrange
    const input = { epcube3483: { gid: 480380, alias: 42 } };

    // Act
    const result = isValidVueDeviceMapping(input);

    // Assert
    expect(result).toBe(false);
  });

  it('returns false when value is null', () => {
    // Arrange
    const input = { epcube3483: null };

    // Act
    const result = isValidVueDeviceMapping(input);

    // Assert
    expect(result).toBe(false);
  });

  it('returns false when gid is a float', () => {
    // Arrange
    const input = { epcube3483: { gid: 480380.5, alias: 'Main Panel' } };

    // Act
    const result = isValidVueDeviceMapping(input);

    // Assert
    expect(result).toBe(false);
  });

  it('returns true when panel has extra properties (ignored)', () => {
    // Arrange — extra fields beyond gid/alias are tolerated
    const input = { epcube3483: { gid: 480380, alias: 'Main Panel', extra: 'ignored' } };

    // Act
    const result = isValidVueDeviceMapping(input);

    // Assert
    expect(result).toBe(true);
  });

  it('returns false for undefined input', () => {
    // Act
    const result = isValidVueDeviceMapping(undefined);

    // Assert
    expect(result).toBe(false);
  });
});
