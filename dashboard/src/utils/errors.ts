import { trackException } from '../telemetry';

/** Wrap any thrown value into an Error and track it. Always returns an Error. */
export function toTrackedError(err: unknown, fallbackMessage: string): Error {
  if (err instanceof Error) {
    trackException(err);
    return err;
  }
  const error = new Error(fallbackMessage);
  trackException(error);
  return error;
}

/** Extract a user-facing message from any thrown value. */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  return fallback;
}
