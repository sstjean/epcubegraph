import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/preact';
import { h } from 'preact';

const mockFetchSettings = vi.fn();
const mockUpdateSetting = vi.fn();

vi.mock('../../src/api', () => ({
  fetchSettings: (...args: unknown[]) => mockFetchSettings(...args),
  updateSetting: (...args: unknown[]) => mockUpdateSetting(...args),
  fetchCurrentReadings: vi.fn(),
  fetchDevices: vi.fn(),
  fetchRangeReadings: vi.fn(),
  fetchGridPower: vi.fn(),
}));

import { SettingsPage } from '../../src/components/SettingsPage';

describe('SettingsPage — Polling Intervals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('Vue polling input is disabled with "Coming in Feature 005" label', async () => {
    // Arrange
    mockFetchSettings.mockResolvedValue({ settings: [] });

    // Act
    render(<SettingsPage />);

    // Assert
    await waitFor(() => {
      const vueInput = screen.getByLabelText(/Emporia Vue Polling Interval/i) as HTMLInputElement;
      expect(vueInput.disabled).toBe(true);
      const labels = screen.getAllByText(/Coming in Feature 005/i);
      expect(labels.length).toBeGreaterThanOrEqual(1);
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
      // 3 total: Vue polling + hierarchy + display names
      expect(comingSoon.length).toBe(3);
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
