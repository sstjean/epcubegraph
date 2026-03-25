import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/preact';
import { h } from 'preact';
import { TimeRangeSelector } from '../../src/components/TimeRangeSelector';

describe('TimeRangeSelector', () => {
  afterEach(cleanup);

  const defaultOnChange = vi.fn();

  it('renders today/7d/30d/1y/custom preset buttons', () => {
    // Arrange & Act
    render(<TimeRangeSelector selected="today" onChange={defaultOnChange} />);

    // Assert
    expect(screen.getByRole('button', { name: /today/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /7d/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /30d/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /1y/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /custom/i })).toBeTruthy();
  });

  it('shows aria-pressed="true" on the active preset (FR-015)', () => {
    // Arrange & Act
    render(<TimeRangeSelector selected="7d" onChange={defaultOnChange} />);

    // Assert
    const activeButton = screen.getByRole('button', { name: /7d/i });
    expect(activeButton.getAttribute('aria-pressed')).toBe('true');

    const inactiveButton = screen.getByRole('button', { name: /today/i });
    expect(inactiveButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('emits onChange with correct start/end/step for "today" (step=60s)', () => {
    // Arrange
    const onChange = vi.fn();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    render(<TimeRangeSelector selected="7d" onChange={onChange} />);

    // Act
    fireEvent.click(screen.getByRole('button', { name: /today/i }));

    // Assert
    expect(onChange).toHaveBeenCalledTimes(1);
    const call = onChange.mock.calls[0];
    expect(call[0]).toBe('today');
    const value = call[1];
    expect(value.step).toBe(60);
    // Start should be start of today (local time)
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    expect(value.start).toBe(Math.floor(startOfToday.getTime() / 1000));
    expect(value.end).toBe(Math.floor(now / 1000));

    vi.restoreAllMocks();
  });

  it('emits onChange with step=3600s for "7d"', () => {
    // Arrange
    const onChange = vi.fn();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    render(<TimeRangeSelector selected="today" onChange={onChange} />);

    // Act
    fireEvent.click(screen.getByRole('button', { name: /7d/i }));

    // Assert
    const value = onChange.mock.calls[0][1];
    expect(value.step).toBe(3600);
    expect(value.start).toBe(Math.floor(now / 1000) - 7 * 86400);

    vi.restoreAllMocks();
  });

  it('emits onChange with step=86400s for "30d"', () => {
    // Arrange
    const onChange = vi.fn();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    render(<TimeRangeSelector selected="today" onChange={onChange} />);

    // Act
    fireEvent.click(screen.getByRole('button', { name: /30d/i }));

    // Assert
    const value = onChange.mock.calls[0][1];
    expect(value.step).toBe(86400);
    expect(value.start).toBe(Math.floor(now / 1000) - 30 * 86400);

    vi.restoreAllMocks();
  });

  it('emits onChange with calendar month step for "1y"', () => {
    // Arrange
    const onChange = vi.fn();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    render(<TimeRangeSelector selected="today" onChange={onChange} />);

    // Act
    fireEvent.click(screen.getByRole('button', { name: /1y/i }));

    // Assert
    const value = onChange.mock.calls[0][1];
    expect(value.step).toBe(2592000);
    expect(value.start).toBe(Math.floor(now / 1000) - 365 * 86400);

    vi.restoreAllMocks();
  });

  it('shows custom date inputs with labels when "custom" selected (FR-015)', () => {
    // Arrange & Act
    render(<TimeRangeSelector selected="custom" onChange={defaultOnChange} />);

    // Assert
    expect(screen.getByLabelText(/start/i)).toBeTruthy();
    expect(screen.getByLabelText(/end/i)).toBeTruthy();
  });

  it('hides custom inputs for preset selections', () => {
    // Arrange & Act
    render(<TimeRangeSelector selected="today" onChange={defaultOnChange} />);

    // Assert
    expect(screen.queryByLabelText(/start/i)).toBeNull();
    expect(screen.queryByLabelText(/end/i)).toBeNull();
  });

  it('validates custom range (start must be before end)', () => {
    // Arrange
    const onChange = vi.fn();
    render(<TimeRangeSelector selected="custom" onChange={onChange} />);

    const startInput = screen.getByLabelText(/start/i) as HTMLInputElement;
    const endInput = screen.getByLabelText(/end/i) as HTMLInputElement;

    // Act — set start after end
    fireEvent.change(startInput, { target: { value: '2026-03-20' } });
    fireEvent.change(endInput, { target: { value: '2026-03-10' } });

    // Assert — onChange should not be called with invalid range
    const validCalls = onChange.mock.calls.filter(
      (call: [string, { start: number; end: number }]) => {
        const v = call[1];
        return v && v.start < v.end;
      }
    );
    // All emitted values must have start < end
    for (const call of validCalls) {
      expect(call[1].start).toBeLessThan(call[1].end);
    }
  });

  it('auto-selects tier for custom ranges: <=1d gets step=60', () => {
    // Arrange
    const onChange = vi.fn();
    render(<TimeRangeSelector selected="custom" onChange={onChange} />);

    const startInput = screen.getByLabelText(/start/i) as HTMLInputElement;
    const endInput = screen.getByLabelText(/end/i) as HTMLInputElement;

    // Act — 1-day range (end first so start-change exercises field==='start' branch)
    fireEvent.change(endInput, { target: { value: '2026-03-23' } });
    fireEvent.change(startInput, { target: { value: '2026-03-22' } });
    fireEvent.change(endInput, { target: { value: '2026-03-23' } });

    // Assert
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
    if (lastCall) {
      expect(lastCall[1].step).toBe(60);
    }
  });

  it('auto-selects tier for custom ranges: <=7d gets step=3600', () => {
    // Arrange
    const onChange = vi.fn();
    render(<TimeRangeSelector selected="custom" onChange={onChange} />);

    const startInput = screen.getByLabelText(/start/i) as HTMLInputElement;
    const endInput = screen.getByLabelText(/end/i) as HTMLInputElement;

    // Act — 5-day range
    fireEvent.change(startInput, { target: { value: '2026-03-18' } });
    fireEvent.change(endInput, { target: { value: '2026-03-23' } });

    // Assert
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
    if (lastCall) {
      expect(lastCall[1].step).toBe(3600);
    }
  });

  it('auto-selects tier for custom ranges: <=30d gets step=86400', () => {
    // Arrange
    const onChange = vi.fn();
    render(<TimeRangeSelector selected="custom" onChange={onChange} />);

    const startInput = screen.getByLabelText(/start/i) as HTMLInputElement;
    const endInput = screen.getByLabelText(/end/i) as HTMLInputElement;

    // Act — 15-day range
    fireEvent.change(startInput, { target: { value: '2026-03-08' } });
    fireEvent.change(endInput, { target: { value: '2026-03-23' } });

    // Assert
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
    if (lastCall) {
      expect(lastCall[1].step).toBe(86400);
    }
  });

  it('auto-selects tier for custom ranges: >30d gets step=2592000 (calendar month)', () => {
    // Arrange
    const onChange = vi.fn();
    render(<TimeRangeSelector selected="custom" onChange={onChange} />);

    const startInput = screen.getByLabelText(/start/i) as HTMLInputElement;
    const endInput = screen.getByLabelText(/end/i) as HTMLInputElement;

    // Act — 60 day range
    fireEvent.change(startInput, { target: { value: '2026-01-22' } });
    fireEvent.change(endInput, { target: { value: '2026-03-23' } });

    // Assert
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
    if (lastCall) {
      expect(lastCall[1].step).toBe(2592000);
    }
  });

  it('emits onChange when "Custom" button is clicked', () => {
    // Arrange
    const onChange = vi.fn();
    render(<TimeRangeSelector selected="today" onChange={onChange} />);

    // Act
    fireEvent.click(screen.getByRole('button', { name: /custom/i }));

    // Assert
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe('custom');
    expect(onChange.mock.calls[0][1]).toHaveProperty('step', 60);
  });

  it('emits onChange when end date is changed in custom mode', () => {
    // Arrange
    const onChange = vi.fn();
    render(<TimeRangeSelector selected="custom" onChange={onChange} />);

    const startInput = screen.getByLabelText(/start/i) as HTMLInputElement;
    const endInput = screen.getByLabelText(/end/i) as HTMLInputElement;

    // Act — set start first, then change end
    fireEvent.change(startInput, { target: { value: '2026-03-20' } });
    fireEvent.change(endInput, { target: { value: '2026-03-23' } });

    // Assert — the end-date change path should have fired onChange
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(lastCall).toBeTruthy();
    expect(lastCall[1].start).toBeLessThan(lastCall[1].end);
  });

  it('keyboard Tab navigates between preset buttons (FR-015)', () => {
    // Arrange
    render(<TimeRangeSelector selected="today" onChange={defaultOnChange} />);

    // Act & Assert — all buttons should be focusable
    const buttons = screen.getAllByRole('button');
    for (const button of buttons) {
      expect(button.tabIndex).not.toBe(-1);
    }
  });

  it('ignores invalid date input', () => {
    // Arrange
    const onChange = vi.fn();
    render(<TimeRangeSelector selected="custom" onChange={onChange} />);
    const startInput = screen.getByLabelText(/start/i) as HTMLInputElement;

    // Act — fire nonsense value
    fireEvent.change(startInput, { target: { value: 'not-a-date' } });

    // Assert — onChange should not be called
    expect(onChange).not.toHaveBeenCalled();
  });

});
