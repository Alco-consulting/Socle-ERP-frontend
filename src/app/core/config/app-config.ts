import { InjectionToken, Provider } from '@angular/core';

import { environment } from '../../../environments/environment';

/**
 * Where the session comes from:
 * - `api`: the Django session (`auth/me/`, `company-context/`) — the real mode;
 * - `prototype`: the simulated user of the UX prototype, no network call (until the
 *   Authentication module replaces it).
 */
export type SessionSource = 'api' | 'prototype';

/**
 * Build-time configuration of the application. Everything here ships to the browser and is
 * public: never a secret, a password, a key or a token.
 */
export interface AppConfig {
  readonly name: 'development' | 'development-api' | 'test' | 'production';
  /**
   * Base URL of the API, without trailing slash. Relative (`/api/v1`) when the front end is
   * served by the same origin (dev proxy, reverse proxy); absolute otherwise.
   */
  readonly apiBaseUrl: string;
  /** Default time allowed to an API call before it fails with a « timeout » error. */
  readonly requestTimeoutMs: number;
  /** Time allowed to a file upload (multipart). */
  readonly uploadTimeoutMs: number;
  readonly sessionSource: SessionSource;
}

/**
 * Defaults to the environment of the build (file replaced per configuration in
 * angular.json: development, development-api, test, production).
 */
export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG', {
  providedIn: 'root',
  factory: () => environment,
});

export function provideAppConfig(config: AppConfig): Provider {
  return { provide: APP_CONFIG, useValue: config };
}
