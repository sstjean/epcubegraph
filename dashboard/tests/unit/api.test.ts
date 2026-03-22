import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock auth module
vi.mock('../../src/auth', () => ({
  getAccessToken: vi.fn().mockResolvedValue('mock-bearer-token'),
  initializeMsal: vi.fn(),
  isAuthenticated: vi.fn().mockReturnValue(true),
  logout: vi.fn(),
}));

describe('api', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test.com/api/v1');
    originalFetch = globalThis.fetch;
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetchDevices returns DeviceListResponse', async () => {
    // Arrange
    const mockResponse = {
      devices: [{ device: 'epcube_battery', class: 'storage_battery', online: true }],
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    });
    const { fetchDevices } = await import('../../src/api');

    // Act
    const result = await fetchDevices();

    // Assert
    expect(result).toEqual(mockResponse);
  });

  it('fetchInstantQuery attaches bearer token', async () => {
    // Arrange
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'success', data: { resultType: 'vector', result: [] } }),
    });
    const { fetchInstantQuery } = await import('../../src/api');

    // Act
    await fetchInstantQuery('up');

    // Assert
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/query'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer mock-bearer-token',
        }),
      })
    );
  });

  it('fetchRangeQuery sends correct start/end/step params', async () => {
    // Arrange
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'success', data: { resultType: 'matrix', result: [] } }),
    });
    const { fetchRangeQuery } = await import('../../src/api');

    // Act
    await fetchRangeQuery('epcube_battery_power_watts', 1000, 2000, 60);

    // Assert
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('start=1000');
    expect(url).toContain('end=2000');
    expect(url).toContain('step=60');
  });

  it('fetchGridPower calls grid endpoint', async () => {
    // Arrange
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'success', data: { resultType: 'matrix', result: [] } }),
    });
    const { fetchGridPower } = await import('../../src/api');

    // Act
    await fetchGridPower(1000, 2000, 60);

    // Assert
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/grid'),
      expect.any(Object)
    );
  });

  it('fetchDeviceMetrics returns metric list', async () => {
    // Arrange
    const mockResponse = { device: 'epcube_battery', metrics: ['power_watts', 'soc_percent'] };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    });
    const { fetchDeviceMetrics } = await import('../../src/api');

    // Act
    const result = await fetchDeviceMetrics('epcube_battery');

    // Assert
    expect(result).toEqual(mockResponse);
  });

  it('fetchHealth returns health status', async () => {
    // Arrange
    const mockResponse = { status: 'healthy', victoriametrics: 'reachable' };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    });
    const { fetchHealth } = await import('../../src/api');

    // Act
    const result = await fetchHealth();

    // Assert
    expect(result).toEqual(mockResponse);
    // fetchHealth should NOT attach an Authorization header (endpoint is AllowAnonymous)
    const callHeaders = (globalThis.fetch as any).mock.calls[0][1]?.headers ?? {};
    expect(callHeaders.Authorization).toBeUndefined();
  });

  it('fetchHealth throws on error response', async () => {
    // Arrange — no `error` field to exercise the HTTP status fallback branch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({}),
    });
    const { fetchHealth } = await import('../../src/api');

    // Act & Assert
    await expect(fetchHealth()).rejects.toThrow('HTTP 503');
  });

  it('parses error responses (400/401/403/404/422/503)', async () => {
    // Arrange
    const errorResponse = { status: 'error', errorType: 'bad_data', error: 'invalid query' };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve(errorResponse),
    });
    const { fetchDevices } = await import('../../src/api');

    // Act & Assert
    await expect(fetchDevices()).rejects.toThrow('invalid query');
  });

  it('401 triggers re-auth and retries request once (FR-014)', async () => {
    // Arrange
    const { getAccessToken } = await import('../../src/auth');
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ status: 'error', errorType: 'unauthorized', error: 'token expired' }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ devices: [] }),
      });
    });
    const { fetchDevices } = await import('../../src/api');

    // Act
    const result = await fetchDevices();

    // Assert — retried and succeeded
    expect(result).toEqual({ devices: [] });
    expect(getAccessToken).toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('401 retry does not loop infinitely', async () => {
    // Arrange
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ status: 'error', errorType: 'unauthorized', error: 'token expired' }),
    });
    const { fetchDevices } = await import('../../src/api');

    // Act & Assert — second 401 throws instead of retrying again
    await expect(fetchDevices()).rejects.toThrow('token expired');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('uses VITE_API_BASE_URL env var for base URL', async () => {
    // Arrange
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ devices: [] }),
    });
    const { fetchDevices } = await import('../../src/api');

    // Act
    await fetchDevices();

    // Assert
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://api.test.com/api/v1'),
      expect.any(Object)
    );
  });

  it('falls back to HTTP status message when error field missing', async () => {
    // Arrange
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ status: 'error' }),
    });
    const { fetchDevices } = await import('../../src/api');

    // Act & Assert
    await expect(fetchDevices()).rejects.toThrow('HTTP 503');
  });

  it('error on non-401 status does not trigger re-auth', async () => {
    // Arrange
    const { getAccessToken } = await import('../../src/auth');
    (getAccessToken as any).mockClear();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ status: 'error', error: 'internal' }),
    });
    const { fetchDevices } = await import('../../src/api');

    // Act
    try {
      await fetchDevices();
    } catch {
      // expected
    }

    // Assert — getAccessToken called once for initial auth, NOT again for re-auth
    expect(getAccessToken).toHaveBeenCalledTimes(1);
  });

  it('throws when getAccessToken returns null (auth redirect in progress)', async () => {
    // Arrange
    const { getAccessToken } = await import('../../src/auth');
    (getAccessToken as any).mockResolvedValue(null);
    const { fetchDevices } = await import('../../src/api');

    // Act & Assert
    await expect(fetchDevices()).rejects.toThrow('Authentication in progress');
  });
});
