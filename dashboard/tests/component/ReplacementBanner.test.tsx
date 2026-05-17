import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { h } from 'preact';

vi.mock('../../src/hooks/useDeviceDiscovery', () => ({
  useDeviceDiscoveryContext: vi.fn(),
}));

import { useDeviceDiscoveryContext } from '../../src/hooks/useDeviceDiscovery';
import { ReplacementBanner } from '../../src/components/ReplacementBanner';

const mockHook = useDeviceDiscoveryContext as ReturnType<typeof vi.fn>;

function setHookResult(
  pending: any[],
  dismiss: any = vi.fn().mockResolvedValue(undefined),
  merge: any = vi.fn().mockResolvedValue({
    old_device_id: '100',
    new_device_id: '200',
    readings_transferred: 0,
    conflicts_skipped: 0,
  }),
) {
  mockHook.mockReturnValue({
    pending,
    dismiss,
    merge,
    refresh: vi.fn(),
  });
  return { dismiss, merge };
}

describe('ReplacementBanner', () => {
  it('renders nothing when there are no pending replacements', () => {
    // Arrange
    setHookResult([]);

    // Act
    const { container } = render(<ReplacementBanner />);

    // Assert
    expect(container.querySelector('.replacement-banner')).toBeNull();
  });

  it('renders one alert per pending replacement', () => {
    // Arrange
    setHookResult([
      { id: 1, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: 12345, conflictsToSkip: 7 },
      { id: 2, old_device_id: '300', new_device_id: '400', detected_at: '', readingsToTransfer: 0, conflictsToSkip: 0 },
    ]);

    // Act
    render(<ReplacementBanner />);

    // Assert
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });

  it('shows old/new device info in a table with Last Seen', () => {
    // Arrange
    setHookResult([
      { id: 1, old_device_id: '100', new_device_id: '200', detected_at: '',
        old_product_code: 'EP Cube (devType=2)', old_alias: 'Kitchen',
        new_product_code: 'EP Cube (devType=2)', new_alias: 'Garage',
        old_last_seen: '2026-05-16T10:00:00Z', new_last_seen: '2026-05-16T11:00:00Z',
        readingsToTransfer: 12345, conflictsToSkip: 7 },
    ]);

    // Act
    render(<ReplacementBanner />);

    // Assert — table headers
    expect(screen.getByText('Last Seen')).toBeTruthy();
    expect(screen.getByText('Device ID')).toBeTruthy();
    expect(screen.getByText('Device Name')).toBeTruthy();
    expect(screen.getByText('Readings')).toBeTruthy();
    expect(screen.getByText('Duplicates')).toBeTruthy();
    // Assert — row labels and data
    expect(screen.getByText('Old device')).toBeTruthy();
    expect(screen.getByText('New device')).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();
    expect(screen.getByText('200')).toBeTruthy();
    expect(screen.getByText('Kitchen')).toBeTruthy();
    expect(screen.getByText('Garage')).toBeTruthy();
    expect(screen.getByText('12,345')).toBeTruthy();
  });

  it('shows em-dash when reading count is unavailable', () => {
    // Arrange
    setHookResult([
      { id: 1, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: null, conflictsToSkip: null },
    ]);

    // Act
    const { container } = render(<ReplacementBanner />);

    // Assert — em dash shown
    expect(container.textContent).toContain('—');
  });
  it('shows em-dash in table when alias is unavailable', () => {
    // Arrange
    setHookResult([
      { id: 1, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: 0, conflictsToSkip: 0 },
    ]);

    // Act
    const { container } = render(<ReplacementBanner />);

    // Assert — em dash shown for missing aliases
    const nameCells = container.querySelectorAll('.replacement-banner__table td');
    const textContent = Array.from(nameCells).map((td) => td.textContent);
    expect(textContent.filter((t) => t === '\u2014')).toHaveLength(4);
  });

  it('shows duplicate readings note when conflicts exist', () => {
    // Arrange
    setHookResult([
      { id: 1, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: 500, conflictsToSkip: 42 },
    ]);

    // Act
    render(<ReplacementBanner />);

    // Assert
    expect(screen.getByText(/The new device was collecting data while the old device was still collecting data/)).toBeTruthy();
    expect(screen.getByText(/overlapped readings from the old device will be deleted/)).toBeTruthy();
  });

  it('hides duplicate readings note when no conflicts', () => {
    // Arrange
    setHookResult([
      { id: 1, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: 500, conflictsToSkip: 0 },
    ]);

    // Act
    const { container } = render(<ReplacementBanner />);

    // Assert
    expect(container.querySelector('.replacement-banner__note')).toBeNull();
  });

  it('shows equipment swap title', () => {
    // Arrange
    setHookResult([
      { id: 1, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: 0, conflictsToSkip: 0 },
    ]);

    // Act
    render(<ReplacementBanner />);

    // Assert
    expect(screen.getByText(/A possible equipment swap was detected/)).toBeTruthy();
  });

  it('shows a link to the Settings page', () => {
    // Arrange
    setHookResult([
      { id: 1, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: 0, conflictsToSkip: 0 },
    ]);

    // Act
    render(<ReplacementBanner />);

    // Assert
    const link = screen.getByRole('link', { name: 'Settings' });
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/settings');
  });
  it('shows Yes and No buttons', () => {
    // Arrange
    setHookResult([
      { id: 1, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: 1, conflictsToSkip: 0 },
    ]);

    // Act
    render(<ReplacementBanner />);

    // Assert
    expect(screen.getByText('Yes')).toBeTruthy();
    expect(screen.getByText('No')).toBeTruthy();
  });

  it('clicking No calls hook.dismiss with the pending id', async () => {
    // Arrange
    const { dismiss } = setHookResult([
      { id: 42, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: 1, conflictsToSkip: 0 },
    ]);

    // Act
    render(<ReplacementBanner />);
    fireEvent.click(screen.getByText('No'));
    await Promise.resolve();

    // Assert
    expect(dismiss).toHaveBeenCalledWith(42);
  });

  it('clicking Yes calls hook.merge and shows success feedback', async () => {
    // Arrange
    const merge = vi.fn().mockResolvedValue({
      old_device_id: '100',
      new_device_id: '200',
      readings_transferred: 5432,
      conflicts_skipped: 3,
    });
    setHookResult(
      [{ id: 7, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: 5432, conflictsToSkip: 3 }],
      undefined,
      merge,
    );

    // Act
    render(<ReplacementBanner />);
    fireEvent.click(screen.getByText('Yes'));
    await new Promise((r) => setTimeout(r, 0));

    // Assert
    expect(merge).toHaveBeenCalledWith(7, '100', '200');
    expect(screen.getByText(/transferred 5,432 readings/i)).toBeTruthy();
  });

  it('shows error feedback when Yes fails', async () => {
    // Arrange
    const merge = vi.fn().mockRejectedValue(new Error('Database busy'));
    setHookResult(
      [{ id: 7, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: 1, conflictsToSkip: 0 }],
      undefined,
      merge,
    );

    // Act
    render(<ReplacementBanner />);
    fireEvent.click(screen.getByText('Yes'));
    await new Promise((r) => setTimeout(r, 0));

    // Assert
    expect(screen.getByText(/Database busy/i)).toBeTruthy();
  });

  it('shows error feedback when No fails', async () => {
    // Arrange
    const dismiss = vi.fn().mockRejectedValue(new Error('Cannot dismiss'));
    setHookResult(
      [{ id: 1, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: 1, conflictsToSkip: 0 }],
      dismiss,
    );

    // Act
    render(<ReplacementBanner />);
    fireEvent.click(screen.getByText('No'));
    await new Promise((r) => setTimeout(r, 0));

    // Assert
    expect(screen.getByText(/Cannot dismiss/i)).toBeTruthy();
  });

  it('disables both buttons while merge is in flight', async () => {
    // Arrange — merge never resolves
    const merge = vi.fn().mockReturnValue(new Promise(() => {}));
    setHookResult(
      [{ id: 1, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: 1, conflictsToSkip: 0 }],
      undefined,
      merge,
    );

    // Act
    render(<ReplacementBanner />);
    fireEvent.click(screen.getByText('Yes'));
    await new Promise((r) => setTimeout(r, 0));

    // Assert — both buttons disabled
    const yes = screen.getByText('Yes') as HTMLButtonElement;
    const no = screen.getByText('No') as HTMLButtonElement;
    expect(yes.disabled).toBe(true);
    expect(no.disabled).toBe(true);
  });

  it('disables both buttons while dismiss is in flight', async () => {
    // Arrange — dismiss never resolves
    const dismiss = vi.fn().mockReturnValue(new Promise(() => {}));
    setHookResult(
      [{ id: 1, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: 1, conflictsToSkip: 0 }],
      dismiss,
    );

    // Act
    render(<ReplacementBanner />);
    fireEvent.click(screen.getByText('No'));
    await new Promise((r) => setTimeout(r, 0));

    // Assert — both buttons disabled
    const yes = screen.getByText('Yes') as HTMLButtonElement;
    const no = screen.getByText('No') as HTMLButtonElement;
    expect(yes.disabled).toBe(true);
    expect(no.disabled).toBe(true);
  });

  it('renders zero reading count as "0" not em-dash', () => {
    // Arrange
    setHookResult([
      { id: 1, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: 0, conflictsToSkip: 0 },
    ]);

    // Act
    const { container } = render(<ReplacementBanner />);

    // Assert — 0 renders as "0", not em-dash
    const cells = container.querySelectorAll('.replacement-banner__table td');
    const textContent = Array.from(cells).map((td) => td.textContent);
    // Readings cell for old device should show "0", not "—"
    expect(textContent).toContain('0');
  });

  it('renders em-dash for null last_seen timestamps', () => {
    // Arrange — no last_seen values
    setHookResult([
      { id: 1, old_device_id: '100', new_device_id: '200', detected_at: '',
        old_last_seen: null, new_last_seen: null,
        readingsToTransfer: 5, conflictsToSkip: 0 },
    ]);

    // Act
    const { container } = render(<ReplacementBanner />);

    // Assert — Last Seen columns show em-dash
    const rows = container.querySelectorAll('.replacement-banner__table tbody tr');
    // Second cell in each row is Last Seen
    const oldLastSeen = rows[0]?.querySelectorAll('td')[1]?.textContent;
    const newLastSeen = rows[1]?.querySelectorAll('td')[1]?.textContent;
    expect(oldLastSeen).toBe('—');
    expect(newLastSeen).toBe('—');
  });

  it('renders confirm question text', () => {
    // Arrange
    setHookResult([
      { id: 1, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: 0, conflictsToSkip: 0 },
    ]);

    // Act
    render(<ReplacementBanner />);

    // Assert
    expect(screen.getByText(/Is the new device a replacement or upgrade/)).toBeTruthy();
  });

  it('success message includes conflict count', async () => {
    // Arrange
    const merge = vi.fn().mockResolvedValue({
      old_device_id: '100',
      new_device_id: '200',
      readings_transferred: 100,
      conflicts_skipped: 42,
    });
    setHookResult(
      [{ id: 1, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: 100, conflictsToSkip: 42 }],
      undefined,
      merge,
    );

    // Act
    render(<ReplacementBanner />);
    fireEvent.click(screen.getByText('Yes'));
    await new Promise((r) => setTimeout(r, 0));

    // Assert — success message mentions both transferred and skipped counts
    expect(screen.getByText(/transferred 100 readings/i)).toBeTruthy();
    expect(screen.getByText(/42 conflicts skipped/i)).toBeTruthy();
  });

  it('renders section with aria-label for accessibility', () => {
    // Arrange
    setHookResult([
      { id: 1, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: 0, conflictsToSkip: 0 },
    ]);

    // Act
    const { container } = render(<ReplacementBanner />);

    // Assert
    const section = container.querySelector('section[aria-label="Pending device replacements"]');
    expect(section).toBeTruthy();
  });
});
