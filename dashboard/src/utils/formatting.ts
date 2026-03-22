export function formatWatts(watts: number): string {
  if (watts == null || Number.isNaN(watts)) return '—';
  const abs = Math.abs(watts);
  if (abs >= 1_000_000) return `${(watts / 1_000_000).toFixed(1)} MW`;
  if (abs >= 1_000) return `${(watts / 1_000).toFixed(1)} kW`;
  return `${watts.toFixed(1)} W`;
}

export function formatKw(watts: number): string {
  if (watts == null || Number.isNaN(watts)) return '—';
  return `${(watts / 1_000).toFixed(1)} kW`;
}

export function formatPercent(value: number): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)}%`;
}

export function formatKwh(value: number): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)} kWh`;
}

export function formatTimestamp(epoch: number): string {
  if (epoch == null || Number.isNaN(epoch)) return '—';
  return new Date(epoch * 1000).toLocaleString();
}

export function formatRelativeTime(epoch: number): string {
  if (epoch == null || Number.isNaN(epoch)) return '—';
  const seconds = Math.floor(Date.now() / 1000 - epoch);
  if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)}d ago`;
  if (seconds >= 3_600) return `${Math.floor(seconds / 3_600)}h ago`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ago`;
  return `${seconds}s ago`;
}
