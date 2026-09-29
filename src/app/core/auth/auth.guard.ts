import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { APP_ROOT } from '../navigation/applications';
import { LOGIN_REASON, LOGIN_RETURN, LOGIN_URL, SessionService } from './session.service';

/**
 * The authenticated area (`/app`): a session must be open, else the login screen with the
 * page to come back to. Unreachable server: the login screen says so (not « log in »).
 * UX only — every API call is checked by the server anyway.
 */
export const authGuard: CanActivateFn = async (_route, state) => {
  // Everything injected before the first `await` (no injection context after it).
  const router = inject(Router);
  const loaded = inject(SessionService).ensureLoaded();
  try {
    if (await loaded) {
      return true;
    }
    return router.createUrlTree([LOGIN_URL], { queryParams: { [LOGIN_RETURN]: state.url } });
  } catch {
    return router.createUrlTree([LOGIN_URL], {
      queryParams: { [LOGIN_REASON]: 'indisponible', [LOGIN_RETURN]: state.url },
    });
  }
};

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
