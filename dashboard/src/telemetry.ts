import { ApplicationInsights } from '@microsoft/applicationinsights-web';

let appInsights: ApplicationInsights | null = null;

export function initTelemetry(): void {
  const connectionString = import.meta.env.VITE_APPINSIGHTS_CONNECTION_STRING;
  if (!connectionString) return;

  appInsights = new ApplicationInsights({
    config: {
      connectionString,
      enableAutoRouteTracking: false,
      disableTelemetry: false,
    },
  });
  appInsights.addTelemetryInitializer((item) => {
    item.tags = item.tags || [];
    item.tags['ai.cloud.role'] = 'epcubegraph-dashboard';
  });
  appInsights.loadAppInsights();
}

export function trackException(error: Error): void {
  appInsights?.trackException({ exception: error });
}

export function trackApiError(url: string, status: number): void {
  appInsights?.trackEvent({ name: 'ApiError' }, { url, status });
}

export function trackPageLoad(): void {
  appInsights?.trackPageView();
}
