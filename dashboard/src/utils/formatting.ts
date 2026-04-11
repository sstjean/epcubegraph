export function formatWatts(watts: number): string {
  if (watts == null || Number.isNaN(watts)) return '—';
  const abs = Math.abs(watts);
  if (abs >= 1_000_000) return `${(watts / 1_000_000).toFixed(3)} MW`;
  if (abs >= 1_000) return `${(watts / 1_000).toFixed(3)} kW`;
  const rounded = Math.round(watts);
  return `${Object.is(rounded, -0) ? 0 : rounded} W`;
}

/** 1-decimal axis labels for readability. Tooltip uses formatWatts (whole W / 3-decimal kW). */
export function formatWattsAxis(watts: number): string {
  if (watts == null || Number.isNaN(watts)) return '—';
  const abs = Math.abs(watts);
  if (abs >= 1_000_000) return `${(watts / 1_000_000).toFixed(1)} MW`;
  if (abs >= 1_000) return `${(watts / 1_000).toFixed(1)} kW`;
  return `${watts} W`;
}

export function formatKw(watts: number): string {
  if (watts == null || Number.isNaN(watts)) return '—';
  return `${(watts / 1_000).toFixed(3)} kW`;
}

export function formatPercent(value: number): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)}%`;
}

export function formatKwh(value: number): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(3)} kWh`;
}

export function formatRelativeTime(epoch: number): string {
  if (epoch == null || Number.isNaN(epoch)) return '—';
  const seconds = Math.floor(Date.now() / 1000 - epoch);
  if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)}d ago`;
  if (seconds >= 3_600) return `${Math.floor(seconds / 3_600)}h ago`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ago`;
  return `${seconds}s ago`;
}
