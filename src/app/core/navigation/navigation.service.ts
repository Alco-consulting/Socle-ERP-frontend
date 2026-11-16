import { Injectable, computed, inject } from '@angular/core';

import { NavEntry } from '../../shared/ui/module-nav/module-nav';
import { SessionStore } from '../session/session.store';
import {
  APPLICATIONS,
  APP_ROOT,
  AlcoApplication,
  AppNavEntry,
  AppSection,
  applicationAt,
  findSection,
  menuLinks,
  splitAppUrl,
} from './applications';

/** A condition on every URL under `path` (relative to its application). */
interface Gate {
  readonly path: string;
  readonly permission?: string;
  readonly feature?: string;
}

function gatesOf(nav: readonly AppNavEntry[], prefix = ''): Gate[] {
  const join = (path: string) => (prefix ? `${prefix}/${path}` : path);
  return nav.flatMap((entry): Gate[] => {
    if (!entry.children) {
      return entry.path !== undefined
        ? [{ path: join(entry.path), permission: entry.permission }]
        : [];
    }
    return entry.children
      .filter((child) => !child.unavailable)
      .flatMap((child) => [
        { path: join(child.path), permission: entry.permission },
        { path: join(child.path), permission: child.permission },
      ]);
  });
}

function gatesOfApplication(app: AlcoApplication): Gate[] {
  return [
    ...gatesOf(app.nav),
    // Les écrans hors menu gardent leurs droits.
    ...(app.offMenu ?? []).map((link) => ({ path: link.path, permission: link.permission })),
    ...(app.sections ?? []).flatMap((section) => [
      { path: section.path, permission: section.permission, feature: section.feature },
      ...gatesOf(section.nav, section.path),
    ]),
  ];
}

const GATES = new Map(APPLICATIONS.map((app) => [app.id, gatesOfApplication(app)]));

/** Every menu screen of an application, sections included, relative to the application. */
function screensOf(app: AlcoApplication): string[] {
  return [
    ...menuLinks(app.nav).map((link) => link.path),
    ...(app.sections ?? []).flatMap((section) =>
      menuLinks(section.nav).map((link) => `${section.path}/${link.path}`),
    ),
  ];
}

const SCREENS = new Map(APPLICATIONS.map((app) => [app.id, screensOf(app)]));

/**
 * What the current user may see in the active company: applications of the launcher,
 * module menus, sections and their menus. One rule for all of them: a screen is visible
 * when every permission and company feature on its path is granted; an application, when
 * its permission is and one of its screens is. Permissions are those the server gave for
 * the active company (`SessionStore`): everything is recomputed when it changes.
 * UX only — the API refuses the data anyway.
 */
@Injectable({ providedIn: 'root' })
export class NavigationService {
  private readonly session = inject(SessionStore);

  readonly applications = computed(() => APPLICATIONS.filter((app) => this.canOpen(app)));

  /** Its permission (if any) and at least one of its screens. */
  canOpen(app: AlcoApplication): boolean {
    return (
      (!app.permission || this.session.can(app.permission)) &&
      menuLinks(app.nav).some((link) => this.canOpenPath(app, link.path))
    );
  }

  /** Whether a screen of `app` (path relative to the application) may be opened. */
  canOpenPath(app: AlcoApplication, path: string): boolean {
    return (GATES.get(app.id) ?? [])
      .filter((gate) => path === gate.path || path.startsWith(`${gate.path}/`))
      .every(
        (gate) =>
          (!gate.permission || this.session.can(gate.permission)) &&
          (!gate.feature || this.session.uses(gate.feature)),
      );
  }

  /** Whether an absolute URL may be opened (used by the route guard). */
  canOpenUrl(url: string): boolean {
    const parts = splitAppUrl(url);
    const app = parts ? applicationAt(parts.app) : undefined;
    if (!parts || !app) {
      return true;
    }
    return this.canOpen(app) && this.canOpenPath(app, parts.rest.join('/'));
  }

  /**
   * Where to go once the active company changed, from `url` (permissions already those of
   * the new company): the same menu screen when it is still open — never a record nor the
   * filters of the previous company —, else the application's home, else the launcher.
   */
  landingUrl(url: string): string {
    const parts = splitAppUrl(url);
    const app = parts ? applicationAt(parts.app) : undefined;
    if (!parts || !app) {
      return APP_ROOT;
    }
    if (!this.canOpen(app)) {
      return APP_ROOT;
    }
    const path = parts.rest.join('/');
    const screen = (SCREENS.get(app.id) ?? [])
      .filter((candidate) => path === candidate || path.startsWith(`${candidate}/`))
      .sort((a, b) => b.length - a.length)[0];
    return screen && this.canOpenPath(app, screen)
      ? `${APP_ROOT}/${app.path}/${screen}`
      : this.homeUrl(app);
  }

  /** First screen of the application the user may open (the launcher otherwise). */
  homeUrl(app: AlcoApplication): string {
    const first = menuLinks(app.nav).find((link) => this.canOpenPath(app, link.path));
    return first ? `${APP_ROOT}/${app.path}/${first.path}` : APP_ROOT;
  }

  /**
   * First screen of a section the user may open. When none is (domain not used by the
   * company, missing permission), its first screen anyway: the route guard then explains.
   */
  sectionHomeUrl(app: AlcoApplication, section: AppSection): string {
    const links = menuLinks(section.nav);
    const first =
      links.find((link) => this.canOpenPath(app, `${section.path}/${link.path}`)) ?? links[0];
    return first ? `${APP_ROOT}/${app.path}/${section.path}/${first.path}` : this.homeUrl(app);
  }

  /** Module menu with absolute URLs, without what the user or the company does not use. */
  menu(app: AlcoApplication): readonly NavEntry[] {
    return this.buildMenu(app, app.nav, '');
  }

  /** Menu of a section (« Trésorerie »: Comptes, Opérations…). */
  sectionMenu(app: AlcoApplication, section: AppSection): readonly NavEntry[] {
    return section.withoutBar ? [] : this.buildMenu(app, section.nav, section.path);
  }

  /** The section an URL belongs to (`/app/comptabilite/tresorerie/operations` → Trésorerie). */
  sectionOfUrl(app: AlcoApplication, url: string): AppSection | undefined {
    const parts = splitAppUrl(url);
    return parts?.app === app.path && parts.rest[0] ? findSection(app, parts.rest[0]) : undefined;
  }

  private buildMenu(
    app: AlcoApplication,
    nav: readonly AppNavEntry[],
    prefix: string,
  ): readonly NavEntry[] {
    const relative = (path: string) => (prefix ? `${prefix}/${path}` : path);
    const url = (path: string) => `${APP_ROOT}/${app.path}/${relative(path)}`;
    return nav
      .map((entry): NavEntry | null => {
        if (!entry.children) {
          return entry.path !== undefined && this.canOpenPath(app, relative(entry.path))
            ? { label: entry.label, icon: entry.icon, url: url(entry.path) }
            : null;
        }
        // A menu shows the screens the user may open, plus the functions the API does not
        // offer yet (disabled, with their reason), when the menu has at least one screen.
        const children = entry.children
          .filter((child) => child.unavailable || this.canOpenPath(app, relative(child.path)))
          .map((child) =>
            child.unavailable
              ? { label: child.label, group: child.group, unavailable: child.unavailable }
              : { label: child.label, group: child.group, url: url(child.path) },
          );
        return children.some((child) => child.url)
          ? { label: entry.label, icon: entry.icon, children }
          : null;
      })
      .filter((entry): entry is NavEntry => entry !== null);
  }
}
