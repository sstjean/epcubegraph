import { describe, it, expect } from 'vitest';
import { getGroupName, groupDevicesByAlias, getDisplayName, getBaseDeviceId } from '../../src/utils/devices';
import type { Device } from '../../src/types';

function makeDevice(overrides: Partial<Device> & { device: string }): Device {
  return { class: 'storage_battery', online: true, ...overrides };
}

describe('getGroupName', () => {
  it('strips "Battery" suffix from alias', () => {
    const device = makeDevice({ device: 'epcube3483_battery', alias: 'Steve St Jean Battery' });
    expect(getGroupName(device)).toBe('Steve St Jean');
  });

  it('strips "Solar" suffix from alias', () => {
    const device = makeDevice({ device: 'epcube3483_solar', alias: 'Steve St Jean Solar' });
    expect(getGroupName(device)).toBe('Steve St Jean');
  });

  it('keeps alias as-is when no Battery/Solar suffix', () => {
    const device = makeDevice({ device: 'epcube3483_battery', alias: 'Steve St Jean 3' });
    expect(getGroupName(device)).toBe('Steve St Jean 3');
  });

  it('falls back to formatted device id when no alias', () => {
    const device = makeDevice({ device: 'epcube3483_battery' });
    expect(getGroupName(device)).toBe('EP Cube 3483');
  });

  it('falls back to raw base id for non-standard format', () => {
    const device = makeDevice({ device: 'custom_device_battery' });
    expect(getGroupName(device)).toBe('custom_device');
  });
});

describe('groupDevicesByAlias', () => {
  it('groups battery and solar devices under same alias', () => {
    const devices: Device[] = [
      makeDevice({ device: 'epcube3483_battery', alias: 'Steve St Jean', class: 'storage_battery' }),
      makeDevice({ device: 'epcube3483_solar', alias: 'Steve St Jean', class: 'home_solar' }),
      makeDevice({ device: 'epcube5488_battery', alias: 'Steve St Jean 3', class: 'storage_battery' }),
      makeDevice({ device: 'epcube5488_solar', alias: 'Steve St Jean 3', class: 'home_solar' }),
    ];

    const groups = groupDevicesByAlias(devices);

    expect(groups.size).toBe(2);
    expect(groups.get('Steve St Jean')!.length).toBe(2);
    expect(groups.get('Steve St Jean 3')!.length).toBe(2);
  });

  it('returns empty map for empty device list', () => {
    const groups = groupDevicesByAlias([]);
    expect(groups.size).toBe(0);
  });
});

describe('getDisplayName', () => {
  it('returns fallback for empty array', () => {
    expect(getDisplayName([])).toBe('Unknown Device');
  });

  it('derives "EP Cube v1" from product_code devType=0', () => {
    const devices = [
      makeDevice({ device: 'epcube3483_battery', product_code: 'EP Cube (devType=0)', alias: 'Steve St Jean' }),
      makeDevice({ device: 'epcube3483_solar', product_code: 'EP Cube (devType=0)', alias: 'Steve St Jean' }),
    ];
    expect(getDisplayName(devices)).toBe('EP Cube v1');
  });

  it('derives "EP Cube v2" from product_code devType=2', () => {
    const devices = [
      makeDevice({ device: 'epcube5488_battery', product_code: 'EP Cube (devType=2)', alias: 'Steve St Jean 3' }),
    ];
    expect(getDisplayName(devices)).toBe('EP Cube v2');
  });

  it('falls back to alias-based name when no product_code', () => {
    const devices = [
      makeDevice({ device: 'epcube1_battery', alias: 'EP Cube v1 Battery' }),
    ];
    expect(getDisplayName(devices)).toBe('EP Cube v1');
  });

  it('falls back to alias-based name for unknown devType', () => {
    const devices = [
      makeDevice({ device: 'epcube9_battery', product_code: 'EP Cube (devType=99)', alias: 'Custom Name' }),
    ];
    expect(getDisplayName(devices)).toBe('Custom Name');
  });

  it('falls back to device id when no alias and unknown devType', () => {
    const devices = [
      makeDevice({ device: 'epcube3483_battery', product_code: 'Unknown Format' }),
    ];
    expect(getDisplayName(devices)).toBe('EP Cube 3483');
  });
});

describe('getBaseDeviceId', () => {
  it('strips _battery suffix', () => {
    const device = makeDevice({ device: 'epcube3483_battery' });
    expect(getBaseDeviceId(device)).toBe('epcube3483');
  });

  it('strips _solar suffix', () => {
    const device = makeDevice({ device: 'epcube3483_solar' });
    expect(getBaseDeviceId(device)).toBe('epcube3483');
  });

  it('strips _home_solar suffix', () => {
    const device = makeDevice({ device: 'epcube3483_home_solar' });
    expect(getBaseDeviceId(device)).toBe('epcube3483');
  });

  it('returns raw device id when no known suffix', () => {
    const device = makeDevice({ device: 'custom_device' });
    expect(getBaseDeviceId(device)).toBe('custom_device');
  });
});
