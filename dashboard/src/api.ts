import { getAccessToken } from './auth';
import type {
  DeviceListResponse,
  CurrentReadingsResponse,
  RangeReadingsResponse,
  DeviceMetricsResponse,
  HealthResponse,
} from './types';

const getBaseUrl = (): string => import.meta.env.VITE_API_BASE_URL;
const authDisabled = import.meta.env.VITE_DISABLE_AUTH === 'true';

async function authFetch(url: string, isRetry = false): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (!authDisabled) {
    const token = await getAccessToken();
    if (!token) {
      throw new Error('Authentication in progress');
    }
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 401 && !isRetry) {
      await getAccessToken();
      return authFetch(url, true);
    }
    const errorBody = await response.json();
    throw new Error(errorBody.error || `HTTP ${response.status}`);
  }

  return response;
}

export async function fetchDevices(): Promise<DeviceListResponse> {
  const response = await authFetch(`${getBaseUrl()}/devices`);
  return response.json();
}

export async function fetchCurrentReadings(metric: string): Promise<CurrentReadingsResponse> {
  const params = new URLSearchParams({ metric });
  const response = await authFetch(`${getBaseUrl()}/readings/current?${params}`);
  return response.json();
}

export async function fetchRangeReadings(
  metric: string,
  start: number,
  end: number,
  step: number,
): Promise<RangeReadingsResponse> {
  const params = new URLSearchParams({
    metric,
    start: String(start),
    end: String(end),
    step: String(step),
  });
  const response = await authFetch(`${getBaseUrl()}/readings/range?${params}`);
  return response.json();
}

export async function fetchGridPower(
  start?: number,
  end?: number,
  step?: number,
): Promise<RangeReadingsResponse> {
  const params = new URLSearchParams();
  if (start !== undefined) params.set('start', String(start));
  if (end !== undefined) params.set('end', String(end));
  if (step !== undefined) params.set('step', String(step));
  const response = await authFetch(`${getBaseUrl()}/grid?${params}`);
  return response.json();
}

export async function fetchDeviceMetrics(device: string): Promise<DeviceMetricsResponse> {
  const response = await authFetch(
    `${getBaseUrl()}/devices/${encodeURIComponent(device)}/metrics`,
  );
  return response.json();
}

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${getBaseUrl()}/health`, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const errorBody = await response.json();
    throw new Error(errorBody.error || `HTTP ${response.status}`);
  }

  return response.json();
}
