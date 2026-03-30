import type { RangeReadingsResponse } from '../types';

export interface GridEnergySummary {
  importKwh: number;
  exportKwh: number;
  netKwh: number;
  hasData: boolean;
}

/**
 * Compute grid energy totals from grid_power_watts time series.
 *
 * Sign convention from exporter: positive = import, negative = export.
 * Each sample represents an average over one step interval, so
 * kWh = watts × (stepSeconds / 3600).
 *
 * Net = export − import (positive = net producer, negative = net consumer).
 */
export function computeGridEnergy(
  response: RangeReadingsResponse,
  stepSeconds: number,
): GridEnergySummary {
  const hoursPerStep = stepSeconds / 3600;
  let importKwh = 0;
  let exportKwh = 0;
  let totalPoints = 0;

  for (const series of response.series) {
    totalPoints += series.values.length;
    for (const pt of series.values) {
      const kwh = (pt.value / 1000) * hoursPerStep;
      if (kwh > 0) {
        importKwh += kwh;
      } else {
        exportKwh += Math.abs(kwh);
      }
    }
  }

  const netKwh = exportKwh - importKwh;

  return { importKwh, exportKwh, netKwh, hasData: totalPoints > 0 };
}
