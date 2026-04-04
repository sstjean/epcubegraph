import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/preact';
import { h } from 'preact';
import { HistoryView } from '../../src/components/HistoryView';
import { fetchDevices, fetchRangeReadings, fetchGridPower } from '../../src/api';

vi.mock('../../src/api', () => ({
  fetchDevices: vi.fn(),
  fetchRangeReadings: vi.fn(),
  fetchGridPower: vi.fn(),
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

const mockFetchDevices = fetchDevices as ReturnType<typeof vi.fn>;
const mockFetchRangeReadings = fetchRangeReadings as ReturnType<typeof vi.fn>;
const mockFetchGridPower = fetchGridPower as ReturnType<typeof vi.fn>;

const deviceList = {
  devices: [
    { device: 'epcube1_battery', class: 'storage_battery', online: true, alias: 'EP Cube v1 Battery', product_code: 'EP Cube (devType=0)' },
    { device: 'epcube1_solar', class: 'home_solar', online: true, alias: 'EP Cube v1 Solar', product_code: 'EP Cube (devType=0)' },
  ],
};

const dataResponse = {
  metric: 'test_metric',
  series: [{ device_id: 'epcube1_battery', values: [{ timestamp: 1711152000, value: 500 }, { timestamp: 1711152060, value: 600 }] }],
};

function setupDefaultMocks() {
  mockFetchDevices.mockResolvedValue(deviceList);
  mockFetchRangeReadings.mockResolvedValue(dataResponse);
  mockFetchGridPower.mockResolvedValue(dataResponse);
}

describe('HistoryView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it('renders as <section> with h2 heading (FR-015)', () => {
    // Arrange
    setupDefaultMocks();

    // Act
    render(<HistoryView />);

    // Assert
    const section = document.querySelector('section');
    expect(section).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2 })).toBeTruthy();
  });

  it('renders TimeRangeSelector and HistoricalGraph', async () => {
    // Arrange
    setupDefaultMocks();

    // Act
    render(<HistoryView />);

    // Assert — TimeRangeSelector preset buttons should be visible
    expect(screen.getByRole('button', { name: /1d/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /7d/i })).toBeTruthy();

    // HistoricalGraph should be present (fetches data)
    await waitFor(() => {
      expect(mockFetchRangeReadings).toHaveBeenCalled();
    });
  });

  it('defaults to "today" preset on mount', () => {
    // Arrange
    setupDefaultMocks();

    // Act
    render(<HistoryView />);

    // Assert
    const todayButton = screen.getByRole('button', { name: /1d/ });
    expect(todayButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('updates graph when time range changes', async () => {
    // Arrange
    setupDefaultMocks();
    render(<HistoryView />);

    await waitFor(() => {
      expect(mockFetchRangeReadings).toHaveBeenCalled();
    });

    vi.clearAllMocks();
    setupDefaultMocks();

    // Act — click 7d preset
    fireEvent.click(screen.getByRole('button', { name: /7d/i }));

    // Assert — new fetch with 7d params
    await waitFor(() => {
      expect(mockFetchRangeReadings).toHaveBeenCalled();
      const call = mockFetchRangeReadings.mock.calls[0];
      // step should be 86400 for 7d
      expect(call[3]).toBe(86400);
    });
  });

  it('passes TimeRangeValue from selector to graph', async () => {
    // Arrange
    setupDefaultMocks();
    render(<HistoryView />);

    await waitFor(() => {
      expect(mockFetchRangeReadings).toHaveBeenCalled();
    });

    // Assert — first fetch should use today's step (60s)
    const firstCall = mockFetchRangeReadings.mock.calls[0];
    expect(firstCall[3]).toBe(60); // step = 60 for today
  });
});
