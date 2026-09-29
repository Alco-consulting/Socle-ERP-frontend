import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';

import { ApiError } from '../http/api-error';
import { SessionStore } from '../session/session.store';
import { openTestSession } from '../session/testing';
import { authGuard, guestGuard, sessionGuard } from './auth.guard';
import { SessionService } from './session.service';

function run(
  guard: typeof authGuard,
  ensureLoaded: () => Promise<boolean>,
  activeCompanyId: string | null = 'c1',
) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: SessionService, useValue: { ensureLoaded } }],
  });
  openTestSession(TestBed.inject(SessionStore), { activeCompanyId });
  return TestBed.runInInjectionContext(() =>
    guard(
      {} as ActivatedRouteSnapshot,
      { url: '/app/comptabilite/ecritures' } as RouterStateSnapshot,
    ),
  ) as Promise<boolean | UrlTree>;
}

describe('authGuard (UX only: the server checks every call)', () => {
  it('lets an open session in', async () => {
    expect(await run(authGuard, () => Promise.resolve(true))).toBe(true);
  });

  it('no session: login, with the page to come back to', async () => {
    const result = (await run(authGuard, () => Promise.resolve(false))) as UrlTree;
    expect(result.toString()).toBe('/login?retour=%2Fapp%2Fcomptabilite%2Fecritures');
  });

  it('server unreachable: login screen explaining it, not a false « log in »', async () => {
    const result = (await run(authGuard, () =>
      Promise.reject(new ApiError('network', 0, null, 'offline')),
    )) as UrlTree;
    expect(result.queryParams).toEqual({
      raison: 'indisponible',
      retour: '/app/comptabilite/ecritures',
    });
  });
});

describe('authGuard and the active company', () => {
  it('an open session without a company goes to the choice of one, then back', async () => {
    const result = (await run(authGuard, () => Promise.resolve(true), null)) as UrlTree;
    expect(result.toString()).toBe('/societe?retour=%2Fapp%2Fcomptabilite%2Fecritures');
  });

  it('the choice of a company needs a session, not a company', async () => {
    expect(await run(sessionGuard, () => Promise.resolve(true), null)).toBe(true);
    TestBed.resetTestingModule();
    const result = (await run(sessionGuard, () => Promise.resolve(false), null)) as UrlTree;
    expect(result.toString()).toBe('/login?retour=%2Fapp%2Fcomptabilite%2Fecritures');
  });
});

describe('guestGuard', () => {
  it('an open session skips the login screen', async () => {
    const result = (await run(guestGuard, () => Promise.resolve(true))) as UrlTree;
    expect(result.toString()).toBe('/app');
  });

  it('anonymous visitors see the login screen', async () => {
    expect(await run(guestGuard, () => Promise.resolve(false))).toBe(true);
  });
});
