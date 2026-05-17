import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/preact';
import { h } from 'preact';

const mockFetchVueDevices = vi.fn();
const mockFetchHierarchy = vi.fn();
const mockUpdateHierarchy = vi.fn();

vi.mock('../../../src/api', () => ({
  fetchVueDevices: (...args: unknown[]) => mockFetchVueDevices(...args),
  fetchHierarchy: (...args: unknown[]) => mockFetchHierarchy(...args),
  updateHierarchy: (...args: unknown[]) => mockUpdateHierarchy(...args),
}));

import { PanelHierarchySection, resolveDeviceAlias } from '../../../src/components/settings/PanelHierarchySection';

describe('resolveDeviceAlias', () => {
  it('returns display_name when device found', () => {
    // Arrange
    const devices = [{ device_gid: 100, device_name: 'V1', display_name: 'Main Panel' }];

    // Act
    const result = resolveDeviceAlias(devices as any, 100);

    // Assert
    expect(result).toBe('Main Panel');
  });

  it('returns GID string when device not found', () => {
    // Arrange
    const devices = [{ device_gid: 100, device_name: 'V1', display_name: 'Main Panel' }];

    // Act
    const result = resolveDeviceAlias(devices as any, 999);

    // Assert
    expect(result).toBe('999');
  });

  it('returns GID string when display_name is empty', () => {
    // Arrange
    const devices = [{ device_gid: 100, device_name: 'V1', display_name: '' }];

    // Act
    const result = resolveDeviceAlias(devices as any, 100);

    // Assert
    expect(result).toBe('100');
  });
});

describe('PanelHierarchySection', () => {
  const VUE_DEVICES = [
    { device_gid: 480380, device_name: 'Vue 1', display_name: 'Main Panel' },
    { device_gid: 480544, device_name: 'Vue 2', display_name: 'Subpanel 1' },
    { device_gid: 480600, device_name: 'Vue 3', display_name: 'Garage' },
  ];

  function setupMocks(overrides?: { vueDevices?: object[]; hierarchy?: object[] }) {
    mockFetchVueDevices.mockResolvedValue({ devices: overrides?.vueDevices ?? VUE_DEVICES });
    mockFetchHierarchy.mockResolvedValue({ entries: overrides?.hierarchy ?? [] });
  }

  it('shows "No Vue devices" when no Vue devices exist', async () => {
    // Arrange
    setupMocks({ vueDevices: [] });

    // Act
    render(<PanelHierarchySection />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/No Vue devices available/i)).toBeTruthy();
    });
  });

  it('renders existing hierarchy entries with device display names', async () => {
    // Arrange
    setupMocks({ hierarchy: [{ id: 1, parent_device_gid: 480380, child_device_gid: 480544 }] });

    // Act
    render(<PanelHierarchySection />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/Main Panel → Subpanel 1/)).toBeTruthy();
      expect(screen.getByLabelText(/Remove hierarchy entry.*480544/i)).toBeTruthy();
    });
  });

  it('renders parent and child dropdowns for adding entries', async () => {
    // Arrange
    setupMocks();

    // Act
    render(<PanelHierarchySection />);

    // Assert
    await waitFor(() => {
      expect(screen.getByLabelText(/Parent panel/i)).toBeTruthy();
      expect(screen.getByLabelText(/Child panel/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /Add/i })).toBeTruthy();
    });
  });

  it('adds a hierarchy entry via dropdowns and Add button', async () => {
    // Arrange
    setupMocks();

    // Act
    render(<PanelHierarchySection />);
    await waitFor(() => screen.getByLabelText(/Parent panel/i));
    fireEvent.change(screen.getByLabelText(/Parent panel/i), { target: { value: '480380' } });
    fireEvent.change(screen.getByLabelText(/Child panel/i), { target: { value: '480544' } });
    fireEvent.click(screen.getByRole('button', { name: /Add/i }));

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/Main Panel → Subpanel 1/)).toBeTruthy();
    });
  });

  it('does not add entry when dropdowns are empty', async () => {
    // Arrange
    setupMocks();

    // Act
    render(<PanelHierarchySection />);
    await waitFor(() => screen.getByLabelText(/Parent panel/i));
    fireEvent.click(screen.getByRole('button', { name: /Add/i }));

    // Assert
    await waitFor(() => {
      expect(screen.queryByLabelText(/Remove hierarchy entry/i)).toBeNull();
    });
  });

  it('removes a hierarchy entry via Remove button', async () => {
    // Arrange
    setupMocks({ hierarchy: [{ id: 1, parent_device_gid: 480380, child_device_gid: 480544 }] });

    // Act
    render(<PanelHierarchySection />);
    await waitFor(() => screen.getByLabelText(/Remove hierarchy entry.*480544/i));
    fireEvent.click(screen.getByLabelText(/Remove hierarchy entry.*480544/i));

    // Assert
    await waitFor(() => {
      expect(screen.queryByLabelText(/Remove hierarchy entry.*480544/i)).toBeNull();
    });
  });

  it('prevents adding self-reference (same parent and child)', async () => {
    // Arrange
    setupMocks();

    // Act
    render(<PanelHierarchySection />);
    await waitFor(() => screen.getByLabelText(/Parent panel/i));
    fireEvent.change(screen.getByLabelText(/Parent panel/i), { target: { value: '480380' } });
    fireEvent.change(screen.getByLabelText(/Child panel/i), { target: { value: '480380' } });
    fireEvent.click(screen.getByRole('button', { name: /Add/i }));

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/cannot be its own child/i)).toBeTruthy();
    });
  });

  it('prevents adding duplicate edge', async () => {
    // Arrange
    setupMocks({ hierarchy: [{ id: 1, parent_device_gid: 480380, child_device_gid: 480544 }] });

    // Act
    render(<PanelHierarchySection />);
    await waitFor(() => screen.getByLabelText(/Parent panel/i));
    fireEvent.change(screen.getByLabelText(/Parent panel/i), { target: { value: '480380' } });
    fireEvent.change(screen.getByLabelText(/Child panel/i), { target: { value: '480544' } });
    fireEvent.click(screen.getByRole('button', { name: /Add/i }));

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/already exists/i)).toBeTruthy();
    });
  });

  it('saves hierarchy via PUT on Save button click', async () => {
    // Arrange
    setupMocks({ hierarchy: [{ id: 1, parent_device_gid: 480380, child_device_gid: 480544 }] });
    mockUpdateHierarchy.mockResolvedValue({
      entries: [{ id: 1, parent_device_gid: 480380, child_device_gid: 480544 }],
    });

    // Act
    render(<PanelHierarchySection />);
    await waitFor(() => screen.getByRole('button', { name: /Save Hierarchy/i }));
    fireEvent.click(screen.getByRole('button', { name: /Save Hierarchy/i }));

    // Assert
    await waitFor(() => {
      expect(mockUpdateHierarchy).toHaveBeenCalledWith([
        { parent_device_gid: 480380, child_device_gid: 480544 },
      ]);
      expect(screen.getByText(/Hierarchy saved/i)).toBeTruthy();
    });
  });

  it('shows API error message on save failure', async () => {
    // Arrange
    setupMocks({
      hierarchy: [
        { id: 1, parent_device_gid: 480380, child_device_gid: 480544 },
        { id: 2, parent_device_gid: 480544, child_device_gid: 480380 },
      ],
    });
    mockUpdateHierarchy.mockRejectedValue(new Error('Panel hierarchy contains a circular reference'));

    // Act
    render(<PanelHierarchySection />);
    await waitFor(() => screen.getByRole('button', { name: /Save Hierarchy/i }));
    fireEvent.click(screen.getByRole('button', { name: /Save Hierarchy/i }));

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/circular reference/i)).toBeTruthy();
    });
  });

  it('shows device_gid as fallback when device not found in vueDevices', async () => {
    // Arrange — hierarchy references a gid not in vueDevices list
    setupMocks({ hierarchy: [{ id: 1, parent_device_gid: 999999, child_device_gid: 480544 }] });

    // Act
    render(<PanelHierarchySection />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/999999 → Subpanel 1/)).toBeTruthy();
    });
  });

  it('falls back to empty Vue device list when fetchVueDevices rejects', async () => {
    // Arrange
    setupMocks();
    mockFetchVueDevices.mockRejectedValue(new Error('Vue API fail'));

    // Act
    render(<PanelHierarchySection />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/No Vue devices available/i)).toBeTruthy();
    });
  });

  it('falls back to empty hierarchy list when fetchHierarchy rejects', async () => {
    // Arrange
    setupMocks();
    mockFetchHierarchy.mockRejectedValue(new Error('Hierarchy API fail'));

    // Act
    render(<PanelHierarchySection />);

    // Assert — Vue devices still load, so the add-row + dropdowns render
    await waitFor(() => {
      expect(screen.getByLabelText(/Parent panel/i)).toBeTruthy();
    });
  });

  it('does not update state after unmount during initial load', async () => {
    // Arrange — block both fetches so they resolve after unmount
    let resolveVue!: (v: unknown) => void;
    let resolveHierarchy!: (v: unknown) => void;
    mockFetchVueDevices.mockReturnValue(new Promise((r) => { resolveVue = r; }));
    mockFetchHierarchy.mockReturnValue(new Promise((r) => { resolveHierarchy = r; }));

    // Act
    const { unmount } = render(<PanelHierarchySection />);
    unmount();
    resolveVue!({ devices: [] });
    resolveHierarchy!({ entries: [] });

    // Assert — no error thrown; state update silently skipped
    await new Promise((r) => setTimeout(r, 10));
  });
});
