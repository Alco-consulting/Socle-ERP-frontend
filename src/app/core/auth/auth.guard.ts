import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';

import { COMPANY_CHOICE_URL } from '../company/company-context.service';
import { APP_ROOT } from '../navigation/applications';
import { SessionStore } from '../session/session.store';
import { LOGIN_REASON, LOGIN_RETURN, LOGIN_URL, SessionService } from './session.service';

/**
 * A session must be open, else the login screen with the page to come back to; with
 * `withCompany`, an active company too, else the choice of one (`/societe`). Unreachable
 * server: the login screen says so (not « log in »).
 * Everything is injected before the first `await` (no injection context after it).
 */
async function sessionGate(url: string, withCompany: boolean): Promise<true | UrlTree> {
  const router = inject(Router);
  const store = inject(SessionStore);
  const loaded = inject(SessionService).ensureLoaded();
  try {
    if (!(await loaded)) {
      return router.createUrlTree([LOGIN_URL], { queryParams: { [LOGIN_RETURN]: url } });
    }
  } catch {
    return router.createUrlTree([LOGIN_URL], {
      queryParams: { [LOGIN_REASON]: 'indisponible', [LOGIN_RETURN]: url },
    });
  }
  if (withCompany && !store.activeCompany()) {
    return router.createUrlTree([COMPANY_CHOICE_URL], { queryParams: { [LOGIN_RETURN]: url } });
  }
  return true;
}

/**
 * The authenticated area (`/app`): a session and an active company. UX only — every API
 * call is checked by the server anyway.
 */
export const authGuard: CanActivateFn = (_route, state) => sessionGate(state.url, true);

/** The choice of a company: a session, no company needed. */
export const sessionGuard: CanActivateFn = (_route, state) => sessionGate(state.url, false);

/** The login screen is for anonymous visitors: an open session goes straight to `/app`. */
export const guestGuard: CanActivateFn = async () => {
  // Everything injected before the first `await` (no injection context after it).
  const router = inject(Router);
  const loaded = inject(SessionService).ensureLoaded();
  try {
    return (await loaded) ? router.parseUrl(APP_ROOT) : true;
  } catch {
    return true;
  }
};
