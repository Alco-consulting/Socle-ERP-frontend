import { Route, Routes } from '@angular/router';

import {
  appAccessGuard,
  appHome,
  screenAccessGuard,
  sectionHome,
} from '../../core/navigation/app-access.guard';
import { AlcoApplication, menuLinks } from '../../core/navigation/applications';
import { TransferKindId } from './transfers/transfer-kinds';

/** The shell of every application, loaded with the first application opened (not at start). */
const moduleShell = () =>
  import('../../core/layout/module-shell/module-shell').then((m) => m.AlcoModuleShell);

const notInPrototype = () =>
  import('./not-in-prototype/not-in-prototype').then((m) => m.NotInPrototypePage);

/**
 * Screens that already show their contextual « Actions ▾ » import/export (path from the
 * application root → kind). Everything else has none.
 */
const TRANSFERS: Readonly<Record<string, TransferKindId>> = {
  'comptabilite/tresorerie/operations': 'treasury',
  'comptabilite/immobilisations/actifs': 'assets',
  'comptabilite/analyse/balance': 'balance',
};

function placeholder(label: string, path: string, fullPath: string): Route {
  return {
    path,
    data: { breadcrumb: label, transfers: TRANSFERS[fullPath] },
    loadComponent: notInPrototype,
  };
}

/**
 * Placeholder routes of the application's own menu links, except the screens a feature
 * already provides (`built`) and the sections (they get `sectionRoutes`).
 */
export function placeholderScreens(app: AlcoApplication, built: readonly string[] = []): Routes {
  const sections = new Set((app.sections ?? []).map((section) => section.path));
  const seen = new Set<string>();
  return menuLinks(app.nav)
    .filter((link) => {
      // A link into a section (`tresorerie/operations`) is served by the section's routes; a
      // screen linked from two menus (Journaux) has one route.
      const fresh = !seen.has(link.path);
      seen.add(link.path);
      return fresh && !built.includes(link.path) && !sections.has(link.path.split('/')[0]);
    })
    .map((link) => placeholder(link.label, link.path, `${app.path}/${link.path}`));
}

/**
 * One route per section (Trésorerie, Immobilisations…): its label in the breadcrumb, its
 * first allowed screen by default, then each of its screens — the one a feature provides
 * (`screens`, path relative to the application: `tresorerie/rapprochements`), else a
 * placeholder.
 */
export function sectionRoutes(app: AlcoApplication, screens: Routes = []): Routes {
  return (app.sections ?? []).map((section) => {
    const prefix = `${section.path}/`;
    const built = screens
      .filter((route) => route.path?.startsWith(prefix))
      .map((route) => ({ ...route, path: (route.path ?? '').slice(prefix.length) }));
    const builtPaths = built.map((route) => route.path);
    return {
      path: section.path,
      data: { breadcrumb: section.label },
      children: [
        {
          path: '',
          pathMatch: 'full',
          canActivate: [sectionHome(app.id, section.path)],
          children: [],
        },
        ...built,
        ...menuLinks(section.nav)
          .filter((link) => !builtPaths.includes(link.path))
          .map((link) =>
            placeholder(link.label, link.path, `${app.path}/${section.path}/${link.path}`),
          ),
      ],
    };
  });
}

/**
 * The shell of an application: access to the application, then to each screen (hidden
 * menu entries stay closed through their URL). `screens` are the routes a feature provides;
 * every other menu link is a placeholder.
 */
export function applicationRoute(app: AlcoApplication, screens: Routes = []): Route {
  const built = screens.map((route) => route.path ?? '');
  // A screen of a section (`tresorerie/rapprochements`) lives among the section's routes.
  const sections = new Set((app.sections ?? []).map((section) => section.path));
  const inSection = (route: Route) => sections.has((route.path ?? '').split('/')[0]);
  return {
    path: app.path,
    loadComponent: moduleShell,
    data: { appId: app.id },
    canActivate: [appAccessGuard],
    canActivateChild: [screenAccessGuard],
    children: [
      { path: '', pathMatch: 'full', canActivate: [appHome(app.id)], children: [] },
      ...screens.filter((route) => !inSection(route)),
      ...placeholderScreens(app, built),
      ...sectionRoutes(app, screens.filter(inSection)),
    ],
  };
}
