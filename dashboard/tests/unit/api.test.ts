import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock auth module — bare mocks, each test configures behavior in Arrange
vi.mock('../../src/auth', () => ({
  getAccessToken: vi.fn(),
  initializeMsal: vi.fn(),
  isAuthenticated: vi.fn(),
}));

// Helper: configure auth mock for tests that need authenticated API calls
async function setupAuth(token: string | null = 'mock-bearer-token') {
  const { getAccessToken } = await import('../../src/auth');
  const mock = getAccessToken as ReturnType<typeof vi.fn>;
  mock.mockResolvedValue(token);
  return { getAccessToken: mock };
}

describe('api', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test.com/api/v1');
    originalFetch = globalThis.fetch;
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetchDevices returns DeviceListResponse', async () => {
    // Arrange
    await setupAuth();
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

  it('fetchCurrentReadings attaches bearer token', async () => {
    // Arrange
    await setupAuth();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ metric: 'test_metric', readings: [] }),
    });
    const { fetchCurrentReadings } = await import('../../src/api');

    // Act
    await fetchCurrentReadings('battery_soc');

    // Assert
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/readings/current'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer mock-bearer-token',
        }),
      })
    );
  });

  it('fetchRangeReadings sends correct start/end/step params', async () => {
    // Arrange
    await setupAuth();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ metric: 'test_metric', series: [] }),
    });
    const { fetchRangeReadings } = await import('../../src/api');

    // Act
    await fetchRangeReadings('battery_power_watts', 1000, 2000, 60);

    // Assert
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('start=1000');
    expect(url).toContain('end=2000');
    expect(url).toContain('step=60');
  });

  it('fetchGridPower calls grid endpoint', async () => {
    // Arrange
    await setupAuth();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ metric: 'grid_power_watts', series: [] }),
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

  it('parses error responses (400/401/403/404/422/503)', async () => {
    // Arrange
    await setupAuth();
    const errorResponse = { status: 'error', errorType: 'bad_data', error: 'invalid query' };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve(errorResponse),
    });
    const { fetchDevices } = await import('../../src/api');
    const { ApiError } = await import('../../src/utils/retry');

    // Act & Assert
    try {
      await fetchDevices();
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).message).toBe('invalid query');
      expect((err as InstanceType<typeof ApiError>).status).toBe(400);
    }
  });

  it('401 triggers re-auth and retries request once (FR-014)', async () => {
    // Arrange
    const { getAccessToken } = await setupAuth();
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
    await setupAuth();
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
    await setupAuth();
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
    await setupAuth();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ status: 'error' }),
    });
    const { fetchDevices } = await import('../../src/api');
    const { ApiError } = await import('../../src/utils/retry');

    // Act & Assert
    try {
      await fetchDevices();
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).message).toBe('HTTP 503');
      expect((err as InstanceType<typeof ApiError>).status).toBe(503);
    }
  });

  it('error on non-401 status does not trigger re-auth', async () => {
    // Arrange
    const { getAccessToken } = await setupAuth();
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
    await setupAuth(null);
    const { fetchDevices } = await import('../../src/api');

    // Act & Assert
    await expect(fetchDevices()).rejects.toThrow('Authentication in progress');
  });

  it('handles empty response body on error without crashing (Fixes #48)', async () => {
    // Arrange — 401 retry exhausted, second 401 has empty body
    await setupAuth();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
    });
    const { fetchDevices } = await import('../../src/api');
    const { ApiError } = await import('../../src/utils/retry');

    // Act & Assert — falls back to status code message instead of SyntaxError
    try {
      await fetchDevices();
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).message).toBe('HTTP 401');
      expect((err as InstanceType<typeof ApiError>).status).toBe(401);
    }
  });

  it('handles non-JSON error body (e.g., HTML from Azure proxy)', async () => {
    // Arrange
    await setupAuth();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    });
    const { fetchDevices } = await import('../../src/api');
    const { ApiError } = await import('../../src/utils/retry');

    // Act & Assert
    try {
      await fetchDevices();
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).message).toBe('HTTP 502');
      expect((err as InstanceType<typeof ApiError>).status).toBe(502);
    }
  });
});

describe('Settings API', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'true');
    globalThis.fetch = vi.fn();
  });

  it('fetchSettings calls GET /settings', async () => {
    // Arrange
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ settings: [] }),
    });
    const { fetchSettings } = await import('../../src/api');

    // Act
    const result = await fetchSettings();

    // Assert
    expect(result.settings).toEqual([]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.test/settings',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('updateSetting calls PUT /settings/{key} with body', async () => {
    // Arrange
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    const { updateSetting } = await import('../../src/api');

    // Act
    await updateSetting('epcube_poll_interval_seconds', '60');

    // Assert
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.test/settings/epcube_poll_interval_seconds',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ value: '60' }),
      }),
    );
  });

  it('authFetchWrite tracks API errors on non-ok response', async () => {
    // Arrange
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'Validation failed' }),
    });
    const { updateSetting } = await import('../../src/api');

    // Act & Assert
    try {
      await updateSetting('bad_key', 'value');
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as Error).message).toBe('Validation failed');
    }
  });

  it('authFetchWrite attaches bearer token when auth enabled', async () => {
    // Arrange
    vi.stubEnv('VITE_DISABLE_AUTH', 'false');
    vi.doMock('../../src/auth', () => ({
      getAccessToken: vi.fn().mockResolvedValue('test-token'),
      initializeMsal: vi.fn(),
      isAuthenticated: vi.fn().mockReturnValue(true),
    }));
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const { updateSetting } = await import('../../src/api');

    // Act
    await updateSetting('key', 'val');

    // Assert
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    );
  });

  it('authFetchWrite throws when auth enabled but no token', async () => {
    // Arrange
    vi.stubEnv('VITE_DISABLE_AUTH', 'false');
    vi.doMock('../../src/auth', () => ({
      getAccessToken: vi.fn().mockResolvedValue(null),
      initializeMsal: vi.fn(),
      isAuthenticated: vi.fn().mockReturnValue(false),
    }));
    const { updateSetting } = await import('../../src/api');

    // Act & Assert
    try {
      await updateSetting('key', 'val');
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as Error).message).toBe('Authentication in progress');
    }
  });

  it('authFetchWrite handles non-JSON error response', async () => {
    // Arrange
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => { throw new Error('not json'); },
    });
    const { updateSetting } = await import('../../src/api');

    // Act & Assert
    try {
      await updateSetting('key', 'val');
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as Error).message).toBe('HTTP 500');
    }
  });

  it('authFetchWrite uses status message when error body has no error field', async () => {
    // Arrange
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ message: 'no error field' }),
    });
    const { updateSetting } = await import('../../src/api');

    // Act & Assert
    try {
      await updateSetting('key', 'val');
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as Error).message).toBe('HTTP 422');
    }
  });
});
