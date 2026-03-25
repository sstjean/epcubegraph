import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns result on first success without retry', async () => {
    // Arrange
    const { withRetry } = await import('../../src/utils/retry');
    const fn = vi.fn().mockResolvedValue('ok');

    // Act
    const result = await withRetry(fn);

    // Assert
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error and succeeds', async () => {
    // Arrange
    const { withRetry, ApiError } = await import('../../src/utils/retry');
    const fn = vi.fn()
      .mockRejectedValueOnce(new ApiError('Server Error', 500))
      .mockResolvedValue('recovered');
    const onRetry = vi.fn();

    // Act
    const promise = withRetry(fn, { maxRetries: 10, onRetry });
    await vi.advanceTimersByTimeAsync(1000); // 1s backoff for attempt 1
    const result = await promise;

    // Assert
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(1);
  });

  it('retries on network error (no status)', async () => {
    // Arrange
    const { withRetry } = await import('../../src/utils/retry');
    const fn = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue('back');
    const onRetry = vi.fn();

    // Act
    const promise = withRetry(fn, { maxRetries: 10, onRetry });
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    // Assert
    expect(result).toBe('back');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(1);
  });

  it('does NOT retry on 4xx error (non-retryable)', async () => {
    // Arrange
    const { withRetry, ApiError } = await import('../../src/utils/retry');
    const fn = vi.fn().mockRejectedValue(new ApiError('Bad Request', 400));
    const onRetry = vi.fn();

    // Act & Assert
    await expect(withRetry(fn, { maxRetries: 10, onRetry })).rejects.toThrow('Bad Request');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('does NOT retry on auth error (401)', async () => {
    // Arrange
    const { withRetry, ApiError } = await import('../../src/utils/retry');
    const fn = vi.fn().mockRejectedValue(new ApiError('Unauthorized', 401));

    // Act & Assert
    await expect(withRetry(fn)).rejects.toThrow('Unauthorized');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after maxRetries exhausted', async () => {
    // Arrange
    const { withRetry, ApiError } = await import('../../src/utils/retry');
    const fn = vi.fn().mockRejectedValue(new ApiError('Server Error', 503));
    const onRetry = vi.fn();

    // Act
    const promise = withRetry(fn, { maxRetries: 3, onRetry });
    const caught = promise.catch((e: unknown) => e);

    // Advance through all 3 retry delays
    await vi.advanceTimersByTimeAsync(1000);  // retry 1: 1s
    await vi.advanceTimersByTimeAsync(2000);  // retry 2: 2s
    await vi.advanceTimersByTimeAsync(4000);  // retry 3: 4s

    // Assert
    const error = await caught;
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('Server Error');
    expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    expect(onRetry).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledWith(1);
    expect(onRetry).toHaveBeenCalledWith(2);
    expect(onRetry).toHaveBeenCalledWith(3);
  });

  it('uses exponential backoff (1s, 2s, 4s, 8s...)', async () => {
    // Arrange
    const { withRetry, ApiError } = await import('../../src/utils/retry');
    const fn = vi.fn()
      .mockRejectedValueOnce(new ApiError('fail', 500))
      .mockRejectedValueOnce(new ApiError('fail', 500))
      .mockRejectedValueOnce(new ApiError('fail', 500))
      .mockResolvedValue('ok');
    const onRetry = vi.fn();

    // Act
    const promise = withRetry(fn, { maxRetries: 10, onRetry });

    // Assert — first retry at 1s
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    // Second retry at 2s
    await vi.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(3);

    // Third retry at 4s
    await vi.advanceTimersByTimeAsync(4000);
    expect(fn).toHaveBeenCalledTimes(4);

    const result = await promise;
    expect(result).toBe('ok');
  });

  it('caps backoff at 30 seconds', async () => {
    // Arrange
    const { withRetry, ApiError } = await import('../../src/utils/retry');
    const fn = vi.fn().mockRejectedValue(new ApiError('fail', 500));
    const onRetry = vi.fn();

    // Act
    const promise = withRetry(fn, { maxRetries: 7, onRetry });
    const caught = promise.catch((e: unknown) => e);

    // Advance through delays: 1, 2, 4, 8, 16, 30 (capped), 30 (capped)
    await vi.advanceTimersByTimeAsync(1000);   // retry 1
    await vi.advanceTimersByTimeAsync(2000);   // retry 2
    await vi.advanceTimersByTimeAsync(4000);   // retry 3
    await vi.advanceTimersByTimeAsync(8000);   // retry 4
    await vi.advanceTimersByTimeAsync(16000);  // retry 5
    await vi.advanceTimersByTimeAsync(30000);  // retry 6: capped at 30s
    await vi.advanceTimersByTimeAsync(30000);  // retry 7: capped at 30s

    // Assert
    const error = await caught;
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('fail');
    expect(fn).toHaveBeenCalledTimes(8); // 1 initial + 7 retries
  });

  it('ApiError exposes status property', async () => {
    // Arrange
    const { ApiError } = await import('../../src/utils/retry');

    // Act
    const err = new ApiError('Not Found', 404);

    // Assert
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Not Found');
    expect(err.status).toBe(404);
    expect(err.name).toBe('ApiError');
  });

  it('isRetryableError returns true for network errors', async () => {
    // Arrange
    const { isRetryableError } = await import('../../src/utils/retry');

    // Act & Assert
    expect(isRetryableError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isRetryableError(new Error('network timeout'))).toBe(true);
  });

  it('isRetryableError returns true for 5xx ApiError', async () => {
    // Arrange
    const { isRetryableError, ApiError } = await import('../../src/utils/retry');

    // Act & Assert
    expect(isRetryableError(new ApiError('Internal', 500))).toBe(true);
    expect(isRetryableError(new ApiError('Bad Gateway', 502))).toBe(true);
    expect(isRetryableError(new ApiError('Unavailable', 503))).toBe(true);
  });

  it('isRetryableError returns false for 4xx ApiError', async () => {
    // Arrange
    const { isRetryableError, ApiError } = await import('../../src/utils/retry');

    // Act & Assert
    expect(isRetryableError(new ApiError('Bad Request', 400))).toBe(false);
    expect(isRetryableError(new ApiError('Unauthorized', 401))).toBe(false);
    expect(isRetryableError(new ApiError('Not Found', 404))).toBe(false);
  });

  it('defaults to maxRetries=10 when not specified', async () => {
    // Arrange
    const { withRetry, ApiError } = await import('../../src/utils/retry');
    const fn = vi.fn().mockRejectedValue(new ApiError('fail', 500));

    // Act
    const promise = withRetry(fn);
    // Attach catch immediately to prevent unhandled rejection
    const caught = promise.catch((e: unknown) => e);

    // Advance through all 10 retries
    for (let i = 0; i < 10; i++) {
      const ms = Math.min(1000 * Math.pow(2, i), 30000);
      await vi.advanceTimersByTimeAsync(ms);
    }

    // Assert
    const error = await caught;
    expect(error).toBeInstanceOf(ApiError);
    expect(fn).toHaveBeenCalledTimes(11); // 1 initial + 10 retries
  });
});
