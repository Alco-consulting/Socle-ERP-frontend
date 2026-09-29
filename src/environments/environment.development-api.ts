import type { AppConfig } from '../app/core/config/app-config';

/**
 * Development against the real API (`npm run start:api`): Django session and company
 * context through the dev proxy (proxy.conf.mjs, target configurable with ALCO_API_TARGET).
 */
export const environment: AppConfig = {
  name: 'development-api',
  apiBaseUrl: '/api/v1',
  requestTimeoutMs: 30_000,
  uploadTimeoutMs: 120_000,
  sessionSource: 'api',
};
