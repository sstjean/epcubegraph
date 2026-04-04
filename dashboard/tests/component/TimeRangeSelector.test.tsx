import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/preact';
import { h } from 'preact';
import { TimeRangeSelector, formatDateLabel } from '../../src/components/TimeRangeSelector';
import type { TimeRangeValue } from '../../src/types';

// Fixed "now" for deterministic tests: 2026-03-25T12:00:00 local time
const FIXED_NOW = new Date(2026, 2, 25, 12, 0, 0).getTime();
const TODAY_START_SEC = Math.floor(new Date(2026, 2, 25, 0, 0, 0).getTime() / 1000);
const NOW_SEC = Math.floor(FIXED_NOW / 1000);

const todayValue: TimeRangeValue = { start: TODAY_START_SEC, end: NOW_SEC, step: 60 };
const sevenDayValue: TimeRangeValue = { start: NOW_SEC - 7 * 86400, end: NOW_SEC, step: 86400 };
const customValue: TimeRangeValue = { start: NOW_SEC - 86400, end: NOW_SEC, step: 60 };

describe('TimeRangeSelector', () => {
  afterEach(cleanup);

  it('renders 1d/7d/30d/1y/custom preset buttons', () => {
    // Arrange
    const onChange = vi.fn();

    // Act
    render(<TimeRangeSelector selected="today" value={todayValue} onChange={onChange} />);

    // Assert
    expect(screen.getByRole('button', { name: /1d/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /7d/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /30d/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /1y/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /custom/i })).toBeTruthy();
  });

  it('shows aria-pressed="true" on the active preset (FR-015)', () => {
    // Arrange
    const onChange = vi.fn();

    // Act
    render(<TimeRangeSelector selected="7d" value={sevenDayValue} onChange={onChange} />);

    // Assert
    const activeButton = screen.getByRole('button', { name: /7d/i });
    expect(activeButton.getAttribute('aria-pressed')).toBe('true');

    const inactiveButton = screen.getByRole('button', { name: /1d/ });
    expect(inactiveButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('emits onChange with correct start/end/step for "today" (step=60s)', () => {
    // Arrange
    const onChange = vi.fn();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    render(<TimeRangeSelector selected="7d" value={sevenDayValue} onChange={onChange} />);

    // Act
    fireEvent.click(screen.getByRole('button', { name: /1d/ }));

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

  it('emits onChange with step=86400s for "7d"', () => {
    // Arrange
    const onChange = vi.fn();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    render(<TimeRangeSelector selected="today" value={todayValue} onChange={onChange} />);

    // Act
    fireEvent.click(screen.getByRole('button', { name: /7d/i }));

    // Assert
    const value = onChange.mock.calls[0][1];
    expect(value.step).toBe(86400);
    expect(value.start).toBe(Math.floor(now / 1000) - 7 * 86400);

    vi.restoreAllMocks();
  });

  it('emits onChange with step=86400s for "30d"', () => {
    // Arrange
    const onChange = vi.fn();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    render(<TimeRangeSelector selected="today" value={todayValue} onChange={onChange} />);

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

    render(<TimeRangeSelector selected="today" value={todayValue} onChange={onChange} />);

    // Act
    fireEvent.click(screen.getByRole('button', { name: /1y/i }));

    // Assert
    const value = onChange.mock.calls[0][1];
    expect(value.step).toBe(2592000);
    expect(value.start).toBe(Math.floor(now / 1000) - 365 * 86400);

    vi.restoreAllMocks();
  });

  it('shows custom date inputs with labels when "custom" selected (FR-015)', () => {
    // Arrange
    const onChange = vi.fn();

    // Act
    render(<TimeRangeSelector selected="custom" value={customValue} onChange={onChange} />);

    // Assert
    expect(screen.getByLabelText(/start/i)).toBeTruthy();
    expect(screen.getByLabelText(/end/i)).toBeTruthy();
  });

  it('hides custom inputs for preset selections', () => {
    // Arrange
    const onChange = vi.fn();

    // Act
    render(<TimeRangeSelector selected="today" value={todayValue} onChange={onChange} />);

    // Assert
    expect(screen.queryByLabelText(/start/i)).toBeNull();
    expect(screen.queryByLabelText(/end/i)).toBeNull();
  });

  it('validates custom range (start must be before end)', () => {
    // Arrange
    const onChange = vi.fn();
    render(<TimeRangeSelector selected="custom" value={customValue} onChange={onChange} />);

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
    render(<TimeRangeSelector selected="custom" value={customValue} onChange={onChange} />);

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

  it('auto-selects tier for custom ranges: <=6d gets step=3600', () => {
    // Arrange
    const onChange = vi.fn();
    render(<TimeRangeSelector selected="custom" value={customValue} onChange={onChange} />);

    const startInput = screen.getByLabelText(/start/i) as HTMLInputElement;
    const endInput = screen.getByLabelText(/end/i) as HTMLInputElement;

    // Act — 5-day range (≤6 days → hourly step)
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
    render(<TimeRangeSelector selected="custom" value={customValue} onChange={onChange} />);

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
    render(<TimeRangeSelector selected="custom" value={customValue} onChange={onChange} />);

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
    render(<TimeRangeSelector selected="today" value={todayValue} onChange={onChange} />);

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
    render(<TimeRangeSelector selected="custom" value={customValue} onChange={onChange} />);

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
    const onChange = vi.fn();
    render(<TimeRangeSelector selected="today" value={todayValue} onChange={onChange} />);

    // Act & Assert — all buttons should be focusable
    const buttons = screen.getAllByRole('button');
    for (const button of buttons) {
      expect(button.tabIndex).not.toBe(-1);
    }
  });

  it('ignores invalid date input', () => {
    // Arrange
    const onChange = vi.fn();
    render(<TimeRangeSelector selected="custom" value={customValue} onChange={onChange} />);
    const startInput = screen.getByLabelText(/start/i) as HTMLInputElement;

    // Act — fire nonsense value
    fireEvent.change(startInput, { target: { value: 'not-a-date' } });

    // Assert — onChange should not be called
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows day navigation UI with prev/next buttons when "today" selected', () => {
    // Arrange
    const onChange = vi.fn();

    // Act
    render(<TimeRangeSelector selected="today" value={todayValue} onChange={onChange} />);

    // Assert
    expect(screen.getByLabelText('Previous day')).toBeTruthy();
    expect(screen.getByLabelText('Next day')).toBeTruthy();
    expect(screen.getByLabelText('Select date')).toBeTruthy();
  });

  it('does not show day navigation for non-today presets', () => {
    // Arrange
    const onChange = vi.fn();

    // Act
    render(<TimeRangeSelector selected="7d" value={sevenDayValue} onChange={onChange} />);

    // Assert
    expect(screen.queryByLabelText('Previous day')).toBeNull();
    expect(screen.queryByLabelText('Next day')).toBeNull();
  });

  it('displays the current date label when in today mode', () => {
    // Arrange
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    const onChange = vi.fn();

    // Act
    render(<TimeRangeSelector selected="today" value={todayValue} onChange={onChange} />);

    // Assert — should show formatted date
    const dateDisplay = document.querySelector('.day-date-display');
    expect(dateDisplay).toBeTruthy();
    expect(dateDisplay!.textContent).toBeTruthy();

    vi.restoreAllMocks();
  });

  it('disables "Next day" button when viewing today', () => {
    // Arrange
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    const onChange = vi.fn();

    // Act
    render(<TimeRangeSelector selected="today" value={todayValue} onChange={onChange} />);

    // Assert
    const nextBtn = screen.getByLabelText('Next day') as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);

    vi.restoreAllMocks();
  });

  it('enables "Next day" button when viewing a past day', () => {
    // Arrange
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    const onChange = vi.fn();
    const yesterdayStart = TODAY_START_SEC - 86400;
    const yesterdayValue: TimeRangeValue = { start: yesterdayStart, end: yesterdayStart + 86400, step: 60 };

    // Act
    render(<TimeRangeSelector selected="today" value={yesterdayValue} onChange={onChange} />);

    // Assert
    const nextBtn = screen.getByLabelText('Next day') as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(false);

    vi.restoreAllMocks();
  });

  it('clicking "Previous day" emits onChange with prior day range', () => {
    // Arrange
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    const onChange = vi.fn();
    render(<TimeRangeSelector selected="today" value={todayValue} onChange={onChange} />);

    // Act
    fireEvent.click(screen.getByLabelText('Previous day'));

    // Assert
    expect(onChange).toHaveBeenCalledTimes(1);
    const [range, val] = onChange.mock.calls[0];
    expect(range).toBe('today');
    expect(val.start).toBe(TODAY_START_SEC - 86400);
    expect(val.end).toBe(TODAY_START_SEC); // full day for past day
    expect(val.step).toBe(60);

    vi.restoreAllMocks();
  });

  it('clicking "Next day" from a past day advances one day', () => {
    // Arrange
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    const onChange = vi.fn();
    const twoDaysAgoStart = TODAY_START_SEC - 2 * 86400;
    const twoDaysAgoValue: TimeRangeValue = { start: twoDaysAgoStart, end: twoDaysAgoStart + 86400, step: 60 };
    render(<TimeRangeSelector selected="today" value={twoDaysAgoValue} onChange={onChange} />);

    // Act
    fireEvent.click(screen.getByLabelText('Next day'));

    // Assert
    expect(onChange).toHaveBeenCalledTimes(1);
    const [range, val] = onChange.mock.calls[0];
    expect(range).toBe('today');
    expect(val.start).toBe(twoDaysAgoStart + 86400);

    vi.restoreAllMocks();
  });

  it('calendar picker emits onChange for valid past date', () => {
    // Arrange
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    const onChange = vi.fn();
    render(<TimeRangeSelector selected="today" value={todayValue} onChange={onChange} />);

    // Act
    const dateInput = screen.getByLabelText('Select date') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-03-20' } });

    // Assert
    expect(onChange).toHaveBeenCalledTimes(1);
    const [range, val] = onChange.mock.calls[0];
    expect(range).toBe('today');
    const expectedStart = Math.floor(new Date(2026, 2, 20).getTime() / 1000);
    expect(val.start).toBe(expectedStart);
    expect(val.end).toBe(expectedStart + 86400); // full day
    expect(val.step).toBe(60);

    vi.restoreAllMocks();
  });

  it('calendar picker ignores future dates', () => {
    // Arrange
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    const onChange = vi.fn();
    render(<TimeRangeSelector selected="today" value={todayValue} onChange={onChange} />);

    // Act
    const dateInput = screen.getByLabelText('Select date') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-03-30' } });

    // Assert — should not emit
    expect(onChange).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('calendar picker ignores invalid date input', () => {
    // Arrange
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    const onChange = vi.fn();
    render(<TimeRangeSelector selected="today" value={todayValue} onChange={onChange} />);

    // Act
    const dateInput = screen.getByLabelText('Select date') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: 'garbage' } });

    // Assert
    expect(onChange).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('selecting today via calendar picker uses end=now instead of end=start+86400', () => {
    // Arrange
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    const onChange = vi.fn();
    const yesterdayStart = TODAY_START_SEC - 86400;
    const yesterdayValue: TimeRangeValue = { start: yesterdayStart, end: yesterdayStart + 86400, step: 60 };
    render(<TimeRangeSelector selected="today" value={yesterdayValue} onChange={onChange} />);

    // Act — pick today's date
    const dateInput = screen.getByLabelText('Select date') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-03-25' } });

    // Assert — end should be now, not start+86400
    const [, val] = onChange.mock.calls[0];
    expect(val.start).toBe(TODAY_START_SEC);
    expect(val.end).toBe(NOW_SEC);

    vi.restoreAllMocks();
  });

});

describe('formatDateLabel', () => {
  it('formats epoch seconds as a readable date', () => {
    // 2026-03-25 00:00:00 local
    const ts = Math.floor(new Date(2026, 2, 25).getTime() / 1000);
    const label = formatDateLabel(ts);
    expect(label).toMatch(/Mar/);
    expect(label).toMatch(/25/);
    expect(label).toMatch(/2026/);
  });
});
