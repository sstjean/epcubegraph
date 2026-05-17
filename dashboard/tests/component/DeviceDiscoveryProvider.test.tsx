import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { h } from 'preact';

vi.mock('../../src/api', () => ({
  fetchPendingReplacements: vi.fn().mockResolvedValue([]),
  dismissPendingReplacement: vi.fn(),
  fetchMergePreview: vi.fn(),
  mergeDevices: vi.fn(),
}));

vi.mock('../../src/telemetry', () => ({
  trackException: vi.fn(),
}));

import { DeviceDiscoveryProvider, useDeviceDiscoveryContext } from '../../src/hooks/useDeviceDiscovery';

function Consumer() {
  const ctx = useDeviceDiscoveryContext();
  return <div data-testid="consumer">pending={ctx.pending.length}</div>;
}

describe('DeviceDiscoveryProvider / useDeviceDiscoveryContext', () => {
  it('provides discovery state to descendants via context', () => {
    // Arrange & Act
    render(
      <DeviceDiscoveryProvider>
        <Consumer />
      </DeviceDiscoveryProvider>,
    );

    // Assert — initial pending count is 0 before any async load completes
    expect(screen.getByTestId('consumer').textContent).toBe('pending=0');
  });

  it('throws when useDeviceDiscoveryContext is used outside the provider', () => {
    // Arrange — silence the expected console.error from React's error boundary
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Act + Assert
    expect(() => render(<Consumer />)).toThrow(
      /useDeviceDiscoveryContext must be used within DeviceDiscoveryProvider/,
    );

    errorSpy.mockRestore();
  });
});
