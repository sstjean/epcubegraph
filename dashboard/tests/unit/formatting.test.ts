import { describe, it, expect } from 'vitest';

describe('formatting', () => {
  describe('formatWatts', () => {
    it('formats watts below 1000 as W', async () => {
      // Arrange
      const { formatWatts } = await import('../../src/utils/formatting');

      // Act
      const result = formatWatts(456);

      // Assert
      expect(result).toBe('456 W');
    });

    it('auto-scales to kW for values >= 1000', async () => {
      // Arrange
      const { formatWatts } = await import('../../src/utils/formatting');

      // Act
      const result = formatWatts(1234);

      // Assert
      expect(result).toBe('1.234 kW');
    });

    it('auto-scales to MW for values >= 1000000', async () => {
      // Arrange
      const { formatWatts } = await import('../../src/utils/formatting');

      // Act
      const result = formatWatts(2345000);

      // Assert
      expect(result).toBe('2.345 MW');
    });

    it('handles negative watts correctly', async () => {
      // Arrange
      const { formatWatts } = await import('../../src/utils/formatting');

      // Act
      const result = formatWatts(-1234);

      // Assert
      expect(result).toBe('-1.234 kW');
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

    it('formats zero as 0 W', async () => {
      // Arrange
      const { formatWatts } = await import('../../src/utils/formatting');

      // Act
      const result = formatWatts(0);

      // Assert
      expect(result).toBe('0 W');
    });
  });

  describe('formatKw', () => {
    it('always formats in kW', async () => {
      const { formatKw } = await import('../../src/utils/formatting');
      expect(formatKw(1234)).toBe('1.234 kW');
      expect(formatKw(5678)).toBe('5.678 kW');
      expect(formatKw(123)).toBe('0.123 kW');
      expect(formatKw(0)).toBe('0.000 kW');
    });

    it('returns — for NaN', async () => {
      const { formatKw } = await import('../../src/utils/formatting');
      expect(formatKw(NaN)).toBe('—');
    });
  });

  describe('formatWattsAxis', () => {
    it('uses 1-decimal kW for axis readability', async () => {
      const { formatWattsAxis } = await import('../../src/utils/formatting');
      expect(formatWattsAxis(1234)).toBe('1.2 kW');
      expect(formatWattsAxis(5678)).toBe('5.7 kW');
      expect(formatWattsAxis(-1500)).toBe('-1.5 kW');
    });

    it('uses 1-decimal MW for large values', async () => {
      const { formatWattsAxis } = await import('../../src/utils/formatting');
      expect(formatWattsAxis(2345000)).toBe('2.3 MW');
    });

    it('uses whole watts for sub-kW', async () => {
      const { formatWattsAxis } = await import('../../src/utils/formatting');
      expect(formatWattsAxis(567)).toBe('567 W');
      expect(formatWattsAxis(0)).toBe('0 W');
    });

    it('returns — for NaN', async () => {
      const { formatWattsAxis } = await import('../../src/utils/formatting');
      expect(formatWattsAxis(NaN)).toBe('—');
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
    it('formats kWh with 3 decimals', async () => {
      // Arrange
      const { formatKwh } = await import('../../src/utils/formatting');

      // Act
      const result = formatKwh(9.7);

      // Assert
      expect(result).toBe('9.700 kWh');
    });

    it('formats zero as 0.000 kWh', async () => {
      // Arrange
      const { formatKwh } = await import('../../src/utils/formatting');

      // Act
      const result = formatKwh(0);

      // Assert
      expect(result).toBe('0.000 kWh');
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
