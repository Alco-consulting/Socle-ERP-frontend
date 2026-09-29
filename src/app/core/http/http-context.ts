import { HttpContext, HttpContextToken } from '@angular/common/http';

/** Per-request options read by the interceptors. */

/** Do not send `X-Company-ID` (authentication, company context, health). */
export const SKIP_COMPANY = new HttpContextToken<boolean>(() => false);

/** Do not count the request in the global activity indicator (background calls). */
export const SKIP_LOADING = new HttpContextToken<boolean>(() => false);

/**
 * A « not authenticated » answer is expected and must not end the session (the session
 * bootstrap `auth/me/`, the login itself).
 */
export const SKIP_SESSION_EXPIRY = new HttpContextToken<boolean>(() => false);

/** Time allowed to this request; `null` = the configured default. */
export const REQUEST_TIMEOUT = new HttpContextToken<number | null>(() => null);

/** Internal: this request is already the retry after a refreshed CSRF token. */
export const CSRF_RETRY = new HttpContextToken<boolean>(() => false);

export interface RequestOptions {
  readonly skipCompany?: boolean;
  readonly skipLoading?: boolean;
  readonly skipSessionExpiry?: boolean;
  readonly timeoutMs?: number;
}

export function requestContext(options: RequestOptions = {}): HttpContext {
  const context = new HttpContext();
  if (options.skipCompany) {
    context.set(SKIP_COMPANY, true);
  }
  if (options.skipLoading) {
    context.set(SKIP_LOADING, true);
  }
  if (options.skipSessionExpiry) {
    context.set(SKIP_SESSION_EXPIRY, true);
  }
  if (options.timeoutMs !== undefined) {
    context.set(REQUEST_TIMEOUT, options.timeoutMs);
  }
  return context;
}
