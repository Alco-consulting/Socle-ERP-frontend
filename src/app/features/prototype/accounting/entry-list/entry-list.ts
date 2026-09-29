import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { Subject, catchError, debounceTime, forkJoin, map, of, switchMap, tap } from 'rxjs';

import { UserError, toUserError } from '../../../../core/errors/user-error';
import { SessionStore } from '../../../../core/session/session.store';
import { FavoriteOption, GroupOption, AlcoFilterBar } from '../../../../shared/filters/filter-bar';
import { AlcoSearchBar, SearchFacet } from '../../../../shared/filters/search-bar';
import { AlcoFormField } from '../../../../shared/forms/form-field';
import { AlcoInput } from '../../../../shared/forms/input';
import { AlcoAmountPipe } from '../../../../shared/pipes/amount.pipe';
import {
  AlcoCell,
  AlcoTable,
  TableColumn,
  TableGroup,
  TableSort,
} from '../../../../shared/tables/table';
import { AlcoBadge } from '../../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../../shared/ui/button/button';
import { AlcoConfirmService } from '../../../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoDropdown, DropdownItem } from '../../../../shared/ui/dropdown/dropdown';
import { AlcoEmptyState } from '../../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../../../shared/ui/pagination/pagination';
import { AlcoToastService } from '../../../../shared/ui/toast/toast.service';
import { AlcoTransferActions } from '../../transfers/transfer-actions';
import { ENTRY_STATUS } from '../entry-presentation';
import {
  CURRENCY,
  CURRENCY_DECIMALS,
  JOURNALS,
  PARTNERS,
  journalName,
  partnerName,
} from '../prototype-data';
import { PrototypeAccountingApi } from '../prototype-accounting-api';
import { EntryQuery, EntryStatus, EntrySummary, Page } from '../prototype-models';

const PAGE_SIZE = 20;
const GROUPED_PAGE_SIZE = 50;
const STATUSES = Object.keys(ENTRY_STATUS) as EntryStatus[];

/** URL parameters of the list: the URL is the state, so « Retour » restores the list. */
const PARAM = {
  search: 'q',
  status: 'etat',
  journal: 'journal',
  partner: 'tiers',
  from: 'du',
  to: 'au',
  group: 'groupe',
  sort: 'tri',
  page: 'page',
} as const;

const GROUP_OPTIONS: readonly GroupOption[] = [
  { id: 'journal', label: 'Journal' },
  { id: 'status', label: 'État' },
  { id: 'partner', label: 'Tiers' },
  { id: 'month', label: 'Mois' },
];

const FAVORITES: readonly (FavoriteOption & { params: Params })[] = [
  { id: 'drafts', label: 'Brouillons à valider', params: { [PARAM.status]: 'draft' } },
  { id: 'bank', label: 'Journal de banque', params: { [PARAM.journal]: 'BQ1' } },
  {
    id: 'september',
    label: 'Septembre 2026',
    params: { [PARAM.from]: '2026-09-01', [PARAM.to]: '2026-09-30' },
  },
];

const EMPTY_FILTERS: Params = {
  [PARAM.status]: null,
  [PARAM.journal]: null,
  [PARAM.partner]: null,
  [PARAM.from]: null,
  [PARAM.to]: null,
  [PARAM.page]: null,
};

function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * PROTOTYPE — list view of the design system on fictitious entries.
 * Search, filters, grouping, favorites, sort, pagination and selection all go through the
 * (simulated) server query; the table only displays.
 */
@Component({
  selector: 'alco-entry-list',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoButton,
    AlcoCell,
    AlcoDropdown,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoFilterBar,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
    AlcoPagination,
    AlcoSearchBar,
    AlcoTable,
    AlcoTransferActions,
  ],
  templateUrl: './entry-list.html',
  styleUrl: './entry-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntryListPage {
  private readonly api = inject(PrototypeAccountingApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirm = inject(AlcoConfirmService);
  private readonly toast = inject(AlcoToastService);
  protected readonly session = inject(SessionStore);

  protected readonly journals = JOURNALS;
  protected readonly partners = PARTNERS;
  protected readonly statuses = STATUSES.map((id) => ({ id, label: ENTRY_STATUS[id].label }));
  protected readonly groupOptions = GROUP_OPTIONS;
  protected readonly favorites = FAVORITES;
  protected readonly decimals = CURRENCY_DECIMALS;
  protected readonly journalName = journalName;
  protected readonly partnerName = partnerName;

  protected readonly columns: readonly TableColumn[] = [
    { key: 'number', label: 'Numéro', sortable: true },
    { key: 'date', label: 'Date', sortable: true },
    { key: 'journal', label: 'Journal', sortable: true },
    { key: 'reference', label: 'Référence', hideBelow: 'laptop' },
    { key: 'label', label: 'Libellé', hideBelow: 'laptop' },
    { key: 'partner', label: 'Tiers', hideBelow: 'laptop' },
    { key: 'total', label: `Montant (${CURRENCY})`, numeric: true, sortable: true },
    { key: 'status', label: 'État' },
  ];

  protected readonly rowId = (entry: EntrySummary) => entry.id;
  protected readonly rowLabel = (entry: EntrySummary) => entry.number;

  // ---- State read from the URL -------------------------------------------------------
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  private readonly status = computed(() => {
    const value = this.params().get(PARAM.status) as EntryStatus | null;
    return value && STATUSES.includes(value) ? value : null;
  });
  private readonly journal = computed(() => this.params().get(PARAM.journal));
  private readonly partnerId = computed(() => this.params().get(PARAM.partner));
  private readonly dateFrom = computed(() => this.params().get(PARAM.from));
  private readonly dateTo = computed(() => this.params().get(PARAM.to));
  protected readonly groupBy = computed(() => {
    const value = this.params().get(PARAM.group);
    return GROUP_OPTIONS.some((option) => option.id === value) ? value : null;
  });
  protected readonly sort = computed<TableSort>(() => {
    const [key, direction] = (this.params().get(PARAM.sort) ?? 'date:desc').split(':');
    return { key, direction: direction === 'asc' ? 'asc' : 'desc' };
  });
  protected readonly page = computed(() => Math.max(1, Number(this.params().get(PARAM.page)) || 1));
  protected readonly pageSize = computed(() => (this.groupBy() ? GROUPED_PAGE_SIZE : PAGE_SIZE));

  /** Text typed in the box; pushed to the URL after a short pause. */
  protected readonly searchText = signal(this.route.snapshot.queryParamMap.get(PARAM.search) ?? '');
  private readonly searchTyped = new Subject<string>();

  protected readonly activeFilterCount = computed(
    () =>
      [this.status(), this.journal(), this.partnerId()].filter(Boolean).length +
      (this.dateFrom() || this.dateTo() ? 1 : 0),
  );

  protected readonly facets = computed<readonly SearchFacet[]>(() => {
    const facets: SearchFacet[] = [];
    const status = this.status();
    if (status) {
      facets.push({
        id: 'status',
        kind: 'filter',
        label: 'État',
        value: ENTRY_STATUS[status].label,
      });
    }
    const journal = this.journal();
    if (journal) {
      facets.push({ id: 'journal', kind: 'filter', label: 'Journal', value: journalName(journal) });
    }
    const partner = this.partnerId();
    if (partner) {
      facets.push({ id: 'partner', kind: 'filter', label: 'Tiers', value: partnerName(partner) });
    }
    const from = this.dateFrom();
    const to = this.dateTo();
    if (from || to) {
      const value =
        from && to
          ? `du ${formatDay(from)} au ${formatDay(to)}`
          : from
            ? `à partir du ${formatDay(from)}`
            : `jusqu’au ${formatDay(to ?? '')}`;
      facets.push({ id: 'period', kind: 'filter', label: 'Période', value });
    }
    const group = GROUP_OPTIONS.find((option) => option.id === this.groupBy());
    if (group) {
      facets.push({ id: 'group', kind: 'group', label: 'Regroupé par', value: group.label });
    }
    return facets;
  });

  // ---- Data --------------------------------------------------------------------------
  private readonly query = computed<EntryQuery>(() => ({
    search: this.params().get(PARAM.search) ?? '',
    status: this.status(),
    journal: this.journal(),
    partnerId: this.partnerId(),
    dateFrom: this.dateFrom(),
    dateTo: this.dateTo(),
    sort: this.sort(),
    page: this.page(),
    pageSize: this.pageSize(),
  }));

  protected readonly loading = signal(true);
  protected readonly error = signal<UserError | null>(null);
  private readonly reload = signal(0);
  protected readonly result = toSignal(
    toObservable(computed(() => ({ query: this.query(), reload: this.reload() }))).pipe(
      tap(() => {
        this.loading.set(true);
        this.error.set(null);
      }),
      switchMap(({ query }) =>
        this.api.list(query).pipe(
          catchError((failure: unknown) => {
            this.error.set(toUserError(failure));
            return of(null);
          }),
        ),
      ),
      tap(() => this.loading.set(false)),
    ),
    { initialValue: null as Page<EntrySummary> | null },
  );

  protected readonly rows = computed(() => this.result()?.results ?? []);
  protected readonly groups = computed<readonly TableGroup<EntrySummary>[] | null>(() => {
    const groupBy = this.groupBy();
    if (!groupBy) {
      return null;
    }
    const keyOf = (entry: EntrySummary): [string, string] => {
      switch (groupBy) {
        case 'journal':
          return [entry.journal, `${entry.journal} — ${journalName(entry.journal)}`];
        case 'status':
          return [entry.status, ENTRY_STATUS[entry.status].label];
        case 'partner':
          return [entry.partnerId ?? '-', partnerName(entry.partnerId) || 'Sans tiers'];
        default: {
          const [year, month] = entry.date.split('-');
          return [`${year}-${month}`, `${month}/${year}`];
        }
      }
    };
    const groups = new Map<string, { label: string; rows: EntrySummary[] }>();
    for (const entry of this.rows()) {
      const [key, label] = keyOf(entry);
      const group = groups.get(key) ?? { label, rows: [] };
      group.rows.push(entry);
      groups.set(key, group);
    }
    return [...groups].map(([key, group]) => ({ key, label: group.label, rows: group.rows }));
  });

  protected readonly hasCriteria = computed(
    () => this.activeFilterCount() > 0 || !!this.params().get(PARAM.search),
  );

  // ---- Selection ---------------------------------------------------------------------
  protected readonly selection = signal<ReadonlySet<string>>(new Set());
  protected readonly bulkItems = computed<readonly DropdownItem[]>(() => [
    {
      id: 'validate',
      label: 'Valider la sélection',
      icon: 'check',
      disabled: !this.session.can('accounting.validate'),
    },
    {
      id: 'export',
      label: 'Exporter la sélection',
      icon: 'download',
      description: 'Disponible avec le module Imports / Exports',
      disabled: true,
    },
  ]);

  // ---- Filters panel -----------------------------------------------------------------
  protected readonly filterForm = new FormGroup({
    status: new FormControl<string>('', { nonNullable: true }),
    journal: new FormControl<string>('', { nonNullable: true }),
    partnerId: new FormControl<string>('', { nonNullable: true }),
    dateFrom: new FormControl<string>('', { nonNullable: true }),
    dateTo: new FormControl<string>('', { nonNullable: true }),
  });

  constructor() {
    // The panel always opens on the criteria currently applied.
    effect(() => {
      this.filterForm.setValue({
        status: this.status() ?? '',
        journal: this.journal() ?? '',
        partnerId: this.partnerId() ?? '',
        dateFrom: this.dateFrom() ?? '',
        dateTo: this.dateTo() ?? '',
      });
    });
    // Selection is per page of results.
    effect(() => {
      this.query();
      this.selection.set(new Set());
    });
    this.searchTyped
      .pipe(
        debounceTime(300),
        map((text) => text.trim()),
        takeUntilDestroyed(),
      )
      .subscribe((text) =>
        this.navigate({ [PARAM.search]: text || null, [PARAM.page]: null }, true),
      );
  }

  // ---- Actions -----------------------------------------------------------------------
  protected onSearch(text: string): void {
    this.searchText.set(text);
    this.searchTyped.next(text);
  }

  protected applyFilters(): void {
    const value = this.filterForm.getRawValue();
    this.navigate({
      [PARAM.status]: value.status || null,
      [PARAM.journal]: value.journal || null,
      [PARAM.partner]: value.partnerId || null,
      [PARAM.from]: value.dateFrom || null,
      [PARAM.to]: value.dateTo || null,
      [PARAM.page]: null,
    });
  }

  protected resetFilters(): void {
    this.searchText.set('');
    this.navigate({ ...EMPTY_FILTERS, [PARAM.search]: null });
  }

  protected removeFacet(facet: SearchFacet): void {
    const cleared: Record<string, Params> = {
      status: { [PARAM.status]: null },
      journal: { [PARAM.journal]: null },
      partner: { [PARAM.partner]: null },
      period: { [PARAM.from]: null, [PARAM.to]: null },
      group: { [PARAM.group]: null },
    };
    this.navigate({ ...cleared[facet.id], [PARAM.page]: null });
  }

  protected setGroupBy(groupBy: string | null): void {
    this.navigate({ [PARAM.group]: groupBy, [PARAM.page]: null });
  }

  protected applyFavorite(id: string): void {
    const favorite = FAVORITES.find((item) => item.id === id);
    if (favorite) {
      this.navigate({ ...EMPTY_FILTERS, ...favorite.params });
    }
  }

  protected setSort(sort: TableSort | null): void {
    this.navigate({
      [PARAM.sort]: sort ? `${sort.key}:${sort.direction}` : null,
      [PARAM.page]: null,
    });
  }

  protected setPage(page: number): void {
    this.navigate({ [PARAM.page]: page > 1 ? page : null });
  }

  protected open(entry: EntrySummary): void {
    void this.router.navigate([entry.id], { relativeTo: this.route });
  }

  protected badgeOf(entry: EntrySummary): (typeof ENTRY_STATUS)[EntryStatus] {
    return ENTRY_STATUS[entry.status];
  }

  protected clearSelection(): void {
    this.selection.set(new Set());
  }

  protected retry(): void {
    this.reload.update((value) => value + 1);
  }

  protected async onBulkAction(item: DropdownItem): Promise<void> {
    if (item.id !== 'validate') {
      return;
    }
    const ids = [...this.selection()];
    const confirmed = await this.confirm.confirm({
      title: `Valider ${ids.length} écriture${ids.length > 1 ? 's' : ''} ?`,
      message:
        'Une écriture validée ne peut plus être modifiée ; elle pourra seulement être contrepassée. ' +
        'Les écritures refusées par le serveur restent inchangées.',
      confirmLabel: 'Valider la sélection',
    });
    if (!confirmed) {
      return;
    }
    forkJoin(
      ids.map((id) =>
        this.api.validate(id).pipe(
          map(() => true),
          catchError(() => of(false)),
        ),
      ),
    ).subscribe((results) => {
      const done = results.filter(Boolean).length;
      const refused = results.length - done;
      const message =
        `${done} écriture${done > 1 ? 's' : ''} validée${done > 1 ? 's' : ''}` +
        (refused
          ? `, ${refused} refusée${refused > 1 ? 's' : ''} (ouvrez-les pour voir pourquoi).`
          : '.');
      this.toast.show(refused ? 'warning' : 'success', message);
      this.retry();
    });
  }

  private navigate(params: Params, replaceUrl = false): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }
}
