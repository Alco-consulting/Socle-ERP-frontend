import type { AppConfig } from '../app/core/config/app-config';

/**
 * Development (`npm start`): the validated UX prototype, simulated session, no network
 * call. `/api/v1` goes through the dev proxy (proxy.conf.mjs) when a screen calls the API.
 */
export const environment: AppConfig = {
  name: 'development',
  apiBaseUrl: '/api/v1',
  requestTimeoutMs: 30_000,
  uploadTimeoutMs: 120_000,
  sessionSource: 'prototype',
};
