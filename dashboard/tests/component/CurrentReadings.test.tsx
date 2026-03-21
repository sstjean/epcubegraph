import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import { fetchDevices, fetchInstantQuery } from '../../src/api';
import { createPollingInterval, clearPollingInterval } from '../../src/utils/polling';
import { CurrentReadings } from '../../src/components/CurrentReadings';

// Mock external dependencies
vi.mock('../../src/api', () => ({
  fetchDevices: vi.fn(),
  fetchInstantQuery: vi.fn(),
}));

vi.mock('../../src/utils/polling', () => ({
  createPollingInterval: vi.fn().mockReturnValue(1),
  clearPollingInterval: vi.fn(),
  DEFAULT_INTERVAL_MS: 30_000,
}));

const mockFetchDevices = fetchDevices as ReturnType<typeof vi.fn>;
const mockFetchInstantQuery = fetchInstantQuery as ReturnType<typeof vi.fn>;
const mockCreatePolling = createPollingInterval as ReturnType<typeof vi.fn>;

const emptyMetricResponse = {
  status: 'success',
  data: { resultType: 'vector', result: [] },
};

describe('CurrentReadings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it('renders as <section> with heading (FR-015)', async () => {
    // Arrange
    mockFetchDevices.mockResolvedValue({ devices: [] });
    mockFetchInstantQuery.mockResolvedValue(emptyMetricResponse);

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
    mockFetchDevices.mockReturnValue(new Promise(() => {})); // never resolves
    mockFetchInstantQuery.mockReturnValue(new Promise(() => {}));

    // Act
    render(<CurrentReadings />);

    // Assert
    const section = document.querySelector('section');
    expect(section?.getAttribute('aria-busy')).toBe('true');
  });

  it('fetches devices and all metric queries on mount', async () => {
    // Arrange
    mockFetchDevices.mockResolvedValue({ devices: [] });
    mockFetchInstantQuery.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(mockFetchDevices).toHaveBeenCalledTimes(1);
      // 5 metric queries: battery SOC, battery power, solar, grid, home load
      expect(mockFetchInstantQuery).toHaveBeenCalledTimes(5);
    });
  });

  it('groups battery+solar devices into one card per alias', async () => {
    // Arrange
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube5488_battery', class: 'storage_battery', online: true, alias: 'EP Cube v2 Battery' },
        { device: 'epcube5488_solar', class: 'home_solar', online: true, alias: 'EP Cube v2 Solar' },
      ],
    });
    mockFetchInstantQuery.mockResolvedValue(emptyMetricResponse);

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
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube5488_battery', class: 'storage_battery', online: true, alias: 'EP Cube v2 Battery' },
        { device: 'epcube5488_solar', class: 'home_solar', online: true, alias: 'EP Cube v2 Solar' },
      ],
    });
    // Battery SOC, Battery Power, Solar, Grid, Home Load — each returns device-specific results
    mockFetchInstantQuery
      .mockResolvedValueOnce({ status: 'success', data: { resultType: 'vector', result: [
        { metric: { device: 'epcube5488_battery' }, value: [1, '97'] },
      ]}})
      .mockResolvedValueOnce({ status: 'success', data: { resultType: 'vector', result: [
        { metric: { device: 'epcube5488_battery' }, value: [1, '500'] },
      ]}})
      .mockResolvedValueOnce({ status: 'success', data: { resultType: 'vector', result: [
        { metric: { device: 'epcube5488_solar' }, value: [1, '5580'] },
      ]}})
      .mockResolvedValueOnce({ status: 'success', data: { resultType: 'vector', result: [
        { metric: { device: 'epcube5488_battery' }, value: [1, '3660'] },
      ]}})
      .mockResolvedValueOnce({ status: 'success', data: { resultType: 'vector', result: [
        { metric: { device: 'epcube5488_battery' }, value: [1, '1200'] },
      ]}});

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('97.0%')).toBeTruthy();
      expect(screen.getByText('5.6 kW')).toBeTruthy();
    });
  });

  it('shows error state when API fails', async () => {
    // Arrange
    mockFetchDevices.mockRejectedValue(new Error('Network error'));
    mockFetchInstantQuery.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/error|failed|network/i)).toBeTruthy();
    });
  });

  it('triggers polling refresh via createPollingInterval', async () => {
    // Arrange
    mockFetchDevices.mockResolvedValue({ devices: [] });
    mockFetchInstantQuery.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(mockCreatePolling).toHaveBeenCalled();
    });
  });

  it('handles non-Error thrown objects', async () => {
    // Arrange
    mockFetchDevices.mockRejectedValue('string error');
    mockFetchInstantQuery.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/failed to load data/i)).toBeTruthy();
    });
  });

  it('shows "No devices found" when API returns empty list', async () => {
    // Arrange
    mockFetchDevices.mockResolvedValue({ devices: [] });
    mockFetchInstantQuery.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/no devices found/i)).toBeTruthy();
    });
  });
});
