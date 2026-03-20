import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h } from 'preact';

// Mock auth module
vi.mock('../../src/auth', () => ({
  initializeMsal: vi.fn(),
  isAuthenticated: vi.fn(),
  getAccessToken: vi.fn(),
}));

// Mock App to avoid transitive side effects
vi.mock('../../src/App', () => ({
  App: () => <div data-testid="mocked-app">App</div>,
}));

describe('main', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<main><div id="app"></div></main>';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes MSAL on startup', async () => {
    // Arrange
    const { initializeMsal, isAuthenticated } = await import('../../src/auth') as any;
    initializeMsal.mockResolvedValue({});
    isAuthenticated.mockReturnValue(true);

    // Act
    await import('../../src/main');
    // Wait for async bootstrap
    await new Promise((r) => setTimeout(r, 10));

    // Assert
    expect(initializeMsal).toHaveBeenCalled();
  });

  it('redirects unauthenticated user to login', async () => {
    // Arrange
    const { initializeMsal, isAuthenticated, getAccessToken } = await import('../../src/auth') as any;
    initializeMsal.mockResolvedValue({});
    isAuthenticated.mockReturnValue(false);
    getAccessToken.mockResolvedValue(null);

    // Act
    await import('../../src/main');
    await new Promise((r) => setTimeout(r, 10));

    // Assert
    expect(getAccessToken).toHaveBeenCalled();
  });

  it('renders app when authenticated', async () => {
    // Arrange
    const { initializeMsal, isAuthenticated } = await import('../../src/auth') as any;
    initializeMsal.mockResolvedValue({});
    isAuthenticated.mockReturnValue(true);

    // Act
    await import('../../src/main');
    await new Promise((r) => setTimeout(r, 10));

    // Assert
    const appDiv = document.getElementById('app');
    expect(appDiv?.children.length).toBeGreaterThan(0);
  });
});
