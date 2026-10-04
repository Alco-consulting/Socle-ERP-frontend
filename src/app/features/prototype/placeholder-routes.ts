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
  'comptabilite/analyse/grand-livre': 'ledger',
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
 * first allowed screen by default, a placeholder for each of its screens.
 */
export function sectionRoutes(app: AlcoApplication): Routes {
  return (app.sections ?? []).map((section) => ({
    path: section.path,
    data: { breadcrumb: section.label },
    children: [
      {
        path: '',
        pathMatch: 'full',
        canActivate: [sectionHome(app.id, section.path)],
        children: [],
      },
      ...menuLinks(section.nav).map((link) =>
        placeholder(link.label, link.path, `${app.path}/${section.path}/${link.path}`),
      ),
    ],
  }));
}

/**
 * The shell of an application: access to the application, then to each screen (hidden
 * menu entries stay closed through their URL). `screens` are the routes a feature provides;
 * every other menu link is a placeholder.
 */
export function applicationRoute(app: AlcoApplication, screens: Routes = []): Route {
  const built = screens.map((route) => route.path ?? '');
  return {
    path: app.path,
    loadComponent: moduleShell,
    data: { appId: app.id },
    canActivate: [appAccessGuard],
    canActivateChild: [screenAccessGuard],
    children: [
      { path: '', pathMatch: 'full', canActivate: [appHome(app.id)], children: [] },
      ...screens,
      ...placeholderScreens(app, built),
      ...sectionRoutes(app),
    ],
  };
}
