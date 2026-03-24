// API response types — consumed from Feature 001 REST API
// See specs/002-web-dashboard/data-model.md

export interface Device {
  device: string;
  class: string;
  manufacturer?: string;
  product_code?: string;
  uid?: string;
  online: boolean;
  alias?: string;
}

export interface DeviceListResponse {
  devices: Device[];
}

export interface Reading {
  device_id: string;
  timestamp: number;
  value: number;
}

export interface CurrentReadingsResponse {
  metric: string;
  readings: Reading[];
}

export interface TimeSeriesPoint {
  timestamp: number;
  value: number;
}

export interface TimeSeries {
  device_id: string;
  values: TimeSeriesPoint[];
}

export interface RangeReadingsResponse {
  metric: string;
  series: TimeSeries[];
}

export interface DeviceMetricsResponse {
  device: string;
  metrics: string[];
}

export interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  datastore: 'reachable' | 'unreachable';
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
