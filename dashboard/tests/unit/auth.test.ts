import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock MSAL browser module
vi.mock('@azure/msal-browser', () => {
  const mockAcquireTokenSilent = vi.fn();
  const mockLoginRedirect = vi.fn();
  const mockGetAllAccounts = vi.fn();
  const mockHandleRedirectPromise = vi.fn();
  const mockInitialize = vi.fn();
  return {
    PublicClientApplication: vi.fn().mockImplementation(() => ({
      initialize: mockInitialize,
      acquireTokenSilent: mockAcquireTokenSilent,
      loginRedirect: mockLoginRedirect,
      getAllAccounts: mockGetAllAccounts,
      handleRedirectPromise: mockHandleRedirectPromise,
    })),
    InteractionRequiredAuthError: class InteractionRequiredAuthError extends Error {
      constructor(msg?: string) {
        super(msg);
        this.name = 'InteractionRequiredAuthError';
      }
    },
    mockAcquireTokenSilent,
    mockLoginRedirect,
    mockGetAllAccounts,
    mockHandleRedirectPromise,
  };
});

describe('auth', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_ENTRA_CLIENT_ID', 'test-client-id');
    vi.stubEnv('VITE_ENTRA_TENANT_ID', 'test-tenant-id');
    vi.stubEnv('VITE_ENTRA_API_SCOPE', 'api://test/user_impersonation');
  });

  it('initializes MSAL PublicClientApplication', async () => {
    // Arrange
    const { initializeMsal } = await import('../../src/auth');

    // Act
    const msalInstance = await initializeMsal();

    // Assert
    expect(msalInstance).toBeDefined();
  });

  it('acquireTokenSilent returns access token on success', async () => {
    // Arrange
    const { PublicClientApplication, mockAcquireTokenSilent, mockGetAllAccounts } =
      await import('@azure/msal-browser') as any;
    mockGetAllAccounts.mockReturnValue([{ username: 'user@test.com' }]);
    mockAcquireTokenSilent.mockResolvedValue({ accessToken: 'test-token-123' });
    const { getAccessToken, initializeMsal } = await import('../../src/auth');
    await initializeMsal();

    // Act
    const token = await getAccessToken();

    // Assert
    expect(token).toBe('test-token-123');
  });

  it('falls back to loginRedirect on InteractionRequiredAuthError', async () => {
    // Arrange
    const { InteractionRequiredAuthError, mockAcquireTokenSilent, mockLoginRedirect, mockGetAllAccounts } =
      await import('@azure/msal-browser') as any;
    mockGetAllAccounts.mockReturnValue([{ username: 'user@test.com' }]);
    mockAcquireTokenSilent.mockRejectedValue(new InteractionRequiredAuthError('interaction_required'));
    const { getAccessToken, initializeMsal } = await import('../../src/auth');
    await initializeMsal();

    // Act
    await getAccessToken();

    // Assert
    expect(mockLoginRedirect).toHaveBeenCalled();
  });

  it('loginRedirect preserves current route via state parameter (FR-014)', async () => {
    // Arrange
    const { mockLoginRedirect, mockGetAllAccounts, mockAcquireTokenSilent } =
      await import('@azure/msal-browser') as any;
    const { InteractionRequiredAuthError } = await import('@azure/msal-browser') as any;
    mockGetAllAccounts.mockReturnValue([{ username: 'user@test.com' }]);
    mockAcquireTokenSilent.mockRejectedValue(new InteractionRequiredAuthError('interaction_required'));
    // Simulate being on /history
    Object.defineProperty(window, 'location', {
      value: { pathname: '/history', search: '?range=7d' },
      writable: true,
    });
    const { getAccessToken, initializeMsal } = await import('../../src/auth');
    await initializeMsal();

    // Act
    await getAccessToken();

    // Assert
    expect(mockLoginRedirect).toHaveBeenCalledWith(
      expect.objectContaining({
        state: expect.stringContaining('/history'),
      })
    );
  });

  it('isAuthenticated returns true when accounts exist', async () => {
    // Arrange
    const { mockGetAllAccounts } = await import('@azure/msal-browser') as any;
    mockGetAllAccounts.mockReturnValue([{ username: 'user@test.com' }]);
    const { isAuthenticated, initializeMsal } = await import('../../src/auth');
    await initializeMsal();

    // Act
    const result = isAuthenticated();

    // Assert
    expect(result).toBe(true);
  });

  it('isAuthenticated returns false when no accounts', async () => {
    // Arrange
    const { mockGetAllAccounts } = await import('@azure/msal-browser') as any;
    mockGetAllAccounts.mockReturnValue([]);
    const { isAuthenticated, initializeMsal } = await import('../../src/auth');
    await initializeMsal();

    // Act
    const result = isAuthenticated();

    // Assert
    expect(result).toBe(false);
  });

  it('getAccessToken triggers loginRedirect when no accounts', async () => {
    // Arrange
    const { mockGetAllAccounts, mockLoginRedirect } = await import('@azure/msal-browser') as any;
    mockGetAllAccounts.mockReturnValue([]);
    const { getAccessToken, initializeMsal } = await import('../../src/auth');
    await initializeMsal();

    // Act
    await getAccessToken();

    // Assert
    expect(mockLoginRedirect).toHaveBeenCalled();
  });

  it('getAccessToken re-throws non-InteractionRequired errors', async () => {
    // Arrange
    const { mockGetAllAccounts, mockAcquireTokenSilent } = await import('@azure/msal-browser') as any;
    mockGetAllAccounts.mockReturnValue([{ username: 'user@test.com' }]);
    mockAcquireTokenSilent.mockRejectedValue(new Error('network_error'));
    const { getAccessToken, initializeMsal } = await import('../../src/auth');
    await initializeMsal();

    // Act & Assert
    await expect(getAccessToken()).rejects.toThrow('network_error');
  });

  it('getAccessToken throws when MSAL not initialized', async () => {
    // Arrange
    const { getAccessToken } = await import('../../src/auth');

    // Act & Assert
    await expect(getAccessToken()).rejects.toThrow('MSAL not initialized');
  });

  it('isAuthenticated returns false when MSAL not initialized', async () => {
    // Arrange
    const { isAuthenticated } = await import('../../src/auth');

    // Act & Assert
    expect(isAuthenticated()).toBe(false);
  });

});
