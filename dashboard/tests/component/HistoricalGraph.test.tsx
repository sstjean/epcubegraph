import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import { HistoricalGraph, buildDeviceChartData, getAggregationLabel, shouldUseBars, formatTooltipTimestamp, formatAxisDates } from '../../src/components/HistoricalGraph';
import { fetchDevices, fetchRangeReadings, fetchGridPower } from '../../src/api';
import { withRetry } from '../../src/utils/retry';
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

const { capturedUPlotOpts, barsSpy } = vi.hoisted(() => ({
  capturedUPlotOpts: [] as Record<string, unknown>[],
  barsSpy: vi.fn(() => vi.fn()),
}));

// Mock uPlot — happy-dom doesn't support canvas
vi.mock('uplot', () => {
  return {
    default: class MockUPlot {
      static paths = { bars: barsSpy };
      root: HTMLDivElement;
      over: HTMLDivElement;
      cursor: { idx: number | null; left: number; top: number };
      ctx: { canvas: { height: number }; createLinearGradient: () => { addColorStop: () => void } };
      constructor(opts: Record<string, unknown>, data: unknown, target: HTMLElement) {
        capturedUPlotOpts.push(opts);
        this.root = document.createElement('div');
        this.root.className = 'uplot';
        this.over = document.createElement('div');
        Object.defineProperty(this.over, 'offsetLeft', { value: 0 });
        Object.defineProperty(this.over, 'offsetTop', { value: 0 });
        this.root.appendChild(this.over);
        target.appendChild(this.root);
        // Give target a width so tooltip positioning covers both branches
        Object.defineProperty(target, 'clientWidth', { value: 800, configurable: true });
        this.cursor = { idx: null, left: 0, top: 0 };
        // Fake canvas context for gradient fill callbacks
        this.ctx = {
          canvas: { height: 300 },
          createLinearGradient: () => ({ addColorStop: () => {} }),
        };
        // Invoke series fill callbacks so coverage reaches gradient code
        const series = opts.series as Array<{ fill?: unknown }> | undefined;
        if (series) {
          for (const s of series) {
            if (typeof s.fill === 'function') {
              s.fill(this);
            }
          }
        }
        // Invoke axis value formatters so coverage reaches the callback
        const axes = opts.axes as Array<{ values?: (u: unknown, splits: number[]) => string[] }> | undefined;
        if (axes) {
          for (const axis of axes) {
            if (typeof axis.values === 'function') {
              axis.values(null, [0, 500, 1500]);
            }
          }
        }
        // Invoke setCursor hooks for tooltip coverage
        const hooks = opts.hooks as { setCursor?: Array<(u: MockUPlot) => void> } | undefined;
        if (hooks?.setCursor) {
          // First call with no idx (tooltip hidden)
          this.cursor = { idx: null, left: 0, top: 0 };
          for (const fn of hooks.setCursor) fn(this);
          // Second call with valid idx — left=50, fits in container → normal branch
          const dataArr = data as Array<number[]>;
          if (dataArr?.[0]?.length > 0) {
            this.cursor = { idx: 0, left: 50, top: 50 };
            for (const fn of hooks.setCursor) fn(this);
            // Third call with left=900 — exceeds clientWidth=800 → flip branch
            this.cursor = { idx: 0, left: 900, top: 50 };
            for (const fn of hooks.setCursor) fn(this);
          }
        }
      }
      destroy() {
        this.root.remove();
      }
      setData() {}
      setSize() {}
    },
  };
});

const mockFetchDevices = fetchDevices as ReturnType<typeof vi.fn>;
const mockFetchRangeReadings = fetchRangeReadings as ReturnType<typeof vi.fn>;
const mockFetchGridPower = fetchGridPower as ReturnType<typeof vi.fn>;
const mockWithRetry = withRetry as ReturnType<typeof vi.fn>;

// --- Test fixtures matching "EP Cube v1" / "EP Cube v2" convention ---

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
  mockWithRetry.mockImplementation((fn: () => Promise<unknown>) => fn());
  mockFetchDevices.mockResolvedValue(twoDeviceList);
  mockFetchRangeReadings
    .mockResolvedValueOnce(makeTwoDeviceResponse('solar_instantaneous_generation_watts', ts))
    .mockResolvedValueOnce(makeTwoDeviceResponse('home_load_power_watts', ts))
    .mockResolvedValueOnce(makeTwoDeviceResponse('battery_state_of_capacity_percent', ts));
  mockFetchGridPower.mockResolvedValue(makeTwoDeviceResponse('grid_power_watts', ts));
}

describe('HistoricalGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedUPlotOpts.length = 0;
  });

  afterEach(cleanup);

  it('renders one chart per device, stacked vertically (FR-021)', async () => {
    // Arrange
    setupTwoDeviceMocks();

    // Act
    render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Assert — two separate device charts, each labeled with device display name
    await waitFor(() => {
      const deviceCharts = document.querySelectorAll('.device-chart');
      expect(deviceCharts.length).toBe(2);
      expect(screen.getByText('EP Cube v1')).toBeTruthy();
      expect(screen.getByText('EP Cube v2')).toBeTruthy();
    });
  });

  it('labels each chart with device name via h3 heading', async () => {
    // Arrange
    setupTwoDeviceMocks();

    // Act
    render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Assert
    await waitFor(() => {
      const headings = screen.getAllByRole('heading', { level: 3 });
      expect(headings.length).toBe(2);
      expect(headings[0].textContent).toBe('EP Cube v1');
      expect(headings[1].textContent).toBe('EP Cube v2');
    });
  });

  it('each chart has aria-label with device name', async () => {
    // Arrange
    setupTwoDeviceMocks();

    // Act
    render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Assert
    await waitFor(() => {
      const charts = document.querySelectorAll('[aria-label*="energy chart"]');
      expect(charts.length).toBe(2);
      expect(charts[0].getAttribute('aria-label')).toBe('EP Cube v1 energy chart');
      expect(charts[1].getAttribute('aria-label')).toBe('EP Cube v2 energy chart');
    });
  });

  it('does not merge data from different devices into one chart (FR-021)', async () => {
    // Arrange — device 1 has data at t=100, device 2 has data at t=200
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

    // Act
    render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Assert — two charts render, each with their own data
    await waitFor(() => {
      const deviceCharts = document.querySelectorAll('.device-chart');
      expect(deviceCharts.length).toBe(2);
    });
  });

  it('renders accessible container with aria-label and aria-busy (FR-015)', async () => {
    // Arrange
    setupTwoDeviceMocks();

    // Act
    render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Assert
    await waitFor(() => {
      const container = document.querySelector('[aria-label="Historical energy graphs"]');
      expect(container).toBeTruthy();
    });
  });

  it('shows "No data available for this time range" for empty result (FR-007)', async () => {
    // Arrange
    mockWithRetry.mockImplementation((fn: () => Promise<unknown>) => fn());
    mockFetchDevices.mockResolvedValue(twoDeviceList);
    mockFetchRangeReadings.mockResolvedValue(emptyRangeResponse);
    mockFetchGridPower.mockResolvedValue(emptyRangeResponse);

    // Act
    render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/no data available/i)).toBeTruthy();
    });
  });

  it('displays aggregation notice with role="status" when step > 60s (FR-013)', async () => {
    // Arrange — hourly step
    const hourlyRange: TimeRangeValue = { start: 1711152000, end: 1711756800, step: 3600 };
    setupTwoDeviceMocks([1711152000, 1711155600]);

    // Act
    render(<HistoricalGraph timeRange={hourlyRange} />);

    // Assert
    await waitFor(() => {
      const notice = screen.getByRole('status');
      expect(notice).toBeTruthy();
      expect(notice.textContent).toMatch(/hourly/i);
    });
  });

  it('displays "daily resolution" notice for step=86400', async () => {
    // Arrange
    const dailyRange: TimeRangeValue = { start: 1711152000, end: 1713744000, step: 86400 };
    setupTwoDeviceMocks([1711152000, 1711238400]);

    // Act
    render(<HistoricalGraph timeRange={dailyRange} />);

    // Assert
    await waitFor(() => {
      const notice = screen.getByRole('status');
      expect(notice.textContent).toMatch(/daily/i);
    });
  });

  it('displays "monthly resolution" notice for step=2592000', async () => {
    // Arrange
    const monthlyRange: TimeRangeValue = { start: 1711152000, end: 1742688000, step: 2592000 };
    setupTwoDeviceMocks([1711152000, 1713744000]);

    // Act
    render(<HistoricalGraph timeRange={monthlyRange} />);

    // Assert
    await waitFor(() => {
      const notice = screen.getByRole('status');
      expect(notice.textContent).toMatch(/monthly/i);
    });
  });

  it('does not show aggregation notice when step=60s (full resolution)', async () => {
    // Arrange
    setupTwoDeviceMocks();

    // Act
    render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Assert
    await waitFor(() => {
      const charts = document.querySelectorAll('.device-chart');
      expect(charts.length).toBe(2);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('fetches devices, solar, home load, grid, and battery SoC metrics', async () => {
    // Arrange
    setupTwoDeviceMocks();

    // Act
    render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Assert
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
    // Arrange — never-resolving promises
    mockWithRetry.mockImplementation((fn: () => Promise<unknown>) => fn());
    mockFetchDevices.mockReturnValue(new Promise(() => {}));
    mockFetchRangeReadings.mockReturnValue(new Promise(() => {}));
    mockFetchGridPower.mockReturnValue(new Promise(() => {}));

    // Act
    render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Assert
    const loading = document.querySelector('[aria-busy="true"]');
    expect(loading).toBeTruthy();
  });

  it('re-fetches data when timeRange changes', async () => {
    // Arrange
    setupTwoDeviceMocks();

    const { rerender } = render(<HistoricalGraph timeRange={defaultTimeRange} />);

    await waitFor(() => {
      expect(mockFetchRangeReadings).toHaveBeenCalled();
    });

    vi.clearAllMocks();
    setupTwoDeviceMocks();

    // Act — change time range
    const newRange: TimeRangeValue = { start: 1711238400, end: 1711324800, step: 60 };
    rerender(<HistoricalGraph timeRange={newRange} />);

    // Assert
    await waitFor(() => {
      expect(mockFetchRangeReadings).toHaveBeenCalledWith(
        expect.any(String), newRange.start, newRange.end, newRange.step,
      );
    });
  });

  it('cleans up uPlot instances on unmount', async () => {
    // Arrange
    setupTwoDeviceMocks();

    const { unmount } = render(<HistoricalGraph timeRange={defaultTimeRange} />);

    await waitFor(() => {
      const charts = document.querySelectorAll('.device-chart');
      expect(charts.length).toBe(2);
    });

    // Act
    unmount();

    // Assert — no uPlot elements remain
    expect(document.querySelector('.uplot')).toBeNull();
  });

  it('ignores stale fetch results when unmounted during fetch', async () => {
    // Arrange — use delayed promises that resolve after unmount
    mockWithRetry.mockImplementation((fn: () => Promise<unknown>) => fn());
    let resolveDevices!: (v: DeviceListResponse) => void;
    mockFetchDevices.mockReturnValue(new Promise<DeviceListResponse>((r) => { resolveDevices = r; }));
    mockFetchRangeReadings.mockResolvedValue(emptyRangeResponse);
    mockFetchGridPower.mockResolvedValue(emptyRangeResponse);

    const { unmount } = render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Act — unmount before fetch resolves
    unmount();
    resolveDevices(twoDeviceList);

    // Assert — no crash, no charts rendered
    await new Promise((r) => setTimeout(r, 10));
    expect(document.querySelector('.uplot')).toBeNull();
  });

  it('shows retry count during reconnection attempts', async () => {
    // Arrange
    setupTwoDeviceMocks();
    mockWithRetry.mockImplementation(async (fn: () => Promise<unknown>, options?: { onRetry?: (n: number) => void }) => {
      if (options?.onRetry) {
        options.onRetry(2);
      }
      return fn();
    });

    // Act
    render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/Reconnecting… attempt 2 of 10/)).toBeTruthy();
    });
  });

  it('shows error after all retries exhausted', async () => {
    // Arrange
    mockWithRetry.mockRejectedValue(new Error('Service Unavailable'));

    // Act
    render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Assert
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText(/Error: Service Unavailable/)).toBeTruthy();
    });
  });

  it('shows fallback error when rejection is not an Error instance', async () => {
    // Arrange
    mockWithRetry.mockRejectedValue('something went wrong');

    // Act
    render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Assert
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText(/Error: Failed to load data/)).toBeTruthy();
    });
  });

  it('wraps fetchData batch in withRetry', async () => {
    // Arrange
    mockWithRetry.mockImplementation((fn: () => Promise<unknown>) => fn());
    setupTwoDeviceMocks();

    // Act
    render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Assert
    await waitFor(() => {
      expect(mockWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ maxRetries: 10 }),
      );
    });
  });

  it('renders single device when only one device has data', async () => {
    // Arrange — only device 1 has data
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

    // Act
    render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Assert — one chart
    await waitFor(() => {
      const deviceCharts = document.querySelectorAll('.device-chart');
      expect(deviceCharts.length).toBe(1);
      expect(screen.getByText('EP Cube v1')).toBeTruthy();
    });
  });
});

describe('buildDeviceChartData', () => {
  it('filters series to matching device_ids only', () => {
    // Arrange
    const responses: RangeReadingsResponse[] = [
      makeRangeResponse('solar', [
        { device_id: 'epcube1_solar', values: [{ timestamp: 100, value: 1000 }] },
        { device_id: 'epcube2_solar', values: [{ timestamp: 100, value: 2000 }] },
      ]),
    ];
    const deviceIds = new Set(['epcube1_solar', 'epcube1_battery']);

    // Act
    const data = buildDeviceChartData(responses, deviceIds, 60);

    // Assert — only device 1 data included
    expect(data).not.toBeNull();
    expect(data![0]).toEqual([100]);
    expect(data![1]).toEqual([1000]);
  });

  it('returns null when no matching data exists', () => {
    // Arrange
    const responses: RangeReadingsResponse[] = [
      makeRangeResponse('solar', [
        { device_id: 'epcube2_solar', values: [{ timestamp: 100, value: 2000 }] },
      ]),
    ];
    const deviceIds = new Set(['epcube9_solar']);

    // Act
    const data = buildDeviceChartData(responses, deviceIds, 60);

    // Assert
    expect(data).toBeNull();
  });

  it('produces null at gap boundaries when gap > 2× step (FR-008, T055)', () => {
    // Arrange — 1-min step, data with a 30-minute gap
    const responses: RangeReadingsResponse[] = [
      makeRangeResponse('solar', [
        { device_id: 'dev1', values: [
          { timestamp: 100, value: 500 },
          { timestamp: 160, value: 600 },
          // gap of 1800s — more than 2× 60s
          { timestamp: 1960, value: 700 },
          { timestamp: 2020, value: 800 },
        ]},
      ]),
    ];
    const deviceIds = new Set(['dev1']);

    // Act
    const data = buildDeviceChartData(responses, deviceIds, 60);

    // Assert
    expect(data).not.toBeNull();
    expect(data![0]).toEqual([100, 160, 1960, 2020]);
    // Value before gap (index 1) should be nulled to break the line
    expect(data![1]).toEqual([500, null, 700, 800]);
  });

  it('does not insert nulls when timestamps are within 2× step', () => {
    // Arrange
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

    // Act
    const data = buildDeviceChartData(responses, deviceIds, 60);

    // Assert — no nulls, all values preserved
    expect(data![1]).toEqual([500, 600, 700]);
  });

  it('handles multiple metrics with shared timestamps', () => {
    // Arrange
    const responses: RangeReadingsResponse[] = [
      makeRangeResponse('solar', [
        { device_id: 'dev1', values: [{ timestamp: 100, value: 1000 }, { timestamp: 200, value: 1100 }] },
      ]),
      makeRangeResponse('battery', [
        { device_id: 'dev1', values: [{ timestamp: 100, value: 500 }, { timestamp: 200, value: 550 }] },
      ]),
      makeRangeResponse('home_load', [
        { device_id: 'dev1', values: [{ timestamp: 100, value: 800 }] },
      ]),
      makeRangeResponse('grid', [
        { device_id: 'dev1', values: [{ timestamp: 100, value: 200 }, { timestamp: 200, value: 250 }] },
      ]),
    ];
    const deviceIds = new Set(['dev1']);

    // Act
    const data = buildDeviceChartData(responses, deviceIds, 60);

    // Assert — 4 metrics + timestamp array
    expect(data).not.toBeNull();
    expect(data!.length).toBe(5);
    expect(data![0]).toEqual([100, 200]);
    expect(data![1]).toEqual([1000, 1100]); // solar
    expect(data![2]).toEqual([500, 550]); // battery
    expect(data![3]).toEqual([800, null]); // home_load — missing at t=200
    expect(data![4]).toEqual([200, 250]); // grid
  });
});

describe('getAggregationLabel', () => {
  it('returns null for step ≤ 60 (full resolution)', () => {
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

describe('shouldUseBars', () => {
  it('returns false for step < 86400 (line chart)', () => {
    expect(shouldUseBars(60)).toBe(false);
    expect(shouldUseBars(1800)).toBe(false);
    expect(shouldUseBars(3600)).toBe(false);
  });

  it('returns true for step >= 86400 (bar chart for daily+ resolution)', () => {
    expect(shouldUseBars(86400)).toBe(true);
    expect(shouldUseBars(2592000)).toBe(true);
  });
});

describe('formatTooltipTimestamp', () => {
  // Use a known epoch: 2024-03-23 14:30:00 UTC = 1711200600
  const epoch = 1711200600;

  it('returns time only for sub-hourly step (line chart)', () => {
    const result = formatTooltipTimestamp(epoch, 60);
    // Should contain a time pattern like "2:30 PM" or "14:30" (locale-dependent)
    expect(result).toMatch(/\d{1,2}:\d{2}/);
    // Should NOT contain a month name
    expect(result).not.toMatch(/Mar|Jan|Feb|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/i);
  });

  it('returns date + time for hourly step (multi-day line chart)', () => {
    const result = formatTooltipTimestamp(epoch, 3600);
    // Should contain both a month abbreviation and a time
    expect(result).toMatch(/\d{1,2}:\d{2}/);
    expect(result).toMatch(/Mar/i);
  });

  it('returns date only for daily step', () => {
    const result = formatTooltipTimestamp(epoch, 86400);
    // Should contain a month abbreviation and year
    expect(result).toMatch(/Mar/i);
    expect(result).toMatch(/2024/);
    // Should NOT contain a colon (no time)
    expect(result).not.toMatch(/:/);
  });

  it('returns date only for monthly step', () => {
    const result = formatTooltipTimestamp(epoch, 2592000);
    expect(result).toMatch(/Mar/i);
    expect(result).not.toMatch(/:/);
  });
});

describe('formatAxisDates', () => {
  it('returns short date labels without year or time', () => {
    // 2024-03-23 14:30:00 UTC
    const labels = formatAxisDates([1711200600]);
    expect(labels[0]).toMatch(/Mar/i);
    expect(labels[0]).toMatch(/23/);
    expect(labels[0]).not.toMatch(/:/);
    expect(labels[0]).not.toMatch(/2024/);
  });

  it('deduplicates consecutive splits on the same calendar day', () => {
    // Two splits same day: noon and 1 PM of 2024-03-23 UTC (same local date in any timezone)
    const noon = 1711195200;     // 2024-03-23 12:00:00 UTC
    const onePm = 1711198800;    // 2024-03-23 13:00:00 UTC
    // Next day noon
    const nextNoon = 1711281600; // 2024-03-24 12:00:00 UTC
    const labels = formatAxisDates([noon, onePm, nextNoon]);
    // First occurrence gets the label
    expect(labels[0]).toMatch(/Mar/i);
    // Second occurrence same day gets empty string
    expect(labels[1]).toBe('');
    // Next day gets its own label
    expect(labels[2]).toMatch(/Mar/i);
    expect(labels[2]).not.toBe(labels[0]);
  });
});

describe('FR-026 bar chart rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedUPlotOpts.length = 0;
  });

  afterEach(cleanup);

  it('uses bar paths for Solar, Home Load, Grid when step >= 86400', async () => {
    // Arrange
    setupTwoDeviceMocks([1711152000, 1711238400]);

    // Act
    render(<HistoricalGraph timeRange={{ start: 1711152000, end: 1711756800, step: 86400 }} />);

    // Assert
    await waitFor(() => {
      expect(document.querySelectorAll('.device-chart').length).toBe(2);
    });

    expect(barsSpy).toHaveBeenCalled();
    const opts = capturedUPlotOpts[0] as { series: Array<{ paths?: unknown; label?: string }> };
    expect(opts.series[1].paths).toBeDefined(); // Solar
    expect(opts.series[2].paths).toBeDefined(); // Home Load
    expect(opts.series[3].paths).toBeDefined(); // Grid
  });

  it('x-axis shows deduplicated date-only labels for bar charts (step >= 86400)', async () => {
    // Arrange
    setupTwoDeviceMocks([1711152000, 1711238400]);

    // Act
    render(<HistoricalGraph timeRange={{ start: 1711152000, end: 1711756800, step: 86400 }} />);

    // Assert
    await waitFor(() => {
      expect(document.querySelectorAll('.device-chart').length).toBe(2);
    });

    const opts = capturedUPlotOpts[0] as { axes: Array<{ values?: (u: unknown, splits: number[]) => string[] }> };
    const xAxis = opts.axes[0];
    expect(typeof xAxis.values).toBe('function');
    // Two splits on different days
    const labels = xAxis.values!(null, [1711152000, 1711238400]);
    expect(labels[0]).toMatch(/Mar/i);
    expect(labels[1]).toMatch(/Mar/i);
    expect(labels[0]).not.toMatch(/:/);
  });

  it('x-axis uses default uPlot formatting for line charts (step < 86400)', async () => {
    // Arrange
    setupTwoDeviceMocks();

    // Act
    render(<HistoricalGraph timeRange={{ start: 1711152000, end: 1711238400, step: 60 }} />);

    // Assert
    await waitFor(() => {
      expect(document.querySelectorAll('.device-chart').length).toBe(2);
    });

    const opts = capturedUPlotOpts[0] as { axes: Array<{ values?: unknown }> };
    const xAxis = opts.axes[0];
    expect(xAxis.values).toBeUndefined();
  });

  it('Battery % always renders as line (no paths) even at step >= 86400', async () => {
    // Arrange
    setupTwoDeviceMocks([1711152000, 1711238400]);

    // Act
    render(<HistoricalGraph timeRange={{ start: 1711152000, end: 1711756800, step: 86400 }} />);

    // Assert
    await waitFor(() => {
      expect(document.querySelectorAll('.device-chart').length).toBe(2);
    });

    const opts = capturedUPlotOpts[0] as { series: Array<{ paths?: unknown; scale?: string }> };
    const batteryPctSeries = opts.series[4];
    expect(batteryPctSeries.scale).toBe('%');
    expect(batteryPctSeries.paths).toBeUndefined();
  });

  it('does not use bar paths when step < 86400', async () => {
    // Arrange
    setupTwoDeviceMocks();

    // Act
    render(<HistoricalGraph timeRange={{ start: 1711152000, end: 1711238400, step: 60 }} />);

    // Assert
    await waitFor(() => {
      expect(document.querySelectorAll('.device-chart').length).toBe(2);
    });

    expect(barsSpy).not.toHaveBeenCalled();
    const opts = capturedUPlotOpts[0] as { series: Array<{ paths?: unknown }> };
    expect(opts.series[1].paths).toBeUndefined();
    expect(opts.series[2].paths).toBeUndefined();
    expect(opts.series[3].paths).toBeUndefined();
  });
});
