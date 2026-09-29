import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

import { APP_CONFIG } from '../config/app-config';

/**
 * The API's address, resolved once from the configuration: builds endpoint URLs and tells
 * whether a request targets the API, and whether the API is on the page's origin.
 * The only place that knows `apiBaseUrl`; services never write a host.
 */
@Injectable({ providedIn: 'root' })
export class ApiConfig {
  private readonly pageUrl = inject(DOCUMENT).location.href;

  /** `https://api.alcoconsulting.tech/api/v1` or `/api/v1`, without trailing slash. */
  readonly baseUrl = inject(APP_CONFIG).apiBaseUrl.replace(/\/+$/, '');
  /** Absolute form of `baseUrl`, for comparisons. */
  private readonly absoluteBase = new URL(`${this.baseUrl}/`, this.pageUrl);

  /** True when the API is served by another origin than the page (cookies need CORS). */
  readonly crossOrigin = this.absoluteBase.origin !== new URL(this.pageUrl).origin;

  /** `url('auth/me/')` → `/api/v1/auth/me/`. Refuses absolute URLs and `..` segments. */
  url(path: string): string {
    const clean = path.replace(/^\/+/, '');
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(path) || clean.split(/[/?#]/).includes('..')) {
      throw new Error(`ApiConfig.url() expects a path relative to the API, got « ${path} ».`);
    }
    return `${this.baseUrl}/${clean}`;
  }

  /** Whether `url` points into the API (and so receives session, CSRF, company…). */
  isApiUrl(url: string): boolean {
    const target = this.resolve(url);
    return !!target && target.href.startsWith(this.absoluteBase.href);
  }

  /** Whether `url` has the page's origin (the only case where the CSRF cookie is readable). */
  isSameOrigin(url: string): boolean {
    return this.resolve(url)?.origin === new URL(this.pageUrl).origin;
  }

  private resolve(url: string): URL | null {
    try {
      return new URL(url, this.pageUrl);
    } catch {
      return null;
    }
  }
}
