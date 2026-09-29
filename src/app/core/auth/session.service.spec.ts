import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiClient } from '../http/api-client';
import { ApiError } from '../http/api-error';
import { clearCookie, envelope, httpMock, provideHttpTesting, setCookie } from '../http/testing';
import { SessionStore } from '../session/session.store';
import { SessionService } from './session.service';

const USER = {
  public_id: 'u-1',
  email: 'mariam.demo@example.org',
  first_name: 'Mariam',
  last_name: 'Démo',
  is_active: true,
  permissions: ['users.read'],
};

const COMPANY_A = {
  public_id: 'aaaaaaaa-0000-4000-8000-000000000001',
  legal_name: 'Alco Guinée SARL (test)',
  trade_name: 'ALCO GUINÉE',
  country: 'GN',
  reference_currency: 'GNF',
  status: 'active',
};

const CONTEXT = {
  current: { company: COMPANY_A, permissions: ['accounting.read', 'reporting.read'] },
  default_company: COMPANY_A.public_id,
  companies: [COMPANY_A],
};

describe('SessionService (Django session)', () => {
  let session: SessionService;
  let store: SessionStore;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: provideHttpTesting() });
    session = TestBed.inject(SessionService);
    store = TestBed.inject(SessionStore);
  });

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  async function signIn(): Promise<void> {
    const loaded = session.ensureLoaded();
    httpMock().expectOne('/api/v1/auth/me/').flush(USER);
    await Promise.resolve();
    await Promise.resolve();
    httpMock().expectOne('/api/v1/company-context/').flush(CONTEXT);
    expect(await loaded).toBe(true);
  }

  it('asks the server once, even for concurrent callers, then fills the session', async () => {
    const first = session.ensureLoaded();
    const second = session.ensureLoaded();
    const me = httpMock().expectOne('/api/v1/auth/me/');
    expect(me.request.headers.has('X-Company-ID')).toBe(false);
    me.flush(USER);
    await Promise.resolve();
    await Promise.resolve();
    const context = httpMock().expectOne('/api/v1/company-context/');
    expect(context.request.headers.has('X-Company-ID')).toBe(false); // default company
    context.flush(CONTEXT);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(session.status()).toBe('authenticated');
    expect(store.user()?.displayName).toBe('Mariam Démo');
    expect(store.activeCompany()?.name).toBe('ALCO GUINÉE');
    expect(store.can('accounting.read')).toBe(true);
    expect(store.can('users.read')).toBe(true); // global permission
    expect(await session.ensureLoaded()).toBe(true); // no new request
  });

  it('no session: anonymous, without company call, and not asked again', async () => {
    const loaded = session.ensureLoaded();
    httpMock()
      .expectOne('/api/v1/auth/me/')
      .flush(envelope('not_authenticated'), { status: 403, statusText: 'Forbidden' });
    expect(await loaded).toBe(false);
    expect(session.status()).toBe('anonymous');
    expect(await session.ensureLoaded()).toBe(false);
  });

  it('server unreachable: rejects (the screen says « unavailable »), and asks again later', async () => {
    const loaded = session.ensureLoaded();
    httpMock().expectOne('/api/v1/auth/me/').error(new ProgressEvent('error'), { status: 0 });
    await expect(loaded).rejects.toBeInstanceOf(ApiError);
    expect(session.status()).toBe('unknown');
    void session.ensureLoaded();
    httpMock()
      .expectOne('/api/v1/auth/me/')
      .flush(envelope('not_authenticated'), { status: 403, statusText: 'x' });
  });

  it('session ending during work: one navigation to the login, with the page to come back to', async () => {
    await signIn();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const api = TestBed.inject(ApiClient);
    const calls = [firstValueFrom(api.get('a/')), firstValueFrom(api.get('b/'))];
    for (const url of ['/api/v1/a/', '/api/v1/b/']) {
      httpMock()
        .expectOne(url)
        .flush(envelope('not_authenticated'), { status: 403, statusText: 'x' });
    }
    await Promise.allSettled(calls);
    expect(session.status()).toBe('expired');
    expect(store.user()).toBeNull();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { raison: 'session-expiree', retour: '/' },
    });
    expect(await session.ensureLoaded()).toBe(false); // no loop of /auth/me/ calls
  });

  it('a 403 permission refusal keeps the session', async () => {
    await signIn();
    const call = firstValueFrom(TestBed.inject(ApiClient).get('users/'));
    httpMock()
      .expectOne('/api/v1/users/')
      .flush(envelope('permission_denied'), { status: 403, statusText: 'x' });
    await expect(call).rejects.toBeInstanceOf(ApiError);
    expect(session.status()).toBe('authenticated');
  });

  it('logout: POST auth/logout/ with the CSRF token, then the login screen', async () => {
    await signIn();
    setCookie('XSRF-TOKEN', 'tok');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const done = session.logout();
    const request = httpMock().expectOne('/api/v1/auth/logout/');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('X-XSRF-TOKEN')).toBe('tok');
    expect(request.request.headers.has('X-Company-ID')).toBe(false);
    request.flush(null, { status: 204, statusText: 'No Content' });
    await done;
    expect(session.status()).toBe('anonymous');
    expect(store.user()).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/login');
  });
});

describe('SessionService (prototype session)', () => {
  it('uses the simulated session: no network call', async () => {
    TestBed.configureTestingModule({
      providers: provideHttpTesting({ sessionSource: 'prototype' }),
    });
    const session = TestBed.inject(SessionService);
    expect(await session.ensureLoaded()).toBe(true);
    httpMock().verify();
  });
});
