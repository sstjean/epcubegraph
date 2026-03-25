import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import { HistoricalGraph, mergeTimeSeries } from '../../src/components/HistoricalGraph';
import { fetchRangeReadings, fetchGridPower } from '../../src/api';
import { withRetry } from '../../src/utils/retry';
import type { RangeReadingsResponse, TimeRangeValue } from '../../src/types';

vi.mock('../../src/api', () => ({
  fetchRangeReadings: vi.fn(),
  fetchGridPower: vi.fn(),
}));

vi.mock('../../src/utils/retry', () => ({
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
  isRetryableError: vi.fn().mockReturnValue(true),
}));

// Mock uPlot — happy-dom doesn't support canvas
vi.mock('uplot', () => {
  return {
    default: class MockUPlot {
      root: HTMLDivElement;
      constructor(_opts: unknown, _data: unknown, target: HTMLElement) {
        this.root = document.createElement('div');
        this.root.className = 'uplot';
        target.appendChild(this.root);
      }
      destroy() {
        this.root.remove();
      }
      setData() {}
      setSize() {}
    },
  };
});

const mockFetchRangeReadings = fetchRangeReadings as ReturnType<typeof vi.fn>;
const mockFetchGridPower = fetchGridPower as ReturnType<typeof vi.fn>;
const mockWithRetry = withRetry as ReturnType<typeof vi.fn>;

function makeRangeResponse(
  values: Array<[number, string]>,
  deviceId = 'epcube_battery',
): RangeReadingsResponse {
  return {
    metric: 'test_metric',
    series: values.length > 0
      ? [{ device_id: deviceId, values: values.map(([ts, v]) => ({ timestamp: ts, value: parseFloat(v) })) }]
      : [],
  };
}

const emptyRangeResponse: RangeReadingsResponse = {
  metric: 'test_metric',
  series: [],
};

const defaultTimeRange: TimeRangeValue = {
  start: 1711152000,
  end: 1711238400,
  step: 60,
};

describe('HistoricalGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it('renders uPlot canvas with accessible aria-label (FR-015)', async () => {
    mockFetchRangeReadings.mockResolvedValue(
      makeRangeResponse([[1711152000, '1000'], [1711152060, '1100']])
    );
    mockFetchGridPower.mockResolvedValue(
      makeRangeResponse([[1711152000, '200'], [1711152060, '250']])
    );

    // Act
    render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Assert
    await waitFor(() => {
      const container = document.querySelector('[aria-label]');
      expect(container).toBeTruthy();
      expect(container!.getAttribute('aria-label')).toMatch(/historical.*graph|energy.*chart/i);
    });
  });

  it('shows "No data available for this time range" for empty result (FR-007)', async () => {
    mockFetchRangeReadings.mockResolvedValue(emptyRangeResponse);
    mockFetchGridPower.mockResolvedValue(emptyRangeResponse);

    // Act
    render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/no data available/i)).toBeTruthy();
    });
  });

  it('handles data gaps with null values for broken line rendering (FR-008)', async () => {
    // Arrange — timestamps with a gap (missing 1711152120)
    const solarValues: Array<[number, string]> = [
      [1711152000, '1000'],
      [1711152060, '1100'],
      // gap at 1711152120
      [1711152180, '1200'],
    ];

    mockFetchRangeReadings.mockResolvedValue(makeRangeResponse(solarValues));
    mockFetchGridPower.mockResolvedValue(makeRangeResponse(solarValues));

    // Act
    render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Assert — component should render without error (the null gap is handled in data conversion)
    await waitFor(() => {
      const container = document.querySelector('[aria-label]');
      expect(container).toBeTruthy();
    });
  });

  it('displays aggregation notice with role="status" when step > 60s (FR-013)', async () => {
    // Arrange — hourly step
    const hourlyRange: TimeRangeValue = {
      start: 1711152000,
      end: 1711756800,
      step: 3600,
    };

    mockFetchRangeReadings.mockResolvedValue(
      makeRangeResponse([[1711152000, '500'], [1711155600, '600']])
    );
    mockFetchGridPower.mockResolvedValue(
      makeRangeResponse([[1711152000, '100'], [1711155600, '150']])
    );

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
    const dailyRange: TimeRangeValue = {
      start: 1711152000,
      end: 1713744000,
      step: 86400,
    };

    mockFetchRangeReadings.mockResolvedValue(
      makeRangeResponse([[1711152000, '500'], [1711238400, '600']])
    );
    mockFetchGridPower.mockResolvedValue(
      makeRangeResponse([[1711152000, '100'], [1711238400, '150']])
    );

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
    const monthlyRange: TimeRangeValue = {
      start: 1711152000,
      end: 1742688000,
      step: 2592000,
    };

    mockFetchRangeReadings.mockResolvedValue(
      makeRangeResponse([[1711152000, '500'], [1713744000, '600']])
    );
    mockFetchGridPower.mockResolvedValue(
      makeRangeResponse([[1711152000, '100'], [1713744000, '150']])
    );

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
    mockFetchRangeReadings.mockResolvedValue(
      makeRangeResponse([[1711152000, '500'], [1711152060, '600']])
    );
    mockFetchGridPower.mockResolvedValue(
      makeRangeResponse([[1711152000, '100'], [1711152060, '150']])
    );

    // Act
    render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Assert
    await waitFor(() => {
      const container = document.querySelector('[aria-label]');
      expect(container).toBeTruthy();
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('fetches solar, battery, home load, and grid metrics', async () => {
    // Arrange
    mockFetchRangeReadings.mockResolvedValue(
      makeRangeResponse([[1711152000, '500']])
    );
    mockFetchGridPower.mockResolvedValue(
      makeRangeResponse([[1711152000, '100']])
    );

    // Act
    render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Assert
    await waitFor(() => {
      // Should call fetchRangeReadings for solar, battery, home load
      expect(mockFetchRangeReadings).toHaveBeenCalledWith(
        expect.stringContaining('solar_instantaneous_generation_watts'),
        defaultTimeRange.start,
        defaultTimeRange.end,
        defaultTimeRange.step,
      );
      expect(mockFetchRangeReadings).toHaveBeenCalledWith(
        expect.stringContaining('battery_power_watts'),
        defaultTimeRange.start,
        defaultTimeRange.end,
        defaultTimeRange.step,
      );
      expect(mockFetchRangeReadings).toHaveBeenCalledWith(
        expect.stringContaining('home_load_power_watts'),
        defaultTimeRange.start,
        defaultTimeRange.end,
        defaultTimeRange.step,
      );
      // Grid uses the convenience endpoint
      expect(mockFetchGridPower).toHaveBeenCalledWith(
        defaultTimeRange.start,
        defaultTimeRange.end,
        defaultTimeRange.step,
      );
    });
  });

  it('renders loading state while fetching', () => {
    // Arrange — never-resolving promises
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
    mockFetchRangeReadings.mockResolvedValue(
      makeRangeResponse([[1711152000, '500']])
    );
    mockFetchGridPower.mockResolvedValue(
      makeRangeResponse([[1711152000, '100']])
    );

    const { rerender } = render(<HistoricalGraph timeRange={defaultTimeRange} />);

    await waitFor(() => {
      expect(mockFetchRangeReadings).toHaveBeenCalled();
    });

    vi.clearAllMocks();

    // Act — change time range
    const newRange: TimeRangeValue = { start: 1711238400, end: 1711324800, step: 60 };
    rerender(<HistoricalGraph timeRange={newRange} />);

    // Assert
    await waitFor(() => {
      expect(mockFetchRangeReadings).toHaveBeenCalledWith(
        expect.any(String),
        newRange.start,
        newRange.end,
        newRange.step,
      );
    });
  });

  it('cleans up uPlot instance on unmount', async () => {
    // Arrange
    mockFetchRangeReadings.mockResolvedValue(
      makeRangeResponse([[1711152000, '500'], [1711152060, '600']])
    );
    mockFetchGridPower.mockResolvedValue(
      makeRangeResponse([[1711152000, '100'], [1711152060, '150']])
    );

    const { unmount } = render(<HistoricalGraph timeRange={defaultTimeRange} />);

    await waitFor(() => {
      const container = document.querySelector('[aria-label]');
      expect(container).toBeTruthy();
    });

    // Act — unmount triggers cleanup
    unmount();

    // Assert — no uPlot elements should remain
    expect(document.querySelector('.uplot')).toBeNull();
  });

  it('ignores stale fetch results when unmounted during fetch', async () => {
    // Arrange — use delayed promises that resolve after unmount
    let resolveRange!: (v: RangeReadingsResponse) => void;
    let resolveGrid!: (v: RangeReadingsResponse) => void;
    mockFetchRangeReadings.mockReturnValue(new Promise<RangeReadingsResponse>((r) => { resolveRange = r; }));
    mockFetchGridPower.mockReturnValue(new Promise<RangeReadingsResponse>((r) => { resolveGrid = r; }));

    const { unmount } = render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Act — unmount before fetch resolves (sets cancelled = true)
    unmount();

    // Resolve after unmount
    const response = makeRangeResponse([[1711152000, '500']]);
    resolveRange(response);
    resolveGrid(response);

    // Assert — no crash, no chart rendered
    await new Promise((r) => setTimeout(r, 10));
    expect(document.querySelector('.uplot')).toBeNull();
  });

  it('shows retry count during reconnection attempts', async () => {
    // Arrange — withRetry calls onRetry before each retry, then succeeds
    mockWithRetry.mockImplementation(async (fn: () => Promise<unknown>, options?: { onRetry?: (n: number) => void }) => {
      if (options?.onRetry) {
        options.onRetry(2);
      }
      return fn();
    });
    mockFetchRangeReadings.mockResolvedValue(
      makeRangeResponse([[1711152000, '500']])
    );
    mockFetchGridPower.mockResolvedValue(
      makeRangeResponse([[1711152000, '100']])
    );

    // Act
    render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/Reconnecting… attempt 2 of 10/)).toBeTruthy();
    });
  });

  it('shows error after all retries exhausted', async () => {
    // Arrange — withRetry rejects after retries
    mockWithRetry.mockRejectedValue(new Error('Service Unavailable'));
    mockFetchRangeReadings.mockResolvedValue(emptyRangeResponse);
    mockFetchGridPower.mockResolvedValue(emptyRangeResponse);

    // Act
    render(<HistoricalGraph timeRange={defaultTimeRange} />);

    // Assert
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText(/Error: Service Unavailable/)).toBeTruthy();
    });
  });

  it('shows fallback error when rejection is not an Error instance', async () => {
    // Arrange — withRetry rejects with a non-Error value
    mockWithRetry.mockRejectedValue('something went wrong');
    mockFetchRangeReadings.mockResolvedValue(emptyRangeResponse);
    mockFetchGridPower.mockResolvedValue(emptyRangeResponse);

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
    mockFetchRangeReadings.mockResolvedValue(
      makeRangeResponse([[1711152000, '500']])
    );
    mockFetchGridPower.mockResolvedValue(
      makeRangeResponse([[1711152000, '100']])
    );

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
});

describe('mergeTimeSeries', () => {
  it('produces null for missing timestamps', () => {
    // Arrange
    const timestamps = [100, 200, 300, 400];
    const series = [
      { values: [[100, '1'], [200, '2'], [400, '4']] as Array<[number, string]> },
      { values: [[100, '10'], [300, '30']] as Array<[number, string]> },
    ];

    // Act
    const result = mergeTimeSeries(timestamps, series);

    // Assert
    // First series: [1, 2, null, 4]
    expect(result[0]).toEqual([1, 2, null, 4]);
    // Second series: [10, null, 30, null]
    expect(result[1]).toEqual([10, null, 30, null]);
  });

  it('returns empty arrays for empty input', () => {
    // Act
    const result = mergeTimeSeries([], []);

    // Assert
    expect(result).toEqual([]);
  });

  it('parses string values to floats', () => {
    // Arrange
    const timestamps = [100, 200];
    const series = [
      { values: [[100, '3.14'], [200, '2.71']] as Array<[number, string]> },
    ];

    // Act
    const result = mergeTimeSeries(timestamps, series);

    // Assert
    expect(result[0]).toEqual([3.14, 2.71]);
  });
});
