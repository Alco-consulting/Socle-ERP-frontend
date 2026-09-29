import { provideHttpClient, withInterceptors, withNoXsrfProtection } from '@angular/common/http';
import { EnvironmentProviders } from '@angular/core';

import { API_INTERCEPTORS } from './interceptors';

/**
 * HttpClient of the application. Angular's built-in XSRF interceptor is replaced by
 * `csrfInterceptor` (same cookie `XSRF-TOKEN`, same header `X-XSRF-TOKEN`, same origin rule)
 * because it also fetches a missing cookie and retries once after a rotated token.
 * CSRF protection stays on: the server enforces it on every unsafe request.
 * XHR backend (not fetch): upload progress for multipart files.
 */
export function provideApi(): EnvironmentProviders {
  return provideHttpClient(withNoXsrfProtection(), withInterceptors(API_INTERCEPTORS));
}
