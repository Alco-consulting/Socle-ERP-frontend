import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map } from 'rxjs';

import { AlcoDropdown, DropdownItem } from '../dropdown/dropdown';

export interface NavLink {
  readonly label: string;
  /** Absolute URL of the screen. */
  readonly url: string;
}

/** A top-level entry: a direct link, or a group opened as a menu (« Rapports ▾ », « Plus ▾ »). */
export interface NavEntry {
  readonly label: string;
  readonly url?: string;
  readonly children?: readonly NavLink[];
}

/**
 * Horizontal navigation of a module: few entries, secondary screens grouped in menus.
 * Below 768px it collapses into a single « current screen ▾ » menu.
 * The entries it receives are already filtered by permissions.
 */
@Component({
  selector: 'alco-module-nav',
  imports: [RouterLink, RouterLinkActive, AlcoDropdown],
  templateUrl: './module-nav.html',
  styleUrl: './module-nav.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoModuleNav {
  private readonly router = inject(Router);

  readonly entries = input.required<readonly NavEntry[]>();
  /** Accessible name, e.g. « Navigation Comptabilité ». */
  readonly label = input.required<string>();

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected isActive(url: string): boolean {
    const current = this.url().split(/[?#]/)[0];
    return current === url || current.startsWith(`${url}/`);
  }

  protected groupActive(entry: NavEntry): boolean {
    return (entry.children ?? []).some((child) => this.isActive(child.url));
  }

  protected groupItems(entry: NavEntry): readonly DropdownItem[] {
    return (entry.children ?? []).map((child) => ({
      id: child.url,
      label: child.label,
      route: child.url,
      checked: this.isActive(child.url),
    }));
  }

  /** Flat list for the compact (phone) menu. */
  protected readonly compactItems = computed<readonly DropdownItem[]>(() =>
    this.entries().flatMap((entry) =>
      entry.children
        ? entry.children.map((child, index) => ({
            id: child.url,
            label: child.label,
            description: index === 0 ? entry.label : undefined,
            route: child.url,
            checked: this.isActive(child.url),
            dividerBefore: index === 0,
          }))
        : [
            {
              id: entry.url ?? entry.label,
              label: entry.label,
              route: entry.url,
              checked: entry.url ? this.isActive(entry.url) : false,
            },
          ],
    ),
  );

  protected readonly currentLabel = computed(
    () => this.compactItems().find((item) => item.checked)?.label ?? 'Menu',
  );
}
