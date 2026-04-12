import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/preact';
import { h } from 'preact';
import { fetchDevices, fetchCurrentReadings } from '../../src/api';
import { createPollingInterval, clearPollingInterval } from '../../src/utils/polling';
import { withRetry } from '../../src/utils/retry';
import { CurrentReadings } from '../../src/components/CurrentReadings';
import { useVueData } from '../../src/hooks/useVueData';

// Mock external dependencies
vi.mock('../../src/api', () => ({
  fetchDevices: vi.fn(),
  fetchCurrentReadings: vi.fn(),
}));

vi.mock('../../src/hooks/useVueData', () => ({
  useVueData: vi.fn().mockReturnValue({
    vueCurrentReadings: undefined,
    vueDeviceMapping: undefined,
    vueError: null,
    hierarchyEntries: [],
  }),
}));

vi.mock('../../src/utils/polling', () => ({
  createPollingInterval: vi.fn(),
  clearPollingInterval: vi.fn(),
  DEFAULT_INTERVAL_MS: 30_000,
}));

vi.mock('../../src/utils/retry', () => ({
  withRetry: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
  isRetryableError: vi.fn(),
}));

vi.mock('../../src/telemetry', () => ({
  trackException: vi.fn(),
  trackApiError: vi.fn(),
  trackPageLoad: vi.fn(),
  initTelemetry: vi.fn(),
}));

const mockUseVueData = useVueData as ReturnType<typeof vi.fn>;
const mockFetchDevices = fetchDevices as ReturnType<typeof vi.fn>;
const mockFetchCurrentReadings = fetchCurrentReadings as ReturnType<typeof vi.fn>;
const mockCreatePolling = createPollingInterval as ReturnType<typeof vi.fn>;
const mockWithRetry = withRetry as ReturnType<typeof vi.fn>;

const emptyMetricResponse = {
  metric: 'test_metric',
  readings: [],
};

function setupCommonMocks() {
  mockWithRetry.mockImplementation((fn: () => Promise<unknown>) => fn());
  mockCreatePolling.mockReturnValue(1);
}

describe('CurrentReadings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it('renders as <section> with heading (FR-015)', async () => {
    // Arrange
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({ devices: [] });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      const section = document.querySelector('section');
      expect(section).toBeTruthy();
      expect(screen.getByRole('heading')).toBeTruthy();
    });
  });

  it('renders loading state with aria-busy="true" initially', () => {
    // Arrange
    setupCommonMocks();
    mockFetchDevices.mockReturnValue(new Promise(() => {})); // never resolves
    mockFetchCurrentReadings.mockReturnValue(new Promise(() => {}));

    // Act
    render(<CurrentReadings />);

    // Assert
    const section = document.querySelector('section');
    expect(section?.getAttribute('aria-busy')).toBe('true');
  });

  it('fetches devices and all metric queries on mount', async () => {
    // Arrange
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({ devices: [] });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(mockFetchDevices).toHaveBeenCalledTimes(1);
      // 6 metric queries: battery SOC, battery power, solar, grid, home load, battery stored kWh
      expect(mockFetchCurrentReadings).toHaveBeenCalledTimes(6);
    });
  });

  it('groups battery+solar devices into one card per alias', async () => {
    // Arrange
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube5488_battery', class: 'storage_battery', online: true, alias: 'EP Cube v2 Battery' },
        { device: 'epcube5488_solar', class: 'home_solar', online: true, alias: 'EP Cube v2 Solar' },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert — one grouped card, not two
    await waitFor(() => {
      const articles = document.querySelectorAll('article');
      expect(articles.length).toBe(1);
      expect(screen.getByText('EP Cube v2')).toBeTruthy();
    });
  });

  it('matches metric values to correct device in group', async () => {
    // Arrange
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube5488_battery', class: 'storage_battery', online: true, alias: 'EP Cube v2 Battery' },
        { device: 'epcube5488_solar', class: 'home_solar', online: true, alias: 'EP Cube v2 Solar' },
      ],
    });
    // Battery SOC, Battery Power, Solar, Grid, Home Load, Battery Stored kWh — each returns device-specific results
    mockFetchCurrentReadings
      .mockResolvedValueOnce({ metric: 'battery_state_of_capacity_percent', readings: [
        { device_id: 'epcube5488_battery', timestamp: 1, value: 97 },
      ]})
      .mockResolvedValueOnce({ metric: 'battery_power_watts', readings: [
        { device_id: 'epcube5488_battery', timestamp: 1, value: 1234 },
      ]})
      .mockResolvedValueOnce({ metric: 'solar_instantaneous_generation_watts', readings: [
        { device_id: 'epcube5488_solar', timestamp: 1, value: 5678 },
      ]})
      .mockResolvedValueOnce({ metric: 'grid_power_watts', readings: [
        { device_id: 'epcube5488_battery', timestamp: 1, value: 3456 },
      ]})
      .mockResolvedValueOnce({ metric: 'home_load_power_watts', readings: [
        { device_id: 'epcube5488_battery', timestamp: 1, value: 2345 },
      ]})
      .mockResolvedValueOnce({ metric: 'battery_stored_kwh', readings: [
        { device_id: 'epcube5488_battery', timestamp: 1, value: 9.876 },
      ]});

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/97\.0%/)).toBeTruthy();
      expect(screen.getByText(/9\.876 kWh/)).toBeTruthy();
      expect(screen.getByText('5.678 kW')).toBeTruthy();
    });
  });

  it('shows error state when API fails', async () => {
    // Arrange
    setupCommonMocks();
    mockFetchDevices.mockRejectedValue(new Error('Network error'));
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/error|failed|network/i)).toBeTruthy();
    });
  });

  it('triggers polling refresh via createPollingInterval', async () => {
    // Arrange
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({ devices: [] });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(mockCreatePolling).toHaveBeenCalled();
    });
  });

  it('handles non-Error thrown objects', async () => {
    // Arrange
    setupCommonMocks();
    mockFetchDevices.mockRejectedValue('string error');
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/failed to load data/i)).toBeTruthy();
    });
  });

  it('shows "No devices found" when API returns empty list', async () => {
    // Arrange
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({ devices: [] });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/no devices found/i)).toBeTruthy();
    });
  });

  it('defaults metrics to zero when group has no battery device', async () => {
    // Arrange — solar-only device with no battery counterpart
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube9999_solar', class: 'home_solar', online: true, alias: 'Solar Only Solar' },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert — card renders with zero-default battery metrics
    await waitFor(() => {
      const articles = document.querySelectorAll('article');
      expect(articles.length).toBe(1);
      expect(screen.getByText('Solar Only')).toBeTruthy();
    });
  });

  it('defaults solar watts to zero when group has no solar device', async () => {
    // Arrange — battery-only device with no solar counterpart
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube9999_battery', class: 'storage_battery', online: true, alias: 'Battery Only Battery' },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert — card renders with zero-default solar metrics
    await waitFor(() => {
      const articles = document.querySelectorAll('article');
      expect(articles.length).toBe(1);
      expect(screen.getByText('Battery Only')).toBeTruthy();
    });
  });

  it('uses device id as group name when no alias is set', async () => {
    // Arrange — device without alias, falls back to device id parsing
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube3483_battery', class: 'storage_battery', online: true },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert — uses formatted device id as name
    await waitFor(() => {
      expect(screen.getByText('EP Cube 3483')).toBeTruthy();
    });
  });

  it('uses raw device base when id does not match epcube pattern', async () => {
    // Arrange — device with non-standard id format
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'custom_device_battery', class: 'storage_battery', online: true },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert — uses raw base name
    await waitFor(() => {
      expect(screen.getByText('custom_device')).toBeTruthy();
    });
  });

  it('defaults to flow view and shows EnergyFlowDiagram when devices loaded', async () => {
    // Arrange
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube1_battery', class: 'storage_battery', online: true, alias: 'EP Cube v1 Battery' },
        { device: 'epcube1_solar', class: 'home_solar', online: true, alias: 'EP Cube v1 Solar' },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert — flow view is default, flow diagram renders as article
    await waitFor(() => {
      const flowButton = screen.getByText('Flow');
      expect(flowButton.getAttribute('aria-pressed')).toBe('true');
      const articles = document.querySelectorAll('article');
      expect(articles.length).toBe(1);
    });
  });

  it('switches to gauges view when Gauges button is clicked', async () => {
    // Arrange
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube1_battery', class: 'storage_battery', online: true, alias: 'EP Cube v1 Battery' },
        { device: 'epcube1_solar', class: 'home_solar', online: true, alias: 'EP Cube v1 Solar' },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    await waitFor(() => {
      expect(screen.getByText('EP Cube v1')).toBeTruthy();
    });

    // Click Gauges button
    fireEvent.click(screen.getByText('Gauges'));

    // Assert — gauges view shows DeviceCard with gauge-grid
    await waitFor(() => {
      const gaugesButton = screen.getByText('Gauges');
      expect(gaugesButton.getAttribute('aria-pressed')).toBe('true');
      const gaugeGrids = document.querySelectorAll('.gauge-grid');
      expect(gaugeGrids.length).toBe(1);
    });
  });

  it('switches back to flow view from gauges view', async () => {
    // Arrange
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube1_battery', class: 'storage_battery', online: true, alias: 'EP Cube v1 Battery' },
        { device: 'epcube1_solar', class: 'home_solar', online: true, alias: 'EP Cube v1 Solar' },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    await waitFor(() => {
      expect(screen.getByText('EP Cube v1')).toBeTruthy();
    });

    // Switch to gauges, then back to flow
    fireEvent.click(screen.getByText('Gauges'));
    fireEvent.click(screen.getByText('Flow'));

    // Assert — flow diagram visible again
    await waitFor(() => {
      const flowButton = screen.getByText('Flow');
      expect(flowButton.getAttribute('aria-pressed')).toBe('true');
      const svg = document.querySelector('.energy-flow-svg');
      expect(svg).toBeTruthy();
    });
  });

  it('renders view toggle group with proper aria', async () => {
    // Arrange
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({ devices: [] });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      const group = screen.getByRole('group');
      expect(group).toBeTruthy();
      expect(group.getAttribute('aria-label')).toBe('View mode');
    });
  });

  it('does not render flow diagram when no devices are loaded', async () => {
    // Arrange
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({ devices: [] });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert — no flow diagram, no gauge cards
    await waitFor(() => {
      const svg = document.querySelector('.energy-flow-svg');
      expect(svg).toBeNull();
    });
  });

  it('preserves grid sign convention (positive=import, negative=export)', async () => {
    // Arrange — grid value is negative (exporting to grid)
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube5488_battery', class: 'storage_battery', online: true, alias: 'EP Cube v2 Battery' },
        { device: 'epcube5488_solar', class: 'home_solar', online: true, alias: 'EP Cube v2 Solar' },
      ],
    });
    mockFetchCurrentReadings
      .mockResolvedValueOnce({ metric: 'battery_state_of_capacity_percent', readings: [
        { device_id: 'epcube5488_battery', timestamp: 1, value: 90 },
      ]})
      .mockResolvedValueOnce({ metric: 'battery_power_watts', readings: [
        { device_id: 'epcube5488_battery', timestamp: 1, value: 500 },
      ]})
      .mockResolvedValueOnce({ metric: 'solar_instantaneous_generation_watts', readings: [
        { device_id: 'epcube5488_solar', timestamp: 1, value: 6000 },
      ]})
      .mockResolvedValueOnce({ metric: 'grid_power_watts', readings: [
        { device_id: 'epcube5488_battery', timestamp: 1, value: -3500 },
      ]})
      .mockResolvedValueOnce({ metric: 'home_load_power_watts', readings: [
        { device_id: 'epcube5488_battery', timestamp: 1, value: 1200 },
      ]})
      .mockResolvedValueOnce({ metric: 'battery_stored_kwh', readings: [
        { device_id: 'epcube5488_battery', timestamp: 1, value: 9.0 },
      ]});

    // Act
    render(<CurrentReadings />);

    // Assert — negative grid value means exporting; flow diagram should show "exporting" sublabel
    await waitFor(() => {
      expect(screen.getByText('exporting')).toBeTruthy();
    });
  });

  it('shows retry count during reconnection attempts', async () => {
    // Arrange — withRetry calls onRetry before each retry delay
    mockWithRetry.mockImplementation(async (fn: () => Promise<unknown>, options?: { onRetry?: (n: number) => void }) => {
      if (options?.onRetry) {
        options.onRetry(3);
      }
      return fn();
    });
    mockFetchDevices.mockResolvedValue({ devices: [] });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/Reconnecting… attempt 3 of 10/)).toBeTruthy();
    });
  });

  it('clears retry count on successful load', async () => {
    // Arrange — withRetry succeeds without calling onRetry
    mockWithRetry.mockImplementation((fn: () => Promise<unknown>) => fn());
    mockFetchDevices.mockResolvedValue({ devices: [] });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert — no retry notice visible
    await waitFor(() => {
      expect(screen.queryByText(/Reconnecting/)).toBeNull();
    });
  });

  it('wraps loadData batch in withRetry', async () => {
    // Arrange
    mockWithRetry.mockImplementation((fn: () => Promise<unknown>) => fn());
    mockFetchDevices.mockResolvedValue({ devices: [] });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(mockWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ maxRetries: 10 }),
      );
    });
  });

  it('skips polling tick while retry is in progress', async () => {
    // Arrange — withRetry resolves after we capture the polling callback
    let retryResolve!: (v: unknown) => void;
    mockWithRetry.mockReturnValue(new Promise((r) => { retryResolve = r; }));
    mockFetchDevices.mockResolvedValue({ devices: [] });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    let pollingCallback: (() => void) | undefined;
    mockCreatePolling.mockImplementation((cb: () => void) => {
      pollingCallback = cb;
      return 1;
    });

    // Act
    render(<CurrentReadings />);

    // loadData is called once on mount, now simulate a polling tick while still retrying
    pollingCallback!();

    // Resolve the first withRetry call
    retryResolve([
      { devices: [] },
      emptyMetricResponse, emptyMetricResponse, emptyMetricResponse,
      emptyMetricResponse, emptyMetricResponse, emptyMetricResponse,
    ]);

    await waitFor(() => {
      // withRetry was only called once (mount) — the polling tick was skipped
      expect(mockWithRetry).toHaveBeenCalledTimes(1);
    });
  });

  // ── Vue data integration via useVueData hook (Feature 007 — US1) ──

  it('renders vueError from useVueData hook', async () => {
    // Arrange
    setupCommonMocks();
    mockUseVueData.mockReturnValue({
      vueCurrentReadings: undefined,
      vueDeviceMapping: undefined,
      vueError: 'Vue API failed',
      hierarchyEntries: [],
    });
    mockFetchDevices.mockResolvedValue({
      devices: [{ device: 'epcube_battery', class: 'storage_battery', online: true }],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/Vue circuits:.*Vue API failed/)).toBeTruthy();
    });
  });

  it('passes Vue data from hook to EnergyFlowDiagram', async () => {
    // Arrange
    setupCommonMocks();
    mockUseVueData.mockReturnValue({
      vueCurrentReadings: { devices: [] },
      vueDeviceMapping: { epcube5488: [{ gid: 480380, alias: 'Panel' }] },
      vueError: null,
      hierarchyEntries: [],
    });
    mockFetchDevices.mockResolvedValue({
      devices: [{ device: 'epcube_battery', class: 'storage_battery', online: true }],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert — renders without error (hook data wired to flow diagram)
    await waitFor(() => {
      expect(screen.queryByText(/Vue circuits:/)).toBeNull();
    });
  });

  it('renders normally when useVueData returns no Vue data', async () => {
    // Arrange
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({
      devices: [{ device: 'epcube_battery', class: 'storage_battery', online: true }],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert — EP Cube cards render, no Vue error
    await waitFor(() => {
      expect(screen.queryByText(/Vue circuits:/)).toBeNull();
    });
  });

  it('renders last updated timestamp after successful data load', async () => {
    // Arrange
    vi.useFakeTimers();
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube1_battery', class: 'storage_battery', online: true, alias: 'EP Cube v1 Battery' },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Wait for data load
    await act(() => vi.advanceTimersByTimeAsync(0));

    // Assert — "Last updated" text appears with RelativeTime
    expect(screen.getByText(/Last updated:/)).toBeTruthy();

    // Advance 1 second to invoke RelativeTime's setInterval tick
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByText(/Last updated:/)).toBeTruthy();

    vi.useRealTimers();
  });
});
