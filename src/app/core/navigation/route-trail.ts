import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ActivatedRouteSnapshot,
  NavigationEnd,
  Router,
  RouterStateSnapshot,
  TitleStrategy,
} from '@angular/router';
import { Title } from '@angular/platform-browser';
import { filter, map } from 'rxjs';

import { BreadcrumbItem } from '../../shared/ui/breadcrumb/breadcrumb';
import { findApplication } from './applications';

/**
 * Route conventions:
 * - `data.appId` on the route of an application's shell → first crumb (application name);
 * - `data.breadcrumb` (static label) or `resolve.breadcrumb` (record number, resolved from
 *   the API) on each screen route → one crumb. Child routes inheriting the value add nothing.
 */
export function buildTrail(root: ActivatedRouteSnapshot): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [];
  let url = '';
  for (let route: ActivatedRouteSnapshot | null = root; route; route = route.firstChild) {
    const segment = route.url.map((part) => part.path).join('/');
    if (segment) {
      url += `/${segment}`;
    }
    const config = route.routeConfig;
    const app = config?.data?.['appId']
      ? findApplication(config.data['appId'] as string)
      : undefined;
    if (app) {
      items.push({ label: app.label, url: `/${app.path}` });
    }
    const ownsCrumb =
      config?.data?.['breadcrumb'] !== undefined || config?.resolve?.['breadcrumb'] !== undefined;
    if (ownsCrumb && typeof route.data['breadcrumb'] === 'string') {
      items.push({ label: route.data['breadcrumb'], url });
    }
  }
  return items;
}

/** Current breadcrumb, rebuilt after each navigation. */
@Injectable({ providedIn: 'root' })
export class BreadcrumbService {
  private readonly router = inject(Router);

  readonly items = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => buildTrail(this.router.routerState.snapshot.root)),
    ),
    { initialValue: buildTrail(this.router.routerState.snapshot.root) },
  );
}

/** Browser tab title from the same trail: « Écritures · Comptabilité · Alco ». */
@Injectable()
export class AlcoTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const trail = buildTrail(snapshot.root).map((item) => item.label);
    const own = this.buildTitle(snapshot);
    const parts = trail.length > 0 ? trail.reverse() : own ? [own] : [];
    this.title.setTitle([...parts, 'Alco'].join(' · '));
  }
}
