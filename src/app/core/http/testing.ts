import { provideHttpClient, withInterceptors, withNoXsrfProtection } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EnvironmentProviders, Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AppConfig, provideAppConfig } from '../config/app-config';
import { API_INTERCEPTORS } from './interceptors';

/** Test helpers for the HTTP layer: the real interceptors, a fake backend, a test config. */

export const TEST_CONFIG: AppConfig = {
  name: 'test',
  apiBaseUrl: '/api/v1',
  requestTimeoutMs: 5_000,
  uploadTimeoutMs: 5_000,
};

export function provideHttpTesting(
  config: Partial<AppConfig> = {},
): (Provider | EnvironmentProviders)[] {
  return [
    provideAppConfig({ ...TEST_CONFIG, ...config }),
    provideHttpClient(withNoXsrfProtection(), withInterceptors(API_INTERCEPTORS)),
    provideHttpClientTesting(),
    provideRouter([]),
  ];
}

export function httpMock(): HttpTestingController {
  return TestBed.inject(HttpTestingController);
}

export function setCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/`;
}

export function clearCookie(name: string): void {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

export function envelope(code: string, message = 'Server message.', correlationId = 'corr-1') {
  return { error: { code, message, details: null, correlation_id: correlationId } };
}
