import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/preact';
import { h } from 'preact';

const mockFetchSettings = vi.fn();
const mockUpdateSetting = vi.fn();
const mockFetchDevices = vi.fn();
const mockFetchVueDevices = vi.fn();
const mockFetchHierarchy = vi.fn();

vi.mock('../../../src/api', () => ({
  fetchSettings: (...args: unknown[]) => mockFetchSettings(...args),
  updateSetting: (...args: unknown[]) => mockUpdateSetting(...args),
  fetchDevices: (...args: unknown[]) => mockFetchDevices(...args),
  fetchVueDevices: (...args: unknown[]) => mockFetchVueDevices(...args),
  fetchHierarchy: (...args: unknown[]) => mockFetchHierarchy(...args),
}));

import { VueDeviceMappingSection } from '../../../src/components/settings/VueDeviceMappingSection';

describe('VueDeviceMappingSection', () => {
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

  function setupMocks(overrides?: {
    settings?: object[];
    epcubeDevices?: object[];
    vueDevices?: object[];
    hierarchy?: object[];
  }) {
    mockFetchSettings.mockResolvedValue({ settings: overrides?.settings ?? [] });
    mockFetchDevices.mockResolvedValue({ devices: overrides?.epcubeDevices ?? EP_CUBE_DEVICES });
    mockFetchVueDevices.mockResolvedValue({ devices: overrides?.vueDevices ?? VUE_DEVICES });
    mockFetchHierarchy.mockResolvedValue({ entries: overrides?.hierarchy ?? [] });
  }

  it('auto-discovers EP Cube and Vue devices from API on mount', async () => {
    // Arrange
    setupMocks();

    // Act
    render(<VueDeviceMappingSection />);

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
        value: JSON.stringify({ epcube3483: { gid: 480380, alias: 'Main Panel' } }),
        last_modified: '',
      }],
    });

    // Act
    render(<VueDeviceMappingSection />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('Vue Device Mapping')).toBeTruthy();
      expect(screen.getByText('EP Cube 3483')).toBeTruthy();
      const select = screen.getByLabelText(/Select Vue device for EP Cube 3483/i) as HTMLSelectElement;
      expect(select.value).toBe('480380');
    });
  });

  it('renders unassigned Vue panels as options in add dropdown', async () => {
    // Arrange
    setupMocks({
      epcubeDevices: [
        { device: 'epcube3483_battery', class: 'storage_battery', online: true },
        { device: 'epcube3483_solar', class: 'home_solar', online: true },
      ],
      settings: [{
        key: 'vue_device_mapping',
        value: JSON.stringify({ epcube3483: { gid: 480380, alias: 'Main Panel' } }),
        last_modified: '',
      }],
    });

    // Act
    render(<VueDeviceMappingSection />);

    // Assert
    await waitFor(() => {
      const select = screen.getByLabelText(/Select Vue device for EP Cube 3483/i) as HTMLSelectElement;
      const options = Array.from(select.options).map((o) => o.text);
      expect(options).toContain('Main Panel');
      expect(options).toContain('Subpanel 1');
      expect(options).toContain('Garage');
      expect(select.value).toBe('480380');
    });
  });

  it('assigns panel to device when selected from dropdown', async () => {
    // Arrange
    setupMocks({
      epcubeDevices: [
        { device: 'epcube3483_battery', class: 'storage_battery', online: true },
        { device: 'epcube3483_solar', class: 'home_solar', online: true },
      ],
    });

    // Act
    render(<VueDeviceMappingSection />);
    await waitFor(() => screen.getByText('Vue Device Mapping'));

    const select = screen.getByLabelText(/Select Vue device for EP Cube 3483/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '480380' } });

    // Assert
    await waitFor(() => {
      expect(select.value).toBe('480380');
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
        value: JSON.stringify({ epcube3483: { gid: 480380, alias: 'Main Panel' } }),
        last_modified: '',
      }],
    });

    // Act
    render(<VueDeviceMappingSection />);
    await waitFor(() => {
      const s = screen.getByLabelText(/Select Vue device for EP Cube 3483/i) as HTMLSelectElement;
      expect(s.value).toBe('480380');
    });

    const select = screen.getByLabelText(/Select Vue device for EP Cube 3483/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '' } });

    // Assert
    await waitFor(() => {
      expect(select.value).toBe('');
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
        value: JSON.stringify({ epcube3483: { gid: 480380, alias: 'Main Panel' } }),
        last_modified: '',
      }],
    });
    mockUpdateSetting.mockResolvedValue(undefined);

    // Act
    render(<VueDeviceMappingSection />);
    await waitFor(() => {
      const s = screen.getByLabelText(/Select Vue device for EP Cube 3483/i) as HTMLSelectElement;
      expect(s.value).toBe('480380');
    });

    fireEvent.click(screen.getByText('Save Mapping'));

    // Assert
    await waitFor(() => {
      expect(mockUpdateSetting).toHaveBeenCalledWith(
        'vue_device_mapping',
        JSON.stringify({ epcube3483: { gid: 480380, alias: 'Main Panel' } }),
      );
    });
  });

  it('shows success message after saving mapping', async () => {
    // Arrange
    setupMocks({
      epcubeDevices: [{ device: 'epcube3483_battery', class: 'storage_battery', online: true }],
    });
    mockUpdateSetting.mockResolvedValue(undefined);

    // Act
    render(<VueDeviceMappingSection />);
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
      epcubeDevices: [{ device: 'epcube3483_battery', class: 'storage_battery', online: true }],
    });
    mockUpdateSetting.mockRejectedValue(new Error('Validation failed'));

    // Act
    render(<VueDeviceMappingSection />);
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
      epcubeDevices: [{ device: 'epcube3483_battery', class: 'storage_battery', online: true }],
    });
    mockUpdateSetting.mockRejectedValue('string error');

    // Act
    render(<VueDeviceMappingSection />);
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
    render(<VueDeviceMappingSection />);

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
    render(<VueDeviceMappingSection />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('Vue Device Mapping')).toBeTruthy();
      expect(screen.getAllByText(/No Vue devices available/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('handles fetchDevices error gracefully', async () => {
    // Arrange
    setupMocks();
    mockFetchDevices.mockRejectedValue(new Error('Device API fail'));

    // Act
    render(<VueDeviceMappingSection />);

    // Assert
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
    render(<VueDeviceMappingSection />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('Vue Device Mapping')).toBeTruthy();
      expect(screen.getAllByText(/No Vue devices available/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows error banner when fetchSettings rejects (outer catch)', async () => {
    // Arrange — fetchSettings has no inner .catch() fallback so its rejection
    // bubbles up to the outer try/catch.
    setupMocks();
    mockFetchSettings.mockRejectedValue(new Error('Settings store down'));

    // Act
    render(<VueDeviceMappingSection />);

    // Assert
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/Settings store down/i);
    });
  });

  it('does not update state after unmount during initial load', async () => {
    // Arrange — fetchSettings never resolves until after unmount
    setupMocks();
    let resolve!: (v: unknown) => void;
    mockFetchSettings.mockReturnValue(new Promise((r) => { resolve = r; }));

    // Act
    const { unmount } = render(<VueDeviceMappingSection />);
    unmount();
    resolve!({ settings: [] });

    // Assert — no error thrown, state update silently skipped
    await new Promise((r) => setTimeout(r, 10));
  });

  it('does not update state after unmount during fetchSettings rejection', async () => {
    // Arrange — fetchSettings rejects after unmount
    setupMocks();
    let reject!: (e: Error) => void;
    mockFetchSettings.mockReturnValue(new Promise((_, r) => { reject = r; }));

    // Act
    const { unmount } = render(<VueDeviceMappingSection />);
    unmount();
    reject!(new Error('late rejection'));

    // Assert
    await new Promise((r) => setTimeout(r, 10));
  });

  it('handles malformed vue_device_mapping value gracefully', async () => {
    // Arrange
    setupMocks({
      settings: [{ key: 'vue_device_mapping', value: 'not valid json{{{', last_modified: '' }],
    });

    // Act
    render(<VueDeviceMappingSection />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('Vue Device Mapping')).toBeTruthy();
    });
  });

  it('treats old array format as invalid and shows empty mapping', async () => {
    // Arrange
    setupMocks({
      settings: [{
        key: 'vue_device_mapping',
        value: JSON.stringify({ epcube3483: [{ gid: 480380, alias: 'Main Panel' }] }),
        last_modified: '',
      }],
    });

    // Act
    render(<VueDeviceMappingSection />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('Vue Device Mapping')).toBeTruthy();
      const select = screen.getByLabelText(/Select Vue device for EP Cube 3483/i) as HTMLSelectElement;
      expect(select.value).toBe('');
    });
  });

  it('ignores saved mapping keys that do not match any EP Cube group', async () => {
    // Arrange
    setupMocks({
      settings: [{
        key: 'vue_device_mapping',
        value: JSON.stringify({
          epcube3483: { gid: 480380, alias: 'Main Panel' },
          unknown_device: { gid: 999, alias: 'Ghost' },
        }),
        last_modified: '',
      }],
    });

    // Act
    render(<VueDeviceMappingSection />);

    // Assert
    await waitFor(() => {
      const select = screen.getByLabelText(/Select Vue device for EP Cube 3483/i) as HTMLSelectElement;
      expect(select.value).toBe('480380');
    });
  });

  it('assigned panel not shown in other device dropdowns', async () => {
    // Arrange
    setupMocks({
      settings: [{
        key: 'vue_device_mapping',
        value: JSON.stringify({ epcube3483: { gid: 480380, alias: 'Main Panel' } }),
        last_modified: '',
      }],
    });

    // Act
    render(<VueDeviceMappingSection />);

    // Assert
    await waitFor(() => {
      const select = screen.getByLabelText(/Select Vue device for EP Cube 7891/i) as HTMLSelectElement;
      const options = Array.from(select.options).map((o) => o.text);
      expect(options).not.toContain('Main Panel');
      expect(options).toContain('Subpanel 1');
      expect(options).toContain('Garage');
    });
  });

  it('omits devices with no assigned panels from saved JSON', async () => {
    // Arrange
    setupMocks();
    mockUpdateSetting.mockResolvedValue(undefined);

    // Act
    render(<VueDeviceMappingSection />);
    await waitFor(() => screen.getByText('Vue Device Mapping'));

    const select = screen.getByLabelText(/Select Vue device for EP Cube 3483/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '480380' } });

    await waitFor(() => {
      const s = screen.getByLabelText(/Select Vue device for EP Cube 3483/i) as HTMLSelectElement;
      expect(s.value).toBe('480380');
    });

    fireEvent.click(screen.getByText('Save Mapping'));

    // Assert
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
      epcubeDevices: [{ device: 'epcube3483_battery', class: 'storage_battery', online: true }],
    });
    mockUpdateSetting.mockReturnValue(new Promise(() => {})); // never resolves

    // Act
    render(<VueDeviceMappingSection />);
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
      epcubeDevices: [{ device: 'epcube3483_battery', class: 'storage_battery', online: true }],
    });

    // Act
    render(<VueDeviceMappingSection />);
    await waitFor(() => screen.getByText('Vue Device Mapping'));

    const select = screen.getByLabelText(/Select Vue device for EP Cube 3483/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '' } });

    // Assert
    expect(select.value).toBe('');
  });

  it('removes panel from device with no prior mapping entry', async () => {
    // Arrange
    setupMocks({
      epcubeDevices: [{ device: 'epcube3483_battery', class: 'storage_battery', online: true }],
    });

    // Act
    render(<VueDeviceMappingSection />);
    await waitFor(() => screen.getByText('Vue Device Mapping'));

    const select = screen.getByLabelText(/Select Vue device for EP Cube 3483/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '480380' } });
    await waitFor(() => {
      expect(select.value).toBe('480380');
    });

    fireEvent.change(select, { target: { value: '' } });

    // Assert
    await waitFor(() => {
      expect(select.value).toBe('');
    });
  });

  it('filters child Vue panels from dropdown based on hierarchy', async () => {
    // Arrange
    setupMocks({
      epcubeDevices: [{ device: 'epcube3483_battery', class: 'storage_battery', online: true }],
      hierarchy: [{ id: 1, parent_device_gid: 480380, child_device_gid: 480544 }],
    });

    // Act
    render(<VueDeviceMappingSection />);

    // Assert
    await waitFor(() => {
      const select = screen.getByLabelText(/Select Vue device for EP Cube 3483/i) as HTMLSelectElement;
      const options = Array.from(select.options).map((o) => o.text);
      expect(options).toContain('Main Panel');
      expect(options).toContain('Garage');
      expect(options).not.toContain('Subpanel 1');
    });
  });

  it('groups multiple raw EP Cube devices into one mapping card', async () => {
    // Arrange
    setupMocks({
      epcubeDevices: [
        { device: 'epcube3483_battery', class: 'storage_battery', online: true, alias: 'EP Cube v2 Battery' },
        { device: 'epcube3483_solar', class: 'home_solar', online: true, alias: 'EP Cube v2 Solar' },
      ],
    });

    // Act
    render(<VueDeviceMappingSection />);

    // Assert
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
    render(<VueDeviceMappingSection />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('Vue Device Mapping')).toBeTruthy();
    });
  });
});
