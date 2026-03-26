import type { TimeRange, TimeRangeValue } from '../types';

interface TimeRangeSelectorProps {
  selected: TimeRange;
  value: TimeRangeValue;
  onChange: (range: TimeRange, value: TimeRangeValue) => void;
}

const PRESETS: { key: TimeRange; label: string }[] = [
  { key: 'today', label: '1d' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: '1y', label: '1y' },
  { key: 'custom', label: 'Custom' },
];

/** Calculate tiered step based on duration in seconds. */
function calculateStep(durationSec: number): number {
  if (durationSec <= 86400) return 60;         // ≤1d → 1-minute resolution
  if (durationSec <= 7 * 86400) return 3600;   // ≤7d → hourly
  if (durationSec <= 30 * 86400) return 86400;  // ≤30d → daily
  return 2592000;                                // >30d → calendar month (~30d)
}

function computePresetValue(preset: TimeRange): TimeRangeValue {
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);

  switch (preset) {
    case 'today': {
      const startOfToday = new Date(nowMs);
      startOfToday.setHours(0, 0, 0, 0);
      return { start: Math.floor(startOfToday.getTime() / 1000), end: nowSec, step: 60 };
    }
    case '7d':
      return { start: nowSec - 7 * 86400, end: nowSec, step: 3600 };
    case '30d':
      return { start: nowSec - 30 * 86400, end: nowSec, step: 86400 };
    case '1y':
      return { start: nowSec - 365 * 86400, end: nowSec, step: 2592000 };
    case 'custom':
      return { start: nowSec - 86400, end: nowSec, step: 60 };
  }
}

/** Format a unix timestamp (seconds) as YYYY-MM-DD in local time. */
function toDateString(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Format a unix timestamp as a human-readable date label (e.g., "Mar 25, 2026"). */
export function formatDateLabel(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

/** Compute a single-day TimeRangeValue for a given date string (YYYY-MM-DD). */
function computeDayValue(dateStr: string): TimeRangeValue {
  const dayStart = new Date(dateStr + 'T00:00:00');
  const startSec = Math.floor(dayStart.getTime() / 1000);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartSec = Math.floor(todayStart.getTime() / 1000);

  // If the selected day is today, end = now; otherwise end = start + 86400
  const isToday = startSec === todayStartSec;
  const endSec = isToday ? Math.floor(Date.now() / 1000) : startSec + 86400;
  return { start: startSec, end: endSec, step: 60 };
}

export function TimeRangeSelector({ selected, value, onChange }: TimeRangeSelectorProps) {
  const handlePresetClick = (preset: TimeRange) => {
    onChange(preset, computePresetValue(preset));
  };

  const handleDayNav = (direction: -1 | 1) => {
    const currentDateStr = toDateString(value.start);
    const d = new Date(currentDateStr + 'T00:00:00');
    d.setDate(d.getDate() + direction);
    const newDateStr = toDateString(Math.floor(d.getTime() / 1000));
    onChange('today', computeDayValue(newDateStr));
  };

  const handleDayPickerChange = (dateStr: string) => {
    const parsed = new Date(dateStr + 'T00:00:00');
    if (isNaN(parsed.getTime())) return;
    // Don't allow future dates
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    if (parsed > todayStart) return;
    onChange('today', computeDayValue(dateStr));
  };

  const isViewingToday = selected === 'today' && (() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return value.start === Math.floor(todayStart.getTime() / 1000);
  })();

  const handleCustomChange = (field: 'start' | 'end', dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    if (isNaN(date.getTime())) return;

    const otherInput = field === 'start'
      ? document.querySelector<HTMLInputElement>('input[aria-label="End date"]')
      : document.querySelector<HTMLInputElement>('input[aria-label="Start date"]');
    const otherStr = otherInput?.value;

    if (!otherStr) return;
    const otherDate = new Date(otherStr + 'T00:00:00');

    let startSec: number;
    let endSec: number;
    if (field === 'start') {
      startSec = Math.floor(date.getTime() / 1000);
      endSec = Math.floor(otherDate.getTime() / 1000);
    } else {
      startSec = Math.floor(otherDate.getTime() / 1000);
      endSec = Math.floor(date.getTime() / 1000);
    }

    // Validate start < end (also catches NaN from invalid otherDate)
    if (!(startSec < endSec)) return;

    const duration = endSec - startSec;
    onChange('custom', { start: startSec, end: endSec, step: calculateStep(duration) });
  };

  return (
    <div class="time-range-selector" role="group" aria-label="Time range">
      <div class="time-range-presets">
        {PRESETS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={selected === key ? 'true' : 'false'}
            class={selected === key ? 'active' : ''}
            onClick={() => handlePresetClick(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {selected === 'today' && (
        <div class="day-navigation">
          <button
            type="button"
            aria-label="Previous day"
            onClick={() => handleDayNav(-1)}
          >
            &lt;
          </button>
          <label class="day-picker-label">
            <span class="day-date-display">{formatDateLabel(value.start)}</span>
            <input
              type="date"
              class="day-picker-input"
              aria-label="Select date"
              value={toDateString(value.start)}
              max={toDateString(Math.floor(Date.now() / 1000))}
              onChange={(e) => handleDayPickerChange((e.target as HTMLInputElement).value)}
            />
          </label>
          <button
            type="button"
            aria-label="Next day"
            disabled={isViewingToday}
            onClick={() => handleDayNav(1)}
          >
            &gt;
          </button>
        </div>
      )}
      {selected === 'custom' && (
        <div class="time-range-custom">
          <label>
            Start date
            <input
              type="date"
              aria-label="Start date"
              onChange={(e) => handleCustomChange('start', (e.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            End date
            <input
              type="date"
              aria-label="End date"
              onChange={(e) => handleCustomChange('end', (e.target as HTMLInputElement).value)}
            />
          </label>
        </div>
      )}
    </div>
  );
}
