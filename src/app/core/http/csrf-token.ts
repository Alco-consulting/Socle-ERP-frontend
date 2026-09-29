import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, defer, finalize, map, of, share } from 'rxjs';

import { ApiConfig } from './api-config';
import { requestContext } from './http-context';

/** Names chosen by the backend (Django `CSRF_COOKIE_NAME` / `CSRF_HEADER_NAME`). */
export const CSRF_COOKIE = 'XSRF-TOKEN';
export const CSRF_HEADER = 'X-XSRF-TOKEN';

/** Endpoint that sets the CSRF cookie (204, no body). */
export const CSRF_ENDPOINT = 'auth/csrf/';

export function readCookie(document: Document, name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie ? document.cookie.split(';') : []) {
    const cookie = part.trim();
    if (cookie.startsWith(prefix)) {
      return decodeURIComponent(cookie.slice(prefix.length));
    }
  }
  return null;
}

/**
 * The CSRF token of the Django session. It lives in the `XSRF-TOKEN` cookie (readable by
 * design: it is not an authentication token); when the cookie is missing, `GET auth/csrf/`
 * sets it. Concurrent requests share one fetch. The token is never stored elsewhere.
 */
@Injectable({ providedIn: 'root' })
export class CsrfToken {
  private readonly document = inject(DOCUMENT);
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfig);
  private inFlight: Observable<string | null> | null = null;

  /** The current token, fetched first if the cookie is missing. */
  token(): Observable<string | null> {
    const current = readCookie(this.document, CSRF_COOKIE);
    return current ? of(current) : this.refresh();
  }

  /** Asks the server for a (new) cookie, then reads it. */
  refresh(): Observable<string | null> {
    this.inFlight ??= defer(() =>
      this.http.get(this.api.url(CSRF_ENDPOINT), {
        context: requestContext({ skipCompany: true, skipLoading: true }),
      }),
    ).pipe(
      map(() => readCookie(this.document, CSRF_COOKIE)),
      finalize(() => (this.inFlight = null)),
      share(),
    );
    return this.inFlight;
  }
}
