import type { AppConfig } from '../app/core/config/app-config';

/**
 * Development (`npm start`): the real API through the dev proxy (proxy.conf.mjs, target
 * configurable with ALCO_API_TARGET, default the deployed API) — same origin for the
 * browser, so the Django session and CSRF cookies work as in production. Log in with your
 * own account; the automated tests never use one (they answer the API themselves).
 */
export const environment: AppConfig = {
  name: 'development',
  apiBaseUrl: '/api/v1',
  requestTimeoutMs: 30_000,
  uploadTimeoutMs: 120_000,
};
