import { Routes } from '@angular/router';

import { AlcoModuleShell } from '../../core/layout/module-shell/module-shell';
import { appAccessGuard } from '../../core/navigation/app-access.guard';
import { AlcoApplication, AppNavLink, defaultPath } from '../../core/navigation/applications';

const notInPrototype = () =>
  import('./not-in-prototype/not-in-prototype').then((m) => m.NotInPrototypePage);

/** Screen routes of every navigation link of an application, all on the placeholder page. */
export function placeholderScreens(app: AlcoApplication, except: readonly string[] = []): Routes {
  const links: AppNavLink[] = app.nav.flatMap((entry) =>
    entry.children
      ? [...entry.children]
      : entry.path
        ? [{ label: entry.label, path: entry.path }]
        : [],
  );
  return links
    .filter((link) => !except.includes(link.path))
    .map((link) => ({
      path: link.path,
      data: { breadcrumb: link.label },
      loadComponent: notInPrototype,
    }));
}

/**
 * PROTOTYPE — an application whose screens are not built yet: real shell, real navigation,
 * placeholder screens. Each application gets its real feature routes in its own module.
 */
export function placeholderApplication(app: AlcoApplication): Routes[number] {
  return {
    path: app.path,
    component: AlcoModuleShell,
    data: { appId: app.id },
    canActivate: [appAccessGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: defaultPath(app) },
      ...placeholderScreens(app),
    ],
  };
}
