import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiClient } from '../http/api-client';
import { ApiError } from '../http/api-error';
import { clearCookie, envelope, httpMock, provideHttpTesting, setCookie } from '../http/testing';
import { NotificationCenter } from '../notifications/notification-center';
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

/** Lets awaited promises move to their next request. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SessionService (Django session)', () => {
  let session: SessionService;
  let store: SessionStore;

  beforeEach(() => {
    sessionStorage.clear();
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
    await settle();
    httpMock().expectOne('/api/v1/company-context/').flush(CONTEXT);
    expect(await loaded).toBe(true);
  }

  describe('start (auth/me)', () => {
    it('asks the server once, even for concurrent callers, then fills the session', async () => {
      const first = session.ensureLoaded();
      const second = session.ensureLoaded();
      expect(store.activity()).toBe('checking');
      const me = httpMock().expectOne('/api/v1/auth/me/');
      expect(me.request.headers.has('X-Company-ID')).toBe(false);
      me.flush(USER);
      await settle();
      const context = httpMock().expectOne('/api/v1/company-context/');
      expect(context.request.headers.has('X-Company-ID')).toBe(false); // default company
      context.flush(CONTEXT);
      expect(await first).toBe(true);
      expect(await second).toBe(true);
      expect(session.status()).toBe('authenticated');
      expect(store.authenticated()).toBe(true);
      expect(store.activity()).toBeNull();
      expect(store.user()?.displayName).toBe('Mariam Démo');
      expect(store.activeCompany()?.name).toBe('ALCO GUINÉE');
      expect(store.can('accounting.read')).toBe(true);
      expect(store.can('users.read')).toBe(true); // global permission (users.* are global)
      expect(await session.ensureLoaded()).toBe(true); // no new request
    });

    it('no session: anonymous, without company call, and not asked again', async () => {
      const loaded = session.ensureLoaded();
      httpMock()
        .expectOne('/api/v1/auth/me/')
        .flush(envelope('not_authenticated'), { status: 403, statusText: 'Forbidden' });
      expect(await loaded).toBe(false);
      expect(session.status()).toBe('anonymous');
      expect(store.error()).toBeNull();
      expect(await session.ensureLoaded()).toBe(false);
    });

    it('server unreachable: rejects with the error kept in the store, and asks again later', async () => {
      const loaded = session.ensureLoaded();
      httpMock().expectOne('/api/v1/auth/me/').error(new ProgressEvent('error'), { status: 0 });
      await expect(loaded).rejects.toBeInstanceOf(ApiError);
      expect(session.status()).toBe('unknown');
      expect(store.error()?.kind).toBe('network');
      void session.ensureLoaded();
      httpMock()
        .expectOne('/api/v1/auth/me/')
        .flush(envelope('not_authenticated'), { status: 403, statusText: 'x' });
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      const loaded = session.ensureLoaded();
      httpMock()
        .expectOne('/api/v1/auth/me/')
        .flush(envelope('not_authenticated'), { status: 403, statusText: 'x' });
      expect(await loaded).toBe(false);
    });

    it('CSRF cookie fetched first, exact payload, the answer is the user (no second auth/me/)', async () => {
      const done = session.login('mariam.demo@example.org', 'correct horse battery');
      expect(store.activity()).toBe('signing-in');
      const csrf = httpMock().expectOne('/api/v1/auth/csrf/');
      setCookie('XSRF-TOKEN', 'before-login');
      csrf.flush(null, { status: 204, statusText: 'No Content' });
      const login = httpMock().expectOne('/api/v1/auth/login/');
      expect(login.request.method).toBe('POST');
      expect(login.request.body).toEqual({
        email: 'mariam.demo@example.org',
        password: 'correct horse battery',
      });
      expect(login.request.headers.get('X-XSRF-TOKEN')).toBe('before-login');
      expect(login.request.headers.has('X-Company-ID')).toBe(false);
      setCookie('XSRF-TOKEN', 'after-login'); // Django rotates the token at login
      login.flush(USER);
      await settle();
      httpMock().expectNone('/api/v1/auth/me/');
      httpMock().expectOne('/api/v1/company-context/').flush(CONTEXT);
      await done;
      expect(session.status()).toBe('authenticated');
      expect(store.activity()).toBeNull();
      expect(store.user()?.email).toBe('mariam.demo@example.org');

      // The next unsafe request carries the rotated token.
      void firstValueFrom(TestBed.inject(ApiClient).post('things/', {}));
      expect(httpMock().expectOne('/api/v1/things/').request.headers.get('X-XSRF-TOKEN')).toBe(
        'after-login',
      );
    });

    it('only the global permissions of auth/me/ count outside the company context', async () => {
      setCookie('XSRF-TOKEN', 'tok');
      const done = session.login('admin@example.org', 'secret');
      // A platform administrator: Django lists every permission for it.
      httpMock()
        .expectOne('/api/v1/auth/login/')
        .flush({ ...USER, permissions: ['accounting.read', 'companies.create', 'users.read'] });
      await settle();
      httpMock()
        .expectOne('/api/v1/company-context/')
        .flush({ ...CONTEXT, current: { company: COMPANY_A, permissions: ['companies.read'] } });
      await done;
      expect(store.can('accounting.read')).toBe(false); // not granted in this company
      expect(store.can('companies.read')).toBe(true);
      expect(store.can('users.read')).toBe(true);
      expect(store.can('companies.create')).toBe(true);
    });

    it('several companies and no default one: open session, no company chosen yet', async () => {
      setCookie('XSRF-TOKEN', 'tok');
      const done = session.login('a@example.org', 'secret');
      httpMock().expectOne('/api/v1/auth/login/').flush(USER);
      await settle();
      httpMock()
        .expectOne('/api/v1/company-context/')
        .flush({
          current: null,
          default_company: null,
          companies: [COMPANY_A, { ...COMPANY_A, public_id: 'b' }],
        });
      await done;
      expect(session.status()).toBe('authenticated');
      expect(store.activeCompany()).toBeNull();
      expect(store.companies().length).toBe(2);
    });

    it('one attempt at a time: a second call joins the running one', async () => {
      setCookie('XSRF-TOKEN', 'tok');
      const first = session.login('a@example.org', 'secret-1');
      const second = session.login('a@example.org', 'secret-1');
      httpMock().expectOne('/api/v1/auth/login/').flush(USER);
      await settle();
      httpMock().expectOne('/api/v1/company-context/').flush(CONTEXT);
      await Promise.all([first, second]);
    });

    it('wrong credentials: the API error, the session stays closed', async () => {
      setCookie('XSRF-TOKEN', 'tok');
      const done = session.login('a@example.org', 'wrong');
      httpMock()
        .expectOne('/api/v1/auth/login/')
        .flush(envelope('invalid_credentials'), { status: 400, statusText: 'Bad Request' });
      await expect(done).rejects.toMatchObject({ code: 'invalid_credentials' });
      expect(session.status()).toBe('anonymous');
      expect(store.user()).toBeNull();
      expect(store.activity()).toBeNull();
    });

    it('invalid CSRF (twice): refused, reported as csrf_failed', async () => {
      setCookie('XSRF-TOKEN', 'stale');
      const done = session.login('a@example.org', 'x');
      httpMock()
        .expectOne('/api/v1/auth/login/')
        .flush(envelope('csrf_failed'), { status: 403, statusText: 'x' });
      httpMock().expectOne('/api/v1/auth/csrf/').flush(null, { status: 204, statusText: 'x' });
      httpMock()
        .expectOne('/api/v1/auth/login/')
        .flush(envelope('csrf_failed'), { status: 403, statusText: 'x' });
      await expect(done).rejects.toMatchObject({ code: 'csrf_failed', kind: 'forbidden' });
    });
  });

  describe('during work', () => {
    it('session ending: one navigation to the login, with the page to come back to', async () => {
      await signIn();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
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
  });

  describe('logout', () => {
    it('POST auth/logout/ with the CSRF token, forgets everything, then the login screen', async () => {
      await signIn();
      expect(sessionStorage.getItem('alco.company')).toBe(COMPANY_A.public_id);
      TestBed.inject(NotificationCenter).load([{ id: 'n', title: 'T', detail: 'D', read: false }]);
      const ended: number[] = [];
      session.ended$.subscribe(() => ended.push(1));
      setCookie('XSRF-TOKEN', 'tok');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      const done = session.logout();
      expect(store.activity()).toBe('signing-out');
      const request = httpMock().expectOne('/api/v1/auth/logout/');
      expect(request.request.method).toBe('POST');
      expect(request.request.headers.get('X-XSRF-TOKEN')).toBe('tok');
      expect(request.request.headers.has('X-Company-ID')).toBe(false);
      request.flush(null, { status: 204, statusText: 'No Content' });
      await done;

      expect(session.status()).toBe('anonymous');
      expect(store.user()).toBeNull();
      expect(store.activeCompany()).toBeNull();
      expect(store.permissions().size).toBe(0);
      expect(sessionStorage.getItem('alco.company')).toBeNull();
      expect(store.companies()).toEqual([]);
      expect(TestBed.inject(NotificationCenter).notifications()).toEqual([]);
      expect(ended.length).toBe(1);
      expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { raison: 'deconnexion' } });
    });

    it('server error: the session is kept (the user may retry)', async () => {
      await signIn();
      setCookie('XSRF-TOKEN', 'tok');
      const done = session.logout();
      httpMock()
        .expectOne('/api/v1/auth/logout/')
        .flush(envelope('server_error'), { status: 500, statusText: 'x' });
      await expect(done).rejects.toMatchObject({ kind: 'server' });
      expect(session.status()).toBe('authenticated');
      expect(store.user()).not.toBeNull();
      expect(store.activity()).toBeNull();
    });

    it('a session already ended on the server counts as logged out', async () => {
      await signIn();
      setCookie('XSRF-TOKEN', 'tok');
      vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const done = session.logout();
      httpMock()
        .expectOne('/api/v1/auth/logout/')
        .flush(envelope('not_authenticated'), { status: 403, statusText: 'x' });
      await done;
      expect(session.status()).toBe('anonymous');
    });
  });
});
