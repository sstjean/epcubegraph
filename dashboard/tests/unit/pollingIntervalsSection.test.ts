import { describe, it, expect } from 'vitest';
import { validatePollingValue } from '../../src/components/settings/PollingIntervalsSection';

describe('validatePollingValue', () => {
  it('returns null for valid integer in range', () => {
    expect(validatePollingValue('30')).toBeNull();
  });

  it('returns error for non-integer', () => {
    expect(validatePollingValue('3.5')).toBe('Must be a whole number');
  });

  it('returns error for value below minimum', () => {
    expect(validatePollingValue('0')).toBe('Minimum is 1 second');
  });

  it('returns error for value above maximum', () => {
    expect(validatePollingValue('3601')).toBe('Maximum is 3600 seconds');
  });
});
