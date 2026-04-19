import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trackException } from '../../src/telemetry';

vi.mock('../../src/telemetry', () => ({
  trackException: vi.fn(),
  trackApiError: vi.fn(),
  trackPageLoad: vi.fn(),
  initTelemetry: vi.fn(),
}));

const mockTrackException = trackException as ReturnType<typeof vi.fn>;

describe('toTrackedError', () => {
  beforeEach(function resetMocks() { vi.clearAllMocks(); });

  it('returns the original Error and tracks it', async () => {
    // Arrange
    const { toTrackedError } = await import('../../src/utils/errors');
    const original = new Error('original message');

    // Act
    const result = toTrackedError(original, 'fallback');

    // Assert
    expect(result).toBe(original);
    expect(result.message).toBe('original message');
    expect(mockTrackException).toHaveBeenCalledWith(original);
  });

  it('wraps non-Error into new Error with fallback message and tracks it', async () => {
    // Arrange
    const { toTrackedError } = await import('../../src/utils/errors');

    // Act
    const result = toTrackedError('string rejection', 'fallback msg');

    // Assert
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('fallback msg');
    expect(mockTrackException).toHaveBeenCalledWith(result);
  });

  it('handles null rejection', async () => {
    // Arrange
    const { toTrackedError } = await import('../../src/utils/errors');

    // Act
    const result = toTrackedError(null, 'null error');

    // Assert
    expect(result.message).toBe('null error');
    expect(mockTrackException).toHaveBeenCalled();
  });
});

describe('errorMessage', () => {
  it('returns Error.message for Error instances', async () => {
    // Arrange
    const { errorMessage } = await import('../../src/utils/errors');

    // Act
    const result = errorMessage(new Error('specific'), 'fallback');

    // Assert
    expect(result).toBe('specific');
  });

  it('returns fallback for non-Error values', async () => {
    // Arrange
    const { errorMessage } = await import('../../src/utils/errors');

    // Act
    const result = errorMessage('string', 'fallback');

    // Assert
    expect(result).toBe('fallback');
  });

  it('returns fallback for undefined', async () => {
    // Arrange
    const { errorMessage } = await import('../../src/utils/errors');

    // Act
    const result = errorMessage(undefined, 'fallback');

    // Assert
    expect(result).toBe('fallback');
  });

  it('returns empty string when Error.message is empty', async () => {
    // Arrange
    const { errorMessage } = await import('../../src/utils/errors');

    // Act
    const result = errorMessage(new Error(''), 'fallback');

    // Assert — empty message is still an Error, returns "" not fallback
    expect(result).toBe('');
  });
});
