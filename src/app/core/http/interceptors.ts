import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, finalize, switchMap, throwError, timeout } from 'rxjs';

import { APP_CONFIG } from '../config/app-config';
import { SessionStore } from '../session/session.store';
import { ApiConfig } from './api-config';
import { isApiErrorEnvelope, toApiError } from './api-error';
import { AuthFailures } from './auth-failures';
import { CSRF_HEADER, CsrfToken } from './csrf-token';
import {
  CSRF_RETRY,
  REQUEST_TIMEOUT,
  SKIP_COMPANY,
  SKIP_LOADING,
  SKIP_SESSION_EXPIRY,
} from './http-context';
import { LoadingService } from './loading.service';

/**
 * Functional interceptors, one responsibility each, applied to API requests only (any other
 * URL passes through untouched). Registration order (outermost first):
 * loading → errors → credentials → company → csrf.
 */

export const COMPANY_HEADER = 'X-Company-ID';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

/** Counts API calls for the activity bar, until their very end (errors and retries included). */
export const loadingInterceptor: HttpInterceptorFn = (request, next) => {
  if (request.context.get(SKIP_LOADING) || !inject(ApiConfig).isApiUrl(request.url)) {
    return next(request);
  }
  const loading = inject(LoadingService);
  loading.start();
  return next(request).pipe(finalize(() => loading.stop()));
};

/**
 * Every failure of an API call becomes an `ApiError` (network, timeout, envelope…). A
 * « not authenticated » answer is reported once to the session; a 403 permission refusal
 * is NOT a logout.
 */
export const errorInterceptor: HttpInterceptorFn = (request, next) => {
  if (!inject(ApiConfig).isApiUrl(request.url)) {
    return next(request);
  }
  const config = inject(APP_CONFIG);
  const failures = inject(AuthFailures);
  const limit = request.context.get(REQUEST_TIMEOUT) ?? config.requestTimeoutMs;
  return next(request).pipe(
    // `each`, not `first`: the first event (« sent ») comes at once; what must arrive in time
    // is the answer (for an upload, each progress step).
    timeout({ each: limit }),
    catchError((failure: unknown) => {
      const error = toApiError(failure);
      if (error.kind === 'unauthenticated' && !request.context.get(SKIP_SESSION_EXPIRY)) {
        failures.report();
      }
      return throwError(() => error);
    }),
  );
};

/**
 * Session cookie: sent automatically to the page's origin; to an API on another origin,
 * only with `withCredentials` (the backend must then allow that origin — CORS).
 */
export const credentialsInterceptor: HttpInterceptorFn = (request, next) => {
  const api = inject(ApiConfig);
  if (api.isApiUrl(request.url) && !api.isSameOrigin(request.url) && !request.withCredentials) {
    return next(request.clone({ withCredentials: true }));
  }
  return next(request);
};

/**
 * `X-Company-ID` of the active company, on every API request: features never write this
 * header themselves. A request that sets it explicitly (company switch) keeps its value.
 */
export const companyInterceptor: HttpInterceptorFn = (request, next) => {
  if (
    request.context.get(SKIP_COMPANY) ||
    request.headers.has(COMPANY_HEADER) ||
    !inject(ApiConfig).isApiUrl(request.url)
  ) {
    return next(request);
  }
  const companyId = inject(SessionStore).activeCompany()?.id;
  return next(companyId ? request.clone({ setHeaders: { [COMPANY_HEADER]: companyId } }) : request);
};

function isCsrfFailure(failure: unknown): boolean {
  return (
    failure instanceof HttpErrorResponse &&
    failure.status === 403 &&
    isApiErrorEnvelope(failure.error) &&
    failure.error.error.code === 'csrf_failed'
  );
}

/**
 * CSRF, as Django expects it: `X-XSRF-TOKEN` = cookie `XSRF-TOKEN` on every unsafe request
 * (POST, PUT, PATCH, DELETE — multipart included) to the API on the page's origin. Fetches
 * the cookie when missing; after a `csrf_failed` (token rotated at login), refreshes it and
 * retries once. Never sends the token to another origin. Never disabled.
 */
export const csrfInterceptor: HttpInterceptorFn = (request, next) => {
  const api = inject(ApiConfig);
  if (
    SAFE_METHODS.has(request.method) ||
    !api.isApiUrl(request.url) ||
    !api.isSameOrigin(request.url)
  ) {
    return next(request);
  }
  const csrf = inject(CsrfToken);
  const withToken = (target: HttpRequest<unknown>, token: string | null) =>
    token ? target.clone({ setHeaders: { [CSRF_HEADER]: token } }) : target;

  return csrf.token().pipe(
    switchMap((token) => next(withToken(request, token))),
    catchError((failure: unknown) => {
      if (!isCsrfFailure(failure) || request.context.get(CSRF_RETRY)) {
        return throwError(() => failure);
      }
      const retry = request.clone({ context: request.context.set(CSRF_RETRY, true) });
      return csrf.refresh().pipe(switchMap((token) => next(withToken(retry, token))));
    }),
  );
};

export const API_INTERCEPTORS: HttpInterceptorFn[] = [
  loadingInterceptor,
  errorInterceptor,
  credentialsInterceptor,
  companyInterceptor,
  csrfInterceptor,
];
