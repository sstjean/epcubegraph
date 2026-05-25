import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/preact';
import { h } from 'preact';
import type { ChartConfiguration, TooltipItem } from 'chart.js';
import {
  HistoricalGraph,
  buildDeviceChartData,
  getAggregationLabel,
  getTimeUnit,
  shouldUseBars,
  shouldShowBattery,
  formatTooltipTimestamp,
  formatAxisTick,
  buildBaseOptions,
  buildPowerDatasets,
  buildBatteryDataset,
  buildBarConfig,
  buildLineConfig,
  SERIES_COLORS,
  gridBarBackgroundColor,
  createGridSplitSwatch,
  createSolidSwatch,
} from '../../src/components/HistoricalGraph';
import { fetchDevices, fetchRangeReadings, fetchGridPower } from '../../src/api';
import { withRetry } from '../../src/utils/retry';
import { trackException } from '../../src/telemetry';
import type { DeviceListResponse, RangeReadingsResponse, TimeRangeValue } from '../../src/types';

vi.mock('../../src/api', () => ({
  fetchDevices: vi.fn(),
  fetchRangeReadings: vi.fn(),
  fetchGridPower: vi.fn(),
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
}));

// --- Chart.js mock ---
// happy-dom has no real canvas; intercept the Chart constructor and capture every config.
const { capturedConfigs, destroySpy, registerSpy } = vi.hoisted(() => ({
  capturedConfigs: [] as ChartConfiguration[],
  destroySpy: vi.fn(),
  registerSpy: vi.fn(),
}));

vi.mock('chart.js', () => {
  class MockChart {
    static register = registerSpy;
    static defaults = {
      plugins: {
        legend: {
          labels: {
            generateLabels: vi.fn((_chart: unknown) => [
              { text: 'Solar', fillStyle: '#f5c542', strokeStyle: '#f5c542' },
              { text: 'Home Load', fillStyle: '#2196f3', strokeStyle: '#2196f3' },
              { text: 'Grid', fillStyle: '#ff5722', strokeStyle: '#ff5722' },
              { text: 'Battery %', fillStyle: '#4caf50', strokeStyle: '#4caf50' },
            ]),
          },
        },
      },
    };
    destroy = destroySpy;
    update = vi.fn();
    constructor(_ctx: unknown, config: ChartConfiguration) {
      capturedConfigs.push(config);
    }
  }
  return {
    Chart: MockChart,
    LineController: class {},
    BarController: class {},
    LineElement: class {},
    PointElement: class {},
    BarElement: class {},
    LinearScale: class {},
    TimeScale: class {},
    Tooltip: class {},
    Legend: class {},
    Filler: class {},
    Decimation: class {},
  };
});

// Date adapter import is side-effect only; stub it.
vi.mock('chartjs-adapter-date-fns', () => ({}));

const mockFetchDevices = fetchDevices as ReturnType<typeof vi.fn>;
const mockFetchRangeReadings = fetchRangeReadings as ReturnType<typeof vi.fn>;
const mockFetchGridPower = fetchGridPower as ReturnType<typeof vi.fn>;
const mockWithRetry = withRetry as ReturnType<typeof vi.fn>;
const mockTrackException = trackException as ReturnType<typeof vi.fn>;

// --- Test fixtures ---

const twoDeviceList: DeviceListResponse = {
  devices: [
    { device: 'epcube1_battery', class: 'storage_battery', online: true, alias: 'EP Cube v1 Battery', product_code: 'EP Cube (devType=0)' },
    { device: 'epcube1_solar', class: 'home_solar', online: true, alias: 'EP Cube v1 Solar', product_code: 'EP Cube (devType=0)' },
    { device: 'epcube2_battery', class: 'storage_battery', online: true, alias: 'EP Cube v2 Battery', product_code: 'EP Cube (devType=2)' },
    { device: 'epcube2_solar', class: 'home_solar', online: true, alias: 'EP Cube v2 Solar', product_code: 'EP Cube (devType=2)' },
  ],
};

function makeRangeResponse(
  metric: string,
  deviceEntries: Array<{ device_id: string; values: Array<{ timestamp: number; value: number }> }>,
): RangeReadingsResponse {
  return { metric, series: deviceEntries };
}

function makeTwoDeviceResponse(metric: string, ts: number[]): RangeReadingsResponse {
  const device1Id = metric.includes('solar') ? 'epcube1_solar' : 'epcube1_battery';
  const device2Id = metric.includes('solar') ? 'epcube2_solar' : 'epcube2_battery';
  return makeRangeResponse(metric, [
    { device_id: device1Id, values: ts.map((t) => ({ timestamp: t, value: 1000 })) },
    { device_id: device2Id, values: ts.map((t) => ({ timestamp: t, value: 2000 })) },
  ]);
}

const emptyRangeResponse: RangeReadingsResponse = { metric: 'test_metric', series: [] };

const defaultTimeRange: TimeRangeValue = { start: 1711152000, end: 1711238400, step: 60 };

const defaultTimestamps = [1711152000, 1711152060];

function setupTwoDeviceMocks(ts: number[] = defaultTimestamps) {
  capturedConfigs.length = 0;
  destroySpy.mockClear();
  mockTrackException.mockClear();
  mockWithRetry.mockImplementation((fn: () => Promise<unknown>) => fn());
  mockFetchDevices.mockResolvedValue(twoDeviceList);
  mockFetchRangeReadings
    .mockResolvedValueOnce(makeTwoDeviceResponse('solar_instantaneous_generation_watts', ts))
    .mockResolvedValueOnce(makeTwoDeviceResponse('home_load_power_watts', ts))
    .mockResolvedValueOnce(makeTwoDeviceResponse('battery_state_of_capacity_percent', ts));
  mockFetchGridPower.mockResolvedValue(makeTwoDeviceResponse('grid_power_watts', ts));
}

describe('HistoricalGraph', () => {
  it('renders one chart per device, stacked vertically (FR-021)', async () => {
    setupTwoDeviceMocks();
    render(<HistoricalGraph timeRange={defaultTimeRange} />);
    await waitFor(() => {
      const deviceCharts = document.querySelectorAll('.device-chart');
      expect(deviceCharts.length).toBe(2);
      expect(screen.getByText('EP Cube v1')).toBeTruthy();
      expect(screen.getByText('EP Cube v2')).toBeTruthy();
    });
  });

  it('labels each chart with device name via h3 heading', async () => {
    setupTwoDeviceMocks();
    render(<HistoricalGraph timeRange={defaultTimeRange} />);
    await waitFor(() => {
      const headings = screen.getAllByRole('heading', { level: 3 });
      expect(headings.length).toBe(2);
      expect(headings[0].textContent).toBe('EP Cube v1');
      expect(headings[1].textContent).toBe('EP Cube v2');
    });
  });

  it('each chart has aria-label with device name', async () => {
    setupTwoDeviceMocks();
    render(<HistoricalGraph timeRange={defaultTimeRange} />);
    await waitFor(() => {
      const charts = document.querySelectorAll('.device-chart');
      expect(charts.length).toBe(2);
      expect(charts[0].getAttribute('aria-label')).toBe('EP Cube v1 energy chart');
      expect(charts[1].getAttribute('aria-label')).toBe('EP Cube v2 energy chart');
    });
  });

  it('renders one <canvas> per device chart', async () => {
    setupTwoDeviceMocks();
    render(<HistoricalGraph timeRange={defaultTimeRange} />);
    await waitFor(() => {
      const canvases = document.querySelectorAll('.device-chart canvas');
      expect(canvases.length).toBe(2);
    });
  });

  it('does not merge data from different devices into one chart (FR-021)', async () => {
    mockWithRetry.mockImplementation((fn: () => Promise<unknown>) => fn());
    mockFetchDevices.mockResolvedValue(twoDeviceList);
    mockFetchRangeReadings
      .mockResolvedValueOnce(makeRangeResponse('solar_instantaneous_generation_watts', [
        { device_id: 'epcube1_solar', values: [{ timestamp: 100, value: 500 }] },
        { device_id: 'epcube2_solar', values: [{ timestamp: 200, value: 600 }] },
      ]))
      .mockResolvedValueOnce(makeRangeResponse('home_load_power_watts', [
        { device_id: 'epcube1_battery', values: [{ timestamp: 100, value: 250 }] },
        { device_id: 'epcube2_battery', values: [{ timestamp: 200, value: 350 }] },
      ]))
      .mockResolvedValueOnce(makeRangeResponse('battery_state_of_capacity_percent', [
        { device_id: 'epcube1_battery', values: [{ timestamp: 100, value: 80 }] },
        { device_id: 'epcube2_battery', values: [{ timestamp: 200, value: 65 }] },
      ]));
    mockFetchGridPower.mockResolvedValue(makeRangeResponse('grid_power_watts', [
      { device_id: 'epcube1_battery', values: [{ timestamp: 100, value: 150 }] },
      { device_id: 'epcube2_battery', values: [{ timestamp: 200, value: 250 }] },
    ]));

    render(<HistoricalGraph timeRange={defaultTimeRange} />);
    await waitFor(() => {
      const deviceCharts = document.querySelectorAll('.device-chart');
      expect(deviceCharts.length).toBe(2);
    });
  });

  it('each chart contains Solar, Home Load, Grid, and Battery % datasets', async () => {
    setupTwoDeviceMocks();
    render(<HistoricalGraph timeRange={defaultTimeRange} />);
    await waitFor(() => {
      expect(document.querySelectorAll('.device-chart').length).toBe(2);
      expect(capturedConfigs.length).toBe(2);
    });

    for (const config of capturedConfigs) {
      const labels = config.data.datasets.map((d) => d.label);
      expect(labels).toContain('Solar');
      expect(labels).toContain('Home Load');
      expect(labels).toContain('Grid');
      expect(labels).toContain('Battery %');
    }
  });

  it('series colors are consistent across all charts (FR-023)', async () => {
    setupTwoDeviceMocks();
    render(<HistoricalGraph timeRange={defaultTimeRange} />);
    await waitFor(() => {
      expect(capturedConfigs.length).toBe(2);
    });

    const labelsToColor = (config: ChartConfiguration) => {
      const map: Record<string, string | undefined> = {};
      for (const ds of config.data.datasets) {
        map[ds.label ?? ''] = (ds.borderColor ?? ds.backgroundColor) as string | undefined;
      }
      return map;
    };
    const c1 = labelsToColor(capturedConfigs[0]);
    const c2 = labelsToColor(capturedConfigs[1]);
    expect(c1['Solar']).toBe(c2['Solar']);
    expect(c1['Home Load']).toBe(c2['Home Load']);
    expect(c1['Grid']).toBe(c2['Grid']);
    expect(c1['Battery %']).toBe(c2['Battery %']);
    expect(c1['Solar']).toBeTruthy();
  });

  it('renders accessible container with aria-label and aria-busy (FR-015)', async () => {
    setupTwoDeviceMocks();
    render(<HistoricalGraph timeRange={defaultTimeRange} />);
    await waitFor(() => {
      const container = document.querySelector('[aria-label="Historical energy graphs"]');
      expect(container).toBeTruthy();
    });
  });

  it('shows "No data available for this time range" for empty result (FR-007)', async () => {
    mockWithRetry.mockImplementation((fn: () => Promise<unknown>) => fn());
    mockFetchDevices.mockResolvedValue(twoDeviceList);
    mockFetchRangeReadings.mockResolvedValue(emptyRangeResponse);
    mockFetchGridPower.mockResolvedValue(emptyRangeResponse);
    render(<HistoricalGraph timeRange={defaultTimeRange} />);
    await waitFor(() => {
      expect(screen.getByText(/no data available/i)).toBeTruthy();
    });
  });

  it('displays aggregation notice with role="status" when step > 60s (FR-013)', async () => {
    const hourlyRange: TimeRangeValue = { start: 1711152000, end: 1711756800, step: 3600 };
    setupTwoDeviceMocks([1711152000, 1711155600]);
    render(<HistoricalGraph timeRange={hourlyRange} />);
    await waitFor(() => {
      const notice = screen.getByRole('status');
      expect(notice).toBeTruthy();
      expect(notice.textContent).toMatch(/hourly/i);
    });
  });

  it('displays "daily resolution" notice for step=86400', async () => {
    const dailyRange: TimeRangeValue = { start: 1711152000, end: 1713744000, step: 86400 };
    setupTwoDeviceMocks([1711152000, 1711238400]);
    render(<HistoricalGraph timeRange={dailyRange} />);
    await waitFor(() => {
      const notice = screen.getByRole('status');
      expect(notice.textContent).toMatch(/daily/i);
    });
  });

  it('displays "monthly resolution" notice for step=2592000', async () => {
    const monthlyRange: TimeRangeValue = { start: 1711152000, end: 1742688000, step: 2592000 };
    setupTwoDeviceMocks([1711152000, 1713744000]);
    render(<HistoricalGraph timeRange={monthlyRange} />);
    await waitFor(() => {
      const notice = screen.getByRole('status');
      expect(notice.textContent).toMatch(/monthly/i);
    });
  });

  it('does not show aggregation notice when step=60s (full resolution)', async () => {
    setupTwoDeviceMocks();
    render(<HistoricalGraph timeRange={defaultTimeRange} />);
    await waitFor(() => {
      expect(document.querySelectorAll('.device-chart').length).toBe(2);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('fetches devices, solar, home load, grid, and battery SoC metrics', async () => {
    setupTwoDeviceMocks();
    render(<HistoricalGraph timeRange={defaultTimeRange} />);
    await waitFor(() => {
      expect(mockFetchDevices).toHaveBeenCalledTimes(1);
      expect(mockFetchRangeReadings).toHaveBeenCalledWith(
        'solar_instantaneous_generation_watts',
        defaultTimeRange.start, defaultTimeRange.end, defaultTimeRange.step,
      );
      expect(mockFetchRangeReadings).toHaveBeenCalledWith(
        'home_load_power_watts',
        defaultTimeRange.start, defaultTimeRange.end, defaultTimeRange.step,
      );
      expect(mockFetchRangeReadings).toHaveBeenCalledWith(
        'battery_state_of_capacity_percent',
        defaultTimeRange.start, defaultTimeRange.end, defaultTimeRange.step,
      );
      expect(mockFetchGridPower).toHaveBeenCalledWith(
        defaultTimeRange.start, defaultTimeRange.end, defaultTimeRange.step,
      );
    });
  });

  it('renders loading state while fetching', () => {
    mockWithRetry.mockImplementation((fn: () => Promise<unknown>) => fn());
    mockFetchDevices.mockReturnValue(new Promise(() => {}));
    mockFetchRangeReadings.mockReturnValue(new Promise(() => {}));
    mockFetchGridPower.mockReturnValue(new Promise(() => {}));
    render(<HistoricalGraph timeRange={defaultTimeRange} />);
    const loading = document.querySelector('[aria-busy="true"]');
    expect(loading).toBeTruthy();
  });

  it('re-fetches data when timeRange changes', async () => {
    setupTwoDeviceMocks();
    const { rerender } = render(<HistoricalGraph timeRange={defaultTimeRange} />);
    await waitFor(() => {
      expect(mockFetchRangeReadings).toHaveBeenCalled();
    });
    vi.clearAllMocks();
    setupTwoDeviceMocks();
    const newRange: TimeRangeValue = { start: 1711238400, end: 1711324800, step: 60 };
    rerender(<HistoricalGraph timeRange={newRange} />);
    await waitFor(() => {
      expect(mockFetchRangeReadings).toHaveBeenCalledWith(
        expect.any(String), newRange.start, newRange.end, newRange.step,
      );
    });
  });

  it('destroys Chart instances on unmount', async () => {
    setupTwoDeviceMocks();
    const { unmount } = render(<HistoricalGraph timeRange={defaultTimeRange} />);
    await waitFor(() => {
      expect(capturedConfigs.length).toBe(2);
    });
    destroySpy.mockClear();
    unmount();
    expect(destroySpy).toHaveBeenCalled();
  });

  it('destroys existing Chart instances before rebuilding when timeRange changes', async () => {
    setupTwoDeviceMocks();
    const { rerender } = render(<HistoricalGraph timeRange={defaultTimeRange} />);
    await waitFor(() => {
      expect(capturedConfigs.length).toBe(2);
    });
    destroySpy.mockClear();
    capturedConfigs.length = 0;
    setupTwoDeviceMocks();
    const newRange: TimeRangeValue = { start: 1711238400, end: 1711324800, step: 86400 };
    rerender(<HistoricalGraph timeRange={newRange} />);
    await waitFor(() => {
      expect(capturedConfigs.length).toBe(2);
    });
    expect(destroySpy).toHaveBeenCalled();
  });

  it('ignores stale fetch results when unmounted during fetch', async () => {
    mockWithRetry.mockImplementation((fn: () => Promise<unknown>) => fn());
    let resolveDevices!: (v: DeviceListResponse) => void;
    mockFetchDevices.mockReturnValue(new Promise<DeviceListResponse>((r) => { resolveDevices = r; }));
    mockFetchRangeReadings.mockResolvedValue(emptyRangeResponse);
    mockFetchGridPower.mockResolvedValue(emptyRangeResponse);
    const { unmount } = render(<HistoricalGraph timeRange={defaultTimeRange} />);
    unmount();
    resolveDevices(twoDeviceList);
    await new Promise((r) => setTimeout(r, 10));
    expect(document.querySelector('.device-chart')).toBeNull();
  });

  it('does not update retry count when unmounted during retry', async () => {
    let onRetryCb: ((n: number) => void) | undefined;
    mockWithRetry.mockImplementation((_fn: () => Promise<unknown>, options?: { onRetry?: (n: number) => void }) => {
      onRetryCb = options?.onRetry;
      return new Promise(() => {});
    });
    const { unmount } = render(<HistoricalGraph timeRange={defaultTimeRange} />);
    unmount();
    onRetryCb?.(3);
    await new Promise((r) => setTimeout(r, 10));
  });

  it('does not update error state when unmounted during fetch failure', async () => {
    let rejectFetch!: (err: Error) => void;
    mockWithRetry.mockReturnValue(new Promise((_resolve, reject) => { rejectFetch = reject; }));
    const { unmount } = render(<HistoricalGraph timeRange={defaultTimeRange} />);
    unmount();
    rejectFetch(new Error('Late failure'));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows retry count during reconnection attempts', async () => {
    setupTwoDeviceMocks();
    mockWithRetry.mockImplementation(async (fn: () => Promise<unknown>, options?: { onRetry?: (n: number) => void }) => {
      options?.onRetry?.(2);
      return fn();
    });
    render(<HistoricalGraph timeRange={defaultTimeRange} />);
    await waitFor(() => {
      expect(screen.getByText(/Reconnecting… attempt 2 of 10/)).toBeTruthy();
    });
  });

  it('shows error after all retries exhausted', async () => {
    mockWithRetry.mockRejectedValue(new Error('Service Unavailable'));
    render(<HistoricalGraph timeRange={defaultTimeRange} />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText(/Error: Service Unavailable/)).toBeTruthy();
    });
  });

  it('shows fallback error when rejection is not an Error instance', async () => {
    mockWithRetry.mockRejectedValue('something went wrong');
    render(<HistoricalGraph timeRange={defaultTimeRange} />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText(/Error: Failed to load data/)).toBeTruthy();
    });
  });

  it('wraps fetchData batch in withRetry', async () => {
    mockWithRetry.mockImplementation((fn: () => Promise<unknown>) => fn());
    setupTwoDeviceMocks();
    render(<HistoricalGraph timeRange={defaultTimeRange} />);
    await waitFor(() => {
      expect(mockWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ maxRetries: 10 }),
      );
    });
  });

  it('renders single device when only one device has data', async () => {
    mockWithRetry.mockImplementation((fn: () => Promise<unknown>) => fn());
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube1_battery', class: 'storage_battery', online: true, alias: 'EP Cube v1 Battery', product_code: 'EP Cube (devType=0)' },
        { device: 'epcube1_solar', class: 'home_solar', online: true, alias: 'EP Cube v1 Solar', product_code: 'EP Cube (devType=0)' },
      ],
    });
    mockFetchRangeReadings.mockResolvedValue(makeRangeResponse('test_metric', [
      { device_id: 'epcube1_solar', values: [{ timestamp: 100, value: 500 }] },
    ]));
    mockFetchGridPower.mockResolvedValue(makeRangeResponse('grid_power_watts', [
      { device_id: 'epcube1_battery', values: [{ timestamp: 100, value: 150 }] },
    ]));
    render(<HistoricalGraph timeRange={defaultTimeRange} />);
    await waitFor(() => {
      const deviceCharts = document.querySelectorAll('.device-chart');
      expect(deviceCharts.length).toBe(1);
      expect(screen.getByText('EP Cube v1')).toBeTruthy();
    });
  });

  it('surfaces error + telemetry when canvas getContext returns null (NFR-006)', async () => {
    // Arrange — stub getContext to null for this test only
    const original = HTMLCanvasElement.prototype.getContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLCanvasElement.prototype as any).getContext = () => null;
    try {
      setupTwoDeviceMocks();
      render(<HistoricalGraph timeRange={defaultTimeRange} />);
      await waitFor(() => {
        expect(screen.getByRole('alert').textContent).toMatch(/Chart context unavailable/);
      });
      expect(capturedConfigs.length).toBe(0);
      expect(mockTrackException).toHaveBeenCalledWith(expect.any(Error));
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
    }
  });
});

describe('buildDeviceChartData', () => {
  it('filters series to matching device_ids only', () => {
    const responses: RangeReadingsResponse[] = [
      makeRangeResponse('solar', [
        { device_id: 'epcube1_solar', values: [{ timestamp: 100, value: 1000 }] },
        { device_id: 'epcube2_solar', values: [{ timestamp: 100, value: 2000 }] },
      ]),
    ];
    const deviceIds = new Set(['epcube1_solar', 'epcube1_battery']);
    const data = buildDeviceChartData(responses, deviceIds, 60);
    expect(data).not.toBeNull();
    expect(data!.solar).toEqual([{ x: 100_000, y: 1000 }]);
  });

  it('returns null when no matching data exists', () => {
    const responses: RangeReadingsResponse[] = [
      makeRangeResponse('solar', [
        { device_id: 'epcube2_solar', values: [{ timestamp: 100, value: 2000 }] },
      ]),
    ];
    const deviceIds = new Set(['epcube9_solar']);
    const data = buildDeviceChartData(responses, deviceIds, 60);
    expect(data).toBeNull();
  });

  it('fills missing response slots with empty arrays when fewer than 4 responses are provided', () => {
    const responses: RangeReadingsResponse[] = [
      makeRangeResponse('solar', [
        { device_id: 'dev1', values: [{ timestamp: 100, value: 1000 }] },
      ]),
    ];
    const deviceIds = new Set(['dev1']);
    const data = buildDeviceChartData(responses, deviceIds, 60);
    expect(data).not.toBeNull();
    expect(data!.solar).toEqual([{ x: 100_000, y: 1000 }]);
    expect(data!.homeLoad).toEqual([]);
    expect(data!.grid).toEqual([]);
    expect(data!.battery).toEqual([]);
  });

  it('produces null y at gap boundaries when gap > 2× step (FR-008)', () => {
    const responses: RangeReadingsResponse[] = [
      makeRangeResponse('solar', [
        { device_id: 'dev1', values: [
          { timestamp: 100, value: 500 },
          { timestamp: 160, value: 600 },
          { timestamp: 1960, value: 700 },
          { timestamp: 2020, value: 800 },
        ]},
      ]),
    ];
    const deviceIds = new Set(['dev1']);
    const data = buildDeviceChartData(responses, deviceIds, 60);
    expect(data).not.toBeNull();
    expect(data!.solar.map((p) => p.x / 1000)).toEqual([100, 160, 1960, 2020]);
    expect(data!.solar.map((p) => p.y)).toEqual([500, null, 700, 800]);
  });

  it('does not insert nulls when timestamps are within 2× step', () => {
    const responses: RangeReadingsResponse[] = [
      makeRangeResponse('solar', [
        { device_id: 'dev1', values: [
          { timestamp: 100, value: 500 },
          { timestamp: 160, value: 600 },
          { timestamp: 220, value: 700 },
        ]},
      ]),
    ];
    const deviceIds = new Set(['dev1']);
    const data = buildDeviceChartData(responses, deviceIds, 60);
    expect(data!.solar.map((p) => p.y)).toEqual([500, 600, 700]);
  });

  it('handles multiple metrics with shared timestamps and missing values', () => {
    const responses: RangeReadingsResponse[] = [
      // [solar, homeLoad, grid, battery]
      makeRangeResponse('solar', [
        { device_id: 'dev1', values: [{ timestamp: 100, value: 1000 }, { timestamp: 200, value: 1100 }] },
      ]),
      makeRangeResponse('home_load', [
        { device_id: 'dev1', values: [{ timestamp: 100, value: 800 }] },
      ]),
      makeRangeResponse('grid', [
        { device_id: 'dev1', values: [{ timestamp: 100, value: 200 }, { timestamp: 200, value: 250 }] },
      ]),
      makeRangeResponse('battery', [
        { device_id: 'dev1', values: [{ timestamp: 100, value: 500 }, { timestamp: 200, value: 550 }] },
      ]),
    ];
    const deviceIds = new Set(['dev1']);
    const data = buildDeviceChartData(responses, deviceIds, 60);
    expect(data).not.toBeNull();
    expect(data!.solar.map((p) => p.y)).toEqual([1000, 1100]);
    expect(data!.homeLoad.map((p) => p.y)).toEqual([800, null]);
    expect(data!.grid.map((p) => p.y)).toEqual([200, 250]);
    expect(data!.battery.map((p) => p.y)).toEqual([500, 550]);
  });
});

describe('getAggregationLabel', () => {
  it('returns null for step ≤ 60', () => {
    expect(getAggregationLabel(60)).toBeNull();
    expect(getAggregationLabel(30)).toBeNull();
  });
  it('returns "hourly" for step ≤ 3600', () => {
    expect(getAggregationLabel(3600)).toBe('hourly');
    expect(getAggregationLabel(1800)).toBe('hourly');
  });
  it('returns "daily" for step ≤ 86400', () => {
    expect(getAggregationLabel(86400)).toBe('daily');
    expect(getAggregationLabel(43200)).toBe('daily');
  });
  it('returns "monthly" for step > 86400', () => {
    expect(getAggregationLabel(2592000)).toBe('monthly');
  });
});

describe('getTimeUnit', () => {
  it('returns "hour" for step ≤ 3600 (1d view — hourly ticks)', () => {
    expect(getTimeUnit(60)).toBe('hour');
    expect(getTimeUnit(30)).toBe('hour');
    expect(getTimeUnit(3600)).toBe('hour');
    expect(getTimeUnit(1800)).toBe('hour');
  });
  it('returns "day" for step ≤ 86400 (7d / 30d — daily ticks)', () => {
    expect(getTimeUnit(86400)).toBe('day');
    expect(getTimeUnit(43200)).toBe('day');
  });
  it('returns "month" for step > 86400 (1y view aggregates monthly)', () => {
    expect(getTimeUnit(2592000)).toBe('month');
  });
});

describe('shouldUseBars', () => {
  it('returns false for step < 86400', () => {
    expect(shouldUseBars(60)).toBe(false);
    expect(shouldUseBars(1800)).toBe(false);
    expect(shouldUseBars(3600)).toBe(false);
  });
  it('returns true for step >= 86400', () => {
    expect(shouldUseBars(86400)).toBe(true);
    expect(shouldUseBars(2592000)).toBe(true);
  });
});

describe('shouldShowBattery', () => {
  it('returns true on line views (step < 86400) where SoC curve is meaningful', () => {
    expect(shouldShowBattery(60)).toBe(true);
    expect(shouldShowBattery(3600)).toBe(true);
  });
  it('returns false on bar views (step >= 86400) where battery overlay is noise', () => {
    expect(shouldShowBattery(86400)).toBe(false);
    expect(shouldShowBattery(2592000)).toBe(false);
  });
});

describe('formatTooltipTimestamp', () => {
  // 2024-03-23 13:30:00 UTC → 09:30 ET (EDT, March is post-DST).
  const epoch = 1711200600;
  it('returns time only for sub-hourly step (rendered in Eastern Time)', () => {
    const r = formatTooltipTimestamp(epoch, 60);
    expect(r).toMatch(/^09:30/);
    expect(r).not.toMatch(/Mar|Jan|Feb|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/i);
  });
  it('returns date + time for hourly step (Eastern Time)', () => {
    const r = formatTooltipTimestamp(epoch, 3600);
    expect(r).toMatch(/Mar 23/);
    expect(r).toMatch(/09:30/);
  });
  it('returns date only for daily step (Eastern Time, includes year)', () => {
    const r = formatTooltipTimestamp(epoch, 86400);
    expect(r).toMatch(/Mar 23, 2024/);
    expect(r).not.toMatch(/:/);
  });
  it('returns date only for monthly step (Eastern Time)', () => {
    const r = formatTooltipTimestamp(epoch, 2592000);
    expect(r).toMatch(/Mar 23, 2024/);
    expect(r).not.toMatch(/:/);
  });
});

describe('formatAxisTick', () => {
  // 2024-03-23 13:30:00 UTC → 09:30 ET; same calendar day in ET.
  const ms = 1711200600 * 1000;
  it('formats hour ticks as HH:mm in Eastern Time', () => {
    expect(formatAxisTick(ms, 'hour')).toBe('09:30');
  });
  it('formats day ticks as "Mon d" in Eastern Time', () => {
    expect(formatAxisTick(ms, 'day')).toBe('Mar 23');
  });
  it('formats month ticks as "Mon yyyy" in Eastern Time', () => {
    expect(formatAxisTick(ms, 'month')).toBe('Mar 2024');
  });
  it('treats a UTC-midnight epoch as the previous ET day (no off-by-one drift)', () => {
    // 2026-05-25 00:00 UTC = 2026-05-24 20:00 ET. A bar bucket timestamped at
    // UTC midnight must NOT render as May 25 in the user's timezone.
    const utcMidnight = Date.UTC(2026, 4, 25, 0, 0, 0);
    expect(formatAxisTick(utcMidnight, 'day')).toBe('May 24');
  });
});

// --- Chart.js config helpers ---

const emptyDatasets = { solar: [], homeLoad: [], grid: [], battery: [] };

describe('buildBaseOptions', () => {
  it('configures a time scale with displayFormats covering minute → year (closes #149)', () => {
    const opts = buildBaseOptions(60);
    const x = opts.scales!.x as { type: string; time: { displayFormats: Record<string, string> } };
    expect(x.type).toBe('time');
    expect(x.time.displayFormats.minute).toBe('HH:mm');
    expect(x.time.displayFormats.hour).toBe('HH:mm');
    expect(x.time.displayFormats.day).toBe('MMM d');
    expect(x.time.displayFormats.week).toBe('MMM d');
    expect(x.time.displayFormats.month).toBe('MMM yyyy');
    expect(x.time.displayFormats.quarter).toBe('MMM yyyy');
    expect(x.time.displayFormats.year).toBe('yyyy');
  });

  it('configures auto-skipping ticks (no fixed maxTicksLimit on time scale)', () => {
    const opts = buildBaseOptions(60);
    const x = opts.scales!.x as { ticks: { autoSkip: boolean; maxRotation: number; source: string; autoSkipPadding: number } };
    expect(x.ticks.autoSkip).toBe(true);
    expect(x.ticks.maxRotation).toBe(0);
    expect(x.ticks.source).toBe('auto');
    expect(x.ticks.autoSkipPadding).toBeGreaterThan(0);
  });

  it('tooltip title callback formats x as a step-aware timestamp', () => {
    const opts = buildBaseOptions(86400);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = (opts.plugins as any).tooltip.callbacks.title as (items: TooltipItem<'bar'>[]) => string;
    const result = cb([{ parsed: { x: 1711200600 * 1000, y: 0 } } as unknown as TooltipItem<'bar'>]);
    expect(result).toMatch(/Mar/i);
  });

  it('tooltip title returns empty string when no items', () => {
    const opts = buildBaseOptions(60);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = (opts.plugins as any).tooltip.callbacks.title as (items: TooltipItem<'bar'>[]) => string;
    expect(cb([])).toBe('');
  });

  it('tooltip label callback formats watts with label prefix', () => {
    const opts = buildBaseOptions(60);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = (opts.plugins as any).tooltip.callbacks.label as (item: TooltipItem<'bar'>) => string;
    const result = cb({ dataset: { label: 'Solar' }, parsed: { y: 1234 } } as unknown as TooltipItem<'bar'>);
    expect(result).toBe('Solar: 1.234 kW');
  });

  it('tooltip label callback formats percent for Battery %', () => {
    const opts = buildBaseOptions(60);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = (opts.plugins as any).tooltip.callbacks.label as (item: TooltipItem<'bar'>) => string;
    const result = cb({ dataset: { label: 'Battery %' }, parsed: { y: 75 } } as unknown as TooltipItem<'bar'>);
    expect(result).toBe('Battery %: 75.0%');
  });

  it('tooltip label callback returns em-dash when y is null', () => {
    const opts = buildBaseOptions(60);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = (opts.plugins as any).tooltip.callbacks.label as (item: TooltipItem<'bar'>) => string;
    const result = cb({ dataset: { label: 'Grid' }, parsed: { y: null } } as unknown as TooltipItem<'bar'>);
    expect(result).toBe('Grid: —');
  });

  it('tooltip label callback handles missing label', () => {
    const opts = buildBaseOptions(60);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = (opts.plugins as any).tooltip.callbacks.label as (item: TooltipItem<'bar'>) => string;
    const result = cb({ dataset: {}, parsed: { y: 100 } } as unknown as TooltipItem<'bar'>);
    expect(result).toBe(': 100 W');
  });

  it('x-axis tick callback formats ticks via formatAxisTick in Eastern Time (accepts number or string)', () => {
    const opts = buildBaseOptions(86400);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = (opts.scales!.x as any).ticks.callback as (v: number | string) => string;
    // 2024-03-23 09:30 UTC = Mar 23 in ET (EDT).
    const ms = 1711200600 * 1000;
    expect(cb(ms)).toBe('Mar 23');
    // Chart.js may pass the value as a string in some tick configurations; coerce path.
    expect(cb(String(ms))).toBe('Mar 23');
  });
});

describe('buildPowerDatasets', () => {
  it('returns three datasets in Solar / Home Load / Grid order with the requested type', () => {
    const datasets = buildPowerDatasets(emptyDatasets, 'bar');
    expect(datasets.length).toBe(3);
    expect(datasets[0].label).toBe('Solar');
    expect(datasets[1].label).toBe('Home Load');
    expect(datasets[2].label).toBe('Grid');
    for (const d of datasets) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((d as any).type).toBe('bar');
      expect(d.yAxisID).toBe('y');
    }
  });

  it('uses canonical bar grouping percentages (barPercentage 0.9, categoryPercentage 0.8)', () => {
    const datasets = buildPowerDatasets(emptyDatasets, 'bar');
    for (const d of datasets) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((d as any).barPercentage).toBeCloseTo(0.9);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((d as any).categoryPercentage).toBeCloseTo(0.8);
    }
  });

  it('returns three line datasets when type is "line" with Grid fill enabled', () => {
    const datasets = buildPowerDatasets(emptyDatasets, 'line');
    for (const d of datasets) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((d as any).type).toBe('line');
    }
    // Grid (index 2) has fill: true for the gradient
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((datasets[2] as any).fill).toBe(true);
  });

  it('uses Solar / Home Load colors from SERIES_COLORS; Grid border varies per bar', () => {
    const barDatasets = buildPowerDatasets(emptyDatasets, 'bar');
    expect(barDatasets[0].borderColor).toBe(SERIES_COLORS.solar);
    expect(barDatasets[1].borderColor).toBe(SERIES_COLORS.homeLoad);
    // Grid border is scriptable on bar charts so the outline matches each bar's fill color.
    expect(typeof barDatasets[2].borderColor).toBe('function');

    // Line charts keep a fixed grid border color (the per-point fill gradient handles emphasis).
    const lineDatasets = buildPowerDatasets(emptyDatasets, 'line');
    expect(lineDatasets[2].borderColor).toBe(SERIES_COLORS.grid);
  });

  it('Grid background for bar charts is a scriptable function (per-bar color by sign)', () => {
    const datasets = buildPowerDatasets(emptyDatasets, 'bar');
    expect(typeof datasets[2].backgroundColor).toBe('function');
  });

  it('Grid background for line charts is a scriptable gradient function', () => {
    const datasets = buildPowerDatasets(emptyDatasets, 'line');
    expect(typeof datasets[2].backgroundColor).toBe('function');
  });
});

describe('gridBarBackgroundColor', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctxFor = (raw: any): any => ({ raw });

  it('returns red (grid pull) when y is positive', () => {
    expect(gridBarBackgroundColor(ctxFor({ x: 0, y: 500 }))).toBe(SERIES_COLORS.grid);
  });
  it('returns green (grid export) when y is negative', () => {
    expect(gridBarBackgroundColor(ctxFor({ x: 0, y: -250 }))).toBe(SERIES_COLORS.gridExport);
  });
  it('returns red when y is exactly zero (no export)', () => {
    expect(gridBarBackgroundColor(ctxFor({ x: 0, y: 0 }))).toBe(SERIES_COLORS.grid);
  });
  it('returns red when y is null/undefined (defensive default)', () => {
    expect(gridBarBackgroundColor(ctxFor({ x: 0, y: null }))).toBe(SERIES_COLORS.grid);
    expect(gridBarBackgroundColor(ctxFor(undefined))).toBe(SERIES_COLORS.grid);
  });
  it('handles raw provided as a bare number', () => {
    expect(gridBarBackgroundColor(ctxFor(-100))).toBe(SERIES_COLORS.gridExport);
    expect(gridBarBackgroundColor(ctxFor(100))).toBe(SERIES_COLORS.grid);
  });
});

describe('createGridSplitSwatch', () => {
  it('returns an HTMLCanvasElement with both triangles drawn when 2D context is available', () => {
    const fakeCtx = {
      fillStyle: '',
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
    };
    const orig = HTMLCanvasElement.prototype.getContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLCanvasElement.prototype as any).getContext = vi.fn(() => fakeCtx);
    try {
      const canvas = createGridSplitSwatch(10);
      expect(canvas).toBeInstanceOf(HTMLCanvasElement);
      expect(canvas!.width).toBe(10);
      expect(canvas!.height).toBe(10);
      // Two triangles drawn (top-right red pull + bottom-left green export).
      expect(fakeCtx.beginPath).toHaveBeenCalledTimes(2);
      expect(fakeCtx.fill).toHaveBeenCalledTimes(2);
    } finally {
      HTMLCanvasElement.prototype.getContext = orig;
    }
  });

  it('returns null if getContext returns null', () => {
    const orig = HTMLCanvasElement.prototype.getContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLCanvasElement.prototype as any).getContext = vi.fn(() => null);
    try {
      expect(createGridSplitSwatch()).toBeNull();
    } finally {
      HTMLCanvasElement.prototype.getContext = orig;
    }
  });
});

describe('createSolidSwatch', () => {
  it('fills the canvas with the supplied color', () => {
    const fakeCtx = {
      fillStyle: '',
      fillRect: vi.fn(),
    };
    const orig = HTMLCanvasElement.prototype.getContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLCanvasElement.prototype as any).getContext = vi.fn(() => fakeCtx);
    try {
      const canvas = createSolidSwatch('#f5c542', 12);
      expect(canvas).toBeInstanceOf(HTMLCanvasElement);
      expect(canvas!.width).toBe(12);
      expect(fakeCtx.fillStyle).toBe('#f5c542');
      expect(fakeCtx.fillRect).toHaveBeenCalledWith(0, 0, 12, 12);
    } finally {
      HTMLCanvasElement.prototype.getContext = orig;
    }
  });

  it('returns null if getContext returns null', () => {
    const orig = HTMLCanvasElement.prototype.getContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLCanvasElement.prototype as any).getContext = vi.fn(() => null);
    try {
      expect(createSolidSwatch('#000')).toBeNull();
    } finally {
      HTMLCanvasElement.prototype.getContext = orig;
    }
  });
});

describe('buildBatteryDataset', () => {
  it('returns a line dataset on the y1 (right) axis with fill enabled', () => {
    const ds = buildBatteryDataset(emptyDatasets);
    expect(ds.type).toBe('line');
    expect(ds.label).toBe('Battery %');
    expect(ds.yAxisID).toBe('y1');
    expect(ds.fill).toBe(true);
    expect(ds.borderColor).toBe(SERIES_COLORS.battery);
    expect(typeof ds.backgroundColor).toBe('function');
  });
});

describe('buildBarConfig', () => {
  it('uses chart type "bar"', () => {
    const cfg = buildBarConfig(86400, emptyDatasets, 'EP Cube v1');
    expect(cfg.type).toBe('bar');
  });

  it('configures x-axis with offset:true and bounds:"ticks" (US-7 edge padding)', () => {
    const cfg = buildBarConfig(86400, emptyDatasets, 'EP Cube v1');
    const x = cfg.options!.scales!.x as { offset: boolean; bounds: string };
    expect(x.offset).toBe(true);
    expect(x.bounds).toBe('ticks');
  });

  it('configures only the left watts y-axis (battery overlay is line-view only)', () => {
    const cfg = buildBarConfig(86400, emptyDatasets, 'EP Cube v1');
    const scales = cfg.options!.scales as Record<string, { position?: string } | undefined>;
    expect(scales.y!.position).toBe('left');
    expect(scales.y1).toBeUndefined();
  });

  it('y-axis ticks callback formats watts (kW abbreviation for ≥1000)', () => {
    const cfg = buildBarConfig(86400, emptyDatasets, 'EP Cube v1');
    const yAxis = (cfg.options!.scales as Record<string, unknown>).y as { ticks: { callback: (v: number) => string } };
    expect(yAxis.ticks.callback(1500)).toMatch(/kW/);
    expect(yAxis.ticks.callback(500)).toMatch(/500/);
  });

  it('contains 3 datasets — Solar, Home Load, Grid bars only (no battery overlay)', () => {
    const cfg = buildBarConfig(86400, emptyDatasets, 'EP Cube v1');
    expect(cfg.data.datasets.length).toBe(3);
    const labels = cfg.data.datasets.map((d) => d.label);
    expect(labels).toEqual(['Solar', 'Home Load', 'Grid']);
    expect(labels).not.toContain('Battery %');
  });

  it('includes battery overlay + y1 axis if invoked with a sub-day step', () => {
    const cfg = buildBarConfig(60, emptyDatasets, 'EP Cube v1');
    expect(cfg.data.datasets.length).toBe(4);
    expect(cfg.data.datasets.map((d) => d.label)).toContain('Battery %');
    const scales = cfg.options!.scales as Record<string, { position?: string } | undefined>;
    expect(scales.y1!.position).toBe('right');
  });

  it('legend.labels.generateLabels swaps the Grid pointStyle to the red/green canvas swatch', () => {
    // Stub canvas getContext so createGridSplitSwatch / createSolidSwatch return real canvases.
    const fakeCtx = {
      fillStyle: '',
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
    };
    const orig = HTMLCanvasElement.prototype.getContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLCanvasElement.prototype as any).getContext = vi.fn(() => fakeCtx);
    try {
      const cfg = buildBarConfig(86400, emptyDatasets, 'EP Cube v1');
      const legend = (cfg.options!.plugins as { legend: { labels: { usePointStyle: boolean; generateLabels: (c: unknown) => Array<{ text: string; pointStyle?: unknown }> } } }).legend;
      expect(legend.labels.usePointStyle).toBe(true);
      const items = legend.labels.generateLabels({});
      const grid = items.find((i) => i.text === 'Grid')!;
      const solar = items.find((i) => i.text === 'Solar')!;
      const homeLoad = items.find((i) => i.text === 'Home Load')!;
      // Each non-default label item now has a canvas pointStyle.
      expect(grid.pointStyle).toBeInstanceOf(HTMLCanvasElement);
      expect(solar.pointStyle).toBeInstanceOf(HTMLCanvasElement);
      expect(homeLoad.pointStyle).toBeInstanceOf(HTMLCanvasElement);
      // Grid swatch is distinct from the solar swatch.
      expect(grid.pointStyle).not.toBe(solar.pointStyle);
    } finally {
      HTMLCanvasElement.prototype.getContext = orig;
    }
  });

  it('leaves pointStyle untouched when canvas getContext is unavailable', () => {
    const orig = HTMLCanvasElement.prototype.getContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLCanvasElement.prototype as any).getContext = vi.fn(() => null);
    try {
      const cfg = buildBarConfig(86400, emptyDatasets, 'EP Cube v1');
      const legend = (cfg.options!.plugins as { legend: { labels: { generateLabels: (c: unknown) => Array<{ text: string; pointStyle?: unknown }> } } }).legend;
      const items = legend.labels.generateLabels({});
      // With null swatches the switch falls through without setting pointStyle.
      for (const item of items) {
        expect(item.pointStyle).toBeUndefined();
      }
    } finally {
      HTMLCanvasElement.prototype.getContext = orig;
    }
  });
});

describe('buildLineConfig', () => {
  it('uses chart type "line"', () => {
    const cfg = buildLineConfig(60, emptyDatasets, 'EP Cube v1');
    expect(cfg.type).toBe('line');
  });

  it('contains 4 line datasets', () => {
    const cfg = buildLineConfig(60, emptyDatasets, 'EP Cube v1');
    expect(cfg.data.datasets.length).toBe(4);
    for (const d of cfg.data.datasets) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((d as any).type).toBe('line');
    }
  });

  it('does not add offset/bounds to x-axis (line charts hug the edges)', () => {
    const cfg = buildLineConfig(60, emptyDatasets, 'EP Cube v1');
    const x = cfg.options!.scales!.x as { offset?: boolean; bounds?: string };
    expect(x.offset).toBeUndefined();
    expect(x.bounds).toBeUndefined();
  });

  it('still has dual y-axes', () => {
    const cfg = buildLineConfig(60, emptyDatasets, 'EP Cube v1');
    const scales = cfg.options!.scales as Record<string, { position?: string }>;
    expect(scales.y.position).toBe('left');
    expect(scales.y1.position).toBe('right');
  });

  it('drops battery overlay + y1 axis if invoked with a day-or-coarser step', () => {
    const cfg = buildLineConfig(86400, emptyDatasets, 'EP Cube v1');
    expect(cfg.data.datasets.length).toBe(3);
    expect(cfg.data.datasets.map((d) => d.label)).not.toContain('Battery %');
    const scales = cfg.options!.scales as Record<string, unknown>;
    expect(scales.y1).toBeUndefined();
  });
});

describe('chart-type dispatch via shouldUseBars', () => {
  it('renders bar config when step >= 86400', async () => {
    setupTwoDeviceMocks([1711152000, 1711238400]);
    render(<HistoricalGraph timeRange={{ start: 1711152000, end: 1711756800, step: 86400 }} />);
    await waitFor(() => {
      expect(capturedConfigs.length).toBe(2);
    });
    expect(capturedConfigs[0].type).toBe('bar');
  });

  it('renders line config when step < 86400', async () => {
    setupTwoDeviceMocks();
    render(<HistoricalGraph timeRange={defaultTimeRange} />);
    await waitFor(() => {
      expect(capturedConfigs.length).toBe(2);
    });
    expect(capturedConfigs[0].type).toBe('line');
  });
});
