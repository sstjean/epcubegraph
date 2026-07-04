import { describe, it, expect } from 'vitest';

describe('deriveGridDown', () => {
  it('returns true for Backup (2)', async () => {
    // Arrange
    const { deriveGridDown } = await import('../../src/utils/grid');
    // Act & Assert
    expect(deriveGridDown(2)).toBe(true);
  });

  it('returns true for Off-Grid (3)', async () => {
    const { deriveGridDown } = await import('../../src/utils/grid');
    expect(deriveGridDown(3)).toBe(true);
  });

  it('returns false for grid-up codes (0, 1, 4, 5, 6)', async () => {
    const { deriveGridDown } = await import('../../src/utils/grid');
    for (const code of [0, 1, 4, 5, 6]) {
      expect(deriveGridDown(code)).toBe(false);
    }
  });

  it('returns false for an unknown code', async () => {
    const { deriveGridDown } = await import('../../src/utils/grid');
    expect(deriveGridDown(99)).toBe(false);
  });

  it('returns false for undefined', async () => {
    const { deriveGridDown } = await import('../../src/utils/grid');
    expect(deriveGridDown(undefined as unknown as number)).toBe(false);
  });

  it('returns false for NaN', async () => {
    const { deriveGridDown } = await import('../../src/utils/grid');
    expect(deriveGridDown(NaN)).toBe(false);
  });

  it('returns false for a non-integer in the grid-down range', async () => {
    const { deriveGridDown } = await import('../../src/utils/grid');
    expect(deriveGridDown(2.5)).toBe(false);
  });
});
