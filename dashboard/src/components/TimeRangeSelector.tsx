import { useState } from 'preact/hooks';
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

function getNowMs(): number {
  return Date.now();
}

/** Calculate tiered step based on duration in seconds. */
function calculateStep(durationSec: number): number {
  if (durationSec <= 86400) return 60;           // ≤1d → 1-minute resolution
  if (durationSec <= 6 * 86400) return 3600;     // ≤6d → hourly (line chart)
  if (durationSec <= 30 * 86400) return 86400;   // ≤30d → daily (bar chart)
  return 2592000;                                 // >30d → by calendar month
}

function computePresetValue(preset: TimeRange): TimeRangeValue {
  const nowMs = getNowMs();
  const nowSec = Math.floor(nowMs / 1000);

  switch (preset) {
    case 'today': {
      const startOfToday = new Date(nowMs);
      startOfToday.setHours(0, 0, 0, 0);
      return { start: Math.floor(startOfToday.getTime() / 1000), end: nowSec, step: 60 };
    }
    case '7d':
      return { start: nowSec - 7 * 86400, end: nowSec, step: 86400 };
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
  const todayStart = new Date(getNowMs());
  todayStart.setHours(0, 0, 0, 0);
  const todayStartSec = Math.floor(todayStart.getTime() / 1000);

  // If the selected day is today, end = now; otherwise end = start + 86400
  const isToday = startSec === todayStartSec;
  const endSec = isToday ? Math.floor(getNowMs() / 1000) : startSec + 86400;
  return { start: startSec, end: endSec, step: 60 };
}

export function TimeRangeSelector({ selected, value, onChange }: TimeRangeSelectorProps) {
  const [customStart, setCustomStart] = useState(() =>
    selected === 'custom' ? toDateString(value.start) : ''
  );
  const [customEnd, setCustomEnd] = useState(() =>
    selected === 'custom' ? toDateString(value.end) : ''
  );

  const handlePresetClick = (preset: TimeRange) => {
    const presetValue = computePresetValue(preset);
    if (preset === 'custom') {
      setCustomStart(toDateString(presetValue.start));
      setCustomEnd(toDateString(presetValue.end));
    }
    onChange(preset, presetValue);
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
    const todayStart = new Date(getNowMs());
    todayStart.setHours(0, 0, 0, 0);
    if (parsed > todayStart) return;
    onChange('today', computeDayValue(dateStr));
  };

  const isViewingToday = selected === 'today' && (() => {
    const todayStart = new Date(getNowMs());
    todayStart.setHours(0, 0, 0, 0);
    return value.start === Math.floor(todayStart.getTime() / 1000);
  })();

  const handleCustomChange = (field: 'start' | 'end', dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    if (isNaN(date.getTime())) return;

    const newStart = field === 'start' ? dateStr : customStart;
    const newEnd = field === 'end' ? dateStr : customEnd;

    if (field === 'start') setCustomStart(dateStr);
    else setCustomEnd(dateStr);

    const startSec = Math.floor(new Date(newStart + 'T00:00:00').getTime() / 1000);
    const endSec = Math.floor(new Date(newEnd + 'T00:00:00').getTime() / 1000);

    // Validate start < end
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
              max={toDateString(Math.floor(getNowMs() / 1000))}
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
              value={customStart}
              onChange={(e) => handleCustomChange('start', (e.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            End date
            <input
              type="date"
              aria-label="End date"
              value={customEnd}
              onChange={(e) => handleCustomChange('end', (e.target as HTMLInputElement).value)}
            />
          </label>
        </div>
      )}
    </div>
  );
}
