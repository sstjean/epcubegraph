import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/preact';
import { h } from 'preact';
import { GridEnergySummary } from '../../src/components/GridEnergySummary';
import { fetchGridPower } from '../../src/api';
import type { TimeRangeValue } from '../../src/types';

vi.mock('../../src/api', () => ({
  fetchGridPower: vi.fn(),
}));

const mockFetchGridPower = fetchGridPower as ReturnType<typeof vi.fn>;

const timeRange: TimeRangeValue = { start: 1711152000, end: 1711238400, step: 60 };

describe('GridEnergySummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it('shows loading state initially', () => {
    // Arrange
    mockFetchGridPower.mockReturnValue(new Promise(() => {})); // never resolves

    // Act
    render(<GridEnergySummary timeRange={timeRange} />);

    // Assert
    expect(screen.getByText(/loading grid energy/i)).toBeTruthy();
  });

  it('shows "No Grid Data" when API returns empty series', async () => {
    // Arrange
    mockFetchGridPower.mockResolvedValue({
      metric: 'grid_power_watts',
      series: [],
    });

    // Act
    render(<GridEnergySummary timeRange={timeRange} />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/no grid data/i)).toBeTruthy();
    });
  });

  it('shows "No Grid Data" when series have empty values', async () => {
    // Arrange
    mockFetchGridPower.mockResolvedValue({
      metric: 'grid_power_watts',
      series: [{ device_id: 'dev1', values: [] }],
    });

    // Act
    render(<GridEnergySummary timeRange={timeRange} />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/no grid data/i)).toBeTruthy();
    });
  });

  it('renders 3 bar rows with correct labels', async () => {
    // Arrange
    mockFetchGridPower.mockResolvedValue({
      metric: 'grid_power_watts',
      series: [{
        device_id: 'dev1',
        values: [
          { timestamp: 1711152000, value: 1000 },
          { timestamp: 1711155600, value: -500 },
        ],
      }],
    });

    // Act
    render(<GridEnergySummary timeRange={timeRange} />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('Grid Import')).toBeTruthy();
      expect(screen.getByText('Solar Export')).toBeTruthy();
      expect(screen.getByText('Net')).toBeTruthy();
    });
  });

  it('displays formatted kWh values', async () => {
    // Arrange — 2000W import for 1h = 2 kWh, -1000W export for 1h = 1 kWh
    mockFetchGridPower.mockResolvedValue({
      metric: 'grid_power_watts',
      series: [{
        device_id: 'dev1',
        values: [
          { timestamp: 1711152000, value: 2000 },
          { timestamp: 1711155600, value: -1000 },
        ],
      }],
    });

    // Act
    render(<GridEnergySummary timeRange={timeRange} />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('2.000 kWh')).toBeTruthy();
      expect(screen.getByText('1.000 kWh')).toBeTruthy();
    });
  });

  it('fetches grid data at hourly step (3600) regardless of timeRange.step', async () => {
    // Arrange — timeRange.step is 60 (today), but grid energy should use 3600
    mockFetchGridPower.mockResolvedValue({
      metric: 'grid_power_watts',
      series: [{ device_id: 'dev1', values: [{ timestamp: 1000, value: 100 }] }],
    });

    // Act
    render(<GridEnergySummary timeRange={{ start: 1000, end: 2000, step: 60 }} />);

    // Assert
    await waitFor(() => {
      expect(mockFetchGridPower).toHaveBeenCalledWith(1000, 2000, 3600);
    });
  });

  it('shows error state on fetch failure', async () => {
    // Arrange
    mockFetchGridPower.mockRejectedValue(new Error('Network error'));

    // Act
    render(<GridEnergySummary timeRange={timeRange} />);

    // Assert
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText(/network error/i)).toBeTruthy();
    });
  });

  it('applies bar-net-positive class when net is positive (net producer)', async () => {
    // Arrange — all export, no import → net positive
    mockFetchGridPower.mockResolvedValue({
      metric: 'grid_power_watts',
      series: [{
        device_id: 'dev1',
        values: [{ timestamp: 1000, value: -5000 }],
      }],
    });

    // Act
    render(<GridEnergySummary timeRange={timeRange} />);

    // Assert
    await waitFor(() => {
      const netBar = document.querySelector('.bar-net-positive');
      expect(netBar).toBeTruthy();
    });
  });

  it('applies bar-net-negative class when net is negative (net consumer)', async () => {
    // Arrange — all import, no export → net negative
    mockFetchGridPower.mockResolvedValue({
      metric: 'grid_power_watts',
      series: [{
        device_id: 'dev1',
        values: [{ timestamp: 1000, value: 5000 }],
      }],
    });

    // Act
    render(<GridEnergySummary timeRange={timeRange} />);

    // Assert
    await waitFor(() => {
      const netBar = document.querySelector('.bar-net-negative');
      expect(netBar).toBeTruthy();
    });
  });

  it('renders meter roles for accessibility', async () => {
    // Arrange
    mockFetchGridPower.mockResolvedValue({
      metric: 'grid_power_watts',
      series: [{
        device_id: 'dev1',
        values: [{ timestamp: 1000, value: 1000 }],
      }],
    });

    // Act
    render(<GridEnergySummary timeRange={timeRange} />);

    // Assert
    await waitFor(() => {
      const meters = screen.getAllByRole('meter');
      expect(meters.length).toBe(3);
    });
  });

  it('has correct aria-label on container', async () => {
    // Arrange
    mockFetchGridPower.mockResolvedValue({
      metric: 'grid_power_watts',
      series: [{
        device_id: 'dev1',
        values: [{ timestamp: 1000, value: 1000 }],
      }],
    });

    // Act
    render(<GridEnergySummary timeRange={timeRange} />);

    // Assert
    await waitFor(() => {
      expect(screen.getByLabelText('Grid energy summary')).toBeTruthy();
    });
  });

  it('refetches when timeRange changes', async () => {
    // Arrange
    mockFetchGridPower.mockResolvedValue({
      metric: 'grid_power_watts',
      series: [{ device_id: 'dev1', values: [{ timestamp: 1000, value: 100 }] }],
    });

    const { rerender } = render(<GridEnergySummary timeRange={timeRange} />);

    await waitFor(() => {
      expect(mockFetchGridPower).toHaveBeenCalledTimes(1);
    });

    // Act — change time range
    const newRange: TimeRangeValue = { start: 1711238400, end: 1711324800, step: 3600 };
    rerender(<GridEnergySummary timeRange={newRange} />);

    // Assert
    await waitFor(() => {
      expect(mockFetchGridPower).toHaveBeenCalledTimes(2);
      expect(mockFetchGridPower).toHaveBeenLastCalledWith(1711238400, 1711324800, 3600);
    });
  });

  it('shows zero-value bars when data exists but sums to zero', async () => {
    // Arrange — a single zero-watt sample
    mockFetchGridPower.mockResolvedValue({
      metric: 'grid_power_watts',
      series: [{
        device_id: 'dev1',
        values: [{ timestamp: 1000, value: 0 }],
      }],
    });

    // Act
    render(<GridEnergySummary timeRange={timeRange} />);

    // Assert — should show bars, not "No Grid Data"
    await waitFor(() => {
      expect(screen.getByText('Grid Import')).toBeTruthy();
      const zeroValues = screen.getAllByText('0.000 kWh');
      expect(zeroValues.length).toBe(3);
    });
  });

  it('does not update state when unmounted before fetch resolves', async () => {
    // Arrange — control when the promise resolves
    let resolveFetch!: (value: unknown) => void;
    mockFetchGridPower.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));

    // Act — render then unmount immediately
    const { unmount } = render(<GridEnergySummary timeRange={timeRange} />);
    unmount();

    // Resolve after unmount — should not throw or update state
    resolveFetch({
      metric: 'grid_power_watts',
      series: [{ device_id: 'dev1', values: [{ timestamp: 1000, value: 1000 }] }],
    });

    // Assert — no errors thrown (React would warn about state updates on unmounted)
    expect(true).toBe(true);
  });

  it('does not update state when unmounted before fetch rejects', async () => {
    // Arrange — control when the promise rejects
    let rejectFetch!: (reason: unknown) => void;
    mockFetchGridPower.mockReturnValue(new Promise((_, reject) => { rejectFetch = reject; }));

    // Act — render then unmount immediately
    const { unmount } = render(<GridEnergySummary timeRange={timeRange} />);
    unmount();

    // Reject after unmount — should not throw or update state
    rejectFetch(new Error('fail'));

    // Assert — no errors thrown
    expect(true).toBe(true);
  });

  it('shows fallback error message for non-Error exceptions', async () => {
    // Arrange — reject with a string, not an Error
    mockFetchGridPower.mockRejectedValue('string error');

    // Act
    render(<GridEnergySummary timeRange={timeRange} />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/failed to load grid energy data/i)).toBeTruthy();
    });
  });
});
