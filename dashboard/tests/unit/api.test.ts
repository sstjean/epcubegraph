import { describe, it, expect, vi } from 'vitest';

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
  it('fetchDevices returns DeviceListResponse', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test.com/api/v1');
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
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test.com/api/v1');
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
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test.com/api/v1');
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
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test.com/api/v1');
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

  it('fetchGridPower omits query params when arguments are undefined', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test.com/api/v1');
    await setupAuth();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ metric: 'grid_power_watts', series: [] }),
    });
    const { fetchGridPower } = await import('../../src/api');

    // Act
    await fetchGridPower();

    // Assert — URL should end with /grid? (empty params)
    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const queryString = calledUrl.split('?')[1] ?? '';
    expect(queryString).toBe('');
  });

  it('parses error responses (400/401/403/404/422/503)', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test.com/api/v1');
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
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test.com/api/v1');
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
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test.com/api/v1');
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

  it('throws when getAccessToken returns null on retry', async () => {
    // Arrange — token is valid initially, then null on retry
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test.com/api/v1');
    const { getAccessToken } = await setupAuth();
    let callCount = 0;
    getAccessToken.mockImplementation(() => {
      callCount++;
      return Promise.resolve(callCount === 1 ? 'valid-token' : null);
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'unauthorized' }),
    });
    const { fetchDevices } = await import('../../src/api');

    // Act & Assert — should throw about authentication, not hang
    await expect(fetchDevices()).rejects.toThrow('Authentication in progress');
  });

  it('uses VITE_API_BASE_URL env var for base URL', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test.com/api/v1');
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
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test.com/api/v1');
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
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test.com/api/v1');
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
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test.com/api/v1');
    await setupAuth(null);
    const { fetchDevices } = await import('../../src/api');

    // Act & Assert
    await expect(fetchDevices()).rejects.toThrow('Authentication in progress');
  });

  it('handles empty response body on error without crashing (Fixes #48)', async () => {
    // Arrange — 401 retry exhausted, second 401 has empty body
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test.com/api/v1');
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
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test.com/api/v1');
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

  // ── Vue API functions (Feature 007) ──

  it('fetchVueDevices calls vue devices endpoint', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test.com/api/v1');
    await setupAuth();
    const mockResponse = {
      devices: [
        { device_gid: 480380, device_name: 'Vue 1', display_name: 'Main Panel', connected: true },
      ],
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    });
    const { fetchVueDevices } = await import('../../src/api');

    // Act
    const result = await fetchVueDevices();

    // Assert
    expect(result).toEqual(mockResponse);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/vue/devices'),
      expect.any(Object),
    );
  });

  it('fetchVueBulkCurrentReadings calls bulk current endpoint', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test.com/api/v1');
    await setupAuth();
    const mockResponse = {
      devices: [
        { device_gid: 480380, timestamp: 1712592000, channels: [{ channel_num: '1,2,3', display_name: 'Main', value: 8450.5 }] },
      ],
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    });
    const { fetchVueBulkCurrentReadings } = await import('../../src/api');

    // Act
    const result = await fetchVueBulkCurrentReadings();

    // Assert
    expect(result).toEqual(mockResponse);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/vue/readings/current'),
      expect.any(Object),
    );
  });

  it('fetchVueDailyReadings sends date parameter', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test.com/api/v1');
    await setupAuth();
    const mockResponse = {
      date: '2026-04-09',
      devices: [
        { device_gid: 480380, channels: [{ channel_num: '4', display_name: 'Kitchen', kwh: 3.2 }] },
      ],
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    });
    const { fetchVueDailyReadings } = await import('../../src/api');

    // Act
    const result = await fetchVueDailyReadings('2026-04-09');

    // Assert
    expect(result).toEqual(mockResponse);
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('/vue/readings/daily');
    expect(url).toContain('date=2026-04-09');
  });
});

describe('Settings API', () => {
  it('fetchSettings calls GET /settings', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'true');
    globalThis.fetch = vi.fn();
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
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'true');
    globalThis.fetch = vi.fn();
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
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'true');
    globalThis.fetch = vi.fn();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'Validation failed' }),
    });
    const { updateSetting } = await import('../../src/api');

    // Act
    const error = await updateSetting('bad_key', 'value').catch((err: unknown) => err);

    // Assert
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Validation failed');
  });

  it('authFetchWrite attaches bearer token when auth enabled', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'true');
    globalThis.fetch = vi.fn();
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
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'true');
    globalThis.fetch = vi.fn();
    vi.stubEnv('VITE_DISABLE_AUTH', 'false');
    vi.doMock('../../src/auth', () => ({
      getAccessToken: vi.fn().mockResolvedValue(null),
      initializeMsal: vi.fn(),
      isAuthenticated: vi.fn().mockReturnValue(false),
    }));
    const { updateSetting } = await import('../../src/api');

    // Act
    const error = await updateSetting('key', 'val').catch((err: unknown) => err);

    // Assert
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Authentication in progress');
  });

  it('authFetchWrite handles non-JSON error response', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'true');
    globalThis.fetch = vi.fn();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => { throw new Error('not json'); },
    });
    const { updateSetting } = await import('../../src/api');

    // Act
    const error = await updateSetting('key', 'val').catch((err: unknown) => err);

    // Assert
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('HTTP 500');
  });

  it('authFetchWrite uses status message when error body has no error field', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'true');
    globalThis.fetch = vi.fn();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ message: 'no error field' }),
    });
    const { updateSetting } = await import('../../src/api');

    // Act
    const error = await updateSetting('key', 'val').catch((err: unknown) => err);

    // Assert
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('HTTP 422');
  });

  it('fetchHierarchy returns PanelHierarchyResponse', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'true');
    globalThis.fetch = vi.fn();
    await setupAuth();
    const mockResponse = {
      entries: [{ id: 1, parent_device_gid: 480380, child_device_gid: 480544 }],
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    });
    const { fetchHierarchy } = await import('../../src/api');

    // Act
    const result = await fetchHierarchy();

    // Assert
    expect(result).toEqual(mockResponse);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/settings/hierarchy'),
      expect.any(Object),
    );
  });

  it('updateHierarchy calls PUT /settings/hierarchy with entries', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'true');
    globalThis.fetch = vi.fn();
    await setupAuth();
    const mockResponse = {
      entries: [{ id: 1, parent_device_gid: 480380, child_device_gid: 480544 }],
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    });
    const { updateHierarchy } = await import('../../src/api');

    // Act
    const result = await updateHierarchy([
      { parent_device_gid: 480380, child_device_gid: 480544 },
    ]);

    // Assert
    expect(result).toEqual(mockResponse);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.test/settings/hierarchy',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          entries: [{ parent_device_gid: 480380, child_device_gid: 480544 }],
        }),
      }),
    );
  });

  it('updateHierarchy throws on API validation error', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'true');
    globalThis.fetch = vi.fn();
    await setupAuth();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'Panel hierarchy contains a circular reference' }),
    });
    const { updateHierarchy } = await import('../../src/api');

    // Act
    const error = await updateHierarchy([
      { parent_device_gid: 1, child_device_gid: 2 },
      { parent_device_gid: 2, child_device_gid: 1 },
    ]).catch((err: unknown) => err);

    // Assert
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Panel hierarchy contains a circular reference');
  });

  it('resolveAuthHeaders throws when getAccessToken rejects', async () => {
    // Arrange — auth enabled, getAccessToken rejects
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'true');
    globalThis.fetch = vi.fn();
    vi.stubEnv('VITE_DISABLE_AUTH', 'false');
    vi.doMock('../../src/auth', () => ({
      getAccessToken: vi.fn().mockRejectedValue(new Error('MSAL interaction required')),
      initializeMsal: vi.fn(),
      isAuthenticated: vi.fn(),
    }));
    const { resolveAuthHeaders } = await import('../../src/api');

    // Act & Assert
    await expect(resolveAuthHeaders()).rejects.toThrow('MSAL interaction required');
  });

  it('handles HTTP 204 No Content response', async () => {
    // Arrange — 204 is ok=true, body may be empty
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'true');
    globalThis.fetch = vi.fn();
    await setupAuth();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.resolve(null),
    });
    const { fetchDevices } = await import('../../src/api');

    // Act — .json() returns null
    const result = await fetchDevices();

    // Assert — returns null (caller must handle)
    expect(result).toBeNull();
  });

  it('fetchDevicesByStatus passes status query param', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'true');
    globalThis.fetch = vi.fn();
    await setupAuth();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve({ devices: [] }),
    });
    const { fetchDevicesByStatus } = await import('../../src/api');

    // Act
    await fetchDevicesByStatus('removed');

    // Assert
    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('status=removed');
  });

  it('fetchPendingReplacements returns array from API', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'true');
    globalThis.fetch = vi.fn();
    await setupAuth();
    const items = [{ id: 1, old_device_id: '100', new_device_id: '200', detected_at: '2026-05-08T00:00:00Z' }];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve(items),
    });
    const { fetchPendingReplacements } = await import('../../src/api');

    // Act
    const result = await fetchPendingReplacements();

    // Assert
    expect(result).toEqual(items);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/devices/pending-replacements'),
      expect.any(Object),
    );
  });

  it('dismissPendingReplacement POSTs to dismiss endpoint with id', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'true');
    globalThis.fetch = vi.fn();
    await setupAuth();
    const dismissed = { dismissed: true, old_device_id: '100', new_device_id: '200' };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve(dismissed),
    });
    const { dismissPendingReplacement } = await import('../../src/api');

    // Act
    const result = await dismissPendingReplacement(42);

    // Assert
    expect(result).toEqual(dismissed);
    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('/devices/pending-replacements/42/dismiss');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].method).toBe('POST');
  });

  it('fetchMergePreview sends old/new device IDs as query params', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'true');
    globalThis.fetch = vi.fn();
    await setupAuth();
    const preview = {
      old_device_id: '100', new_device_id: '200',
      readings_to_transfer: 100, conflicts_to_skip: 5,
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve(preview),
    });
    const { fetchMergePreview } = await import('../../src/api');

    // Act
    const result = await fetchMergePreview('100', '200');

    // Assert
    expect(result).toEqual(preview);
    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('old_device_id=100');
    expect(calledUrl).toContain('new_device_id=200');
  });

  it('mergeDevices POSTs to /devices/merge with both device IDs', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'true');
    globalThis.fetch = vi.fn();
    await setupAuth();
    const mergeResult = {
      old_device_id: '100', new_device_id: '200',
      readings_transferred: 4321, conflicts_skipped: 7,
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve(mergeResult),
    });
    const { mergeDevices } = await import('../../src/api');

    // Act
    const result = await mergeDevices('100', '200');

    // Assert
    expect(result).toEqual(mergeResult);
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/devices/merge');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ old_device_id: '100', new_device_id: '200' });
  });

  it('deleteDevice sends DELETE to /devices/{cloudId} and returns the response', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'true');
    globalThis.fetch = vi.fn();
    await setupAuth();
    const deleteResult = { device_id: '5488', readings_deleted: 12345 };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve(deleteResult),
    });
    const { deleteDevice } = await import('../../src/api');

    // Act
    const result = await deleteDevice('5488');

    // Assert
    expect(result).toEqual(deleteResult);
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/devices/5488');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });

  it('deleteDevice attaches Bearer token from getAccessToken when auth is enabled', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'false');
    globalThis.fetch = vi.fn();
    await setupAuth('bearer-xyz');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve({ device_id: '5488', readings_deleted: 0 }),
    });
    const { deleteDevice } = await import('../../src/api');

    // Act
    await deleteDevice('5488');

    // Assert
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer bearer-xyz');
  });

  it('deleteDevice throws when getAccessToken returns no token (auth in progress)', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'false');
    globalThis.fetch = vi.fn();
    await setupAuth(null);
    const { deleteDevice } = await import('../../src/api');

    // Act + Assert
    await expect(deleteDevice('5488')).rejects.toThrow(/Authentication in progress/);
  });

  it('deleteDevice throws ApiError with error body message when response is not OK', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'true');
    globalThis.fetch = vi.fn();
    await setupAuth();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ error: 'Cannot delete an active device' }),
    });
    const { deleteDevice } = await import('../../src/api');

    // Act + Assert
    await expect(deleteDevice('5488')).rejects.toThrow(/Cannot delete an active device/);
  });

  it('deleteDevice throws ApiError with HTTP status fallback when error body has no `error` field', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'true');
    globalThis.fetch = vi.fn();
    await setupAuth();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ detail: 'something' }), // no `error` key
    });
    const { deleteDevice } = await import('../../src/api');

    // Act + Assert — falls through to HTTP status message
    await expect(deleteDevice('5488')).rejects.toThrow(/HTTP 422/);
  });

  it('deleteDevice throws ApiError with HTTP status fallback when error body is not JSON', async () => {
    // Arrange
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');
    vi.stubEnv('VITE_DISABLE_AUTH', 'true');
    globalThis.fetch = vi.fn();
    await setupAuth();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('not json')),
    });
    const { deleteDevice } = await import('../../src/api');

    // Act + Assert
    await expect(deleteDevice('5488')).rejects.toThrow(/HTTP 500/);
  });
});
