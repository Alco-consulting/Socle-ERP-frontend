import { Injectable, computed, inject, signal } from '@angular/core';
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
import { APP_ROOT, findApplication } from './applications';

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
      items.push({ label: app.label, url: `${APP_ROOT}/${app.path}` });
    }
    const ownsCrumb =
      config?.data?.['breadcrumb'] !== undefined || config?.resolve?.['breadcrumb'] !== undefined;
    if (ownsCrumb && typeof route.data['breadcrumb'] === 'string') {
      items.push({ label: route.data['breadcrumb'], url });
    }
  }
  return items;
}

/**
 * Current breadcrumb, rebuilt after each navigation. A record screen names its own crumb
 * once the record is loaded (`nameCurrent`): no resolver, so the screen keeps its loading
 * state instead of blocking the navigation.
 */
@Injectable({ providedIn: 'root' })
export class BreadcrumbService {
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly named = signal<{ readonly url: string; readonly label: string } | null>(null);

  private readonly trail = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => buildTrail(this.router.routerState.snapshot.root)),
    ),
    { initialValue: buildTrail(this.router.routerState.snapshot.root) },
  );

  readonly items = computed<BreadcrumbItem[]>(() => {
    const named = this.named();
    return this.trail().map((item) =>
      named && item.url === named.url ? { ...item, label: named.label } : item,
    );
  });

  /**
   * Names a crumb of the current screen once its record is loaded: the last one by default
   * (« CLI-001 — Société X »), or a parent one (`level` 1: the record above « Modifier »).
   * The tab title follows.
   */
  nameCurrent(label: string, level = 0): void {
    const items = this.trail();
    const target = items.at(-1 - level);
    if (!target?.url) {
      return;
    }
    this.named.set({ url: target.url, label });
    const labels = this.items()
      .map((item) => item.label)
      .reverse();
    this.title.setTitle([...labels, 'Alco'].join(' · '));
  }
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
