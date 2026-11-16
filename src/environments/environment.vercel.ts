import type { AppConfig } from '../app/core/config/app-config';

/**
 * Production sur Vercel. L'API est relayée par Vercel (`vercel.json` : `/api/*` vers
 * api.alcoconsulting.tech) : le navigateur ne voit qu'une origine, celle du site. Les cookies
 * de session et CSRF restent donc ceux du site (lisibles, SameSite=Lax), sans CORS.
 */
export const environment: AppConfig = {
  name: 'production',
  apiBaseUrl: '/api/v1',
  requestTimeoutMs: 30_000,
  uploadTimeoutMs: 120_000,
};
