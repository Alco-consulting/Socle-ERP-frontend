import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { SessionStore } from '../session/session.store';
import { ApiClient } from './api-client';
import { ApiError } from './api-error';
import { AuthFailures } from './auth-failures';
import { requestContext } from './http-context';
import { LoadingService } from './loading.service';
import { clearCookie, envelope, httpMock, provideHttpTesting, setCookie } from './testing';

const COMPANY = '7c5f0c3e-4b0a-4f3c-9a55-3b8f5a1d2e10';

function signInCompany(): void {
  TestBed.inject(SessionStore).load({
    user: { displayName: 'Test', email: 'test@example.org' },
    companies: [
      {
        id: COMPANY,
        name: 'Société test',
        fiscalYearLabel: '',
        currency: 'GNF',
        permissions: [],
        features: null,
      },
    ],
    activeCompanyId: COMPANY,
  });
}

async function failureOf(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('Expected a failure');
}

describe('API interceptors', () => {
  let api: ApiClient;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideHttpTesting() });
    api = TestBed.inject(ApiClient);
  });

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  describe('CSRF (X-XSRF-TOKEN = cookie XSRF-TOKEN)', () => {
    it('GET never carries the token', () => {
      setCookie('XSRF-TOKEN', 'tok');
      void firstValueFrom(api.get('auth/me/'));
      const request = httpMock().expectOne('/api/v1/auth/me/');
      expect(request.request.headers.has('X-XSRF-TOKEN')).toBe(false);
      request.flush({});
    });

    it.each(['post', 'patch', 'delete'] as const)(
      '%s carries the token of the cookie',
      (method) => {
        setCookie('XSRF-TOKEN', 'tok-123');
        const call =
          method === 'delete' ? api.delete('things/1/') : api[method]('things/1/', { a: 1 });
        void firstValueFrom(call);
        const request = httpMock().expectOne('/api/v1/things/1/');
        expect(request.request.headers.get('X-XSRF-TOKEN')).toBe('tok-123');
        request.flush({});
      },
    );

    it('multipart upload carries the token too', () => {
      setCookie('XSRF-TOKEN', 'tok-mp');
      void firstValueFrom(api.upload('documents/', new FormData()));
      const request = httpMock().expectOne('/api/v1/documents/');
      expect(request.request.headers.get('X-XSRF-TOKEN')).toBe('tok-mp');
      request.flush({});
    });

    it('missing cookie: asks auth/csrf/ first, once for concurrent requests', async () => {
      const first = firstValueFrom(api.post('a/', {}));
      const second = firstValueFrom(api.post('b/', {}));
      const csrf = httpMock().expectOne('/api/v1/auth/csrf/');
      expect(csrf.request.method).toBe('GET');
      expect(csrf.request.headers.has('X-Company-ID')).toBe(false);
      setCookie('XSRF-TOKEN', 'fresh'); // what Django's Set-Cookie does
      csrf.flush(null, { status: 204, statusText: 'No Content' });
      const a = httpMock().expectOne('/api/v1/a/');
      const b = httpMock().expectOne('/api/v1/b/');
      expect(a.request.headers.get('X-XSRF-TOKEN')).toBe('fresh');
      expect(b.request.headers.get('X-XSRF-TOKEN')).toBe('fresh');
      a.flush({});
      b.flush({});
      await Promise.all([first, second]);
    });

    it('csrf_failed (token rotated at login): refreshes the cookie and retries once', async () => {
      setCookie('XSRF-TOKEN', 'old');
      const result = firstValueFrom(api.post<{ ok: boolean }>('things/', {}));
      httpMock()
        .expectOne('/api/v1/things/')
        .flush(envelope('csrf_failed'), { status: 403, statusText: 'Forbidden' });
      setCookie('XSRF-TOKEN', 'new');
      httpMock()
        .expectOne('/api/v1/auth/csrf/')
        .flush(null, { status: 204, statusText: 'No Content' });
      const retry = httpMock().expectOne('/api/v1/things/');
      expect(retry.request.headers.get('X-XSRF-TOKEN')).toBe('new');
      retry.flush({ ok: true });
      expect(await result).toEqual({ ok: true });
    });

    it('a second csrf_failed is reported, not retried forever', async () => {
      setCookie('XSRF-TOKEN', 'old');
      const result = firstValueFrom(api.post('things/', {}));
      httpMock()
        .expectOne('/api/v1/things/')
        .flush(envelope('csrf_failed'), { status: 403, statusText: 'x' });
      httpMock().expectOne('/api/v1/auth/csrf/').flush(null, { status: 204, statusText: 'x' });
      httpMock()
        .expectOne('/api/v1/things/')
        .flush(envelope('csrf_failed'), { status: 403, statusText: 'x' });
      const error = await failureOf(result);
      expect(error.code).toBe('csrf_failed');
      expect(error.kind).toBe('forbidden');
    });

    it('never sends the token outside the API', () => {
      setCookie('XSRF-TOKEN', 'secret-to-us');
      void firstValueFrom(TestBed.inject(HttpClient).post('https://other.example/hook', {}));
      const request = httpMock().expectOne('https://other.example/hook');
      expect(request.request.headers.has('X-XSRF-TOKEN')).toBe(false);
      request.flush({});
    });
  });

  describe('X-Company-ID', () => {
    it('is added from the active company, never written by the features', () => {
      signInCompany();
      void firstValueFrom(api.get('accounting/entries/'));
      const request = httpMock().expectOne('/api/v1/accounting/entries/');
      expect(request.request.headers.get('X-Company-ID')).toBe(COMPANY);
      request.flush({});
    });

    it('is absent without an active company, when skipped, and outside the API', () => {
      void firstValueFrom(api.get('health/'));
      expect(httpMock().expectOne('/api/v1/health/').request.headers.has('X-Company-ID')).toBe(
        false,
      );
      signInCompany();
      void firstValueFrom(api.get('auth/me/', { skipCompany: true }));
      expect(httpMock().expectOne('/api/v1/auth/me/').request.headers.has('X-Company-ID')).toBe(
        false,
      );
      void firstValueFrom(TestBed.inject(HttpClient).get('/assets/data.json'));
      expect(httpMock().expectOne('/assets/data.json').request.headers.has('X-Company-ID')).toBe(
        false,
      );
    });
  });

  describe('errors', () => {
    it('every failure becomes an ApiError', async () => {
      const result = firstValueFrom(api.get('companies/x/'));
      httpMock()
        .expectOne('/api/v1/companies/x/')
        .flush(envelope('not_found', 'Not found.', 'corr-9'), {
          status: 404,
          statusText: 'Not Found',
        });
      const error = await failureOf(result);
      expect(error).toBeInstanceOf(ApiError);
      expect(error.kind).toBe('not-found');
      expect(error.correlationId).toBe('corr-9');
    });

    it('network failure', async () => {
      const result = firstValueFrom(api.get('health/'));
      httpMock().expectOne('/api/v1/health/').error(new ProgressEvent('error'), { status: 0 });
      expect((await failureOf(result)).kind).toBe('network');
    });

    it('timeout: no answer in time', async () => {
      const result = firstValueFrom(
        TestBed.inject(HttpClient).get('/api/v1/slow/', {
          context: requestContext({ timeoutMs: 5 }),
        }),
      );
      const request = httpMock().expectOne('/api/v1/slow/');
      const error = await failureOf(result);
      expect(error.kind).toBe('timeout');
      expect(request.cancelled).toBe(true);
    });

    it('« not authenticated » is reported to the session; a permission refusal is not', async () => {
      const reports: number[] = [];
      TestBed.inject(AuthFailures).unauthenticated$.subscribe(() => reports.push(1));

      const denied = firstValueFrom(api.get('users/'));
      httpMock()
        .expectOne('/api/v1/users/')
        .flush(envelope('permission_denied'), { status: 403, statusText: 'x' });
      expect((await failureOf(denied)).kind).toBe('forbidden');
      expect(reports.length).toBe(0);

      const expired = firstValueFrom(api.get('users/'));
      httpMock()
        .expectOne('/api/v1/users/')
        .flush(envelope('not_authenticated'), { status: 403, statusText: 'x' });
      expect((await failureOf(expired)).kind).toBe('unauthenticated');
      expect(reports.length).toBe(1);

      const bootstrap = firstValueFrom(api.get('auth/me/', { skipSessionExpiry: true }));
      httpMock()
        .expectOne('/api/v1/auth/me/')
        .flush(envelope('not_authenticated'), { status: 403, statusText: 'x' });
      await failureOf(bootstrap);
      expect(reports.length).toBe(1);
    });
  });

  describe('loading', () => {
    it('counts API calls until they end, errors included; background calls are not counted', async () => {
      const loading = TestBed.inject(LoadingService);
      const ok = firstValueFrom(api.get('a/'));
      const failed = firstValueFrom(api.get('b/'));
      void firstValueFrom(api.get('c/', { skipLoading: true }));
      expect(loading.count()).toBe(2);
      httpMock().expectOne('/api/v1/a/').flush({});
      await ok;
      expect(loading.busy()).toBe(true);
      httpMock()
        .expectOne('/api/v1/b/')
        .flush(envelope('server_error'), { status: 500, statusText: 'x' });
      await failureOf(failed);
      expect(loading.busy()).toBe(false);
      httpMock().expectOne('/api/v1/c/').flush({});
    });
  });
});

describe('API interceptors — API on another origin (production URL)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: provideHttpTesting({ apiBaseUrl: 'https://api.alcoconsulting.tech/api/v1' }),
    });
  });

  afterEach(() => httpMock().verify());

  it('sends the session cookie (withCredentials) and never a CSRF token it cannot read', () => {
    setCookie('XSRF-TOKEN', 'page-cookie');
    void firstValueFrom(TestBed.inject(ApiClient).post('auth/logout/', null));
    const request = httpMock().expectOne('https://api.alcoconsulting.tech/api/v1/auth/logout/');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.has('X-XSRF-TOKEN')).toBe(false);
    request.flush(null, { status: 204, statusText: 'No Content' });
    clearCookie('XSRF-TOKEN');
  });
});
