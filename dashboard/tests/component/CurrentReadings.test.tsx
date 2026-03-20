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

describe('CurrentReadings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it('renders as <section> with heading (FR-015)', async () => {
    // Arrange
    mockFetchDevices.mockResolvedValue({ devices: [] });

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

    // Act
    render(<CurrentReadings />);

    // Assert
    const section = document.querySelector('section');
    expect(section?.getAttribute('aria-busy')).toBe('true');
  });

  it('fetches devices and instant queries on mount', async () => {
    // Arrange
    mockFetchDevices.mockResolvedValue({
      devices: [{ device: 'epcube_battery', class: 'storage_battery', online: true }],
    });
    mockFetchInstantQuery.mockResolvedValue({
      status: 'success',
      data: { resultType: 'vector', result: [{ metric: {}, value: [Date.now() / 1000, '85'] }] },
    });

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(mockFetchDevices).toHaveBeenCalled();
    });
  });

  it('renders DeviceCard for each device', async () => {
    // Arrange
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube_battery', class: 'storage_battery', online: true },
        { device: 'epcube_solar', class: 'home_solar', online: true },
      ],
    });
    mockFetchInstantQuery.mockResolvedValue({
      status: 'success',
      data: { resultType: 'vector', result: [{ metric: {}, value: [Date.now() / 1000, '0'] }] },
    });

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      const articles = document.querySelectorAll('article');
      expect(articles.length).toBe(2);
    });
  });

  it('shows error state when API fails', async () => {
    // Arrange
    mockFetchDevices.mockRejectedValue(new Error('Network error'));

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

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(mockCreatePolling).toHaveBeenCalled();
    });
  });

  it('handles empty instant query results (getValue fallback to 0)', async () => {
    // Arrange
    mockFetchDevices.mockResolvedValue({
      devices: [{ device: 'epcube_battery', class: 'storage_battery', online: true }],
    });
    mockFetchInstantQuery.mockResolvedValue({
      status: 'success',
      data: { resultType: 'vector', result: [] },
    });

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      const articles = document.querySelectorAll('article');
      expect(articles.length).toBe(1);
    });
  });

  it('handles non-Error thrown objects', async () => {
    // Arrange
    mockFetchDevices.mockRejectedValue('string error');

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

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/no devices found/i)).toBeTruthy();
    });
  });
});
