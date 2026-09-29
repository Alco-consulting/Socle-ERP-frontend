import { inject } from '@angular/core';
import { CanActivateChildFn, CanActivateFn, RedirectFunction, Router } from '@angular/router';

import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { SessionStore } from '../session/session.store';
import { findApplication, findSection } from './applications';
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

/**
 * Every screen of an application: hidden menu entries stay closed through their URL too
 * (missing permission, or a domain the company does not use). Back to the application's
 * home with an explanation.
 */
export const screenAccessGuard: CanActivateChildFn = (route, state) => {
  const navigation = inject(NavigationService);
  if (navigation.canOpenUrl(state.url)) {
    return true;
  }
  let shell = route.parent;
  while (shell && !shell.data['appId']) {
    shell = shell.parent;
  }
  const app = findApplication((shell?.data['appId'] as string) ?? '');
  inject(AlcoToastService).show(
    'warning',
    'Cet écran n’est pas disponible pour votre profil ou pour cette société.',
  );
  return inject(Router).parseUrl(app ? navigation.homeUrl(app) : '/');
};

/** Screen reserved to permissions (e.g. `accounting.create` for « Nouvelle écriture »). */
export function permissionGuard(...permissions: string[]): CanActivateFn {
  return (_route, state) => {
    const session = inject(SessionStore);
    if (permissions.every((permission) => session.can(permission))) {
      return true;
    }
    inject(AlcoToastService).show('warning', 'Votre profil ne permet pas d’ouvrir cet écran.');
    const parent = state.url.split('?')[0].split('/').slice(0, -1).join('/');
    return inject(Router).parseUrl(parent || '/');
  };
}

/** Empty path of an application → its first screen the user may open. */
export function appHome(appId: string): RedirectFunction {
  return () => {
    const app = findApplication(appId);
    return app ? inject(NavigationService).homeUrl(app) : '/';
  };
}

/** Empty path of a section → its first screen the user may open. */
export function sectionHome(appId: string, sectionPath: string): RedirectFunction {
  return () => {
    const navigation = inject(NavigationService);
    const app = findApplication(appId);
    const section = app ? findSection(app, sectionPath) : undefined;
    return app && section ? navigation.sectionHomeUrl(app, section) : '/';
  };
}
