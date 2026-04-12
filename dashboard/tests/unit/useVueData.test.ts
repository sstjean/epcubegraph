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
import { useVueData } from '../../src/hooks/useVueData';

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
    { key: 'vue_device_mapping', value: '{"panel1":[{"gid":123,"alias":"Main Panel"}]}' },
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
    expect(result.current.vueDeviceMapping).toEqual({ panel1: [{ gid: 123, alias: 'Main Panel' }] });
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
});
