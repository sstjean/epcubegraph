import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/preact';
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
  DEFAULT_INTERVAL_MS: 5_000,
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
      // 6 metric queries: battery SOC, battery power, solar, grid, home load, battery stored kWh
      expect(mockFetchInstantQuery).toHaveBeenCalledTimes(6);
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
    // Battery SOC, Battery Power, Solar, Grid, Home Load, Battery Stored kWh — each returns device-specific results
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
      ]}})
      .mockResolvedValueOnce({ status: 'success', data: { resultType: 'vector', result: [
        { metric: { device: 'epcube5488_battery' }, value: [1, '9.7'] },
      ]}});

    // Act
    render(<CurrentReadings />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/97\.0%/)).toBeTruthy();
      expect(screen.getByText(/9\.7 kWh/)).toBeTruthy();
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

  it('defaults metrics to zero when group has no battery device', async () => {
    // Arrange — solar-only device with no battery counterpart
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube9999_solar', class: 'home_solar', online: true, alias: 'Solar Only Solar' },
      ],
    });
    mockFetchInstantQuery.mockResolvedValue(emptyMetricResponse);

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
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube9999_battery', class: 'storage_battery', online: true, alias: 'Battery Only Battery' },
      ],
    });
    mockFetchInstantQuery.mockResolvedValue(emptyMetricResponse);

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
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube3483_battery', class: 'storage_battery', online: true },
      ],
    });
    mockFetchInstantQuery.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert — uses formatted device id as name
    await waitFor(() => {
      expect(screen.getByText('EP Cube 3483')).toBeTruthy();
    });
  });

  it('uses raw device base when id does not match epcube pattern', async () => {
    // Arrange — device with non-standard id format
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'custom_device_battery', class: 'storage_battery', online: true },
      ],
    });
    mockFetchInstantQuery.mockResolvedValue(emptyMetricResponse);

    // Act
    render(<CurrentReadings />);

    // Assert — uses raw base name
    await waitFor(() => {
      expect(screen.getByText('custom_device')).toBeTruthy();
    });
  });

  it('defaults to flow view and shows EnergyFlowDiagram when devices loaded', async () => {
    // Arrange
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube1_battery', class: 'storage_battery', online: true, alias: 'EP Cube v1 Battery' },
        { device: 'epcube1_solar', class: 'home_solar', online: true, alias: 'EP Cube v1 Solar' },
      ],
    });
    mockFetchInstantQuery.mockResolvedValue(emptyMetricResponse);

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
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube1_battery', class: 'storage_battery', online: true, alias: 'EP Cube v1 Battery' },
        { device: 'epcube1_solar', class: 'home_solar', online: true, alias: 'EP Cube v1 Solar' },
      ],
    });
    mockFetchInstantQuery.mockResolvedValue(emptyMetricResponse);

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
    mockFetchDevices.mockResolvedValue({
      devices: [
        { device: 'epcube1_battery', class: 'storage_battery', online: true, alias: 'EP Cube v1 Battery' },
        { device: 'epcube1_solar', class: 'home_solar', online: true, alias: 'EP Cube v1 Solar' },
      ],
    });
    mockFetchInstantQuery.mockResolvedValue(emptyMetricResponse);

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
    mockFetchDevices.mockResolvedValue({ devices: [] });
    mockFetchInstantQuery.mockResolvedValue(emptyMetricResponse);

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
    mockFetchDevices.mockResolvedValue({ devices: [] });
    mockFetchInstantQuery.mockResolvedValue(emptyMetricResponse);

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
    mockFetchInstantQuery
      .mockResolvedValueOnce({ status: 'success', data: { resultType: 'vector', result: [
        { metric: { device: 'epcube5488_battery' }, value: [1, '90'] },
      ]}})
      .mockResolvedValueOnce({ status: 'success', data: { resultType: 'vector', result: [
        { metric: { device: 'epcube5488_battery' }, value: [1, '500'] },
      ]}})
      .mockResolvedValueOnce({ status: 'success', data: { resultType: 'vector', result: [
        { metric: { device: 'epcube5488_solar' }, value: [1, '6000'] },
      ]}})
      .mockResolvedValueOnce({ status: 'success', data: { resultType: 'vector', result: [
        { metric: { device: 'epcube5488_battery' }, value: [1, '-3500'] },
      ]}})
      .mockResolvedValueOnce({ status: 'success', data: { resultType: 'vector', result: [
        { metric: { device: 'epcube5488_battery' }, value: [1, '1200'] },
      ]}})
      .mockResolvedValueOnce({ status: 'success', data: { resultType: 'vector', result: [
        { metric: { device: 'epcube5488_battery' }, value: [1, '9.0'] },
      ]}});

    // Act
    render(<CurrentReadings />);

    // Assert — negative grid value means exporting; flow diagram should show "exporting" sublabel
    await waitFor(() => {
      expect(screen.getByText('exporting')).toBeTruthy();
    });
  });
});
