import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';

/**
 * What went wrong, as the screens need to know it:
 * - `network`: no answer at all (offline, DNS, CORS, proxy down);
 * - `timeout`: no answer in time;
 * - `unavailable`: the server says it cannot serve now (502, 503, 504);
 * - `bad-request` (400 and other 4xx), `unauthenticated` (session absent or expired),
 *   `forbidden` (403: connected but not allowed — never a logout), `not-found` (404),
 *   `throttled` (429), `server` (500 and other 5xx).
 */
export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'unavailable'
  | 'bad-request'
  | 'unauthenticated'
  | 'forbidden'
  | 'not-found'
  | 'throttled'
  | 'server';

/** Error envelope of the API: `{"error": {"code", "message", "details", "correlation_id"}}`. */
export interface ApiErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
    readonly correlation_id?: string | null;
  };
}

export function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  const error = (value as { error?: { code?: unknown } } | null)?.error;
  return typeof error?.code === 'string';
}

/**
 * The single error type the application sees from the API. `code` is the backend's stable
 * code (`validation_error`, `company_access_denied`…) when the server sent its envelope,
 * `null` otherwise; the front end never invents a backend code.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly kind: ApiErrorKind,
    readonly status: number,
    readonly code: string | null,
    message: string,
    readonly details: unknown = null,
    readonly correlationId: string | null = null,
    /** Seconds to wait before retrying (429 `Retry-After`). */
    readonly retryAfter: number | null = null,
  ) {
    super(message);
  }

  /** Field errors of a `validation_error` (`{ field: [{ message, code }] }`). */
  get fieldErrors(): Readonly<Record<string, readonly { message: string; code: string }[]>> {
    return this.code === 'validation_error' && this.details && typeof this.details === 'object'
      ? (this.details as Record<string, { message: string; code: string }[]>)
      : {};
  }
}

const NOT_AUTHENTICATED = new Set(['not_authenticated', 'authentication_failed']);

function kindOf(status: number, code: string | null): ApiErrorKind {
  if (status === 0) {
    return 'network';
  }
  if (status === 401 || (status === 403 && code !== null && NOT_AUTHENTICATED.has(code))) {
    return 'unauthenticated';
  }
  if (status === 403) {
    return 'forbidden';
  }
  if (status === 404) {
    return 'not-found';
  }
  if (status === 429) {
    return 'throttled';
  }
  if (status === 502 || status === 503 || status === 504) {
    return 'unavailable';
  }
  return status >= 500 ? 'server' : 'bad-request';
}

function retryAfterOf(response: HttpErrorResponse): number | null {
  const header = response.headers?.get('Retry-After');
  const seconds = header !== null && header !== undefined ? Number(header) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/** Turns anything an HTTP call can throw into an `ApiError`. */
export function toApiError(failure: unknown): ApiError {
  if (failure instanceof ApiError) {
    return failure;
  }
  if (failure instanceof TimeoutError) {
    return new ApiError('timeout', 0, null, 'The server did not answer in time.');
  }
  if (failure instanceof HttpErrorResponse) {
    const envelope = isApiErrorEnvelope(failure.error) ? failure.error.error : null;
    const code = envelope?.code ?? null;
    return new ApiError(
      kindOf(failure.status, code),
      failure.status,
      code,
      envelope?.message ?? failure.message,
      envelope?.details ?? null,
      envelope?.correlation_id ?? null,
      retryAfterOf(failure),
    );
  }
  return new ApiError(
    'network',
    0,
    null,
    failure instanceof Error ? failure.message : 'Unknown failure.',
  );
}
