import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('DEFAULT_INTERVAL_MS equals 30000', async () => {
    // Arrange
    const { DEFAULT_INTERVAL_MS } = await import('../../src/utils/polling');

    // Act & Assert
    expect(DEFAULT_INTERVAL_MS).toBe(30_000);
  });

  it('createPollingInterval starts timer at 30000ms default (FR-012)', async () => {
    // Arrange
    const { createPollingInterval, DEFAULT_INTERVAL_MS } = await import('../../src/utils/polling');
    const callback = vi.fn();

    // Act
    createPollingInterval(callback);
    vi.advanceTimersByTime(DEFAULT_INTERVAL_MS);

    // Assert
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('callback executes at each interval', async () => {
    // Arrange
    const { createPollingInterval, DEFAULT_INTERVAL_MS } = await import('../../src/utils/polling');
    const callback = vi.fn();
    createPollingInterval(callback);

    // Act
    vi.advanceTimersByTime(DEFAULT_INTERVAL_MS * 3);

    // Assert
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('clearPollingInterval stops timer', async () => {
    // Arrange
    const { createPollingInterval, clearPollingInterval, DEFAULT_INTERVAL_MS } =
      await import('../../src/utils/polling');
    const callback = vi.fn();
    const id = createPollingInterval(callback);

    // Act
    clearPollingInterval(id);
    vi.advanceTimersByTime(DEFAULT_INTERVAL_MS * 3);

    // Assert
    expect(callback).not.toHaveBeenCalled();
  });

  it('immediate option executes callback on start', async () => {
    // Arrange
    const { createPollingInterval } = await import('../../src/utils/polling');
    const callback = vi.fn();

    // Act
    createPollingInterval(callback, undefined, true);

    // Assert
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('custom interval is respected', async () => {
    // Arrange
    const { createPollingInterval } = await import('../../src/utils/polling');
    const callback = vi.fn();
    const customInterval = 5000;

    // Act
    createPollingInterval(callback, customInterval);
    vi.advanceTimersByTime(5000);

    // Assert
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
