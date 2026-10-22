import { DialogRef } from '@angular/cdk/dialog';
import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  Observable,
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  map,
  of,
  startWith,
  switchMap,
} from 'rxjs';

import { AlcoIcon } from '../../../shared/ui/icon/icon';
import { IconName } from '../../../shared/ui/icon/icons';
import { APP_ROOT, AppNavLink, menuLinks } from '../../navigation/applications';
import { NavigationService } from '../../navigation/navigation.service';
import { GLOBAL_SEARCH_SOURCES, SearchHit, matchesAll } from '../../search/global-search';
import { SessionStore } from '../../session/session.store';

interface PaletteItem {
  readonly label: string;
  readonly detail: string;
  readonly url: string;
  readonly icon?: IconName;
  readonly image?: string;
}

interface PaletteGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly PaletteItem[];
}

/** What is created most often, each behind its own permission. */
const ACTIONS: readonly (PaletteItem & { permission: string })[] = [
  {
    label: 'Nouvelle écriture',
    detail: 'Comptabilité › Écritures',
    url: '/app/comptabilite/ecritures/nouvelle',
    icon: 'plus',
    permission: 'accounting.create',
  },
  {
    label: 'Nouvelle facture client',
    detail: 'Comptabilité › Ventes',
    url: '/app/comptabilite/ventes/factures/nouvelle',
    icon: 'plus',
    permission: 'invoicing.create',
  },
  {
    label: 'Nouveau contact',
    detail: 'Contacts',
    url: '/app/contacts/nouveau',
    icon: 'plus',
    permission: 'partners.create',
  },
  {
    label: 'Nouveau virement interne',
    detail: 'Comptabilité › Trésorerie',
    url: '/app/comptabilite/tresorerie/virements/nouveau',
    icon: 'plus',
    permission: 'treasury.create',
  },
];

const SCREENS_SHOWN = 8;
const HITS_SHOWN = 5;

/**
 * The global search (Ctrl+K), as Linear's or Odoo's command palette: the applications, every
 * screen of their menus, what can be created, and the records of the domains that declared a
 * search (contacts, accounts…), all within the user's permissions. ↑ ↓ move, Entrée opens.
 */
@Component({
  selector: 'alco-command-palette',
  imports: [AlcoIcon],
  templateUrl: './command-palette.html',
  styleUrl: './command-palette.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoCommandPalette {
  private readonly dialogRef = inject(DialogRef);
  private readonly router = inject(Router);
  private readonly navigation = inject(NavigationService);
  private readonly session = inject(SessionStore);
  private readonly document = inject(DOCUMENT);
  private readonly sources = inject(GLOBAL_SEARCH_SOURCES, { optional: true }) ?? [];

  protected readonly query = signal('');
  protected readonly active = signal(0);

  /** The applications and their screens the user may open, once each. */
  private readonly catalog = computed(() => {
    const apps: PaletteItem[] = [];
    const screens = new Map<string, PaletteItem>();
    const add = (links: readonly AppNavLink[], root: string, trail: string, image: string) => {
      for (const link of links) {
        const url = `${root}/${link.path}`;
        if (!screens.has(url) && this.navigation.canOpenUrl(url)) {
          const detail = link.group ? `${trail} › ${link.group}` : trail;
          screens.set(url, { label: link.label, detail, url, image });
        }
      }
    };
    for (const app of this.navigation.applications()) {
      const root = `${APP_ROOT}/${app.path}`;
      apps.push({ label: app.label, detail: app.description, url: root, image: app.image });
      add(menuLinks(app.nav), root, app.label, app.image);
      for (const section of app.sections ?? []) {
        add(
          menuLinks(section.nav),
          `${root}/${section.path}`,
          `${app.label} › ${section.label}`,
          app.image,
        );
      }
    }
    return { apps, screens: [...screens.values()] };
  });

  private readonly actions = computed(() =>
    ACTIONS.filter((action) => this.session.can(action.permission)),
  );

  /** The records of the declared searches, two characters typed at least. */
  private readonly records = toSignal(
    toObservable(this.query).pipe(
      map((text) => text.trim()),
      debounceTime(250),
      distinctUntilChanged(),
      switchMap((term) => this.searchRecords(term)),
    ),
    { initialValue: [] as readonly PaletteGroup[] | null },
  );
  protected readonly searching = computed(() => this.records() === null);

  protected readonly groups = computed<readonly PaletteGroup[]>(() => {
    const term = this.query().trim();
    const { apps, screens } = this.catalog();
    const found = (items: readonly PaletteItem[]) =>
      items.filter((item) => matchesAll(`${item.label} ${item.detail}`, term));
    const groups: PaletteGroup[] = term
      ? [
          { id: 'screens', label: 'Écrans', items: found(screens).slice(0, SCREENS_SHOWN) },
          { id: 'actions', label: 'Créer', items: found(this.actions()) },
          { id: 'apps', label: 'Applications', items: found(apps) },
          ...(this.records() ?? []),
        ]
      : [
          { id: 'actions', label: 'Créer', items: this.actions() },
          { id: 'apps', label: 'Applications', items: apps },
        ];
    return groups.filter((group) => group.items.length > 0);
  });

  /** Every result in order, with its element id: the keyboard moves along it. */
  protected readonly entries = computed(() =>
    this.groups()
      .flatMap((group) => group.items)
      .map((item, index) => ({ item, id: `palette-option-${index}` })),
  );
  protected readonly activeId = computed(() => this.entries()[this.active()]?.id ?? null);

  protected idOf(item: PaletteItem): string {
    return this.entries().find((entry) => entry.item === item)?.id ?? '';
  }

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.active.set(0);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.entries().length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (count > 0) {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        this.active.set((this.active() + step + count) % count);
        this.reveal();
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = this.entries()[this.active()];
      if (entry) {
        this.open(entry.item);
      }
    }
  }

  protected point(item: PaletteItem): void {
    const index = this.entries().findIndex((entry) => entry.item === item);
    if (index >= 0 && index !== this.active()) {
      this.active.set(index);
    }
  }

  protected open(item: PaletteItem): void {
    this.dialogRef.close();
    void this.router.navigateByUrl(item.url);
  }

  private reveal(): void {
    const id = this.activeId();
    if (id) {
      this.document.getElementById(id)?.scrollIntoView({ block: 'nearest' });
    }
  }

  private searchRecords(term: string): Observable<readonly PaletteGroup[] | null> {
    const sources = this.sources.filter((source) => this.session.can(source.permission));
    if (term.length < 2 || sources.length === 0) {
      return of([]);
    }
    const hits = (items: readonly SearchHit[], icon: IconName): PaletteItem[] =>
      items.slice(0, HITS_SHOWN).map((hit) => ({
        label: hit.label,
        detail: hit.detail ?? '',
        url: hit.url,
        icon,
      }));
    return combineLatest(
      sources.map((source) =>
        source.search(term).pipe(
          map((items) => ({
            id: source.group,
            label: source.group,
            items: hits(items, source.icon),
          })),
          catchError(() => of({ id: source.group, label: source.group, items: [] })),
        ),
      ),
    ).pipe(startWith(null));
  }
}
