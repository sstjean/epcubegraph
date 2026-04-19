import { describe, it, expect, vi } from 'vitest';
import type { Device, VuePanelMapping } from '../../src/types';

vi.mock('../../src/telemetry', () => ({
  trackException: vi.fn(),
}));

describe('buildEpcubeGroups', () => {
  it('groups devices by base alias and extracts display name', async () => {
    // Arrange
    const { buildEpcubeGroups } = await import('../../src/components/SettingsPage');
    const devices: Device[] = [
      { device: 'epcube3483_battery', class: 'storage_battery', online: true, alias: 'EP Cube v2 Battery', product_code: null },
      { device: 'epcube3483_solar', class: 'home_solar', online: true, alias: 'EP Cube v2 Solar', product_code: null },
    ];

    // Act
    const groups = buildEpcubeGroups(devices);

    // Assert
    expect(groups).toHaveLength(1);
    expect(groups[0].baseDeviceId).toBe('epcube3483');
    expect(groups[0].devices).toHaveLength(2);
  });

  it('returns empty array for empty device list', async () => {
    // Arrange
    const { buildEpcubeGroups } = await import('../../src/components/SettingsPage');

    // Act
    const groups = buildEpcubeGroups([]);

    // Assert
    expect(groups).toEqual([]);
  });
});

describe('initializeMapping', () => {
  it('overlays saved mapping onto group keys', async () => {
    // Arrange
    const { initializeMapping, buildEpcubeGroups } = await import('../../src/components/SettingsPage');
    const devices: Device[] = [
      { device: 'epcube3483_battery', class: 'storage_battery', online: true, alias: 'EP Cube Battery', product_code: null },
    ];
    const groups = buildEpcubeGroups(devices);
    const rawMapping = '{"epcube3483":{"gid":480380,"alias":"Main Panel"}}';

    // Act
    const mapping = initializeMapping(groups, rawMapping);

    // Assert
    expect(mapping.epcube3483).toEqual({ gid: 480380, alias: 'Main Panel' });
  });

  it('returns undefined for all keys when no raw mapping', async () => {
    // Arrange
    const { initializeMapping, buildEpcubeGroups } = await import('../../src/components/SettingsPage');
    const devices: Device[] = [
      { device: 'epcube3483_battery', class: 'storage_battery', online: true, alias: 'EP Cube Battery', product_code: null },
    ];
    const groups = buildEpcubeGroups(devices);

    // Act
    const mapping = initializeMapping(groups, undefined);

    // Assert
    expect(mapping.epcube3483).toBeUndefined();
  });

  it('ignores saved keys not matching any group', async () => {
    // Arrange
    const { initializeMapping, buildEpcubeGroups } = await import('../../src/components/SettingsPage');
    const devices: Device[] = [
      { device: 'epcube3483_battery', class: 'storage_battery', online: true, alias: 'EP Cube Battery', product_code: null },
    ];
    const groups = buildEpcubeGroups(devices);
    const rawMapping = '{"epcube3483":{"gid":480380,"alias":"Main Panel"},"unknown":{"gid":999,"alias":"Ghost"}}';

    // Act
    const mapping = initializeMapping(groups, rawMapping);

    // Assert
    expect(mapping.epcube3483).toBeDefined();
    expect(mapping.unknown).toBeUndefined();
  });

  it('treats old array format as invalid (all undefined)', async () => {
    // Arrange
    const { initializeMapping, buildEpcubeGroups } = await import('../../src/components/SettingsPage');
    const devices: Device[] = [
      { device: 'epcube3483_battery', class: 'storage_battery', online: true, alias: 'EP Cube Battery', product_code: null },
    ];
    const groups = buildEpcubeGroups(devices);
    const rawMapping = '{"epcube3483":[{"gid":480380,"alias":"Main Panel"}]}';

    // Act
    const mapping = initializeMapping(groups, rawMapping);

    // Assert — old format rejected, key remains undefined
    expect(mapping.epcube3483).toBeUndefined();
  });

  it('handles malformed JSON gracefully', async () => {
    // Arrange
    const { initializeMapping, buildEpcubeGroups } = await import('../../src/components/SettingsPage');
    const devices: Device[] = [
      { device: 'epcube3483_battery', class: 'storage_battery', online: true, alias: 'EP Cube Battery', product_code: null },
    ];
    const groups = buildEpcubeGroups(devices);

    // Act
    const mapping = initializeMapping(groups, 'not valid json');

    // Assert — malformed JSON treated as empty
    expect(mapping.epcube3483).toBeUndefined();
  });
});

describe('validatePollingValue', () => {
  it('returns null for valid integer in range', async () => {
    const { validatePollingValue } = await import('../../src/components/SettingsPage');
    expect(validatePollingValue('30')).toBeNull();
  });

  it('returns error for non-integer', async () => {
    const { validatePollingValue } = await import('../../src/components/SettingsPage');
    expect(validatePollingValue('3.5')).toBe('Must be a whole number');
  });

  it('returns error for value below minimum', async () => {
    const { validatePollingValue } = await import('../../src/components/SettingsPage');
    expect(validatePollingValue('0')).toBe('Minimum is 1 second');
  });

  it('returns error for value above maximum', async () => {
    const { validatePollingValue } = await import('../../src/components/SettingsPage');
    expect(validatePollingValue('3601')).toBe('Maximum is 3600 seconds');
  });
});
