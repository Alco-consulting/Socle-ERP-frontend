import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { SessionStore } from '../session/session.store';
import { findApplication } from './applications';
import { NavigationService } from './navigation.service';

/**
 * Opens an application only if the user may see it; otherwise back to the launcher with
 * an explanation. UX only: the API refuses the data anyway (403).
 */
export const appAccessGuard: CanActivateFn = (route) => {
  const app = findApplication(route.data['appId'] as string);
  if (app && inject(NavigationService).canOpen(app)) {
    return true;
  }
  inject(AlcoToastService).show(
    'warning',
    app
      ? `Vous n’avez pas accès à l’application ${app.label} dans cette société.`
      : 'Cette application n’existe pas.',
  );
  return inject(Router).createUrlTree(['/']);
};

/** Screen reserved to a permission (e.g. `accounting.create` for « Nouvelle écriture »). */
export function permissionGuard(permission: string): CanActivateFn {
  return (_route, state) => {
    if (inject(SessionStore).can(permission)) {
      return true;
    }
    inject(AlcoToastService).show('warning', 'Votre profil ne permet pas d’ouvrir cet écran.');
    const parent = state.url.split('?')[0].split('/').slice(0, -1).join('/');
    return inject(Router).parseUrl(parent || '/');
  };
}
