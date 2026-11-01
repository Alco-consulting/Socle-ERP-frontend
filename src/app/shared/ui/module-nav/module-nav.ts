import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map } from 'rxjs';

import { AlcoDropdown, DropdownItem } from '../dropdown/dropdown';
import { AlcoIcon } from '../icon/icon';
import { IconName } from '../icon/icons';

export interface NavLink {
  readonly label: string;
  /** Absolute URL of the screen (none for an unavailable function). */
  readonly url?: string;
  /** Title of the link's group inside its menu (« Rapports financiers »). */
  readonly group?: string;
  /**
   * Why the function is not available (no API yet): shown disabled with this reason, never
   * as an operational screen.
   */
  readonly unavailable?: string;
}

/**
 * A top-level entry: a direct link, or a menu (« Analyse ▾ ») whose links may be grouped
 * under titles (`NavLink.group`).
 */
export interface NavEntry {
  readonly label: string;
  /** Drawn before the label (decorative). */
  readonly icon?: IconName;
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
  imports: [RouterLink, RouterLinkActive, AlcoDropdown, AlcoIcon],
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

  /** The menu of the current screen: the first holding it (Plan comptable is in two). */
  private readonly activeGroup = computed(() =>
    this.entries().find((entry) =>
      (entry.children ?? []).some((child) => !!child.url && this.isActive(child.url)),
    ),
  );

  protected groupActive(entry: NavEntry): boolean {
    return this.activeGroup() === entry;
  }

  protected groupItems(entry: NavEntry): readonly DropdownItem[] {
    return (entry.children ?? []).map((child) => this.item(child, child.group));
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

  private item(link: NavLink, group: string | undefined): DropdownItem {
    return {
      id: link.url ?? `${group ?? ''}/${link.label}`,
      label: link.label,
      route: link.unavailable ? undefined : link.url,
      checked: !!link.url && !link.unavailable && this.isActive(link.url),
      disabled: !!link.unavailable,
      description: link.unavailable,
      group,
    };
  }

  /**
   * Direct links first, without a title; then each menu's links under a title: the menu's
   * name, followed by the group's (« Analyse · Rapports financiers ») when it has groups.
   */
  private flatten(entries: readonly NavEntry[]): DropdownItem[] {
    return entries.flatMap((entry) =>
      entry.children
        ? entry.children.map((child) =>
            this.item(
              child,
              entry.label === MORE
                ? child.group
                : [entry.label, child.group].filter(Boolean).join(' · '),
            ),
          )
        : [this.item({ label: entry.label, url: entry.url }, undefined)],
    );
  }
}
