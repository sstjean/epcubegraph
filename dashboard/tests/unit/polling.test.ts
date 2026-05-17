import { describe, it, expect, vi } from 'vitest';

describe('polling', () => {
  it('DEFAULT_INTERVAL_MS equals 30000', async () => {
    // Arrange
    const { DEFAULT_INTERVAL_MS } = await import('../../src/utils/polling');

    // Act & Assert
    expect(DEFAULT_INTERVAL_MS).toBe(30_000);
  });

  it('createPollingInterval starts timer at 30000ms default (FR-012)', async () => {
    // Arrange
    vi.useFakeTimers();
    const { createPollingInterval, DEFAULT_INTERVAL_MS } = await import('../../src/utils/polling');
    const callback = vi.fn();

    // Act
    createPollingInterval(callback);
    vi.advanceTimersByTime(DEFAULT_INTERVAL_MS);

    // Assert
    expect(callback).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('callback executes at each interval', async () => {
    // Arrange
    vi.useFakeTimers();
    const { createPollingInterval, DEFAULT_INTERVAL_MS } = await import('../../src/utils/polling');
    const callback = vi.fn();
    createPollingInterval(callback);

    // Act
    vi.advanceTimersByTime(DEFAULT_INTERVAL_MS * 3);

    // Assert
    expect(callback).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('clearPollingInterval stops timer', async () => {
    // Arrange
    vi.useFakeTimers();
    const { createPollingInterval, clearPollingInterval, DEFAULT_INTERVAL_MS } =
      await import('../../src/utils/polling');
    const callback = vi.fn();
    const id = createPollingInterval(callback);

    // Act
    clearPollingInterval(id);
    vi.advanceTimersByTime(DEFAULT_INTERVAL_MS * 3);

    // Assert
    expect(callback).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('immediate option executes callback on start', async () => {
    // Arrange
    vi.useFakeTimers();
    const { createPollingInterval } = await import('../../src/utils/polling');
    const callback = vi.fn();

    // Act
    createPollingInterval(callback, undefined, true);

    // Assert
    expect(callback).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('custom interval is respected', async () => {
    // Arrange
    vi.useFakeTimers();
    const { createPollingInterval } = await import('../../src/utils/polling');
    const callback = vi.fn();
    const customInterval = 5000;

    // Act
    createPollingInterval(callback, customInterval);
    vi.advanceTimersByTime(5000);

    // Assert
    expect(callback).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
