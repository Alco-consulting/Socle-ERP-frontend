import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { APP_CONFIG } from '../config/app-config';
import { ApiConfig } from './api-config';
import { RequestOptions, requestContext } from './http-context';

/** Query string values; `null`/`undefined` are left out, arrays repeat the key. */
export type QueryParams = Readonly<
  Record<string, string | number | boolean | readonly (string | number)[] | null | undefined>
>;

export interface ApiRequestOptions extends RequestOptions {
  readonly params?: QueryParams;
}

/** DRF page: `?page=` / `?page_size=` (capped by the server). */
export interface Paginated<T> {
  readonly count: number;
  readonly next: string | null;
  readonly previous: string | null;
  readonly results: readonly T[];
}

/** A file sent by the API as an attachment (`Content-Disposition`). */
export interface ApiFile {
  readonly blob: Blob;
  /** Name given by the server; `null` when it gave none. */
  readonly filename: string | null;
}

/** `attachment; filename="tiers.csv"` (or `filename*=UTF-8''…`) → the file name. */
export function attachmentName(disposition: string | null): string | null {
  if (!disposition) {
    return null;
  }
  const encoded = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, ''));
    } catch {
      return null;
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1].trim() : null;
}

function toHttpParams(params: QueryParams = {}): HttpParams {
  let result = new HttpParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) {
      continue;
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      result = result.append(key, String(item));
    }
  }
  return result;
}

/**
 * The one entry point to the API for the domain services (`AccountingApi`…): paths
 * relative to `apiBaseUrl`, typed answers, `ApiError` on failure. Session, CSRF,
 * `X-Company-ID`, timeouts and errors are handled by the interceptors, never here nor in
 * the services. No business logic.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfig);
  private readonly config = inject(APP_CONFIG);

  get<T>(path: string, options: ApiRequestOptions = {}): Observable<T> {
    return this.http.get<T>(this.api.url(path), this.options(options));
  }

  post<T>(path: string, body: unknown = null, options: ApiRequestOptions = {}): Observable<T> {
    return this.http.post<T>(this.api.url(path), body, this.options(options));
  }

  put<T>(path: string, body: unknown, options: ApiRequestOptions = {}): Observable<T> {
    return this.http.put<T>(this.api.url(path), body, this.options(options));
  }

  patch<T>(path: string, body: unknown, options: ApiRequestOptions = {}): Observable<T> {
    return this.http.patch<T>(this.api.url(path), body, this.options(options));
  }

  delete<T = void>(path: string, options: ApiRequestOptions = {}): Observable<T> {
    return this.http.delete<T>(this.api.url(path), this.options(options));
  }

  /** A file to download (export…), with the name the server gives it. */
  getFile(path: string, options: ApiRequestOptions = {}): Observable<ApiFile> {
    return this.http
      .get(this.api.url(path), {
        ...this.options(options),
        observe: 'response',
        responseType: 'blob',
      })
      .pipe(
        map((response) => ({
          blob: response.body ?? new Blob([]),
          filename: attachmentName(response.headers.get('Content-Disposition')),
        })),
      );
  }

  /**
   * Multipart upload (`FormData`): the browser sets the `Content-Type` boundary itself.
   * Longer default timeout (`uploadTimeoutMs`).
   */
  upload<T>(path: string, data: FormData, options: ApiRequestOptions = {}): Observable<T> {
    return this.http.post<T>(
      this.api.url(path),
      data,
      this.options({ timeoutMs: this.config.uploadTimeoutMs, ...options }),
    );
  }

  private options(options: ApiRequestOptions) {
    return { params: toHttpParams(options.params), context: requestContext(options) };
  }
}
