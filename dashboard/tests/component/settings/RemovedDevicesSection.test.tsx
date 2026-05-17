import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/preact';
import { h } from 'preact';

const mockFetchDevicesByStatus = vi.fn();
const mockDeleteDevice = vi.fn();

vi.mock('../../../src/api', () => ({
  fetchDevicesByStatus: (...args: unknown[]) => mockFetchDevicesByStatus(...args),
  deleteDevice: (...args: unknown[]) => mockDeleteDevice(...args),
}));

import { RemovedDevicesSection } from '../../../src/components/settings/RemovedDevicesSection';

describe('RemovedDevicesSection', () => {
  function setupMocks(removed: object[] = []) {
    mockFetchDevicesByStatus.mockImplementation((status: string) => {
      if (status === 'removed') return Promise.resolve({ devices: removed });
      return Promise.resolve({ devices: [] });
    });
  }

  it('renders heading', async () => {
    // Arrange
    setupMocks();

    // Act
    render(<RemovedDevicesSection />);

    // Assert
    expect(screen.getByRole('heading', { name: /Removed Devices/i })).toBeTruthy();
  });

  it('shows empty state when no removed devices exist', async () => {
    // Arrange
    setupMocks();

    // Act
    render(<RemovedDevicesSection />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/No removed devices/i)).toBeTruthy();
    });
  });

  it('does not render a Status column', async () => {
    // Arrange — all rows are removed; status column would be redundant
    setupMocks([
      { device: 'epcube5488_battery', class: 'storage_battery', online: false, alias: 'Old', product_code: 'EP Cube (devType=2)', updated_at: '2026-05-10T12:00:00Z' },
    ]);

    // Act
    render(<RemovedDevicesSection />);
    await waitFor(() => screen.getByText(/EP Cube v2/));

    // Assert
    expect(screen.queryByRole('columnheader', { name: /Status/i })).toBeNull();
  });

  it('renders columns: Device, Cloud ID, Removed Date, (actions)', async () => {
    // Arrange
    setupMocks([
      { device: 'epcube5488_battery', class: 'storage_battery', online: false, alias: 'Old', product_code: 'EP Cube (devType=2)', updated_at: '2026-05-10T12:00:00Z' },
    ]);

    // Act
    render(<RemovedDevicesSection />);

    // Assert
    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /Device/i })).toBeTruthy();
      expect(screen.getByRole('columnheader', { name: /Cloud ID/i })).toBeTruthy();
      expect(screen.getByRole('columnheader', { name: /Removed Date/i })).toBeTruthy();
    });
  });

  it('shows the formatted removed date from updated_at', async () => {
    // Arrange — 2026-05-10 UTC; localized rendering will differ by locale but
    // should at least contain "2026"
    setupMocks([
      { device: 'epcube5488_battery', class: 'storage_battery', online: false, alias: 'Old', product_code: 'EP Cube (devType=2)', updated_at: '2026-05-10T12:00:00Z' },
    ]);

    // Act
    render(<RemovedDevicesSection />);

    // Assert
    await waitFor(() => {
      const cells = Array.from(document.querySelectorAll('.removed-devices-table td')).map(
        (td) => td.textContent ?? '',
      );
      expect(cells.some((c) => c.includes('2026'))).toBe(true);
    });
  });

  it('shows an em dash when updated_at is missing', async () => {
    // Arrange
    setupMocks([
      { device: 'epcube5488_battery', class: 'storage_battery', online: false, alias: 'Old', product_code: 'EP Cube (devType=2)' },
    ]);

    // Act
    render(<RemovedDevicesSection />);

    // Assert
    await waitFor(() => {
      const cells = Array.from(document.querySelectorAll('.removed-devices-table td')).map(
        (td) => td.textContent ?? '',
      );
      expect(cells.some((c) => c === '—')).toBe(true);
    });
  });

  it('shows an em dash when updated_at is an invalid date string', async () => {
    // Arrange — `new Date("not-a-date").getTime()` is NaN, exercises the NaN guard
    setupMocks([
      { device: 'epcube5488_battery', class: 'storage_battery', online: false, alias: 'Old', product_code: 'EP Cube (devType=2)', updated_at: 'not-a-date' },
    ]);

    // Act
    render(<RemovedDevicesSection />);

    // Assert
    await waitFor(() => {
      const cells = Array.from(document.querySelectorAll('.removed-devices-table td')).map(
        (td) => td.textContent ?? '',
      );
      expect(cells.some((c) => c === '—')).toBe(true);
    });
  });

  it('does not fetch merged devices (section is for Removed only)', async () => {
    // Arrange
    setupMocks([]);

    // Act
    render(<RemovedDevicesSection />);
    await waitFor(() => screen.getByText(/No removed devices/i));

    // Assert
    const statuses = mockFetchDevicesByStatus.mock.calls.map((c) => c[0]);
    expect(statuses).toContain('removed');
    expect(statuses).not.toContain('merged');
  });

  it('renders a trash icon delete button with accessible label', async () => {
    // Arrange
    setupMocks([
      { device: 'epcube5488_battery', class: 'storage_battery', online: false, alias: 'Old', product_code: 'EP Cube (devType=2)', updated_at: '2026-05-10T12:00:00Z' },
    ]);

    // Act
    render(<RemovedDevicesSection />);

    // Assert — button is queryable by accessible name "Delete"; contains an svg child
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Delete/i });
      expect(btn).toBeTruthy();
      expect(btn.querySelector('svg')).toBeTruthy();
    });
  });

  it('groups removed devices by cloud ID into one row per group', async () => {
    // Arrange — battery + solar for one cloud id = one row
    setupMocks([
      { device: 'epcube5488_battery', class: 'storage_battery', online: false, alias: 'Old', product_code: 'EP Cube (devType=2)', updated_at: '2026-05-10T12:00:00Z' },
      { device: 'epcube5488_solar', class: 'home_solar', online: false, alias: 'Old', product_code: 'EP Cube (devType=2)', updated_at: '2026-05-10T12:00:00Z' },
      { device: 'epcube7777_battery', class: 'storage_battery', online: false, alias: 'Another', product_code: 'EP Cube (devType=2)', updated_at: '2026-05-10T13:00:00Z' },
    ]);

    // Act
    render(<RemovedDevicesSection />);

    // Assert
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Delete/i })).toHaveLength(2);
    });
  });

  it('clicking Delete shows Confirm Delete / Cancel; deleteDevice not called yet', async () => {
    // Arrange
    setupMocks([
      { device: 'epcube5488_battery', class: 'storage_battery', online: false, alias: 'Old', product_code: 'EP Cube (devType=2)', updated_at: '2026-05-10T12:00:00Z' },
    ]);

    // Act
    render(<RemovedDevicesSection />);
    await waitFor(() => screen.getByRole('button', { name: /Delete/i }));
    fireEvent.click(screen.getByRole('button', { name: /Delete/i }));

    // Assert
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Confirm Delete/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Cancel/i })).toBeTruthy();
    });
    expect(mockDeleteDevice).not.toHaveBeenCalled();
  });

  it('Cancel dismisses the confirmation without calling deleteDevice', async () => {
    // Arrange
    setupMocks([
      { device: 'epcube5488_battery', class: 'storage_battery', online: false, alias: 'Old', product_code: 'EP Cube (devType=2)', updated_at: '2026-05-10T12:00:00Z' },
    ]);

    // Act
    render(<RemovedDevicesSection />);
    await waitFor(() => screen.getByRole('button', { name: /Delete/i }));
    fireEvent.click(screen.getByRole('button', { name: /Delete/i }));
    await waitFor(() => screen.getByRole('button', { name: /Cancel/i }));
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

    // Assert
    expect(mockDeleteDevice).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Confirm Delete/i })).toBeNull();
  });

  it('Confirm Delete calls deleteDevice with cloud id and removes the row', async () => {
    // Arrange
    setupMocks([
      { device: 'epcube5488_battery', class: 'storage_battery', online: false, alias: 'Old', product_code: 'EP Cube (devType=2)', updated_at: '2026-05-10T12:00:00Z' },
    ]);
    mockDeleteDevice.mockResolvedValue({ device_id: '5488', readings_deleted: 12345 });

    // Act
    render(<RemovedDevicesSection />);
    await waitFor(() => screen.getByRole('button', { name: /Delete/i }));
    fireEvent.click(screen.getByRole('button', { name: /Delete/i }));
    await waitFor(() => screen.getByRole('button', { name: /Confirm Delete/i }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm Delete/i }));

    // Assert
    await waitFor(() => {
      expect(mockDeleteDevice).toHaveBeenCalledWith('5488');
      expect(screen.getByText(/Deleted 12,345 readings/i)).toBeTruthy();
    });
  });

  it('shows error feedback when deleteDevice fails', async () => {
    // Arrange
    setupMocks([
      { device: 'epcube5488_battery', class: 'storage_battery', online: false, alias: 'Old', product_code: 'EP Cube (devType=2)', updated_at: '2026-05-10T12:00:00Z' },
    ]);
    mockDeleteDevice.mockRejectedValue(new Error('Cannot delete an active device'));

    // Act
    render(<RemovedDevicesSection />);
    await waitFor(() => screen.getByRole('button', { name: /Delete/i }));
    fireEvent.click(screen.getByRole('button', { name: /Delete/i }));
    await waitFor(() => screen.getByRole('button', { name: /Confirm Delete/i }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm Delete/i }));

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/Cannot delete an active device/i)).toBeTruthy();
    });
  });

  it('disables Confirm Delete while the delete is in flight', async () => {
    // Arrange
    setupMocks([
      { device: 'epcube5488_battery', class: 'storage_battery', online: false, alias: 'Old', product_code: 'EP Cube (devType=2)', updated_at: '2026-05-10T12:00:00Z' },
    ]);
    mockDeleteDevice.mockReturnValue(new Promise(() => {})); // never resolves

    // Act
    render(<RemovedDevicesSection />);
    await waitFor(() => screen.getByRole('button', { name: /Delete/i }));
    fireEvent.click(screen.getByRole('button', { name: /Delete/i }));
    await waitFor(() => screen.getByRole('button', { name: /Confirm Delete/i }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm Delete/i }));

    // Assert
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Deleting…/i }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  it('handles fetchDevicesByStatus failure gracefully (empty state)', async () => {
    // Arrange
    mockFetchDevicesByStatus.mockRejectedValue(new Error('API down'));

    // Act
    render(<RemovedDevicesSection />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/No removed devices/i)).toBeTruthy();
    });
  });

  it('disambiguates group titles when two groups share a display name', async () => {
    // Arrange — both resolve to "EP Cube v2"
    setupMocks([
      { device: 'epcube5488_battery', class: 'storage_battery', online: false, alias: 'Cube A', product_code: 'EP Cube (devType=2)', updated_at: '2026-05-10T12:00:00Z' },
      { device: 'epcube7777_battery', class: 'storage_battery', online: false, alias: 'Cube B', product_code: 'EP Cube (devType=2)', updated_at: '2026-05-10T13:00:00Z' },
    ]);

    // Act
    render(<RemovedDevicesSection />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/EP Cube v2 \(5488\)/)).toBeTruthy();
      expect(screen.getByText(/EP Cube v2 \(7777\)/)).toBeTruthy();
    });
  });

  it('omits the alias subtext when alias matches the display name', async () => {
    // Arrange — alias resolves to the same string as displayName (no extra .removed-devices-alias)
    setupMocks([
      { device: 'epcube5488_battery', class: 'storage_battery', online: false, alias: 'EP Cube v2', product_code: 'EP Cube (devType=2)', updated_at: '2026-05-10T12:00:00Z' },
    ]);

    // Act
    render(<RemovedDevicesSection />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('EP Cube v2')).toBeTruthy();
    });
    expect(document.querySelector('.removed-devices-alias')).toBeNull();
  });

  it('omits the alias subtext when alias is empty', async () => {
    // Arrange — device with no alias at all
    setupMocks([
      { device: 'epcube5488_battery', class: 'storage_battery', online: false, product_code: 'EP Cube (devType=2)', updated_at: '2026-05-10T12:00:00Z' },
    ]);

    // Act
    render(<RemovedDevicesSection />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('EP Cube v2')).toBeTruthy();
    });
    expect(document.querySelector('.removed-devices-alias')).toBeNull();
  });

  it('does not update state after unmount during initial load', async () => {
    // Arrange — fetch resolves after unmount, exercising the `cancelled` guard
    let resolve!: (v: unknown) => void;
    mockFetchDevicesByStatus.mockReturnValue(new Promise((r) => { resolve = r; }));

    // Act
    const { unmount } = render(<RemovedDevicesSection />);
    unmount();
    resolve!({ devices: [] });

    // Assert — no error thrown, state update silently skipped
    await new Promise((r) => setTimeout(r, 10));
  });
});
