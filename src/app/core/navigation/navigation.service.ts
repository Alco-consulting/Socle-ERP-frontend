import { Injectable, computed, inject } from '@angular/core';

import { NavEntry } from '../../shared/ui/module-nav/module-nav';
import { SessionStore } from '../session/session.store';
import { APPLICATIONS, AlcoApplication, AppNavEntry, defaultPath } from './applications';

/** Applications and module menus the current user may see, in the active company. */
@Injectable({ providedIn: 'root' })
export class NavigationService {
  private readonly session = inject(SessionStore);

  readonly applications = computed(() =>
    APPLICATIONS.filter((app) => this.session.permissions().has(app.permission)),
  );

  canOpen(app: AlcoApplication): boolean {
    return this.session.can(app.permission);
  }

  homeUrl(app: AlcoApplication): string {
    return `/${app.path}/${defaultPath(app)}`;
  }

  /** Module menu with absolute URLs, without the entries the user may not open. */
  menu(app: AlcoApplication): readonly NavEntry[] {
    const allowed = (permission?: string) => !permission || this.session.can(permission);
    const url = (path: string) => `/${app.path}/${path}`;
    return app.nav
      .filter((entry) => allowed(entry.permission))
      .map((entry: AppNavEntry): NavEntry => {
        if (!entry.children) {
          return { label: entry.label, url: url(entry.path ?? '') };
        }
        const children = entry.children
          .filter((child) => allowed(child.permission))
          .map((child) => ({ label: child.label, url: url(child.path) }));
        return { label: entry.label, children };
      })
      .filter((entry) => !entry.children || entry.children.length > 0);
  }
}
