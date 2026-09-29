import { Injectable, computed, inject } from '@angular/core';

import { NavEntry } from '../../shared/ui/module-nav/module-nav';
import { SessionStore } from '../session/session.store';
import {
  APPLICATIONS,
  APP_ROOT,
  AlcoApplication,
  AppNavEntry,
  AppSection,
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
    return entry.children.flatMap((child) => [
      { path: join(child.path), permission: entry.permission },
      { path: join(child.path), permission: child.permission },
    ]);
  });
}

function gatesOfApplication(app: AlcoApplication): Gate[] {
  return [
    ...gatesOf(app.nav),
    ...(app.sections ?? []).flatMap((section) => [
      { path: section.path, permission: section.permission, feature: section.feature },
      ...gatesOf(section.nav, section.path),
    ]),
  ];
}

const GATES = new Map(APPLICATIONS.map((app) => [app.id, gatesOfApplication(app)]));

/**
 * What the current user may see in the active company: applications of the launcher,
 * module menus, sections and their menus. One rule for all of them: a screen is visible
 * when every permission and company feature on its path is granted.
 * UX only — the API refuses the data anyway.
 */
@Injectable({ providedIn: 'root' })
export class NavigationService {
  private readonly session = inject(SessionStore);

  readonly applications = computed(() => APPLICATIONS.filter((app) => this.canOpen(app)));

  canOpen(app: AlcoApplication): boolean {
    return this.session.can(app.permission);
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
    const app = parts ? APPLICATIONS.find((item) => item.path === parts.app) : undefined;
    if (!parts || !app) {
      return true;
    }
    return this.canOpen(app) && this.canOpenPath(app, parts.rest.join('/'));
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
    return this.buildMenu(app, section.nav, section.path);
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
            ? { label: entry.label, url: url(entry.path) }
            : null;
        }
        const children = entry.children
          .filter((child) => this.canOpenPath(app, relative(child.path)))
          .map((child) => ({ label: child.label, url: url(child.path) }));
        return children.length > 0 ? { label: entry.label, children } : null;
      })
      .filter((entry): entry is NavEntry => entry !== null);
  }
}
