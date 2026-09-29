import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';

import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { SessionStore } from '../session/session.store';
import { openTestSession } from '../session/testing';
import { appAccessGuard, appHome, sectionHome } from './app-access.guard';

function run(guard: CanActivateFn, permissions: string[], data: object = {}, url = '/app') {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  openTestSession(TestBed.inject(SessionStore), { permissions });
  return TestBed.runInInjectionContext(() =>
    guard({ data } as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
  ) as boolean | UrlTree;
}

describe('Application access guards (UX only: the API checks every call)', () => {
  it('the home of an application: its first screen open in the active company', () => {
    expect(String(run(appHome('accounting'), ['accounting.read']))).toBe(
      '/app/comptabilite/tableau-de-bord',
    );
    expect(String(run(appHome('settings'), ['currencies.read']))).toBe('/app/parametres/devises');
  });

  it('the home of a section: its first screen open', () => {
    expect(String(run(sectionHome('accounting', 'tresorerie'), ['treasury.read']))).toBe(
      '/app/comptabilite/tresorerie/comptes',
    );
  });

  it('an application hidden in the launcher stays closed through its URL, with a reason', () => {
    const result = run(appAccessGuard, ['accounting.read'], { appId: 'partners' });
    expect(String(result)).toBe('/app');
    expect(TestBed.inject(AlcoToastService).toasts()[0]?.message).toBe(
      'Vous n’avez pas accès à l’application Tiers dans cette société.',
    );
  });

  it('an open application passes', () => {
    expect(run(appAccessGuard, ['partners.read'], { appId: 'partners' })).toBe(true);
  });
});
