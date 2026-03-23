export const DEFAULT_INTERVAL_MS = 5_000;

export function createPollingInterval(
  callback: () => void,
  intervalMs: number = DEFAULT_INTERVAL_MS,
  immediate?: boolean,
): ReturnType<typeof setInterval> {
  if (immediate) callback();
  return setInterval(callback, intervalMs);
}

export function clearPollingInterval(id: ReturnType<typeof setInterval>): void {
  clearInterval(id);
}
