import { describe, it, expect } from 'vitest';
import type { Device, CurrentReadingsResponse } from '../../src/types';

/** Build a full MetricResponses with an optional grid_status_code reading per device. */
function makeMetrics(gridStatusReadings: { device_id: string; value: number }[]): {
  batterySOC: CurrentReadingsResponse;
  batteryPower: CurrentReadingsResponse;
  batteryStored: CurrentReadingsResponse;
  solar: CurrentReadingsResponse;
  grid: CurrentReadingsResponse;
  homeLoad: CurrentReadingsResponse;
  gridStatus: CurrentReadingsResponse;
} {
  const empty = (metric: string): CurrentReadingsResponse => ({ metric, readings: [] });
  return {
    batterySOC: empty('battery_state_of_capacity_percent'),
    batteryPower: empty('battery_power_watts'),
    batteryStored: empty('battery_stored_kwh'),
    solar: empty('solar_instantaneous_generation_watts'),
    grid: empty('grid_power_watts'),
    homeLoad: empty('home_load_power_watts'),
    gridStatus: {
      metric: 'grid_status_code',
      readings: gridStatusReadings.map((r) => ({ ...r, timestamp: 1000 })),
    },
  };
}

function battery(baseId: string, online = true): Device {
  return { device: `${baseId}_battery`, class: 'storage_battery', online, alias: baseId, product_code: null };
}

describe('buildDeviceGroups — gridDown derivation (feature 181)', () => {
  it('sets gridDown true when grid_status_code is 2 (Backup)', async () => {
    // Arrange
    const { buildDeviceGroups } = await import('../../src/components/CurrentReadings');
    const devices = [battery('epcube1')];
    const metrics = makeMetrics([{ device_id: 'epcube1_battery', value: 2 }]);
    // Act
    const groups = buildDeviceGroups(devices, metrics);
    // Assert
    expect(groups[0].metrics.gridDown).toBe(true);
  });

  it('sets gridDown true when grid_status_code is 3 (Off-Grid)', async () => {
    const { buildDeviceGroups } = await import('../../src/components/CurrentReadings');
    const devices = [battery('epcube1')];
    const metrics = makeMetrics([{ device_id: 'epcube1_battery', value: 3 }]);
    const groups = buildDeviceGroups(devices, metrics);
    expect(groups[0].metrics.gridDown).toBe(true);
  });

  it('sets gridDown false for grid-up codes (0, 1, 4, 5, 6)', async () => {
    const { buildDeviceGroups } = await import('../../src/components/CurrentReadings');
    for (const code of [0, 1, 4, 5, 6]) {
      const devices = [battery('epcube1')];
      const metrics = makeMetrics([{ device_id: 'epcube1_battery', value: code }]);
      const groups = buildDeviceGroups(devices, metrics);
      expect(groups[0].metrics.gridDown).toBe(false);
    }
  });

  it('forces gridDown false for an offline group even if the last code was 3', async () => {
    // Arrange — offline device whose stale reading is Off-Grid
    const { buildDeviceGroups } = await import('../../src/components/CurrentReadings');
    const devices = [battery('epcube1', false)];
    const metrics = makeMetrics([{ device_id: 'epcube1_battery', value: 3 }]);
    // Act
    const groups = buildDeviceGroups(devices, metrics);
    // Assert
    expect(groups[0].online).toBe(false);
    expect(groups[0].metrics.gridDown).toBe(false);
  });

  it('attributes gridDown per device — only the down system is flagged (US2)', async () => {
    // Arrange — device A off-grid (3), device B self-use (1)
    const { buildDeviceGroups } = await import('../../src/components/CurrentReadings');
    const devices = [battery('epcubeA'), battery('epcubeB')];
    const metrics = makeMetrics([
      { device_id: 'epcubeA_battery', value: 3 },
      { device_id: 'epcubeB_battery', value: 1 },
    ]);
    // Act
    const groups = buildDeviceGroups(devices, metrics);
    // Assert
    const a = groups.find((g) => g.baseDeviceId === 'epcubeA')!;
    const b = groups.find((g) => g.baseDeviceId === 'epcubeB')!;
    expect(a.metrics.gridDown).toBe(true);
    expect(b.metrics.gridDown).toBe(false);
  });

  it('flags both systems when both are grid-down, and neither when both are up (US2)', async () => {
    // Arrange
    const { buildDeviceGroups } = await import('../../src/components/CurrentReadings');
    const devices = [battery('epcubeA'), battery('epcubeB')];

    // Act — both down (2 and 3)
    const bothDown = buildDeviceGroups(devices, makeMetrics([
      { device_id: 'epcubeA_battery', value: 2 },
      { device_id: 'epcubeB_battery', value: 3 },
    ]));
    // Act — both up (1 and 4)
    const bothUp = buildDeviceGroups(devices, makeMetrics([
      { device_id: 'epcubeA_battery', value: 1 },
      { device_id: 'epcubeB_battery', value: 4 },
    ]));

    // Assert
    expect(bothDown.every((g) => g.metrics.gridDown)).toBe(true);
    expect(bothUp.some((g) => g.metrics.gridDown)).toBe(false);
  });
});
