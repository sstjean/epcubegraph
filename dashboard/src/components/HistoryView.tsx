import { useState } from 'preact/hooks';
import { TimeRangeSelector } from './TimeRangeSelector';
import { HistoricalGraph } from './HistoricalGraph';
import type { TimeRange, TimeRangeValue } from '../types';

function computeInitialValue(): TimeRangeValue {
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const startOfToday = new Date(nowMs);
  startOfToday.setHours(0, 0, 0, 0);
  return { start: Math.floor(startOfToday.getTime() / 1000), end: nowSec, step: 60 };
}

export function HistoryView() {
  const [selectedRange, setSelectedRange] = useState<TimeRange>('today');
  const [timeRangeValue, setTimeRangeValue] = useState<TimeRangeValue>(computeInitialValue);

  const handleChange = (range: TimeRange, value: TimeRangeValue) => {
    setSelectedRange(range);
    setTimeRangeValue(value);
  };

  return (
    <section>
      <h2>Historical Data</h2>
      <TimeRangeSelector selected={selectedRange} onChange={handleChange} />
      <HistoricalGraph timeRange={timeRangeValue} />
    </section>
  );
}
