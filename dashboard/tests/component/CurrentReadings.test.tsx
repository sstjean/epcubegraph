import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/preact';
import { h } from 'preact';
import { fetchDevices, fetchDevicesByStatus, fetchCurrentReadings } from '../../src/api';
import { useDeviceDiscoveryContext } from '../../src/hooks/useDeviceDiscovery';
import { createPollingInterval, clearPollingInterval } from '../../src/utils/polling';
import { withRetry } from '../../src/utils/retry';
import { CurrentReadings } from '../../src/components/CurrentReadings';
import { useVueData } from '../../src/hooks/useVueData';

// Mock external dependencies
vi.mock('../../src/api', () => ({
  fetchDevices: vi.fn(),
  fetchDevicesByStatus: vi.fn(),
  fetchCurrentReadings: vi.fn(),
}));

vi.mock('../../src/hooks/useDeviceDiscovery', () => ({
  useDeviceDiscoveryContext: vi.fn().mockReturnValue({
    pending: [],
    dismiss: vi.fn(),
    merge: vi.fn(),
    refresh: vi.fn(),
  }),
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
const mockFetchDevicesByStatus = fetchDevicesByStatus as ReturnType<typeof vi.fn>;
const mockFetchCurrentReadings = fetchCurrentReadings as ReturnType<typeof vi.fn>;
const mockUseDeviceDiscoveryContext = useDeviceDiscoveryContext as ReturnType<typeof vi.fn>;
const mockCreatePolling = createPollingInterval as ReturnType<typeof vi.fn>;
const mockWithRetry = withRetry as ReturnType<typeof vi.fn>;

const emptyMetricResponse = {
  metric: 'test_metric',
  readings: [],
};

function setupCommonMocks() {
  mockWithRetry.mockImplementation((fn: () => Promise<unknown>) => fn());
  mockCreatePolling.mockReturnValue(1);
  mockFetchDevicesByStatus.mockResolvedValue({ devices: [] });
  mockUseDeviceDiscoveryContext.mockReturnValue({
    pending: [],
    dismiss: vi.fn(),
    merge: vi.fn(),
    refresh: vi.fn(),
  });
}

describe('CurrentReadings', () => {
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

  // ---------------------------------------------------------------------------
  // T054: Removed-device visibility toggle
  // ---------------------------------------------------------------------------

  it('does not show removed-device toggle when no removed devices exist', async () => {
    // Arrange
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube1_battery', class: 'storage_battery', online: true, alias: 'EP Cube v1 Battery' },
      ],
    });
    mockFetchDevicesByStatus.mockResolvedValue({ devices: [] });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(screen.queryByRole('checkbox', { name: /show removed devices/i })).toBeNull();
    });
  });

  it('shows removed-device toggle when removed devices exist', async () => {
    // Arrange
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube1_battery', class: 'storage_battery', online: true, alias: 'EP Cube v1 Battery' },
        { device: 'epcube1_solar', class: 'home_solar', online: true, alias: 'EP Cube v1 Solar' },
      ],
    });
    mockFetchDevicesByStatus.mockResolvedValue({
      devices: [
        { device: 'epcube2_battery', class: 'storage_battery', online: false, alias: 'EP Cube v2 Battery' },
        { device: 'epcube2_solar', class: 'home_solar', online: false, alias: 'EP Cube v2 Solar' },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /show removed devices/i })).toBeTruthy();
    });
  });

  it('removed-device toggle defaults to checked (show removed)', async () => {
    // Arrange
    setupCommonMocks();
    localStorage.removeItem('showRemovedDevices');
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube1_battery', class: 'storage_battery', online: true, alias: 'Active Battery' },
      ],
    });
    mockFetchDevicesByStatus.mockResolvedValue({
      devices: [
        { device: 'epcube2_battery', class: 'storage_battery', online: false, alias: 'Removed Battery' },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      const toggle = screen.getByRole('checkbox', { name: /show removed devices/i }) as HTMLInputElement;
      expect(toggle.checked).toBe(true);
    });
  });

  it('removed devices shown with grayed-out styling when toggle is on', async () => {
    // Arrange
    setupCommonMocks();
    localStorage.setItem('showRemovedDevices', 'true');
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube1_battery', class: 'storage_battery', online: true, alias: 'Active Battery' },
        { device: 'epcube1_solar', class: 'home_solar', online: true, alias: 'Active Solar' },
      ],
    });
    mockFetchDevicesByStatus.mockResolvedValue({
      devices: [
        { device: 'epcube2_battery', class: 'storage_battery', online: false, alias: 'Old Battery' },
        { device: 'epcube2_solar', class: 'home_solar', online: false, alias: 'Old Solar' },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert — removed device group rendered with device-removed class
    await waitFor(() => {
      const removedEl = document.querySelector('.device-removed');
      expect(removedEl).toBeTruthy();
    });
  });

  it('removed devices hidden when toggle is off', async () => {
    // Arrange
    setupCommonMocks();
    localStorage.setItem('showRemovedDevices', 'false');
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube1_battery', class: 'storage_battery', online: true, alias: 'Active Battery' },
        { device: 'epcube1_solar', class: 'home_solar', online: true, alias: 'Active Solar' },
      ],
    });
    mockFetchDevicesByStatus.mockResolvedValue({
      devices: [
        { device: 'epcube2_battery', class: 'storage_battery', online: false, alias: 'Old Battery' },
        { device: 'epcube2_solar', class: 'home_solar', online: false, alias: 'Old Solar' },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert — no removed device elements rendered
    await waitFor(() => {
      expect(document.querySelector('.device-removed')).toBeNull();
    });
  });

  it('toggling off persists to localStorage and hides removed devices', async () => {
    // Arrange
    setupCommonMocks();
    localStorage.setItem('showRemovedDevices', 'true');
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube1_battery', class: 'storage_battery', online: true, alias: 'Active Battery' },
      ],
    });
    mockFetchDevicesByStatus.mockResolvedValue({
      devices: [
        { device: 'epcube2_battery', class: 'storage_battery', online: false, alias: 'Old Battery' },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /show removed devices/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /show removed devices/i }));

    // Assert
    expect(localStorage.getItem('showRemovedDevices')).toBe('false');
    await waitFor(() => {
      expect(document.querySelector('.device-removed')).toBeNull();
    });
  });

  it('toggling on persists to localStorage and shows removed devices', async () => {
    // Arrange
    setupCommonMocks();
    localStorage.setItem('showRemovedDevices', 'false');
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube1_battery', class: 'storage_battery', online: true, alias: 'Active Battery' },
      ],
    });
    mockFetchDevicesByStatus.mockResolvedValue({
      devices: [
        { device: 'epcube2_battery', class: 'storage_battery', online: false, alias: 'Old Battery' },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /show removed devices/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /show removed devices/i }));

    // Assert
    expect(localStorage.getItem('showRemovedDevices')).toBe('true');
    await waitFor(() => {
      expect(document.querySelector('.device-removed')).toBeTruthy();
    });
  });

  it('annotates device card with pending merge note when old and new devices share a display name', async () => {
    // Arrange — old and new both devType=2 → both resolve to "EP Cube v2"
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube5840_battery', class: 'storage_battery', online: true, product_code: 'EP Cube (devType=2)', alias: 'My EP Cube' },
        { device: 'epcube5840_solar', class: 'home_solar', online: true, product_code: 'EP Cube (devType=2)', alias: 'My EP Cube' },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);
    mockUseDeviceDiscoveryContext.mockReturnValue({
      pending: [
        {
          id: 1,
          old_device_id: '5488',
          new_device_id: '5840',
          detected_at: '2026-05-16T12:00:00Z',
          old_product_code: 'EP Cube (devType=2)',
          new_product_code: 'EP Cube (devType=2)',
        },
      ],
      dismiss: vi.fn(),
      merge: vi.fn(),
      refresh: vi.fn(),
    });

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/These are the new device readings/)).toBeTruthy();
      expect(screen.getByText(/The old device is offline/)).toBeTruthy();
    });
    // Title remains clean — no inline annotation
    expect(screen.queryByText(/pending merge/)).toBeNull();
  });

  it('does not annotate device card when no pending replacement matches', async () => {
    // Arrange
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube5840_battery', class: 'storage_battery', online: true, product_code: 'EP Cube (devType=2)', alias: 'My EP Cube' },
        { device: 'epcube5840_solar', class: 'home_solar', online: true, product_code: 'EP Cube (devType=2)', alias: 'My EP Cube' },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);
    // setupCommonMocks already sets pending=[]

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('EP Cube v2')).toBeTruthy();
    });
    expect(screen.queryByText(/new device readings/)).toBeNull();
  });

  it('does not annotate device card when old and new devices resolve to different titles', async () => {
    // Arrange — old=devType=0 ("EP Cube v1") vs new=devType=2 ("EP Cube v2"): different titles
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube5840_battery', class: 'storage_battery', online: true, product_code: 'EP Cube (devType=2)', alias: 'My EP Cube' },
        { device: 'epcube5840_solar', class: 'home_solar', online: true, product_code: 'EP Cube (devType=2)', alias: 'My EP Cube' },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);
    mockUseDeviceDiscoveryContext.mockReturnValue({
      pending: [
        {
          id: 1,
          old_device_id: '5488',
          new_device_id: '5840',
          detected_at: '2026-05-16T12:00:00Z',
          old_product_code: 'EP Cube (devType=0)',
          new_product_code: 'EP Cube (devType=2)',
        },
      ],
      dismiss: vi.fn(),
      merge: vi.fn(),
      refresh: vi.fn(),
    });

    // Act
    render(<CurrentReadings />);

    // Assert — note NOT shown because cards have distinct titles ("EP Cube v1" vs "EP Cube v2")
    await waitFor(() => {
      expect(screen.getByText('EP Cube v2')).toBeTruthy();
    });
    expect(screen.queryByText(/new device readings/)).toBeNull();
  });

  it('disambiguates duplicate display names across active groups by appending device ID', async () => {
    // Arrange — two separate active devices both resolving to "EP Cube v2"
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube5840_battery', class: 'storage_battery', online: true, product_code: 'EP Cube (devType=2)', alias: 'Cube A' },
        { device: 'epcube5840_solar', class: 'home_solar', online: true, product_code: 'EP Cube (devType=2)', alias: 'Cube A' },
        { device: 'epcube7777_battery', class: 'storage_battery', online: true, product_code: 'EP Cube (devType=2)', alias: 'Cube B' },
        { device: 'epcube7777_solar', class: 'home_solar', online: true, product_code: 'EP Cube (devType=2)', alias: 'Cube B' },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert — both rendered titles include their device ID
    await waitFor(() => {
      expect(screen.getByText('EP Cube v2 (5840)')).toBeTruthy();
      expect(screen.getByText('EP Cube v2 (7777)')).toBeTruthy();
    });
    // Original undisambiguated "EP Cube v2" should NOT appear
    expect(screen.queryByText('EP Cube v2')).toBeNull();
  });

  it('disambiguates duplicate display names across active and removed groups', async () => {
    // Arrange — active 5840 + removed 5488; both resolve to "EP Cube v2"
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube5840_battery', class: 'storage_battery', online: true, product_code: 'EP Cube (devType=2)', alias: 'New' },
      ],
    });
    mockFetchDevicesByStatus.mockResolvedValue({
      devices: [
        { device: 'epcube5488_battery', class: 'storage_battery', online: false, product_code: 'EP Cube (devType=2)', alias: 'Old' },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);
    // No pending replacement so the removed device card is visible

    // Act
    render(<CurrentReadings />);

    // Assert — both titles disambiguated with device IDs
    await waitFor(() => {
      expect(screen.getByText('EP Cube v2 (5840)')).toBeTruthy();
      expect(screen.getByText('EP Cube v2 (5488)')).toBeTruthy();
    });
  });

  it('does not disambiguate when display names are already unique', async () => {
    // Arrange — one v1, one v2 (distinct titles already)
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube3483_battery', class: 'storage_battery', online: true, product_code: 'EP Cube (devType=0)', alias: 'Cube A' },
        { device: 'epcube5840_battery', class: 'storage_battery', online: true, product_code: 'EP Cube (devType=2)', alias: 'Cube B' },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert — titles remain clean (no device-id suffix)
    await waitFor(() => {
      expect(screen.getByText('EP Cube v1')).toBeTruthy();
      expect(screen.getByText('EP Cube v2')).toBeTruthy();
    });
    expect(screen.queryByText(/EP Cube v\d+ \(\d+\)/)).toBeNull();
  });

  it('hides removed-device card while it has a pending replacement (avoids duplicate-title clutter)', async () => {
    // Arrange — old=5488 is removed, new=5840 is active, pending replacement exists.
    // Both share product_code → both resolve to "EP Cube v2".
    // Without this fix, the page shows two "EP Cube v2" cards (one normal, one faded).
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube5840_battery', class: 'storage_battery', online: true, product_code: 'EP Cube (devType=2)', alias: 'My EP Cube' },
      ],
    });
    mockFetchDevicesByStatus.mockResolvedValue({
      devices: [
        { device: 'epcube5488_battery', class: 'storage_battery', online: false, product_code: 'EP Cube (devType=2)', alias: 'My EP Cube' },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);
    mockUseDeviceDiscoveryContext.mockReturnValue({
      pending: [
        {
          id: 1,
          old_device_id: '5488',
          new_device_id: '5840',
          detected_at: '2026-05-16T12:00:00Z',
          old_product_code: 'EP Cube (devType=2)',
          new_product_code: 'EP Cube (devType=2)',
        },
      ],
      dismiss: vi.fn(),
      merge: vi.fn(),
      refresh: vi.fn(),
    });

    // Act
    render(<CurrentReadings />);

    // Assert — the removed-device card is hidden while the pending replacement exists
    await waitFor(() => {
      expect(screen.getByText(/These are the new device readings/)).toBeTruthy();
    });
    expect(document.querySelector('.device-removed')).toBeNull();
    // The "Show removed devices" toggle is also hidden since no visible removed devices exist
    expect(screen.queryByRole('checkbox', { name: /show removed devices/i })).toBeNull();
  });

  it('shows removed-device card again once the pending replacement is cleared', async () => {
    // Arrange — initial render: pending exists; rerender after dismiss: pending cleared
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube5840_battery', class: 'storage_battery', online: true, product_code: 'EP Cube (devType=2)', alias: 'My EP Cube' },
      ],
    });
    mockFetchDevicesByStatus.mockResolvedValue({
      devices: [
        { device: 'epcube5488_battery', class: 'storage_battery', online: false, product_code: 'EP Cube (devType=2)', alias: 'My EP Cube' },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);
    mockUseDeviceDiscoveryContext.mockReturnValue({
      pending: [
        {
          id: 1,
          old_device_id: '5488',
          new_device_id: '5840',
          detected_at: '2026-05-16T12:00:00Z',
          old_product_code: 'EP Cube (devType=2)',
          new_product_code: 'EP Cube (devType=2)',
        },
      ],
      dismiss: vi.fn(),
      merge: vi.fn(),
      refresh: vi.fn(),
    });

    // Act — first render: removed card hidden
    const { rerender } = render(<CurrentReadings />);
    await waitFor(() => {
      expect(screen.getByText(/These are the new device readings/)).toBeTruthy();
    });
    expect(document.querySelector('.device-removed')).toBeNull();

    // Pending is cleared (dismiss completed)
    mockUseDeviceDiscoveryContext.mockReturnValue({
      pending: [],
      dismiss: vi.fn(),
      merge: vi.fn(),
      refresh: vi.fn(),
    });
    rerender(<CurrentReadings />);

    // Assert — removed card now visible
    await waitFor(() => {
      expect(document.querySelector('.device-removed')).toBeTruthy();
    });
  });

  it('removes annotation when pending replacement is dismissed (state-driven)', async () => {
    // Arrange — start with one pending, then re-render with empty pending
    setupCommonMocks();
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube5840_battery', class: 'storage_battery', online: true, product_code: 'EP Cube (devType=2)', alias: 'My EP Cube' },
      ],
    });
    mockFetchCurrentReadings.mockResolvedValue(emptyMetricResponse);
    mockUseDeviceDiscoveryContext.mockReturnValue({
      pending: [
        {
          id: 1,
          old_device_id: '5488',
          new_device_id: '5840',
          detected_at: '2026-05-16T12:00:00Z',
          old_product_code: 'EP Cube (devType=2)',
          new_product_code: 'EP Cube (devType=2)',
        },
      ],
      dismiss: vi.fn(),
      merge: vi.fn(),
      refresh: vi.fn(),
    });

    // Act — first render shows the note
    const { rerender } = render(<CurrentReadings />);
    await waitFor(() => {
      expect(screen.getByText(/These are the new device readings/)).toBeTruthy();
    });

    // Now context returns empty pending (simulating successful dismiss/merge)
    mockUseDeviceDiscoveryContext.mockReturnValue({
      pending: [],
      dismiss: vi.fn(),
      merge: vi.fn(),
      refresh: vi.fn(),
    });
    rerender(<CurrentReadings />);

    // Assert — note disappears immediately
    await waitFor(() => {
      expect(screen.queryByText(/These are the new device readings/)).toBeNull();
    });
  });
});
