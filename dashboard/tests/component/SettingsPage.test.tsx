import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/preact';
import { h } from 'preact';

const mockFetchSettings = vi.fn();
const mockUpdateSetting = vi.fn();
const mockFetchDevices = vi.fn();
const mockFetchVueDevices = vi.fn();
const mockFetchHierarchy = vi.fn();

vi.mock('../../src/api', () => ({
  fetchSettings: (...args: unknown[]) => mockFetchSettings(...args),
  updateSetting: (...args: unknown[]) => mockUpdateSetting(...args),
  fetchDevices: (...args: unknown[]) => mockFetchDevices(...args),
  fetchVueDevices: (...args: unknown[]) => mockFetchVueDevices(...args),
  fetchHierarchy: (...args: unknown[]) => mockFetchHierarchy(...args),
  fetchCurrentReadings: vi.fn(),
  fetchRangeReadings: vi.fn(),
  fetchGridPower: vi.fn(),
}));

import { SettingsPage } from '../../src/components/SettingsPage';

describe('SettingsPage — Polling Intervals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchDevices.mockResolvedValue({ devices: [] });
    mockFetchVueDevices.mockResolvedValue({ devices: [] });
    mockFetchHierarchy.mockResolvedValue({ entries: [] });
  });

  afterEach(cleanup);

  it('renders polling interval inputs with current values from API', async () => {
    // Arrange
    mockFetchSettings.mockResolvedValue({
      settings: [
        { key: 'epcube_poll_interval_seconds', value: '45', last_modified: '2026-04-05T00:00:00Z' },
      ],
    });

    // Act
    render(<SettingsPage />);

    // Assert
    await waitFor(() => {
      const input = screen.getByLabelText(/EP Cube Polling Interval/i) as HTMLInputElement;
      expect(input.value).toBe('45');
    });
  });

  it('shows fallback defaults when no settings exist', async () => {
    // Arrange
    mockFetchSettings.mockResolvedValue({ settings: [] });

    // Act
    render(<SettingsPage />);

    // Assert
    await waitFor(() => {
      const epcubeInput = screen.getByLabelText(/EP Cube Polling Interval/i) as HTMLInputElement;
      expect(epcubeInput.value).toBe('30');
    });
  });

  it('Vue polling inputs are enabled and editable', async () => {
    // Arrange
    mockFetchSettings.mockResolvedValue({ settings: [] });

    // Act
    render(<SettingsPage />);

    // Assert
    await waitFor(() => {
      const vueInput = screen.getByLabelText(/Emporia Vue Current Polling/i) as HTMLInputElement;
      expect(vueInput.disabled).toBe(false);
      const dailyInput = screen.getByLabelText(/Emporia Vue Daily Polling/i) as HTMLInputElement;
      expect(dailyInput.disabled).toBe(false);
    });
  });

  it('shows validation error for value below minimum', async () => {
    // Arrange
    mockFetchSettings.mockResolvedValue({ settings: [] });

    // Act
    render(<SettingsPage />);
    await waitFor(() => screen.getByLabelText(/EP Cube Polling Interval/i));

    const input = screen.getByLabelText(/EP Cube Polling Interval/i) as HTMLInputElement;
    fireEvent.input(input, { target: { value: '0' } });
    fireEvent.click(screen.getByText('Save Polling Intervals'));

    // Assert
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toMatch(/Minimum is 1 second/i);
    });
    expect(mockUpdateSetting).not.toHaveBeenCalled();
  });

  it('shows validation error for value above maximum', async () => {
    // Arrange
    mockFetchSettings.mockResolvedValue({ settings: [] });

    // Act
    render(<SettingsPage />);
    await waitFor(() => screen.getByLabelText(/EP Cube Polling Interval/i));

    const input = screen.getByLabelText(/EP Cube Polling Interval/i) as HTMLInputElement;
    fireEvent.input(input, { target: { value: '5000' } });
    fireEvent.click(screen.getByText('Save Polling Intervals'));

    // Assert
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toMatch(/Maximum is 3600 seconds/i);
    });
    expect(mockUpdateSetting).not.toHaveBeenCalled();
  });

  it('saves successfully and shows success message', async () => {
    // Arrange
    mockFetchSettings.mockResolvedValue({ settings: [] });
    mockUpdateSetting.mockResolvedValue(undefined);

    // Act
    render(<SettingsPage />);
    await waitFor(() => screen.getByLabelText(/EP Cube Polling Interval/i));

    const input = screen.getByLabelText(/EP Cube Polling Interval/i) as HTMLInputElement;
    fireEvent.input(input, { target: { value: '60' } });
    fireEvent.click(screen.getByText('Save Polling Intervals'));

    // Assert
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeTruthy();
      expect(screen.getByRole('status').textContent).toMatch(/saved/i);
    });
    expect(mockUpdateSetting).toHaveBeenCalledWith('epcube_poll_interval_seconds', '60');
  });

  it('shows error when save fails', async () => {
    // Arrange
    mockFetchSettings.mockResolvedValue({ settings: [] });
    mockUpdateSetting.mockRejectedValue(new Error('Network error'));

    // Act
    render(<SettingsPage />);
    await waitFor(() => screen.getByLabelText(/EP Cube Polling Interval/i));
    fireEvent.click(screen.getByText('Save Polling Intervals'));

    // Assert
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toMatch(/Network error/i);
    });
  });

  it('shows loading state while fetching', () => {
    // Arrange
    mockFetchSettings.mockReturnValue(new Promise(() => {})); // never resolves

    // Act
    render(<SettingsPage />);

    // Assert
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('shows error when fetch fails', async () => {
    // Arrange
    mockFetchSettings.mockRejectedValue(new Error('API down'));

    // Act
    render(<SettingsPage />);

    // Assert
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toMatch(/API down/i);
    });
  });

  it('does not update state after unmount during load', async () => {
    // Arrange — resolve after unmount to exercise cancelled guard
    let resolve: (v: unknown) => void;
    mockFetchSettings.mockReturnValue(new Promise((r) => { resolve = r; }));

    // Act
    const { unmount } = render(<SettingsPage />);
    unmount();
    resolve!({ settings: [{ key: 'epcube_poll_interval_seconds', value: '30', last_modified: '' }] });

    // Assert — no error thrown, state update silently skipped
    await new Promise((r) => setTimeout(r, 10));
  });

  it('does not update state after unmount during load error', async () => {
    // Arrange — reject after unmount to exercise cancelled guard in catch
    let reject: (e: Error) => void;
    mockFetchSettings.mockReturnValue(new Promise((_, r) => { reject = r; }));

    // Act
    const { unmount } = render(<SettingsPage />);
    unmount();
    reject!(new Error('late error'));

    // Assert — no error thrown
    await new Promise((r) => setTimeout(r, 10));
  });

  it('shows validation error for non-integer value', async () => {
    // Arrange
    mockFetchSettings.mockResolvedValue({ settings: [] });

    // Act
    render(<SettingsPage />);
    await waitFor(() => screen.getByLabelText(/EP Cube Polling Interval/i));

    const input = screen.getByLabelText(/EP Cube Polling Interval/i) as HTMLInputElement;
    fireEvent.input(input, { target: { value: '2.5' } });
    fireEvent.click(screen.getByText('Save Polling Intervals'));

    // Assert
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/whole number/i);
    });
  });

  it('handles non-Error rejection during save', async () => {
    // Arrange
    mockFetchSettings.mockResolvedValue({ settings: [] });
    mockUpdateSetting.mockRejectedValue('string error');

    // Act
    render(<SettingsPage />);
    await waitFor(() => screen.getByLabelText(/EP Cube Polling Interval/i));
    fireEvent.click(screen.getByText('Save Polling Intervals'));

    // Assert
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/Failed to save/i);
    });
  });

  it('handles non-Error rejection during fetch', async () => {
    // Arrange
    mockFetchSettings.mockRejectedValue('string error');

    // Act
    render(<SettingsPage />);

    // Assert
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/Failed to load settings/i);
    });
  });

  it('renders deferred sections for hierarchy and display names', async () => {
    // Arrange
    mockFetchSettings.mockResolvedValue({ settings: [] });

    // Act
    render(<SettingsPage />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('Panel Hierarchy')).toBeTruthy();
      expect(screen.getByText('Display Names')).toBeTruthy();
      const comingSoon = screen.getAllByText(/Coming in Feature 005/i);
      // 2 total: hierarchy + display names (Vue polling now enabled)
      expect(comingSoon.length).toBe(2);
    });
  });

  it('saves with defaults when fetch failed and values are empty', async () => {
    // Arrange — fetch fails, values stays empty, but save uses defaults
    mockFetchSettings.mockRejectedValue(new Error('API down'));
    mockUpdateSetting.mockResolvedValue(undefined);

    // Act
    render(<SettingsPage />);
    await waitFor(() => screen.getByRole('alert')); // wait for error
    fireEvent.click(screen.getByText('Save Polling Intervals'));

    // Assert — saves the default value, not undefined
    await waitFor(() => {
      expect(mockUpdateSetting).toHaveBeenCalledWith('epcube_poll_interval_seconds', '30');
    });
  });
});

describe('SettingsPage — Vue Device Mapping', () => {
  // Raw devices — two per EP Cube to test grouping
  const EP_CUBE_DEVICES = [
    { device: 'epcube3483_battery', class: 'storage_battery', online: true },
    { device: 'epcube3483_solar', class: 'home_solar', online: true },
    { device: 'epcube7891_battery', class: 'storage_battery', online: true },
    { device: 'epcube7891_solar', class: 'home_solar', online: true },
  ];

  const VUE_DEVICES = [
    { device_gid: 480380, device_name: 'Vue 1', display_name: 'Main Panel' },
    { device_gid: 480544, device_name: 'Vue 2', display_name: 'Subpanel 1' },
    { device_gid: 480600, device_name: 'Vue 3', display_name: 'Garage' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  function setupMocks(overrides?: {
    settings?: object[];
    epcubeDevices?: object[];
    vueDevices?: object[];
    hierarchy?: object[];
  }) {
    mockFetchSettings.mockResolvedValue({
      settings: overrides?.settings ?? [],
    });
    mockFetchDevices.mockResolvedValue({
      devices: overrides?.epcubeDevices ?? EP_CUBE_DEVICES,
    });
    mockFetchVueDevices.mockResolvedValue({
      devices: overrides?.vueDevices ?? VUE_DEVICES,
    });
    mockFetchHierarchy.mockResolvedValue({
      entries: overrides?.hierarchy ?? [],
    });
  }

  it('auto-discovers EP Cube and Vue devices from API on mount', async () => {
    // Arrange
    setupMocks();

    // Act
    render(<SettingsPage />);

    // Assert
    await waitFor(() => {
      expect(mockFetchDevices).toHaveBeenCalledTimes(1);
      expect(mockFetchVueDevices).toHaveBeenCalledTimes(1);
      expect(mockFetchHierarchy).toHaveBeenCalledTimes(1);
    });
  });

  it('renders EP Cube devices grouped with friendly display name and assigned Vue panels', async () => {
    // Arrange
    setupMocks({
      settings: [{
        key: 'vue_device_mapping',
        value: JSON.stringify({
          epcube3483: [{ gid: 480380, alias: 'Main Panel' }],
        }),
        last_modified: '',
      }],
    });

    // Act
    render(<SettingsPage />);

    // Assert — groups shown by display name, not raw device ID
    await waitFor(() => {
      expect(screen.getByText('Vue Device Mapping')).toBeTruthy();
      expect(screen.getByText('EP Cube 3483')).toBeTruthy();
      expect(screen.getByDisplayValue('Main Panel')).toBeTruthy();
    });
  });

  it('renders unassigned Vue panels as options in add dropdown', async () => {
    // Arrange — one panel mapped to epcube3483, two unassigned
    setupMocks({
      epcubeDevices: [
        { device: 'epcube3483_battery', class: 'storage_battery', online: true },
        { device: 'epcube3483_solar', class: 'home_solar', online: true },
      ],
      settings: [{
        key: 'vue_device_mapping',
        value: JSON.stringify({
          epcube3483: [{ gid: 480380, alias: 'Main Panel' }],
        }),
        last_modified: '',
      }],
    });

    // Act
    render(<SettingsPage />);

    // Assert
    await waitFor(() => {
      const select = screen.getByLabelText(/Add Vue panel to EP Cube 3483/i) as HTMLSelectElement;
      const options = Array.from(select.options).map((o) => o.text);
      expect(options).toContain('Subpanel 1');
      expect(options).toContain('Garage');
      expect(options).not.toContain('Main Panel');
    });
  });

  it('assigns panel to device when selected from dropdown', async () => {
    // Arrange — no existing mapping
    setupMocks({
      epcubeDevices: [
        { device: 'epcube3483_battery', class: 'storage_battery', online: true },
        { device: 'epcube3483_solar', class: 'home_solar', online: true },
      ],
    });

    // Act
    render(<SettingsPage />);
    await waitFor(() => screen.getByText('Vue Device Mapping'));

    const select = screen.getByLabelText(/Add Vue panel to EP Cube 3483/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '480380' } });

    // Assert — panel now shows as assigned with display_name as default alias
    await waitFor(() => {
      expect(screen.getByDisplayValue('Main Panel')).toBeTruthy();
    });
  });

  it('unassigns panel and returns to dropdown when removed', async () => {
    // Arrange
    setupMocks({
      epcubeDevices: [
        { device: 'epcube3483_battery', class: 'storage_battery', online: true },
        { device: 'epcube3483_solar', class: 'home_solar', online: true },
      ],
      settings: [{
        key: 'vue_device_mapping',
        value: JSON.stringify({
          epcube3483: [{ gid: 480380, alias: 'Main Panel' }],
        }),
        last_modified: '',
      }],
    });

    // Act
    render(<SettingsPage />);
    await waitFor(() => screen.getByDisplayValue('Main Panel'));

    fireEvent.click(screen.getByLabelText(/Remove panel 480380/i));

    // Assert — panel removed from assigned list, back in dropdown
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Main Panel')).toBeNull();
      const select = screen.getByLabelText(/Add Vue panel to EP Cube 3483/i) as HTMLSelectElement;
      const options = Array.from(select.options).map((o) => o.text);
      expect(options).toContain('Main Panel');
    });
  });

  it('saves mapping with correct JSON via PUT settings API', async () => {
    // Arrange
    setupMocks({
      epcubeDevices: [
        { device: 'epcube3483_battery', class: 'storage_battery', online: true },
        { device: 'epcube3483_solar', class: 'home_solar', online: true },
      ],
      settings: [{
        key: 'vue_device_mapping',
        value: JSON.stringify({
          epcube3483: [{ gid: 480380, alias: 'Main Panel' }],
        }),
        last_modified: '',
      }],
    });
    mockUpdateSetting.mockResolvedValue(undefined);

    // Act
    render(<SettingsPage />);
    await waitFor(() => screen.getByDisplayValue('Main Panel'));

    fireEvent.click(screen.getByText('Save Mapping'));

    // Assert
    await waitFor(() => {
      expect(mockUpdateSetting).toHaveBeenCalledWith(
        'vue_device_mapping',
        JSON.stringify({
          epcube3483: [{ gid: 480380, alias: 'Main Panel' }],
        }),
      );
    });
  });

  it('shows success message after saving mapping', async () => {
    // Arrange
    setupMocks({
      epcubeDevices: [
        { device: 'epcube3483_battery', class: 'storage_battery', online: true },
      ],
    });
    mockUpdateSetting.mockResolvedValue(undefined);

    // Act
    render(<SettingsPage />);
    await waitFor(() => screen.getByText('Vue Device Mapping'));

    fireEvent.click(screen.getByText('Save Mapping'));

    // Assert
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/mapping saved/i);
    });
  });

  it('shows error when mapping save fails', async () => {
    // Arrange
    setupMocks({
      epcubeDevices: [
        { device: 'epcube3483_battery', class: 'storage_battery', online: true },
      ],
    });
    mockUpdateSetting.mockRejectedValue(new Error('Validation failed'));

    // Act
    render(<SettingsPage />);
    await waitFor(() => screen.getByText('Vue Device Mapping'));

    fireEvent.click(screen.getByText('Save Mapping'));

    // Assert
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/Validation failed/i);
    });
  });

  it('shows error when mapping save fails with non-Error rejection', async () => {
    // Arrange
    setupMocks({
      epcubeDevices: [
        { device: 'epcube3483_battery', class: 'storage_battery', online: true },
      ],
    });
    mockUpdateSetting.mockRejectedValue('string error');

    // Act
    render(<SettingsPage />);
    await waitFor(() => screen.getByText('Vue Device Mapping'));

    fireEvent.click(screen.getByText('Save Mapping'));

    // Assert
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/Failed to save/i);
    });
  });

  it('handles empty EP Cube device list', async () => {
    // Arrange
    setupMocks({ epcubeDevices: [] });

    // Act
    render(<SettingsPage />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('Vue Device Mapping')).toBeTruthy();
      expect(screen.getByText(/No EP Cube devices found/i)).toBeTruthy();
    });
  });

  it('handles empty Vue device list', async () => {
    // Arrange
    setupMocks({ vueDevices: [] });

    // Act
    render(<SettingsPage />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('Vue Device Mapping')).toBeTruthy();
      expect(screen.getByText(/No Vue devices available/i)).toBeTruthy();
    });
  });

  it('updates alias when edited', async () => {
    // Arrange
    setupMocks({
      epcubeDevices: [
        { device: 'epcube3483_battery', class: 'storage_battery', online: true },
      ],
      settings: [{
        key: 'vue_device_mapping',
        value: JSON.stringify({
          epcube3483: [{ gid: 480380, alias: 'Main Panel' }],
        }),
        last_modified: '',
      }],
    });
    mockUpdateSetting.mockResolvedValue(undefined);

    // Act
    render(<SettingsPage />);
    await waitFor(() => screen.getByDisplayValue('Main Panel'));

    const aliasInput = screen.getByDisplayValue('Main Panel') as HTMLInputElement;
    fireEvent.input(aliasInput, { target: { value: 'Updated Name' } });
    fireEvent.click(screen.getByText('Save Mapping'));

    // Assert
    await waitFor(() => {
      expect(mockUpdateSetting).toHaveBeenCalledWith(
        'vue_device_mapping',
        expect.stringContaining('"alias":"Updated Name"'),
      );
    });
  });

  it('handles fetchDevices error gracefully', async () => {
    // Arrange
    setupMocks();
    mockFetchDevices.mockRejectedValue(new Error('Device API fail'));

    // Act
    render(<SettingsPage />);

    // Assert — section renders without crash, shows no devices
    await waitFor(() => {
      expect(screen.getByText('Vue Device Mapping')).toBeTruthy();
      expect(screen.getByText(/No EP Cube devices found/i)).toBeTruthy();
    });
  });

  it('handles fetchVueDevices error gracefully', async () => {
    // Arrange
    setupMocks();
    mockFetchVueDevices.mockRejectedValue(new Error('Vue API fail'));

    // Act
    render(<SettingsPage />);

    // Assert — section renders without crash, shows no vue devices
    await waitFor(() => {
      expect(screen.getByText('Vue Device Mapping')).toBeTruthy();
      expect(screen.getByText(/No Vue devices available/i)).toBeTruthy();
    });
  });

  it('handles malformed vue_device_mapping value gracefully', async () => {
    // Arrange
    setupMocks({
      settings: [{
        key: 'vue_device_mapping',
        value: 'not valid json{{{',
        last_modified: '',
      }],
    });

    // Act
    render(<SettingsPage />);

    // Assert — renders without crash, treats as empty mapping
    await waitFor(() => {
      expect(screen.getByText('Vue Device Mapping')).toBeTruthy();
    });
  });

  it('ignores saved mapping keys that do not match any EP Cube group', async () => {
    // Arrange — mapping has an extra key "unknown_device" not in EP Cube groups
    setupMocks({
      settings: [{
        key: 'vue_device_mapping',
        value: JSON.stringify({
          epcube3483: [{ gid: 480380, alias: 'Main Panel' }],
          unknown_device: [{ gid: 999, alias: 'Ghost' }],
        }),
        last_modified: '',
      }],
    });

    // Act
    render(<SettingsPage />);

    // Assert — epcube3483 mapping loaded (input with alias value), unknown_device silently ignored
    await waitFor(() => {
      const aliasInput = screen.getByDisplayValue('Main Panel') as HTMLInputElement;
      expect(aliasInput).toBeTruthy();
      expect(screen.queryByDisplayValue('Ghost')).toBeNull();
    });
  });

  it('assigned panel not shown in other device dropdowns', async () => {
    // Arrange — one panel mapped to epcube3483
    setupMocks({
      settings: [{
        key: 'vue_device_mapping',
        value: JSON.stringify({
          epcube3483: [{ gid: 480380, alias: 'Main Panel' }],
        }),
        last_modified: '',
      }],
    });

    // Act
    render(<SettingsPage />);

    // Assert — epcube7891 dropdown should not contain Main Panel
    await waitFor(() => {
      const select = screen.getByLabelText(/Add Vue panel to EP Cube 7891/i) as HTMLSelectElement;
      const options = Array.from(select.options).map((o) => o.text);
      expect(options).not.toContain('Main Panel');
      expect(options).toContain('Subpanel 1');
      expect(options).toContain('Garage');
    });
  });

  it('omits devices with no assigned panels from saved JSON', async () => {
    // Arrange — no mapping, two EP Cube groups
    setupMocks();
    mockUpdateSetting.mockResolvedValue(undefined);

    // Act
    render(<SettingsPage />);
    await waitFor(() => screen.getByText('Vue Device Mapping'));

    // Assign one panel to epcube3483 only
    const select = screen.getByLabelText(/Add Vue panel to EP Cube 3483/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '480380' } });

    await waitFor(() => screen.getByDisplayValue('Main Panel'));

    fireEvent.click(screen.getByText('Save Mapping'));

    // Assert — only epcube3483 in saved JSON, not epcube7891
    await waitFor(() => {
      const savedValue = (mockUpdateSetting as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      const parsed = JSON.parse(savedValue);
      expect(parsed).toHaveProperty('epcube3483');
      expect(parsed).not.toHaveProperty('epcube7891');
    });
  });

  it('disables save button while saving', async () => {
    // Arrange
    setupMocks({
      epcubeDevices: [
        { device: 'epcube3483_battery', class: 'storage_battery', online: true },
      ],
    });
    mockUpdateSetting.mockReturnValue(new Promise(() => {})); // never resolves

    // Act
    render(<SettingsPage />);
    await waitFor(() => screen.getByText('Vue Device Mapping'));

    fireEvent.click(screen.getByText('Save Mapping'));

    // Assert
    await waitFor(() => {
      const saveBtn = screen.getByText('Saving...') as HTMLButtonElement;
      expect(saveBtn.disabled).toBe(true);
    });
  });

  it('ignores assign when empty value selected', async () => {
    // Arrange
    setupMocks({
      epcubeDevices: [
        { device: 'epcube3483_battery', class: 'storage_battery', online: true },
      ],
    });

    // Act
    render(<SettingsPage />);
    await waitFor(() => screen.getByText('Vue Device Mapping'));

    const select = screen.getByLabelText(/Add Vue panel to EP Cube 3483/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '' } });

    // Assert — no panel assigned
    expect(screen.queryByLabelText(/Remove panel/i)).toBeNull();
  });

  it('removes panel from device with no prior mapping entry', async () => {
    // Arrange — assign then remove a panel (exercises ?? [] fallback in remove)
    setupMocks({
      epcubeDevices: [
        { device: 'epcube3483_battery', class: 'storage_battery', online: true },
      ],
    });

    // Act
    render(<SettingsPage />);
    await waitFor(() => screen.getByText('Vue Device Mapping'));

    // Assign a panel
    const select = screen.getByLabelText(/Add Vue panel to EP Cube 3483/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '480380' } });
    await waitFor(() => screen.getByDisplayValue('Main Panel'));

    // Remove it
    fireEvent.click(screen.getByLabelText(/Remove panel 480380/i));

    // Assert — panel removed successfully
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Main Panel')).toBeNull();
    });
  });

  it('edits field on panel within a multi-panel device', async () => {
    // Arrange — two panels on same device (exercises map branch for non-matching gid)
    setupMocks({
      epcubeDevices: [
        { device: 'epcube3483_battery', class: 'storage_battery', online: true },
      ],
      settings: [{
        key: 'vue_device_mapping',
        value: JSON.stringify({
          epcube3483: [
            { gid: 480380, alias: 'Main Panel' },
            { gid: 480544, alias: 'Subpanel 1' },
          ],
        }),
        last_modified: '',
      }],
    });
    mockUpdateSetting.mockResolvedValue(undefined);

    // Act
    render(<SettingsPage />);
    await waitFor(() => screen.getByDisplayValue('Main Panel'));

    // Edit only the first panel's alias — second panel should be unchanged
    const aliasInput = screen.getByDisplayValue('Main Panel') as HTMLInputElement;
    fireEvent.input(aliasInput, { target: { value: 'Updated Panel' } });
    fireEvent.click(screen.getByText('Save Mapping'));

    // Assert — both panels in save, first has updated alias
    await waitFor(() => {
      const savedValue = (mockUpdateSetting as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      const parsed = JSON.parse(savedValue);
      expect(parsed.epcube3483[0].alias).toBe('Updated Panel');
      expect(parsed.epcube3483[1].alias).toBe('Subpanel 1');
    });
  });

  it('filters child Vue panels from dropdown based on hierarchy', async () => {
    // Arrange — Subpanel 1 (480544) is a child of Main Panel (480380)
    setupMocks({
      epcubeDevices: [
        { device: 'epcube3483_battery', class: 'storage_battery', online: true },
      ],
      hierarchy: [
        { id: 1, parent_device_gid: 480380, child_device_gid: 480544 },
      ],
    });

    // Act
    render(<SettingsPage />);

    // Assert — dropdown should show Main Panel and Garage, but NOT Subpanel 1 (it's a child)
    await waitFor(() => {
      const select = screen.getByLabelText(/Add Vue panel to EP Cube 3483/i) as HTMLSelectElement;
      const options = Array.from(select.options).map((o) => o.text);
      expect(options).toContain('Main Panel');
      expect(options).toContain('Garage');
      expect(options).not.toContain('Subpanel 1');
    });
  });

  it('groups multiple raw EP Cube devices into one mapping card', async () => {
    // Arrange — two raw devices that should group into one EP Cube
    setupMocks({
      epcubeDevices: [
        { device: 'epcube3483_battery', class: 'storage_battery', online: true, alias: 'EP Cube v2 Battery' },
        { device: 'epcube3483_solar', class: 'home_solar', online: true, alias: 'EP Cube v2 Solar' },
      ],
    });

    // Act
    render(<SettingsPage />);

    // Assert — one group shown, not two separate devices
    await waitFor(() => {
      const headings = screen.getAllByRole('heading', { level: 4 });
      const mappingLabels = headings.map((h) => h.textContent);
      expect(mappingLabels.filter((l) => l?.includes('EP Cube v2'))).toHaveLength(1);
    });
  });

  it('handles fetchHierarchy error gracefully', async () => {
    // Arrange
    setupMocks();
    mockFetchHierarchy.mockRejectedValue(new Error('Hierarchy API fail'));

    // Act
    render(<SettingsPage />);

    // Assert — renders normally without hierarchy filtering
    await waitFor(() => {
      expect(screen.getByText('Vue Device Mapping')).toBeTruthy();
    });
  });
});
