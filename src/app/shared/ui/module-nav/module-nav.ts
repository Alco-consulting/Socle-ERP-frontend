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

const MORE = 'Plus';

/**
 * Horizontal navigation, never a sidebar. Three layouts, switched by CSS only:
 * - wide screens: every entry, groups as menus (« Rapports ▾ », « Plus ▾ »);
 * - tablets (768–1023px): the first `keep` entries, the rest merged into one « Plus ▾ »;
 * - phones (< 768px): a single « current screen ▾ » menu.
 * `variant="section"` is the lighter second level of a domain inside an application
 * (Comptabilité › Trésorerie: Comptes, Opérations…).
 * The entries it receives are already filtered by permissions.
 */
@Component({
  selector: 'alco-module-nav',
  imports: [RouterLink, RouterLinkActive, AlcoDropdown],
  templateUrl: './module-nav.html',
  styleUrl: './module-nav.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.section]': 'variant() === "section"' },
})
export class AlcoModuleNav {
  private readonly router = inject(Router);

  readonly entries = input.required<readonly NavEntry[]>();
  /** Accessible name, e.g. « Navigation Comptabilité ». */
  readonly label = input.required<string>();
  readonly variant = input<'module' | 'section'>('module');
  /** Entries kept visible on tablets; `null` never collapses (short menus). */
  readonly keep = input<number | null>(4);

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

  // ---- Tablet layout: first entries + one merged « Plus ▾ » -------------------------
  protected readonly collapses = computed(() => {
    const keep = this.keep();
    return keep !== null && this.entries().length > keep + 1;
  });
  protected readonly keptEntries = computed(() =>
    this.entries().slice(0, this.keep() ?? undefined),
  );
  protected readonly overflowItems = computed(() =>
    this.flatten(this.entries().slice(this.keep() ?? this.entries().length)),
  );
  protected readonly overflowActive = computed(() =>
    this.overflowItems().some((item) => item.checked),
  );

  // ---- Phone layout: everything in one menu ------------------------------------------
  protected readonly compactItems = computed(() => this.flatten(this.entries()));
  protected readonly currentLabel = computed(
    () => this.compactItems().find((item) => item.checked)?.label ?? 'Menu',
  );

  /** Direct links first-level; a group's links follow a divider named after the group. */
  private flatten(entries: readonly NavEntry[]): DropdownItem[] {
    return entries.flatMap((entry, position) =>
      entry.children
        ? entry.children.map((child, index) => ({
            id: child.url,
            label: child.label,
            description: index === 0 && entry.label !== MORE ? entry.label : undefined,
            route: child.url,
            checked: this.isActive(child.url),
            dividerBefore: index === 0 && position > 0,
          }))
        : [
            {
              id: entry.url ?? entry.label,
              label: entry.label,
              route: entry.url,
              checked: entry.url ? this.isActive(entry.url) : false,
            },
          ],
    );
  }
}
