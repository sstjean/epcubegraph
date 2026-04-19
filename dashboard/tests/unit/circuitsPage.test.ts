import { describe, it, expect } from 'vitest';
import type { VueDeviceMapping, VueDeviceInfo, PanelHierarchyEntry } from '../../src/types';

describe('resolvePanelsFromMapping', () => {
  it('creates panel list from single-object mapping', async () => {
    // Arrange
    const { resolvePanelsFromMapping } = await import('../../src/components/CircuitsPage');
    const mapping: VueDeviceMapping = {
      epcube1: { gid: 111, alias: 'Main Panel' },
    };
    const hierarchy: PanelHierarchyEntry[] = [];
    const vueDevices: VueDeviceInfo[] = [];

    // Act
    const panels = resolvePanelsFromMapping(mapping, hierarchy, vueDevices);

    // Assert
    expect(panels).toHaveLength(1);
    expect(panels[0]).toEqual({ device_gid: 111, alias: 'Main Panel' });
  });

  it('resolves children from hierarchy with vueDevices display names', async () => {
    // Arrange
    const { resolvePanelsFromMapping } = await import('../../src/components/CircuitsPage');
    const mapping: VueDeviceMapping = {
      epcube1: { gid: 111, alias: 'Main Panel' },
    };
    const hierarchy: PanelHierarchyEntry[] = [
      { id: 1, parent_device_gid: 111, child_device_gid: 222 },
    ];
    const vueDevices = [
      { device_gid: 222, device_name: 'Vue 2', display_name: 'Subpanel 1' },
    ] as VueDeviceInfo[];

    // Act
    const panels = resolvePanelsFromMapping(mapping, hierarchy, vueDevices);

    // Assert
    expect(panels).toHaveLength(2);
    expect(panels[0]).toEqual({ device_gid: 111, alias: 'Main Panel' });
    expect(panels[1]).toEqual({ device_gid: 222, alias: 'Subpanel 1' });
  });

  it('falls back to GID string when child not in vueDevices', async () => {
    // Arrange
    const { resolvePanelsFromMapping } = await import('../../src/components/CircuitsPage');
    const mapping: VueDeviceMapping = {
      epcube1: { gid: 111, alias: 'Main Panel' },
    };
    const hierarchy: PanelHierarchyEntry[] = [
      { id: 1, parent_device_gid: 111, child_device_gid: 999 },
    ];

    // Act
    const panels = resolvePanelsFromMapping(mapping, hierarchy, []);

    // Assert
    expect(panels).toHaveLength(2);
    expect(panels[1]).toEqual({ device_gid: 999, alias: '999' });
  });

  it('ignores hierarchy entries for unmapped parents', async () => {
    // Arrange
    const { resolvePanelsFromMapping } = await import('../../src/components/CircuitsPage');
    const mapping: VueDeviceMapping = {
      epcube1: { gid: 111, alias: 'Main Panel' },
    };
    const hierarchy: PanelHierarchyEntry[] = [
      { id: 1, parent_device_gid: 999, child_device_gid: 222 },
    ];

    // Act
    const panels = resolvePanelsFromMapping(mapping, hierarchy, []);

    // Assert
    expect(panels).toHaveLength(1);
  });

  it('returns empty array for empty mapping', async () => {
    // Arrange
    const { resolvePanelsFromMapping } = await import('../../src/components/CircuitsPage');
    const mapping: VueDeviceMapping = {};

    // Act
    const panels = resolvePanelsFromMapping(mapping, [], []);

    // Assert
    expect(panels).toEqual([]);
  });
});
