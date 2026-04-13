import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('telemetry', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  describe('initTelemetry', () => {
    it('initializes ApplicationInsights when connection string is set', async () => {
      // Arrange
      vi.stubEnv('VITE_APPINSIGHTS_CONNECTION_STRING', 'InstrumentationKey=test-key');
      const mockLoadAppInsights = vi.fn();
      const MockAI = vi.fn().mockImplementation(function () {
        this.addTelemetryInitializer = vi.fn();
        this.loadAppInsights = mockLoadAppInsights;
        this.trackException = vi.fn();
        this.trackEvent = vi.fn();
        this.trackPageView = vi.fn();
      });
      vi.doMock('@microsoft/applicationinsights-web', () => ({
        ApplicationInsights: MockAI,
      }));

      // Act
      const { initTelemetry } = await import('../../src/telemetry');
      initTelemetry();

      // Assert
      expect(MockAI).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            connectionString: 'InstrumentationKey=test-key',
          }),
        }),
      );
      expect(mockLoadAppInsights).toHaveBeenCalled();
    });

    it('sets cloud role name via telemetry initializer', async () => {
      // Arrange
      vi.stubEnv('VITE_APPINSIGHTS_CONNECTION_STRING', 'InstrumentationKey=test-key');
      let capturedInitializer: ((item: { tags?: Record<string, string> }) => void) | null = null;
      const MockAI = vi.fn().mockImplementation(function () {
        this.addTelemetryInitializer = vi.fn((fn: (item: { tags?: Record<string, string> }) => void) => { capturedInitializer = fn; });
        this.loadAppInsights = vi.fn();
        this.trackException = vi.fn();
        this.trackEvent = vi.fn();
        this.trackPageView = vi.fn();
      });
      vi.doMock('@microsoft/applicationinsights-web', () => ({
        ApplicationInsights: MockAI,
      }));

      // Act
      const { initTelemetry } = await import('../../src/telemetry');
      initTelemetry();

      // Assert — initializer was registered and sets the role name
      expect(capturedInitializer).not.toBeNull();
      const item: { tags?: Record<string, string> } = {};
      capturedInitializer!(item);
      expect(item.tags).toBeDefined();
      expect(item.tags!['ai.cloud.role']).toBe('epcubegraph-dashboard');
    });

    it('is a no-op when connection string is empty', async () => {
      // Arrange
      vi.stubEnv('VITE_APPINSIGHTS_CONNECTION_STRING', '');
      const MockAI = vi.fn();
      vi.doMock('@microsoft/applicationinsights-web', () => ({
        ApplicationInsights: MockAI,
      }));

      // Act
      const { initTelemetry } = await import('../../src/telemetry');
      initTelemetry();

      // Assert
      expect(MockAI).not.toHaveBeenCalled();
    });

    it('is a no-op when connection string is undefined', async () => {
      // Arrange — VITE_APPINSIGHTS_CONNECTION_STRING not set
      const MockAI = vi.fn();
      vi.doMock('@microsoft/applicationinsights-web', () => ({
        ApplicationInsights: MockAI,
      }));

      // Act
      const { initTelemetry } = await import('../../src/telemetry');
      initTelemetry();

      // Assert
      expect(MockAI).not.toHaveBeenCalled();
    });
  });

  describe('trackException', () => {
    it('calls appInsights.trackException when initialized', async () => {
      // Arrange
      vi.stubEnv('VITE_APPINSIGHTS_CONNECTION_STRING', 'InstrumentationKey=test-key');
      const mockTrackException = vi.fn();
      vi.doMock('@microsoft/applicationinsights-web', () => ({
        ApplicationInsights: vi.fn().mockImplementation(function () {
          this.addTelemetryInitializer = vi.fn();
        this.loadAppInsights = vi.fn();
          this.trackException = mockTrackException;
          this.trackEvent = vi.fn();
          this.trackPageView = vi.fn();
        }),
      }));

      const { initTelemetry, trackException } = await import('../../src/telemetry');
      initTelemetry();

      // Act
      const error = new Error('test error');
      trackException(error);

      // Assert
      expect(mockTrackException).toHaveBeenCalledWith({ exception: error });
    });

    it('is a no-op when not initialized', async () => {
      // Arrange — no connection string, no init
      vi.doMock('@microsoft/applicationinsights-web', () => ({
        ApplicationInsights: vi.fn(),
      }));
      const { trackException } = await import('../../src/telemetry');

      // Act & Assert — should not throw
      expect(() => trackException(new Error('test'))).not.toThrow();
    });
  });

  describe('trackApiError', () => {
    it('calls appInsights.trackEvent with url and status', async () => {
      // Arrange
      vi.stubEnv('VITE_APPINSIGHTS_CONNECTION_STRING', 'InstrumentationKey=test-key');
      const mockTrackEvent = vi.fn();
      vi.doMock('@microsoft/applicationinsights-web', () => ({
        ApplicationInsights: vi.fn().mockImplementation(function () {
          this.addTelemetryInitializer = vi.fn();
        this.loadAppInsights = vi.fn();
          this.trackException = vi.fn();
          this.trackEvent = mockTrackEvent;
          this.trackPageView = vi.fn();
        }),
      }));

      const { initTelemetry, trackApiError } = await import('../../src/telemetry');
      initTelemetry();

      // Act
      trackApiError('/api/v1/health', 503);

      // Assert
      expect(mockTrackEvent).toHaveBeenCalledWith(
        { name: 'ApiError' },
        { url: '/api/v1/health', status: 503 },
      );
    });

    it('is a no-op when not initialized', async () => {
      // Arrange
      vi.doMock('@microsoft/applicationinsights-web', () => ({
        ApplicationInsights: vi.fn(),
      }));
      const { trackApiError } = await import('../../src/telemetry');

      // Act & Assert
      expect(() => trackApiError('/api/v1/test', 500)).not.toThrow();
    });
  });

  describe('trackPageLoad', () => {
    it('calls appInsights.trackPageView when initialized', async () => {
      // Arrange
      vi.stubEnv('VITE_APPINSIGHTS_CONNECTION_STRING', 'InstrumentationKey=test-key');
      const mockTrackPageView = vi.fn();
      vi.doMock('@microsoft/applicationinsights-web', () => ({
        ApplicationInsights: vi.fn().mockImplementation(function () {
          this.addTelemetryInitializer = vi.fn();
        this.loadAppInsights = vi.fn();
          this.trackException = vi.fn();
          this.trackEvent = vi.fn();
          this.trackPageView = mockTrackPageView;
        }),
      }));

      const { initTelemetry, trackPageLoad } = await import('../../src/telemetry');
      initTelemetry();

      // Act
      trackPageLoad();

      // Assert
      expect(mockTrackPageView).toHaveBeenCalled();
    });

    it('is a no-op when not initialized', async () => {
      // Arrange
      vi.doMock('@microsoft/applicationinsights-web', () => ({
        ApplicationInsights: vi.fn(),
      }));
      const { trackPageLoad } = await import('../../src/telemetry');

      // Act & Assert
      expect(() => trackPageLoad()).not.toThrow();
    });
  });
});
