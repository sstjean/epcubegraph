import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { h } from 'preact';

vi.mock('../../src/api', () => ({
  fetchDevicesByStatus: vi.fn(),
  fetchMergePreview: vi.fn(),
  fetchPendingReplacements: vi.fn(),
  mergeDevices: vi.fn(),
}));

import { fetchDevicesByStatus, fetchMergePreview, fetchPendingReplacements, mergeDevices } from '../../src/api';
import { DeviceMerge } from '../../src/components/DeviceMerge';

const mockFetchDevices = fetchDevicesByStatus as ReturnType<typeof vi.fn>;
const mockFetchPreview = fetchMergePreview as ReturnType<typeof vi.fn>;
const mockFetchPending = fetchPendingReplacements as ReturnType<typeof vi.fn>;
const mockMerge = mergeDevices as ReturnType<typeof vi.fn>;

const removedDevices = [
  { device: 'epcube100_battery', class: 'storage_battery', online: false, alias: 'Old EP Cube' },
  { device: 'epcube100_solar', class: 'home_solar', online: false, alias: 'Old EP Cube' },
];

const activeDevices = [
  { device: 'epcube200_battery', class: 'storage_battery', online: true, alias: 'New EP Cube' },
  { device: 'epcube200_solar', class: 'home_solar', online: true, alias: 'New EP Cube' },
];

function setupMocks() {
  mockFetchDevices.mockImplementation((status: string) => {
    if (status === 'removed') return Promise.resolve({ devices: removedDevices });
    if (status === 'active') return Promise.resolve({ devices: activeDevices });
    return Promise.resolve({ devices: [] });
  });
  mockFetchPending.mockResolvedValue([]);
  mockFetchPreview.mockResolvedValue({
    old_device_id: '100',
    new_device_id: '200',
    readings_to_transfer: 45230,
    conflicts_to_skip: 12,
  });
  mockMerge.mockResolvedValue({
    old_device_id: '100',
    new_device_id: '200',
    readings_transferred: 45230,
    conflicts_skipped: 12,
  });
}

describe('DeviceMerge', () => {
  it('renders merge section heading', async () => {
    // Arrange
    setupMocks();
    render(<DeviceMerge />);

    // Assert
    expect(screen.getByText(/Device Merge/i)).toBeTruthy();
  });

  it('shows informational message when no removed devices exist', async () => {
    // Arrange
    setupMocks();
    mockFetchDevices.mockResolvedValue({ devices: [] });

    // Act
    render(<DeviceMerge />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/No removed devices/i)).toBeTruthy();
    });
  });

  it('lists removed device groups in source dropdown', async () => {
    // Arrange
    setupMocks();

    // Act
    render(<DeviceMerge />);
    await waitFor(() => screen.getByLabelText(/Removed device/i));

    // Assert — one option per device group, plus the "Choose" placeholder
    const select = screen.getByLabelText(/Removed device/i) as HTMLSelectElement;
    expect(select.options.length).toBeGreaterThanOrEqual(2);
    expect(select.textContent).toContain('Old EP Cube');
  });

  it('lists active device groups in target dropdown', async () => {
    // Arrange
    setupMocks();

    // Act
    render(<DeviceMerge />);
    await waitFor(() => screen.getByLabelText(/Active device/i));

    // Assert
    const select = screen.getByLabelText(/Active device/i) as HTMLSelectElement;
    expect(select.textContent).toContain('New EP Cube');
  });

  it('fetches merge preview after both selections are made', async () => {
    // Arrange
    setupMocks();

    // Act
    render(<DeviceMerge />);
    await waitFor(() => screen.getByLabelText(/Removed device/i));

    fireEvent.change(screen.getByLabelText(/Removed device/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Active device/i), { target: { value: '200' } });

    // Assert
    await waitFor(() => {
      expect(mockFetchPreview).toHaveBeenCalledWith('100', '200');
    });
  });

  it('displays reading count and conflict count from merge preview', async () => {
    // Arrange
    setupMocks();

    // Act
    render(<DeviceMerge />);
    await waitFor(() => screen.getByLabelText(/Removed device/i));

    fireEvent.change(screen.getByLabelText(/Removed device/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Active device/i), { target: { value: '200' } });

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/45,230/)).toBeTruthy();
      expect(screen.getByText(/12/)).toBeTruthy();
    });
  });

  it('shows irreversibility warning in the confirmation panel', async () => {
    // Arrange
    setupMocks();

    // Act
    render(<DeviceMerge />);
    await waitFor(() => screen.getByLabelText(/Removed device/i));

    fireEvent.change(screen.getByLabelText(/Removed device/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Active device/i), { target: { value: '200' } });

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/cannot be undone/i)).toBeTruthy();
    });
  });

  it('renders a Merge button in the confirmation panel', async () => {
    // Arrange
    setupMocks();

    // Act
    render(<DeviceMerge />);
    await waitFor(() => screen.getByLabelText(/Removed device/i));

    fireEvent.change(screen.getByLabelText(/Removed device/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Active device/i), { target: { value: '200' } });

    // Assert
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Merge/i })).toBeTruthy();
    });
  });

  it('shows error message when preview fails', async () => {
    // Arrange
    setupMocks();
    mockFetchPreview.mockRejectedValue(new Error('Endpoint not available yet'));

    // Act
    render(<DeviceMerge />);
    await waitFor(() => screen.getByLabelText(/Removed device/i));

    fireEvent.change(screen.getByLabelText(/Removed device/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Active device/i), { target: { value: '200' } });

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/Endpoint not available yet/i)).toBeTruthy();
    });
  });

  it('treats failed device fetches as empty lists', async () => {
    // Arrange — both calls reject
    setupMocks();
    mockFetchDevices.mockRejectedValue(new Error('API down'));

    // Act
    render(<DeviceMerge />);

    // Assert — falls through to "No removed devices" message
    await waitFor(() => {
      expect(screen.getByText(/No removed devices/i)).toBeTruthy();
    });
  });

  it('skips groups whose base id has no epcube prefix', async () => {
    // Arrange — non-epcube device produces empty cloudId after prefix strip
    setupMocks();
    mockFetchDevices.mockImplementation((status: string) => {
      if (status === 'removed') {
        return Promise.resolve({
          devices: [{ device: 'epcube_battery', class: 'storage_battery', online: false, alias: 'Weird' }],
        });
      }
      return Promise.resolve({ devices: [] });
    });

    // Act
    render(<DeviceMerge />);

    // Assert — group is filtered out, falls back to no-removed message
    await waitFor(() => {
      expect(screen.getByText(/No removed devices/i)).toBeTruthy();
    });
  });

  it('does not update state when devices fetch resolves after unmount', async () => {
    // Arrange — fetchDevicesByStatus resolves AFTER unmount (collect all resolvers)
    setupMocks();
    const resolvers: Array<(v: any) => void> = [];
    mockFetchDevices.mockImplementation(() => new Promise((res) => { resolvers.push(res); }));

    // Act
    const { unmount } = render(<DeviceMerge />);
    unmount();
    // Resolve all pending fetches AFTER cancellation
    for (const r of resolvers) r({ devices: removedDevices });
    await new Promise((r) => setTimeout(r, 0));

    // Assert — UI never rendered the dropdowns (cancelled flag prevented setState)
    expect(screen.queryByLabelText(/Removed device/i)).toBeNull();
  });

  it('does not update state when preview resolves after both inputs cleared', async () => {
    // Arrange — preview resolves slowly
    setupMocks();
    let resolvePreview!: (v: any) => void;
    mockFetchPreview.mockImplementation(() => new Promise((res) => { resolvePreview = res; }));

    // Act
    render(<DeviceMerge />);
    await waitFor(() => screen.getByLabelText(/Removed device/i));
    fireEvent.change(screen.getByLabelText(/Removed device/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Active device/i), { target: { value: '200' } });
    // Clear selection — the previous effect's `cancelled` flag should fire
    fireEvent.change(screen.getByLabelText(/Active device/i), { target: { value: '' } });
    resolvePreview({ old_device_id: '100', new_device_id: '200', readings_to_transfer: 1, conflicts_to_skip: 0 });

    // Assert — readings count from stale request is not displayed
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/Merging will transfer/)).toBeNull();
  });

  it('does not update state when preview rejects after both inputs cleared', async () => {
    // Arrange — preview rejects slowly
    setupMocks();
    let rejectPreview!: (e: any) => void;
    mockFetchPreview.mockImplementation(() => new Promise((_res, rej) => { rejectPreview = rej; }));

    // Act
    render(<DeviceMerge />);
    await waitFor(() => screen.getByLabelText(/Removed device/i));
    fireEvent.change(screen.getByLabelText(/Removed device/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Active device/i), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText(/Active device/i), { target: { value: '' } });
    rejectPreview(new Error('Network'));

    // Assert — error not displayed (request was cancelled)
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/Network/)).toBeNull();
  });

  it('clicking Merge calls mergeDevices and shows success feedback', async () => {
    // Arrange
    setupMocks();

    // Act
    render(<DeviceMerge />);
    await waitFor(() => screen.getByLabelText(/Removed device/i));
    fireEvent.change(screen.getByLabelText(/Removed device/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Active device/i), { target: { value: '200' } });
    await waitFor(() => screen.getByRole('button', { name: /Merge devices/i }));

    fireEvent.click(screen.getByRole('button', { name: /Merge devices/i }));

    // Assert
    await waitFor(() => {
      expect(mockMerge).toHaveBeenCalledWith('100', '200');
      expect(screen.getByText(/transferred 45,230 readings/i)).toBeTruthy();
    });
  });

  it('shows error feedback when merge API fails', async () => {
    // Arrange
    setupMocks();
    mockMerge.mockRejectedValue(new Error('Merge endpoint exploded'));

    // Act
    render(<DeviceMerge />);
    await waitFor(() => screen.getByLabelText(/Removed device/i));
    fireEvent.change(screen.getByLabelText(/Removed device/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Active device/i), { target: { value: '200' } });
    await waitFor(() => screen.getByRole('button', { name: /Merge devices/i }));

    fireEvent.click(screen.getByRole('button', { name: /Merge devices/i }));

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/Merge endpoint exploded/i)).toBeTruthy();
    });
  });

  it('disables button while merge is in flight', async () => {
    // Arrange — slow merge
    setupMocks();
    let resolveMerge!: (v: any) => void;
    mockMerge.mockImplementation(() => new Promise((res) => { resolveMerge = res; }));

    // Act
    render(<DeviceMerge />);
    await waitFor(() => screen.getByLabelText(/Removed device/i));
    fireEvent.change(screen.getByLabelText(/Removed device/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Active device/i), { target: { value: '200' } });
    await waitFor(() => screen.getByRole('button', { name: /Merge devices/i }));

    fireEvent.click(screen.getByRole('button', { name: /Merge devices/i }));
    await waitFor(() => screen.getByRole('button', { name: /Merging…/i }));

    // Assert — button shows merging label and is disabled
    const btn = screen.getByRole('button', { name: /Merging…/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    // Cleanup
    resolveMerge({ old_device_id: '100', new_device_id: '200', readings_transferred: 0, conflicts_skipped: 0 });
    await new Promise((r) => setTimeout(r, 0));
  });

  it('treats post-merge refetch failures as empty lists', async () => {
    // Arrange — initial fetches succeed, refetches after merge reject
    setupMocks();
    let callCount = 0;
    mockFetchDevices.mockImplementation((status: string) => {
      callCount++;
      // Initial calls (1, 2): succeed; post-merge calls (3, 4): reject
      if (callCount > 2) return Promise.reject(new Error('Refetch failed'));
      if (status === 'removed') return Promise.resolve({ devices: removedDevices });
      return Promise.resolve({ devices: activeDevices });
    });

    // Act
    render(<DeviceMerge />);
    await waitFor(() => screen.getByLabelText(/Removed device/i));
    fireEvent.change(screen.getByLabelText(/Removed device/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Active device/i), { target: { value: '200' } });
    await waitFor(() => screen.getByRole('button', { name: /Merge devices/i }));

    fireEvent.click(screen.getByRole('button', { name: /Merge devices/i }));

    // Assert — success message still shows; component doesn't crash
    await waitFor(() => {
      expect(screen.getByText(/transferred 45,230 readings/i)).toBeTruthy();
    });
  });

  it('renders added date in dropdown options when devices have created_at', async () => {
    // Arrange — devices include created_at
    setupMocks();
    mockFetchDevices.mockImplementation((status: string) => {
      if (status === 'removed') {
        return Promise.resolve({
          devices: [
            { device: 'epcube100_battery', class: 'storage_battery', online: false, alias: 'Old', created_at: '2026-04-09T12:59:49Z' },
            { device: 'epcube100_solar', class: 'home_solar', online: false, alias: 'Old', created_at: '2026-04-09T13:00:00Z' },
          ],
        });
      }
      if (status === 'active') {
        return Promise.resolve({
          devices: [
            { device: 'epcube200_battery', class: 'storage_battery', online: true, alias: 'New', created_at: '2026-05-10T14:56:05Z' },
          ],
        });
      }
      return Promise.resolve({ devices: [] });
    });

    // Act
    render(<DeviceMerge />);
    await waitFor(() => screen.getByLabelText(/Removed device/i));

    // Assert — option text contains "added <localized date>"
    const removedSelect = screen.getByLabelText(/Removed device/i) as HTMLSelectElement;
    expect(removedSelect.textContent).toMatch(/added/i);
    const activeSelect = screen.getByLabelText(/Active device/i) as HTMLSelectElement;
    expect(activeSelect.textContent).toMatch(/added/i);
  });

  it('omits added date label when created_at is missing or invalid', async () => {
    // Arrange — invalid date triggers formatAddedAt's NaN guard
    setupMocks();
    mockFetchDevices.mockImplementation((status: string) => {
      if (status === 'removed') {
        return Promise.resolve({
          devices: [
            { device: 'epcube100_battery', class: 'storage_battery', online: false, alias: 'Old', created_at: 'not-a-date' },
          ],
        });
      }
      return Promise.resolve({ devices: [] });
    });

    // Act
    render(<DeviceMerge />);
    await waitFor(() => screen.getByLabelText(/Removed device/i));

    // Assert — option text does NOT contain "added"
    const removedSelect = screen.getByLabelText(/Removed device/i) as HTMLSelectElement;
    expect(removedSelect.textContent).not.toMatch(/added/i);
  });

  it('handles fetchPendingReplacements rejection gracefully', async () => {
    // Arrange — pending fetch rejects (caught and treated as empty)
    setupMocks();
    mockFetchPending.mockRejectedValue(new Error('pending API down'));

    // Act
    render(<DeviceMerge />);
    await waitFor(() => screen.getByLabelText(/Removed device/i));

    // Assert — UI still works (falls back to all-active list)
    const activeSelect = screen.getByLabelText(/Active device/i) as HTMLSelectElement;
    expect(activeSelect.textContent).toContain('New EP Cube');
  });

  it('filters target dropdown to only suggested replacements when pending row exists', async () => {
    // Arrange — pending replacement says 100 → 200; add a third active device
    setupMocks();
    mockFetchDevices.mockImplementation((status: string) => {
      if (status === 'removed') return Promise.resolve({ devices: removedDevices });
      if (status === 'active') {
        return Promise.resolve({
          devices: [
            ...activeDevices,
            { device: 'epcube999_battery', class: 'storage_battery', online: true, alias: 'Unrelated' },
          ],
        });
      }
      return Promise.resolve({ devices: [] });
    });
    mockFetchPending.mockResolvedValue([
      { id: 1, old_device_id: '100', new_device_id: '200', detected_at: '2026-05-10T16:46:00Z' },
    ]);

    // Act
    render(<DeviceMerge />);
    await waitFor(() => screen.getByLabelText(/Removed device/i));
    fireEvent.change(screen.getByLabelText(/Removed device/i), { target: { value: '100' } });

    // Assert — only the suggested target ('200') appears; '999' is filtered out;
    // and the single suggestion is auto-selected.
    await waitFor(() => {
      const activeSelect = screen.getByLabelText(/Active device/i) as HTMLSelectElement;
      expect(activeSelect.textContent).toContain('New EP Cube');
      expect(activeSelect.textContent).not.toContain('Unrelated');
      expect(activeSelect.value).toBe('200');
    });
  });

  it('clears target when source changes and previously-selected target is no longer allowed', async () => {
    // Arrange — old=100 has no pending (manual fallback path); old=101 has pending → 201.
    setupMocks();
    mockFetchDevices.mockImplementation((status: string) => {
      if (status === 'removed') {
        return Promise.resolve({
          devices: [
            ...removedDevices,
            { device: 'epcube101_battery', class: 'storage_battery', online: false, alias: 'Old 2' },
          ],
        });
      }
      if (status === 'active') {
        return Promise.resolve({
          devices: [
            ...activeDevices,
            { device: 'epcube201_battery', class: 'storage_battery', online: true, alias: 'New 2' },
          ],
        });
      }
      return Promise.resolve({ devices: [] });
    });
    mockFetchPending.mockResolvedValue([
      { id: 1, old_device_id: '101', new_device_id: '201', detected_at: '2026-05-10T00:00:00Z' },
    ]);

    // Act — select old=100 (no pending → fallback), pick newId=200 manually
    render(<DeviceMerge />);
    await waitFor(() => screen.getByLabelText(/Removed device/i));
    fireEvent.change(screen.getByLabelText(/Removed device/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Active device/i), { target: { value: '200' } });
    await waitFor(() => {
      const sel = screen.getByLabelText(/Active device/i) as HTMLSelectElement;
      expect(sel.value).toBe('200');
    });

    // Switch to old=101 → pending [101→201] → newId '200' must be cleared and auto-set to '201'
    fireEvent.change(screen.getByLabelText(/Removed device/i), { target: { value: '101' } });

    await waitFor(() => {
      const sel = screen.getByLabelText(/Active device/i) as HTMLSelectElement;
      expect(sel.value).toBe('201');
    });
  });

  it('clears stale newId when source switches to a pending row whose target does not exist', async () => {
    // Arrange — old=100 has no pending (manual fallback). old=101 points at a device id
    setupMocks();
    mockFetchDevices.mockImplementation((status: string) => {
      if (status === 'removed') {
        return Promise.resolve({
          devices: [
            ...removedDevices,
            { device: 'epcube101_battery', class: 'storage_battery', online: false, alias: 'Old 2' },
          ],
        });
      }
      if (status === 'active') return Promise.resolve({ devices: activeDevices });
      return Promise.resolve({ devices: [] });
    });
    mockFetchPending.mockResolvedValue([
      { id: 1, old_device_id: '101', new_device_id: '999', detected_at: '2026-05-10T00:00:00Z' },
    ]);

    // Act — manually select old=100 + newId=200 (no pending row for 100 → fallback list)
    render(<DeviceMerge />);
    await waitFor(() => screen.getByLabelText(/Removed device/i));
    fireEvent.change(screen.getByLabelText(/Removed device/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Active device/i), { target: { value: '200' } });
    await waitFor(() => {
      const sel = screen.getByLabelText(/Active device/i) as HTMLSelectElement;
      expect(sel.value).toBe('200');
    });

    // Switch source to 101 → pendingMatches=[{101→999}], suggestedTargets=[] (999 not active).
    // Existing newId '200' is no longer allowed → clear branch fires.
    fireEvent.change(screen.getByLabelText(/Removed device/i), { target: { value: '101' } });

    // Assert — newId reset to '' (no option selected)
    await waitFor(() => {
      const sel = screen.getByLabelText(/Active device/i) as HTMLSelectElement;
      expect(sel.value).toBe('');
    });
  });
});
