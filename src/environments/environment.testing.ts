import type { AppConfig } from '../app/core/config/app-config';

/** Unit tests: relative API URL, never the real API (HttpTestingController answers). */
export const environment: AppConfig = {
  name: 'test',
  apiBaseUrl: '/api/v1',
  requestTimeoutMs: 5_000,
  uploadTimeoutMs: 5_000,
};
