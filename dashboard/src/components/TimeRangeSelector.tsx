import type { TimeRange, TimeRangeValue } from '../types';

interface TimeRangeSelectorProps {
  selected: TimeRange;
  onChange: (range: TimeRange, value: TimeRangeValue) => void;
}

const PRESETS: { key: TimeRange; label: string }[] = [
  { key: 'today', label: 'Today' },
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

export function TimeRangeSelector({ selected, onChange }: TimeRangeSelectorProps) {
  const handlePresetClick = (preset: TimeRange) => {
    onChange(preset, computePresetValue(preset));
  };

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
