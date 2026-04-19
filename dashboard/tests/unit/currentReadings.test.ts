import { describe, it, expect } from 'vitest';
import type { Device, CurrentReadingsResponse } from '../../src/types';

describe('buildDeviceGroups', () => {
  it('groups devices and extracts metrics from responses', async () => {
    // Arrange
    const { buildDeviceGroups } = await import('../../src/components/CurrentReadings');
    const devices: Device[] = [
      { device: 'epcube3483_battery', class: 'storage_battery', online: true, alias: 'EP Cube v2 Battery', product_code: null },
      { device: 'epcube3483_solar', class: 'home_solar', online: true, alias: 'EP Cube v2 Solar', product_code: null },
    ];
    const batterySOC: CurrentReadingsResponse = {
      metric: 'battery_state_of_capacity_percent',
      readings: [{ device_id: 'epcube3483_battery', value: 85, timestamp: 1000 }],
    };
    const batteryPower: CurrentReadingsResponse = {
      metric: 'battery_power_watts',
      readings: [{ device_id: 'epcube3483_battery', value: -1500, timestamp: 1000 }],
    };
    const solar: CurrentReadingsResponse = {
      metric: 'solar_instantaneous_generation_watts',
      readings: [{ device_id: 'epcube3483_solar', value: 3000, timestamp: 1000 }],
    };
    const grid: CurrentReadingsResponse = {
      metric: 'grid_power_watts',
      readings: [{ device_id: 'epcube3483_battery', value: 0, timestamp: 1000 }],
    };
    const homeLoad: CurrentReadingsResponse = {
      metric: 'home_load_power_watts',
      readings: [{ device_id: 'epcube3483_battery', value: 1500, timestamp: 1000 }],
    };
    const batteryStored: CurrentReadingsResponse = {
      metric: 'battery_stored_kwh',
      readings: [{ device_id: 'epcube3483_battery', value: 12.5, timestamp: 1000 }],
    };

    // Act
    const groups = buildDeviceGroups(devices, {
      batterySOC, batteryPower, solar, grid, homeLoad, batteryStored,
    });

    // Assert
    expect(groups).toHaveLength(1);
    expect(groups[0].baseDeviceId).toBe('epcube3483');
    expect(groups[0].online).toBe(true);
    expect(groups[0].metrics.batteryPercent).toBe(85);
    expect(groups[0].metrics.batteryWatts).toBe(-1500);
    expect(groups[0].metrics.solarWatts).toBe(3000);
    expect(groups[0].metrics.gridWatts).toBe(0);
    expect(groups[0].metrics.homeLoadWatts).toBe(1500);
    expect(groups[0].metrics.batteryStoredKwh).toBe(12.5);
  });

  it('returns 0 for metrics when device type is missing', async () => {
    // Arrange — no solar device
    const { buildDeviceGroups } = await import('../../src/components/CurrentReadings');
    const devices: Device[] = [
      { device: 'epcube3483_battery', class: 'storage_battery', online: true, alias: 'Battery', product_code: null },
    ];
    const empty: CurrentReadingsResponse = { metric: 'x', readings: [] };

    // Act
    const groups = buildDeviceGroups(devices, {
      batterySOC: empty, batteryPower: empty, solar: empty,
      grid: empty, homeLoad: empty, batteryStored: empty,
    });

    // Assert
    expect(groups).toHaveLength(1);
    expect(groups[0].metrics.solarWatts).toBe(0);
  });

  it('returns empty array for empty device list', async () => {
    // Arrange
    const { buildDeviceGroups } = await import('../../src/components/CurrentReadings');
    const empty: CurrentReadingsResponse = { metric: 'x', readings: [] };

    // Act
    const groups = buildDeviceGroups([], {
      batterySOC: empty, batteryPower: empty, solar: empty,
      grid: empty, homeLoad: empty, batteryStored: empty,
    });

    // Assert
    expect(groups).toEqual([]);
  });
});
