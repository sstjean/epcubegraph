import { getAccessToken } from './auth';
import { ApiError } from './utils/retry';
import type {
  DeviceListResponse,
  CurrentReadingsResponse,
  RangeReadingsResponse,
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
    let errorMessage = `HTTP ${response.status}`;
    try {
      const errorBody = await response.json();
      errorMessage = errorBody.error || errorMessage;
    } catch {
      // Empty or non-JSON response body — use status code message
    }
    throw new ApiError(errorMessage, response.status);
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

