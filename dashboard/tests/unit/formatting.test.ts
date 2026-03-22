import { describe, it, expect } from 'vitest';

describe('formatting', () => {
  describe('formatWatts', () => {
    it('formats watts below 1000 as W', async () => {
      // Arrange
      const { formatWatts } = await import('../../src/utils/formatting');

      // Act
      const result = formatWatts(500);

      // Assert
      expect(result).toBe('500.0 W');
    });

    it('auto-scales to kW for values >= 1000', async () => {
      // Arrange
      const { formatWatts } = await import('../../src/utils/formatting');

      // Act
      const result = formatWatts(1500);

      // Assert
      expect(result).toBe('1.5 kW');
    });

    it('auto-scales to MW for values >= 1000000', async () => {
      // Arrange
      const { formatWatts } = await import('../../src/utils/formatting');

      // Act
      const result = formatWatts(2500000);

      // Assert
      expect(result).toBe('2.5 MW');
    });

    it('handles negative watts correctly', async () => {
      // Arrange
      const { formatWatts } = await import('../../src/utils/formatting');

      // Act
      const result = formatWatts(-1500);

      // Assert
      expect(result).toBe('-1.5 kW');
    });

    it('returns "—" for NaN', async () => {
      // Arrange
      const { formatWatts } = await import('../../src/utils/formatting');

      // Act
      const result = formatWatts(NaN);

      // Assert
      expect(result).toBe('—');
    });

    it('returns "—" for null', async () => {
      // Arrange
      const { formatWatts } = await import('../../src/utils/formatting');

      // Act
      const result = formatWatts(null as unknown as number);

      // Assert
      expect(result).toBe('—');
    });

    it('formats zero as 0.0 W', async () => {
      // Arrange
      const { formatWatts } = await import('../../src/utils/formatting');

      // Act
      const result = formatWatts(0);

      // Assert
      expect(result).toBe('0.0 W');
    });
  });

  describe('formatKw', () => {
    it('always formats in kW', async () => {
      const { formatKw } = await import('../../src/utils/formatting');
      expect(formatKw(500)).toBe('0.5 kW');
      expect(formatKw(1500)).toBe('1.5 kW');
      expect(formatKw(60)).toBe('0.1 kW');
      expect(formatKw(0)).toBe('0.0 kW');
    });

    it('returns — for NaN', async () => {
      const { formatKw } = await import('../../src/utils/formatting');
      expect(formatKw(NaN)).toBe('—');
    });
  });

  describe('formatPercent', () => {
    it('formats 0-100 with % suffix', async () => {
      // Arrange
      const { formatPercent } = await import('../../src/utils/formatting');

      // Act
      const result = formatPercent(85.3);

      // Assert
      expect(result).toBe('85.3%');
    });

    it('returns "—" for NaN', async () => {
      // Arrange
      const { formatPercent } = await import('../../src/utils/formatting');

      // Act
      const result = formatPercent(NaN);

      // Assert
      expect(result).toBe('—');
    });

    it('returns "—" for null', async () => {
      // Arrange
      const { formatPercent } = await import('../../src/utils/formatting');

      // Act
      const result = formatPercent(null as unknown as number);

      // Assert
      expect(result).toBe('—');
    });
  });

  describe('formatKwh', () => {
    it('formats kWh with 1 decimal', async () => {
      // Arrange
      const { formatKwh } = await import('../../src/utils/formatting');

      // Act
      const result = formatKwh(9.7);

      // Assert
      expect(result).toBe('9.7 kWh');
    });

    it('formats zero as 0.0 kWh', async () => {
      // Arrange
      const { formatKwh } = await import('../../src/utils/formatting');

      // Act
      const result = formatKwh(0);

      // Assert
      expect(result).toBe('0.0 kWh');
    });

    it('returns "—" for NaN', async () => {
      // Arrange
      const { formatKwh } = await import('../../src/utils/formatting');

      // Act
      const result = formatKwh(NaN);

      // Assert
      expect(result).toBe('—');
    });

    it('returns "—" for null', async () => {
      // Arrange
      const { formatKwh } = await import('../../src/utils/formatting');

      // Act
      const result = formatKwh(null as unknown as number);

      // Assert
      expect(result).toBe('—');
    });
  });

  describe('formatTimestamp', () => {
    it('formats epoch to locale-aware date/time', async () => {
      // Arrange
      const { formatTimestamp } = await import('../../src/utils/formatting');
      const epoch = 1710864000; // 2024-03-19T20:00:00Z

      // Act
      const result = formatTimestamp(epoch);

      // Assert
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('returns "—" for NaN', async () => {
      // Arrange
      const { formatTimestamp } = await import('../../src/utils/formatting');

      // Act
      const result = formatTimestamp(NaN);

      // Assert
      expect(result).toBe('—');
    });
  });

  describe('formatRelativeTime', () => {
    it('formats recent time as "Xm ago"', async () => {
      // Arrange
      const { formatRelativeTime } = await import('../../src/utils/formatting');
      const fiveMinAgo = Date.now() / 1000 - 300;

      // Act
      const result = formatRelativeTime(fiveMinAgo);

      // Assert
      expect(result).toBe('5m ago');
    });

    it('formats hours as "Xh ago"', async () => {
      // Arrange
      const { formatRelativeTime } = await import('../../src/utils/formatting');
      const twoHoursAgo = Date.now() / 1000 - 7200;

      // Act
      const result = formatRelativeTime(twoHoursAgo);

      // Assert
      expect(result).toBe('2h ago');
    });

    it('returns "—" for NaN', async () => {
      // Arrange
      const { formatRelativeTime } = await import('../../src/utils/formatting');

      // Act
      const result = formatRelativeTime(NaN);

      // Assert
      expect(result).toBe('—');
    });

    it('returns "—" for null', async () => {
      // Arrange
      const { formatRelativeTime } = await import('../../src/utils/formatting');

      // Act
      const result = formatRelativeTime(null as unknown as number);

      // Assert
      expect(result).toBe('—');
    });

    it('formats seconds as "Xs ago" for < 60s', async () => {
      // Arrange
      const { formatRelativeTime } = await import('../../src/utils/formatting');
      const thirtySecAgo = Date.now() / 1000 - 30;

      // Act
      const result = formatRelativeTime(thirtySecAgo);

      // Assert
      expect(result).toBe('30s ago');
    });

    it('formats days as "Xd ago" for >= 24h', async () => {
      // Arrange
      const { formatRelativeTime } = await import('../../src/utils/formatting');
      const twoDaysAgo = Date.now() / 1000 - 172800;

      // Act
      const result = formatRelativeTime(twoDaysAgo);

      // Assert
      expect(result).toBe('2d ago');
    });
  });
});
