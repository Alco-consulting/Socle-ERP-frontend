import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

import { BreadcrumbItem } from '../../shared/ui/breadcrumb/breadcrumb';
import { APP_ROOT, AlcoApplication } from './applications';

/** Where the back arrow leads, and how it is announced (« Retour à Contacts »). */
export interface BackTarget {
  readonly url: string;
  readonly label: string;
}

function pathOf(url: string): string {
  return url.split(/[?#]/)[0];
}

/**
 * The back arrow of every screen: one level up the breadcrumb, never the browser's history
 * (a reload or a shared link would leave the application, a saved form would come back).
 * - A record goes back to its list; when the user came from that list, to the list as it was
 *   left (its filters, its page).
 * - An application's home screen (Tous les contacts, Tableau de bord) goes to the launcher.
 * Started with the application, so the first page seen is already known.
 */
@Injectable({ providedIn: 'root' })
export class BackNavigation {
  private readonly router = inject(Router);
  private current: string | null = null;
  private previous: string | null = null;

  constructor() {
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        if (pathOf(event.urlAfterRedirects) !== pathOf(this.current ?? '')) {
          this.previous = this.current;
        }
        this.current = event.urlAfterRedirects;
      });
  }

  /**
   * The parent of the screen at `url`. `home`: the application's first screen (its root URL
   * leads there, so going « up » to it from it would not move).
   */
  target(
    url: string,
    trail: readonly BreadcrumbItem[],
    app: AlcoApplication | null | undefined,
    home: string | null,
  ): BackTarget | null {
    const parent = trail.at(-2);
    if (!parent?.url) {
      return null;
    }
    const here = pathOf(url);
    const appRoot = app ? `${APP_ROOT}/${app.path}` : null;
    if (parent.url === appRoot && home && (here === pathOf(home) || here === appRoot)) {
      return { url: APP_ROOT, label: 'Applications' };
    }
    const previous = this.previous;
    const back = previous && pathOf(previous) === parent.url ? previous : parent.url;
    return { url: back, label: parent.label };
  }
}
