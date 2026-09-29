import type { AppConfig } from '../app/core/config/app-config';

/**
 * Production. The API answers on api.alcoconsulting.tech. Served from that same origin,
 * the session and CSRF cookies work as is; served from another origin, the backend must
 * first allow it (CORS with credentials, shared CSRF cookie) — see
 * docs/frontend/technical-architecture.md.
 */
export const environment: AppConfig = {
  name: 'production',
  apiBaseUrl: 'https://api.alcoconsulting.tech/api/v1',
  requestTimeoutMs: 30_000,
  uploadTimeoutMs: 120_000,
};
