import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { h } from 'preact';

vi.mock('../../src/hooks/useDeviceDiscovery', () => ({
  useDeviceDiscovery: vi.fn(),
}));

import { useDeviceDiscovery } from '../../src/hooks/useDeviceDiscovery';
import { ReplacementBanner } from '../../src/components/ReplacementBanner';

const mockHook = useDeviceDiscovery as ReturnType<typeof vi.fn>;

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

  it('shows old/new device IDs and reading counts', () => {
    // Arrange
    setHookResult([
      { id: 1, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: 12345, conflictsToSkip: 7 },
    ]);

    // Act
    render(<ReplacementBanner />);

    // Assert
    expect(screen.getByText('100')).toBeTruthy();
    expect(screen.getByText('200')).toBeTruthy();
    expect(screen.getByText(/12,345/)).toBeTruthy();
    expect(screen.getByText(/7/)).toBeTruthy();
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

  it('shows Merge and Dismiss buttons', () => {
    // Arrange
    setHookResult([
      { id: 1, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: 1, conflictsToSkip: 0 },
    ]);

    // Act
    render(<ReplacementBanner />);

    // Assert
    expect(screen.getByText('Merge')).toBeTruthy();
    expect(screen.getByText('Dismiss')).toBeTruthy();
  });

  it('clicking Dismiss calls hook.dismiss with the pending id', async () => {
    // Arrange
    const { dismiss } = setHookResult([
      { id: 42, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: 1, conflictsToSkip: 0 },
    ]);

    // Act
    render(<ReplacementBanner />);
    fireEvent.click(screen.getByText('Dismiss'));
    await Promise.resolve();

    // Assert
    expect(dismiss).toHaveBeenCalledWith(42);
  });

  it('clicking Merge calls hook.merge and shows success feedback', async () => {
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
    fireEvent.click(screen.getByText('Merge'));
    await new Promise((r) => setTimeout(r, 0));

    // Assert
    expect(merge).toHaveBeenCalledWith(7, '100', '200');
    expect(screen.getByText(/transferred 5,432 readings/i)).toBeTruthy();
  });

  it('shows error feedback when Merge fails', async () => {
    // Arrange
    const merge = vi.fn().mockRejectedValue(new Error('Database busy'));
    setHookResult(
      [{ id: 7, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: 1, conflictsToSkip: 0 }],
      undefined,
      merge,
    );

    // Act
    render(<ReplacementBanner />);
    fireEvent.click(screen.getByText('Merge'));
    await new Promise((r) => setTimeout(r, 0));

    // Assert
    expect(screen.getByText(/Database busy/i)).toBeTruthy();
  });

  it('shows error feedback when Dismiss fails', async () => {
    // Arrange
    const dismiss = vi.fn().mockRejectedValue(new Error('Cannot dismiss'));
    setHookResult(
      [{ id: 1, old_device_id: '100', new_device_id: '200', detected_at: '', readingsToTransfer: 1, conflictsToSkip: 0 }],
      dismiss,
    );

    // Act
    render(<ReplacementBanner />);
    fireEvent.click(screen.getByText('Dismiss'));
    await new Promise((r) => setTimeout(r, 0));

    // Assert
    expect(screen.getByText(/Cannot dismiss/i)).toBeTruthy();
  });
});
