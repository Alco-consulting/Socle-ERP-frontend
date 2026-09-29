import { TestBed } from '@angular/core/testing';

import { provideAppConfig } from '../config/app-config';
import { ApiConfig } from './api-config';
import { TEST_CONFIG } from './testing';

function apiConfig(apiBaseUrl: string): ApiConfig {
  TestBed.configureTestingModule({ providers: [provideAppConfig({ ...TEST_CONFIG, apiBaseUrl })] });
  return TestBed.inject(ApiConfig);
}

describe('ApiConfig', () => {
  it('builds endpoint URLs from the single configured base, without double slashes', () => {
    const api = apiConfig('/api/v1/');
    expect(api.url('auth/me/')).toBe('/api/v1/auth/me/');
    expect(api.url('/company-context/')).toBe('/api/v1/company-context/');
  });

  it('refuses anything that is not a path of the API', () => {
    const api = apiConfig('/api/v1');
    expect(() => api.url('https://evil.example/steal')).toThrow();
    expect(() => api.url('//evil.example/steal')).toThrow();
    expect(() => api.url('auth/../../admin/')).toThrow();
  });

  it('same origin (dev proxy, reverse proxy): relative base', () => {
    const api = apiConfig('/api/v1');
    expect(api.crossOrigin).toBe(false);
    expect(api.isApiUrl('/api/v1/auth/me/')).toBe(true);
    expect(api.isApiUrl(`${location.origin}/api/v1/health/`)).toBe(true);
    expect(api.isApiUrl('/assets/logo.svg')).toBe(false);
    expect(api.isApiUrl('/api/v10/other')).toBe(false);
    expect(api.isSameOrigin('/api/v1/auth/me/')).toBe(true);
  });

  it('production URL on another origin: detected as cross-origin', () => {
    const api = apiConfig('https://api.alcoconsulting.tech/api/v1');
    expect(api.url('health/')).toBe('https://api.alcoconsulting.tech/api/v1/health/');
    expect(api.isApiUrl('https://api.alcoconsulting.tech/api/v1/health/')).toBe(true);
    expect(api.isApiUrl('https://evil.example/api/v1/health/')).toBe(false);
    expect(api.crossOrigin).toBe(location.origin !== 'https://api.alcoconsulting.tech');
    expect(api.isSameOrigin('https://api.alcoconsulting.tech/api/v1/health/')).toBe(false);
  });
});
