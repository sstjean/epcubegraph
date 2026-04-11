import { describe, it, expect } from 'vitest';

describe('circuits', () => {
  describe('filterActiveCircuits', () => {
    it('returns only channels with value > 0', async () => {
      // Arrange
      const { filterActiveCircuits } = await import('../../src/utils/circuits');
      const channels = [
        { channel_num: '1', display_name: 'Kitchen', value: 850 },
        { channel_num: '2', display_name: 'Bedroom', value: 0 },
        { channel_num: '3', display_name: 'Office', value: 120 },
      ];

      // Act
      const result = filterActiveCircuits(channels);

      // Assert
      expect(result).toHaveLength(2);
      expect(result.map((c) => c.channel_num)).toEqual(['1', '3']);
    });

    it('excludes mains channel 1,2,3', async () => {
      // Arrange
      const { filterActiveCircuits } = await import('../../src/utils/circuits');
      const channels = [
        { channel_num: '1,2,3', display_name: 'Main', value: 8000 },
        { channel_num: '1', display_name: 'Kitchen', value: 500 },
      ];

      // Act
      const result = filterActiveCircuits(channels);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].channel_num).toBe('1');
    });

    it('excludes negative values', async () => {
      // Arrange
      const { filterActiveCircuits } = await import('../../src/utils/circuits');
      const channels = [
        { channel_num: '1', display_name: 'Solar', value: -200 },
        { channel_num: '2', display_name: 'Kitchen', value: 100 },
      ];

      // Act
      const result = filterActiveCircuits(channels);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].channel_num).toBe('2');
    });

    it('returns empty array when all channels are 0W or mains', async () => {
      // Arrange
      const { filterActiveCircuits } = await import('../../src/utils/circuits');
      const channels = [
        { channel_num: '1,2,3', display_name: 'Main', value: 5000 },
        { channel_num: '1', display_name: 'Kitchen', value: 0 },
      ];

      // Act
      const result = filterActiveCircuits(channels);

      // Assert
      expect(result).toHaveLength(0);
    });

    it('includes Balance channel when active', async () => {
      // Arrange
      const { filterActiveCircuits } = await import('../../src/utils/circuits');
      const channels = [
        { channel_num: 'Balance', display_name: 'Unmonitored loads', value: 320 },
        { channel_num: '1', display_name: 'Kitchen', value: 100 },
      ];

      // Act
      const result = filterActiveCircuits(channels);

      // Assert
      expect(result).toHaveLength(2);
    });
  });

  describe('sortByWattsThenName', () => {
    it('sorts descending by watts (highest first)', async () => {
      // Arrange
      const { sortByWattsThenName } = await import('../../src/utils/circuits');
      const items = [
        { channel_num: '1', display_name: 'Kitchen', value: 850 },
        { channel_num: '2', display_name: 'Office', value: 120 },
        { channel_num: '3', display_name: 'Bedroom', value: 450 },
      ];

      // Act
      const result = [...items].sort(sortByWattsThenName);

      // Assert
      expect(result.map((c) => c.value)).toEqual([850, 450, 120]);
    });

    it('sorts alphabetically by name when watts are equal', async () => {
      // Arrange
      const { sortByWattsThenName } = await import('../../src/utils/circuits');
      const items = [
        { channel_num: '1', display_name: 'Kitchen', value: 500 },
        { channel_num: '2', display_name: 'Bedroom', value: 500 },
        { channel_num: '3', display_name: 'Office', value: 500 },
      ];

      // Act
      const result = [...items].sort(sortByWattsThenName);

      // Assert
      expect(result.map((c) => c.display_name)).toEqual([
        'Bedroom',
        'Kitchen',
        'Office',
      ]);
    });
  });

  describe('sortByCircuitNumber', () => {
    it('sorts mains first, numbered next, Balance last', async () => {
      // Arrange
      const { sortByCircuitNumber } = await import('../../src/utils/circuits');
      const items = [
        { channel_num: 'Balance', display_name: 'Unmonitored loads', value: 0 },
        { channel_num: '3', display_name: 'Office', value: 0 },
        { channel_num: '1,2,3', display_name: 'Main', value: 0 },
        { channel_num: '1', display_name: 'Kitchen', value: 0 },
      ];

      // Act
      const result = [...items].sort(sortByCircuitNumber);

      // Assert
      expect(result.map((c) => c.channel_num)).toEqual([
        '1,2,3',
        '1',
        '3',
        'Balance',
      ]);
    });

    it('sorts numbered channels numerically not lexicographically', async () => {
      // Arrange
      const { sortByCircuitNumber } = await import('../../src/utils/circuits');
      const items = [
        { channel_num: '10', display_name: 'Ch10', value: 0 },
        { channel_num: '2', display_name: 'Ch2', value: 0 },
        { channel_num: '1', display_name: 'Ch1', value: 0 },
      ];

      // Act
      const result = [...items].sort(sortByCircuitNumber);

      // Assert
      expect(result.map((c) => c.channel_num)).toEqual(['1', '2', '10']);
    });

    it('sorts numeric channels before non-numeric non-special channels', async () => {
      // Arrange
      const { sortByCircuitNumber } = await import('../../src/utils/circuits');
      const items = [
        { channel_num: 'SubPanel', display_name: 'Sub', value: 0 },
        { channel_num: '2', display_name: 'Ch2', value: 0 },
      ];

      // Act
      const result = [...items].sort(sortByCircuitNumber);

      // Assert
      expect(result.map((c) => c.channel_num)).toEqual(['2', 'SubPanel']);
    });

    it('sorts non-numeric non-special channels alphabetically', async () => {
      // Arrange
      const { sortByCircuitNumber } = await import('../../src/utils/circuits');
      const items = [
        { channel_num: 'Zeta', display_name: 'Z', value: 0 },
        { channel_num: 'Alpha', display_name: 'A', value: 0 },
      ];

      // Act
      const result = [...items].sort(sortByCircuitNumber);

      // Assert
      expect(result.map((c) => c.channel_num)).toEqual(['Alpha', 'Zeta']);
    });

    it('sorts non-numeric before numeric when only b is numeric', async () => {
      // Arrange
      const { sortByCircuitNumber } = await import('../../src/utils/circuits');
      const items = [
        { channel_num: '5', display_name: 'Ch5', value: 0 },
        { channel_num: 'Custom', display_name: 'Custom', value: 0 },
      ];

      // Act
      const result = [...items].sort(sortByCircuitNumber);

      // Assert — numeric sorts before non-numeric
      expect(result.map((c) => c.channel_num)).toEqual(['5', 'Custom']);
    });
  });

  describe('orderPanels', () => {
    it('puts standalone panels first alphabetically, then parents with children', async () => {
      // Arrange
      const { orderPanels } = await import('../../src/utils/circuits');
      const panels = [
        { device_gid: 1, alias: 'Main Panel' },
        { device_gid: 2, alias: 'Subpanel 1' },
        { device_gid: 3, alias: 'Workshop' },
      ];
      const hierarchy = [{ parent_device_gid: 1, child_device_gid: 2 }];

      // Act
      const result = orderPanels(panels, hierarchy);

      // Assert — Workshop (standalone) first, then Main Panel, then Subpanel 1
      expect(result.map((p) => p.alias)).toEqual([
        'Workshop',
        'Main Panel',
        'Subpanel 1',
      ]);
    });

    it('returns all panels when no hierarchy', async () => {
      // Arrange
      const { orderPanels } = await import('../../src/utils/circuits');
      const panels = [
        { device_gid: 1, alias: 'Beta' },
        { device_gid: 2, alias: 'Alpha' },
      ];

      // Act
      const result = orderPanels(panels, []);

      // Assert — alphabetical (all standalone)
      expect(result.map((p) => p.alias)).toEqual(['Alpha', 'Beta']);
    });

    it('orders children alphabetically after their parent', async () => {
      // Arrange
      const { orderPanels } = await import('../../src/utils/circuits');
      const panels = [
        { device_gid: 1, alias: 'Main' },
        { device_gid: 2, alias: 'Zebra Sub' },
        { device_gid: 3, alias: 'Alpha Sub' },
      ];
      const hierarchy = [
        { parent_device_gid: 1, child_device_gid: 2 },
        { parent_device_gid: 1, child_device_gid: 3 },
      ];

      // Act
      const result = orderPanels(panels, hierarchy);

      // Assert — Main, then Alpha Sub, then Zebra Sub
      expect(result.map((p) => p.alias)).toEqual([
        'Main',
        'Alpha Sub',
        'Zebra Sub',
      ]);
    });

    it('returns empty array for empty input', async () => {
      // Arrange
      const { orderPanels } = await import('../../src/utils/circuits');

      // Act
      const result = orderPanels([], []);

      // Assert
      expect(result).toEqual([]);
    });

    it('handles self-referencing hierarchy without infinite recursion', async () => {
      // Arrange
      const { orderPanels } = await import('../../src/utils/circuits');
      const panels = [
        { device_gid: 1, alias: 'Panel A' },
      ];
      const hierarchy = [{ parent_device_gid: 1, child_device_gid: 1 }];

      // Act
      const result = orderPanels(panels, hierarchy);

      // Assert — panel appears once, self-reference ignored
      expect(result).toHaveLength(1);
      expect(result[0].alias).toBe('Panel A');
    });

    it('handles circular hierarchy without infinite recursion', async () => {
      // Arrange
      const { orderPanels } = await import('../../src/utils/circuits');
      const panels = [
        { device_gid: 1, alias: 'A' },
        { device_gid: 2, alias: 'B' },
        { device_gid: 3, alias: 'C' },
      ];
      const hierarchy = [
        { parent_device_gid: 1, child_device_gid: 2 },
        { parent_device_gid: 2, child_device_gid: 3 },
        { parent_device_gid: 3, child_device_gid: 1 },
      ];

      // Act — should not hang or throw
      const result = orderPanels(panels, hierarchy);

      // Assert — all panels present exactly once, regardless of order
      expect(result).toHaveLength(3);
      expect(result.map((p) => p.device_gid).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    });

    it('handles orphaned hierarchy references gracefully', async () => {
      // Arrange — hierarchy references device_gid 999 that doesn't exist in panels
      const { orderPanels } = await import('../../src/utils/circuits');
      const panels = [
        { device_gid: 1, alias: 'Main' },
      ];
      const hierarchy = [{ parent_device_gid: 1, child_device_gid: 999 }];

      // Act
      const result = orderPanels(panels, hierarchy);

      // Assert — Main still appears, orphan ignored
      expect(result).toHaveLength(1);
      expect(result[0].alias).toBe('Main');
    });
  });
});
