import { ApiError } from "@/lib/api/errors";

const MAX_RATE_LIMIT_WAIT_SECONDS = 30;

/**
 * Query retry policy:
 * - never retry 4xx (they will fail the same way again), except
 * - 429 is retried at most once, honoring Retry-After when it is short enough;
 * - network errors and 5xx are retried once.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      const wait = error.retryAfterSeconds ?? 1;
      return failureCount < 1 && wait <= MAX_RATE_LIMIT_WAIT_SECONDS;
    }
    if (error.status === 408) {
      return false;
    }
    if (error.status >= 400 && error.status < 500) {
      return false;
    }
  }
  return failureCount < 1;
}

export function queryRetryDelay(failureCount: number, error: unknown): number {
  if (error instanceof ApiError && error.status === 429) {
    return Math.max(1, error.retryAfterSeconds ?? 1) * 1000;
  }
  return Math.min(1000 * 2 ** failureCount, 8000);
}
