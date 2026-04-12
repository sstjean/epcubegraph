import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/preact';
import { h } from 'preact';
import { fetchVueBulkCurrentReadings, fetchVueDailyReadings, fetchSettings, fetchHierarchy } from '../../src/api';

vi.mock('../../src/api', () => ({
  fetchVueBulkCurrentReadings: vi.fn(),
  fetchVueDailyReadings: vi.fn(),
  fetchSettings: vi.fn(),
  fetchHierarchy: vi.fn(),
}));

vi.mock('../../src/telemetry', () => ({
  trackException: vi.fn(),
  trackApiError: vi.fn(),
  trackPageLoad: vi.fn(),
  initTelemetry: vi.fn(),
}));

import { CircuitsPage } from '../../src/components/CircuitsPage';

const mockFetchCurrentReadings = fetchVueBulkCurrentReadings as ReturnType<typeof vi.fn>;
const mockFetchDailyReadings = fetchVueDailyReadings as ReturnType<typeof vi.fn>;
const mockFetchSettings = fetchSettings as ReturnType<typeof vi.fn>;
const mockFetchHierarchy = fetchHierarchy as ReturnType<typeof vi.fn>;

const currentReadings = {
  devices: [
    {
      device_gid: 111,
      timestamp: 1000,
      channels: [
        { channel_num: '1,2,3', display_name: 'Main', value: 5000 },
        { channel_num: '1', display_name: 'Kitchen', value: 1200 },
        { channel_num: '2', display_name: 'HVAC', value: 3000 },
        { channel_num: '3', display_name: 'Garage Door', value: 0 },
        { channel_num: 'Balance', display_name: 'Unmonitored loads', value: 800 },
      ],
    },
    {
      device_gid: 222,
      timestamp: 1000,
      channels: [
        { channel_num: '1,2,3', display_name: 'Sub Main', value: 1500 },
        { channel_num: '1', display_name: 'Office', value: 500 },
        { channel_num: '2', display_name: 'Server', value: 300 },
        { channel_num: 'Balance', display_name: 'Unmonitored loads', value: 700 },
      ],
    },
  ],
};

const dailyReadings = {
  date: '2026-04-12',
  devices: [
    {
      device_gid: 111,
      channels: [
        { channel_num: '1,2,3', display_name: 'Main', kwh: 25.5 },
        { channel_num: '1', display_name: 'Kitchen', kwh: 8.2 },
        { channel_num: '2', display_name: 'HVAC', kwh: 12.0 },
        { channel_num: '3', display_name: 'Garage Door', kwh: 0.1 },
        { channel_num: 'Balance', display_name: 'Unmonitored loads', kwh: 5.2 },
      ],
    },
    {
      device_gid: 222,
      channels: [
        { channel_num: '1,2,3', display_name: 'Sub Main', kwh: 10.0 },
        { channel_num: '1', display_name: 'Office', kwh: 4.0 },
        { channel_num: '2', display_name: 'Server', kwh: 3.5 },
        { channel_num: 'Balance', display_name: 'Unmonitored loads', kwh: 2.5 },
      ],
    },
  ],
};

const settingsWithMapping = {
  settings: [
    {
      key: 'vue_device_mapping',
      value: JSON.stringify({
        epcube1: [
          { gid: 111, alias: 'Main Panel' },
          { gid: 222, alias: 'Subpanel 1' },
        ],
      }),
    },
  ],
};

const hierarchyWithChild = {
  entries: [{ id: 1, parent_device_gid: 111, child_device_gid: 222 }],
};

function setupMocks(opts?: {
  settings?: typeof settingsWithMapping;
  hierarchy?: typeof hierarchyWithChild;
  current?: typeof currentReadings;
  daily?: typeof dailyReadings;
}) {
  mockFetchCurrentReadings.mockResolvedValue(opts?.current ?? currentReadings);
  mockFetchDailyReadings.mockResolvedValue(opts?.daily ?? dailyReadings);
  mockFetchSettings.mockResolvedValue(opts?.settings ?? settingsWithMapping);
  mockFetchHierarchy.mockResolvedValue(opts?.hierarchy ?? hierarchyWithChild);
}

describe('CircuitsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it('renders panel sections with panel names', async () => {
    // Arrange
    setupMocks();

    // Act
    render(<CircuitsPage />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('Main Panel')).toBeTruthy();
      expect(screen.getByText('Subpanel 1')).toBeTruthy();
    });
  });

  it('orders panels: parent followed by children (FR-014)', async () => {
    // Arrange
    setupMocks();

    // Act
    const { container } = render(<CircuitsPage />);

    // Assert — Main Panel first, Subpanel 1 second (child follows parent)
    await waitFor(() => {
      const headers = container.querySelectorAll('.panel-header');
      expect(headers.length).toBe(2);
      expect(headers[0].textContent).toContain('Main Panel');
      expect(headers[1].textContent).toContain('Subpanel 1');
    });
  });

  it('renders circuits alphabetically with Unmonitored last, no mains row', async () => {
    // Arrange
    setupMocks();

    // Act
    const { container } = render(<CircuitsPage />);

    // Assert — check first panel's circuit order (mains excluded, alphabetical, Unmonitored last)
    await waitFor(() => {
      const panels = container.querySelectorAll('.panel-section');
      expect(panels.length).toBe(2);
      const rows = panels[0].querySelectorAll('.circuit-row');
      const channelNames = Array.from(rows).map((r) => r.querySelector('.circuit-row-name')?.textContent);
      // Alphabetical: Garage Door, HVAC, Kitchen, then Unmonitored last
      expect(channelNames[0]).toBe('Garage Door');
      expect(channelNames[1]).toBe('HVAC');
      expect(channelNames[2]).toBe('Kitchen');
      expect(channelNames[3]).toBe('Unmonitored');
    });
  });

  it('shows 0W circuits in their fixed position (FR-013)', async () => {
    // Arrange
    setupMocks();

    // Act
    const { container } = render(<CircuitsPage />);

    // Assert — Garage Door is 0W but still appears (dimmed)
    await waitFor(() => {
      const panels = container.querySelectorAll('.panel-section');
      const rows = panels[0].querySelectorAll('.circuit-row');
      const garageDoor = Array.from(rows).find((r) => r.querySelector('.circuit-row-name')?.textContent === 'Garage Door');
      expect(garageDoor).toBeTruthy();
      expect(garageDoor?.classList.contains('circuit-row-zero')).toBe(true);
      expect(garageDoor?.querySelector('.circuit-row-watts')?.textContent).toContain('0');
    });
  });

  it('shows current watts and daily kWh for each circuit (FR-012)', async () => {
    // Arrange
    setupMocks();

    // Act
    const { container } = render(<CircuitsPage />);

    // Assert
    await waitFor(() => {
      const panels = container.querySelectorAll('.panel-section');
      const rows = panels[0].querySelectorAll('.circuit-row');
      // Kitchen: 1200W, 8.2 kWh — mains excluded
      const kitchen = Array.from(rows).find((r) => r.querySelector('.circuit-row-name')?.textContent === 'Kitchen');
      expect(kitchen).toBeTruthy();
      expect(kitchen?.querySelector('.circuit-row-watts')?.textContent).toContain('1.200');
      expect(kitchen?.querySelector('.circuit-row-kwh')?.textContent).toContain('8.2');
      // No mains row
      const mains = Array.from(rows).find((r) => r.querySelector('.circuit-row-name')?.textContent === 'Main');
      expect(mains).toBeUndefined();
    });
  });

  it('shows panel header with power total (FR-010)', async () => {
    // Arrange — single panel, no hierarchy
    setupMocks({
      settings: {
        settings: [{
          key: 'vue_device_mapping',
          value: JSON.stringify({ epcube1: [{ gid: 111, alias: 'Main Panel' }] }),
        }],
      },
      hierarchy: { entries: [] },
    });

    // Act
    const { container } = render(<CircuitsPage />);

    // Assert — header shows mains total
    await waitFor(() => {
      const header = container.querySelector('.panel-header');
      expect(header?.textContent).toContain('Main Panel');
      expect(header?.textContent).toContain('5.000');
    });
  });

  it('shows deduplicated total for parent panel with children (FR-010)', async () => {
    // Arrange — parent 111 has child 222
    setupMocks();

    // Act
    const { container } = render(<CircuitsPage />);

    // Assert — Main Panel dedup total: 5000 - 1500 (child mains) = 3500
    await waitFor(() => {
      const headers = container.querySelectorAll('.panel-header');
      const mainHeader = headers[0];
      expect(mainHeader?.textContent).toContain('3.500');
    });
  });

  it('deduplicates Unmonitored value by subtracting children mains', async () => {
    // Arrange — parent 111 (Balance=800) has child 222 (mains=1500)
    // Dedup Balance: 800 - 1500 = negative → should show 0 or hide
    // Use higher Balance so it stays positive
    setupMocks({
      current: {
        devices: [
          {
            device_gid: 111,
            timestamp: 1000,
            channels: [
              { channel_num: '1,2,3', display_name: 'Main', value: 5000 },
              { channel_num: '1', display_name: 'Kitchen', value: 1200 },
              { channel_num: 'Balance', display_name: 'Unmonitored loads', value: 2800 },
            ],
          },
          {
            device_gid: 222,
            timestamp: 1000,
            channels: [
              { channel_num: '1,2,3', display_name: 'Sub Main', value: 1500 },
              { channel_num: '1', display_name: 'Office', value: 500 },
            ],
          },
        ],
      },
    });

    // Act
    const { container } = render(<CircuitsPage />);

    // Assert — Unmonitored on parent: 2800 - 1500 = 1300
    await waitFor(() => {
      const panels = container.querySelectorAll('.panel-section');
      const rows = panels[0].querySelectorAll('.circuit-row');
      const unmon = Array.from(rows).find((r) => r.querySelector('.circuit-row-name')?.textContent === 'Unmonitored');
      expect(unmon).toBeTruthy();
      expect(unmon?.querySelector('.circuit-row-watts')?.textContent).toContain('1.300');
    });
  });

  it('shows daily kWh sum in panel header', async () => {
    // Arrange
    setupMocks({
      settings: {
        settings: [{
          key: 'vue_device_mapping',
          value: JSON.stringify({ epcube1: [{ gid: 111, alias: 'Main Panel' }] }),
        }],
      },
      hierarchy: { entries: [] },
    });

    // Act
    const { container } = render(<CircuitsPage />);

    // Assert — daily total from mains: 25.5 kWh
    await waitFor(() => {
      const header = container.querySelector('.panel-header');
      expect(header?.textContent).toContain('25.5');
    });
  });

  it('shows loading state initially', () => {
    // Arrange
    mockFetchCurrentReadings.mockReturnValue(new Promise(() => {}));
    mockFetchDailyReadings.mockReturnValue(new Promise(() => {}));
    mockFetchSettings.mockReturnValue(new Promise(() => {}));
    mockFetchHierarchy.mockReturnValue(new Promise(() => {}));

    // Act
    render(<CircuitsPage />);

    // Assert
    expect(screen.getByText(/Loading/)).toBeTruthy();
  });

  it('shows configuration prompt when vue_device_mapping is missing', async () => {
    // Arrange
    setupMocks({
      settings: { settings: [] },
    });

    // Act
    render(<CircuitsPage />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/Configure Vue device mapping/i)).toBeTruthy();
    });
  });

  it('shows error message when API fails', async () => {
    // Arrange
    mockFetchSettings.mockRejectedValue(new Error('Network error'));
    mockFetchCurrentReadings.mockRejectedValue(new Error('Network error'));
    mockFetchDailyReadings.mockRejectedValue(new Error('Network error'));
    mockFetchHierarchy.mockRejectedValue(new Error('Network error'));

    // Act
    render(<CircuitsPage />);

    // Assert
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toContain('Network error');
    });
  });

  it('auto-refreshes data on polling interval (FR-015)', async () => {
    // Arrange
    vi.useFakeTimers();
    setupMocks();

    // Act
    render(<CircuitsPage />);
    await act(() => vi.advanceTimersByTimeAsync(0));

    // Assert — initial fetch
    expect(mockFetchCurrentReadings).toHaveBeenCalledTimes(1);

    // Advance past polling interval
    vi.clearAllMocks();
    setupMocks();
    await act(() => vi.advanceTimersByTimeAsync(1000));

    // Assert — polled again
    expect(mockFetchCurrentReadings).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('renames Balance to Unmonitored in circuit rows', async () => {
    // Arrange
    setupMocks({
      settings: {
        settings: [{
          key: 'vue_device_mapping',
          value: JSON.stringify({ epcube1: [{ gid: 111, alias: 'Main Panel' }] }),
        }],
      },
      hierarchy: { entries: [] },
    });

    // Act
    const { container } = render(<CircuitsPage />);

    // Assert
    await waitFor(() => {
      const rows = container.querySelectorAll('.circuit-row');
      const balanceRow = Array.from(rows).find((r) => r.querySelector('.circuit-row-name')?.textContent === 'Unmonitored');
      expect(balanceRow).toBeTruthy();
    });
  });

  it('handles malformed vue_device_mapping JSON', async () => {
    // Arrange
    setupMocks({
      settings: {
        settings: [{ key: 'vue_device_mapping', value: 'not json{{{' }],
      },
    });

    // Act
    render(<CircuitsPage />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/Configure Vue device mapping/i)).toBeTruthy();
    });
  });

  it('handles panel with no current readings data', async () => {
    // Arrange — mapping references GID 999 which has no readings
    setupMocks({
      settings: {
        settings: [{
          key: 'vue_device_mapping',
          value: JSON.stringify({ epcube1: [{ gid: 999, alias: 'Ghost Panel' }] }),
        }],
      },
      hierarchy: { entries: [] },
      current: { devices: [] },
      daily: { date: '2026-04-12', devices: [] },
    });

    // Act
    const { container } = render(<CircuitsPage />);

    // Assert — panel renders with no circuits
    await waitFor(() => {
      expect(screen.getByText('Ghost Panel')).toBeTruthy();
      const rows = container.querySelectorAll('.circuit-row');
      expect(rows.length).toBe(0);
    });
  });

  it('does not update state after unmount on resolve', async () => {
    // Arrange
    let resolveSettings!: (v: typeof settingsWithMapping) => void;
    mockFetchSettings.mockReturnValue(new Promise((r) => { resolveSettings = r; }));
    mockFetchCurrentReadings.mockResolvedValue(currentReadings);
    mockFetchDailyReadings.mockResolvedValue(dailyReadings);
    mockFetchHierarchy.mockResolvedValue(hierarchyWithChild);

    const { unmount } = render(<CircuitsPage />);

    // Act
    unmount();
    resolveSettings(settingsWithMapping);
    await act(() => new Promise((r) => setTimeout(r, 10)));

    // Assert — no crash
  });

  it('does not update state after unmount on reject', async () => {
    // Arrange
    let rejectSettings!: (err: Error) => void;
    mockFetchSettings.mockReturnValue(new Promise((_r, rej) => { rejectSettings = rej; }));
    mockFetchCurrentReadings.mockResolvedValue(currentReadings);
    mockFetchDailyReadings.mockResolvedValue(dailyReadings);
    mockFetchHierarchy.mockResolvedValue(hierarchyWithChild);

    const { unmount } = render(<CircuitsPage />);

    // Act
    unmount();
    rejectSettings(new Error('late'));
    await act(() => new Promise((r) => setTimeout(r, 10)));

    // Assert — no crash
  });

  it('handles child panel with no mains channel during dedup', async () => {
    // Arrange — child 222 has no 1,2,3 channel
    setupMocks({
      current: {
        devices: [
          {
            device_gid: 111,
            timestamp: 1000,
            channels: [
              { channel_num: '1,2,3', display_name: 'Main', value: 5000 },
              { channel_num: '1', display_name: 'Kitchen', value: 1200 },
            ],
          },
          {
            device_gid: 222,
            timestamp: 1000,
            channels: [
              { channel_num: '1', display_name: 'Office', value: 500 },
            ],
          },
        ],
      },
    });

    // Act
    const { container } = render(<CircuitsPage />);

    // Assert — Main Panel dedup total stays 5000 (no child mains to subtract)
    await waitFor(() => {
      const headers = container.querySelectorAll('.panel-header');
      expect(headers[0]?.textContent).toContain('5.000');
    });
  });

  it('handles daily channel not found for a circuit', async () => {
    // Arrange — daily data missing channel 2
    setupMocks({
      settings: {
        settings: [{
          key: 'vue_device_mapping',
          value: JSON.stringify({ epcube1: [{ gid: 111, alias: 'Main Panel' }] }),
        }],
      },
      hierarchy: { entries: [] },
      daily: {
        date: '2026-04-12',
        devices: [{
          device_gid: 111,
          channels: [
            { channel_num: '1,2,3', display_name: 'Main', kwh: 25.5 },
            { channel_num: '1', display_name: 'Kitchen', kwh: 8.2 },
            // channel 2 (HVAC) missing — no daily data
          ],
        }],
      },
    });

    // Act
    const { container } = render(<CircuitsPage />);

    // Assert — HVAC shows 0.000 kWh
    await waitFor(() => {
      const rows = container.querySelectorAll('.circuit-row');
      const hvac = Array.from(rows).find((r) => r.querySelector('.circuit-row-name')?.textContent === 'HVAC');
      expect(hvac).toBeTruthy();
      expect(hvac?.querySelector('.circuit-row-kwh')?.textContent).toContain('0.000');
    });
  });
});
