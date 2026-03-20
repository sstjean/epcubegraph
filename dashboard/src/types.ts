// API response types — consumed from Feature 001 REST API
// See specs/002-web-dashboard/data-model.md

export interface Device {
  device: string;
  class: string;
  manufacturer?: string;
  product_code?: string;
  uid?: string;
  online: boolean;
}

export interface DeviceListResponse {
  devices: Device[];
}

export interface InstantQueryResponse {
  status: 'success' | 'error';
  data: {
    resultType: 'vector';
    result: Array<{
      metric: Record<string, string>;
      value: [number, string];
    }>;
  };
  errorType?: string;
  error?: string;
}

export interface RangeQueryResponse {
  status: 'success' | 'error';
  data: {
    resultType: 'matrix';
    result: Array<{
      metric: Record<string, string>;
      values: Array<[number, string]>;
    }>;
  };
  errorType?: string;
  error?: string;
}

export interface DeviceMetricsResponse {
  device: string;
  metrics: string[];
}

export interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  victoriametrics: 'reachable' | 'unreachable';
}

export interface ErrorResponse {
  status: 'error';
  errorType: string;
  error: string;
}

// Client-side types

export type TimeRange = 'today' | '7d' | '30d' | '1y' | 'custom';

export interface TimeRangeValue {
  start: number;
  end: number;
  step: number;
}

export interface AppState {
  selectedTimeRange: TimeRange;
  customStart: Date | null;
  customEnd: Date | null;
  isAuthenticated: boolean;
  isApiReachable: boolean;
  lastRefreshed: Date | null;
}
