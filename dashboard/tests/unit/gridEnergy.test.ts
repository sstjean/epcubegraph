import { describe, it, expect } from 'vitest';
import { computeGridEnergy } from '../../src/utils/gridEnergy';
import type { RangeReadingsResponse } from '../../src/types';

describe('computeGridEnergy', () => {
  it('returns zeros for empty series', () => {
    // Arrange
    const response: RangeReadingsResponse = { metric: 'grid_power_watts', series: [] };

    // Act
    const result = computeGridEnergy(response, 3600);

    // Assert
    expect(result).toEqual({ importKwh: 0, exportKwh: 0, netKwh: 0, hasData: false });
  });

  it('returns hasData false for empty series', () => {
    // Arrange
    const response: RangeReadingsResponse = { metric: 'grid_power_watts', series: [] };

    // Act
    const result = computeGridEnergy(response, 3600);

    // Assert
    expect(result.hasData).toBe(false);
  });

  it('returns hasData true when series have data points', () => {
    // Arrange
    const response: RangeReadingsResponse = {
      metric: 'grid_power_watts',
      series: [{ device_id: 'dev1', values: [{ timestamp: 1000, value: 500 }] }],
    };

    // Act
    const result = computeGridEnergy(response, 3600);

    // Assert
    expect(result.hasData).toBe(true);
  });

  it('accumulates positive watts as import kWh', () => {
    // Arrange — 2 samples at 1000W each, step=3600s → 1 kWh per sample
    const response: RangeReadingsResponse = {
      metric: 'grid_power_watts',
      series: [{
        device_id: 'dev1',
        values: [
          { timestamp: 1000, value: 1000 },
          { timestamp: 4600, value: 1000 },
        ],
      }],
    };

    // Act
    const result = computeGridEnergy(response, 3600);

    // Assert
    expect(result.importKwh).toBe(2);
    expect(result.exportKwh).toBe(0);
    expect(result.netKwh).toBe(-2); // net = export - import = 0 - 2
  });

  it('accumulates negative watts as export kWh (absolute value)', () => {
    // Arrange — 3 samples at -2000W each, step=3600s → 2 kWh per sample
    const response: RangeReadingsResponse = {
      metric: 'grid_power_watts',
      series: [{
        device_id: 'dev1',
        values: [
          { timestamp: 1000, value: -2000 },
          { timestamp: 4600, value: -2000 },
          { timestamp: 8200, value: -2000 },
        ],
      }],
    };

    // Act
    const result = computeGridEnergy(response, 3600);

    // Assert
    expect(result.importKwh).toBe(0);
    expect(result.exportKwh).toBe(6);
    expect(result.netKwh).toBe(6); // net = 6 - 0 = net producer
  });

  it('computes net = export - import (net producer when positive)', () => {
    // Arrange — import 3 kWh, export 5 kWh → net = +2
    const response: RangeReadingsResponse = {
      metric: 'grid_power_watts',
      series: [{
        device_id: 'dev1',
        values: [
          { timestamp: 1000, value: 1000 },  // +1 kWh import
          { timestamp: 4600, value: 2000 },  // +2 kWh import
          { timestamp: 8200, value: -3000 }, // +3 kWh export
          { timestamp: 11800, value: -2000 },// +2 kWh export
        ],
      }],
    };

    // Act
    const result = computeGridEnergy(response, 3600);

    // Assert
    expect(result.importKwh).toBe(3);
    expect(result.exportKwh).toBe(5);
    expect(result.netKwh).toBe(2); // net producer
  });

  it('computes net = export - import (net consumer when negative)', () => {
    // Arrange — import 8 kWh, export 3 kWh → net = -5
    const response: RangeReadingsResponse = {
      metric: 'grid_power_watts',
      series: [{
        device_id: 'dev1',
        values: [
          { timestamp: 1000, value: 5000 },  // +5 kWh import
          { timestamp: 4600, value: 3000 },  // +3 kWh import
          { timestamp: 8200, value: -3000 }, // +3 kWh export
        ],
      }],
    };

    // Act
    const result = computeGridEnergy(response, 3600);

    // Assert
    expect(result.importKwh).toBe(8);
    expect(result.exportKwh).toBe(3);
    expect(result.netKwh).toBe(-5); // net consumer
  });

  it('sums across multiple devices', () => {
    // Arrange — dev1: 2 kWh import, dev2: 1 kWh export
    const response: RangeReadingsResponse = {
      metric: 'grid_power_watts',
      series: [
        {
          device_id: 'dev1',
          values: [{ timestamp: 1000, value: 2000 }], // 2 kWh import
        },
        {
          device_id: 'dev2',
          values: [{ timestamp: 1000, value: -1000 }], // 1 kWh export
        },
      ],
    };

    // Act
    const result = computeGridEnergy(response, 3600);

    // Assert
    expect(result.importKwh).toBe(2);
    expect(result.exportKwh).toBe(1);
    expect(result.netKwh).toBe(-1); // net consumer
  });

  it('scales correctly with non-3600 step (e.g., 60s)', () => {
    // Arrange — 5000W at 60s step = (5000/1000) × (60/3600) = 0.08333... kWh
    const response: RangeReadingsResponse = {
      metric: 'grid_power_watts',
      series: [{
        device_id: 'dev1',
        values: [{ timestamp: 1000, value: 5000 }],
      }],
    };

    // Act
    const result = computeGridEnergy(response, 60);

    // Assert — 5000/1000 × 60/3600 = 0.08333... (no rounding)
    expect(result.importKwh).toBeCloseTo(5 / 60, 10);
  });

  it('treats zero-watt samples as neither import nor export', () => {
    // Arrange
    const response: RangeReadingsResponse = {
      metric: 'grid_power_watts',
      series: [{
        device_id: 'dev1',
        values: [{ timestamp: 1000, value: 0 }],
      }],
    };

    // Act
    const result = computeGridEnergy(response, 3600);

    // Assert
    expect(result.importKwh).toBe(0);
    expect(result.exportKwh).toBe(0);
    expect(result.netKwh).toBe(0);
    expect(result.hasData).toBe(true);
  });

  it('handles series with empty values array', () => {
    // Arrange
    const response: RangeReadingsResponse = {
      metric: 'grid_power_watts',
      series: [{ device_id: 'dev1', values: [] }],
    };

    // Act
    const result = computeGridEnergy(response, 3600);

    // Assert
    expect(result.hasData).toBe(false);
    expect(result.importKwh).toBe(0);
    expect(result.exportKwh).toBe(0);
  });

  it('preserves full precision without rounding', () => {
    // Arrange — values that produce float noise: (333+333+334)/1000 = 1.0 kWh
    const response: RangeReadingsResponse = {
      metric: 'grid_power_watts',
      series: [{
        device_id: 'dev1',
        values: [
          { timestamp: 1000, value: 333 },
          { timestamp: 4600, value: 333 },
          { timestamp: 8200, value: 334 },
        ],
      }],
    };

    // Act
    const result = computeGridEnergy(response, 3600);

    // Assert — (0.333 + 0.333 + 0.334) = 1.0 kWh (exact in IEEE 754)
    expect(result.importKwh).toBeCloseTo(1, 10);
  });

  it('returns zero energy when stepSeconds is 0 (division by zero safe)', () => {
    // Arrange — stepSeconds=0 means hoursPerStep=0, all kWh=0
    const response: RangeReadingsResponse = {
      metric: 'grid_power_watts',
      series: [{
        device_id: 'grid',
        values: [
          { timestamp: 1000, value: 5000 },
          { timestamp: 2000, value: -3000 },
        ],
      }],
    };

    // Act
    const result = computeGridEnergy(response, 0);

    // Assert — no energy accumulated, but data exists
    expect(result.importKwh).toBe(0);
    expect(result.exportKwh).toBe(0);
    expect(result.netKwh).toBe(0);
    expect(result.hasData).toBe(true);
  });
});
