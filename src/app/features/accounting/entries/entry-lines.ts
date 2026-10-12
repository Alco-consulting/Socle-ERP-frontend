import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { Subject, catchError, debounceTime, map, of } from 'rxjs';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { APP_ROOT } from '../../../core/navigation/applications';
import { AlcoFilterBar } from '../../../shared/filters/filter-bar';
import { AlcoSearchBar, SearchFacet } from '../../../shared/filters/search-bar';
import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { isZeroDecimal } from '../../../shared/utils/decimal';
import { AccountingApi } from '../data-access/accounting-api';
import { Journal } from '../data-access/accounting-models';
import {
  EntryLineRow,
  EntryLinesApi,
  LINE_PAGE_SIZE,
  LineState,
} from '../data-access/entry-lines-api';
import { ENTRY_ERRORS } from './entry-presentation';

const PARAM = {
  search: 'q',
  state: 'etat',
  journal: 'journal',
  prefix: 'classe',
  from: 'du',
  to: 'au',
  page: 'page',
} as const;
const STATES: readonly { id: LineState; label: string }[] = [
  { id: 'posted', label: 'Comptabilisées' },
  { id: 'draft', label: 'Brouillons' },
  { id: 'submitted', label: 'Soumises' },
  { id: 'all', label: 'Toutes' },
];

/** « Écritures comptables » as in Odoo: one row per line of the entries (note backend 0039). */
@Component({
  selector: 'alco-entry-lines',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    AlcoAmountPipe,
    AlcoButton,
    AlcoCell,
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
  ],
  templateUrl: './entry-lines.html',
  styleUrls: ['../accounting-list.scss', '../accounts/account-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntryLinesPage {
  private readonly api = inject(EntryLinesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly entriesUrl = `${APP_ROOT}/comptabilite/ecritures`;
  protected readonly states = STATES;
  protected readonly pageSize = LINE_PAGE_SIZE;
  protected readonly columns: readonly TableColumn[] = [
    { key: 'date', label: 'Date', width: '6.5rem' },
    { key: 'entry', label: 'Pièce comptable', width: '11rem' },
    { key: 'account', label: 'Compte' },
    { key: 'partner', label: 'Partenaire', hideBelow: 'tablet' },
    { key: 'label', label: 'Libellé', hideBelow: 'laptop' },
    { key: 'debit', label: 'Débit', width: '9rem', numeric: true },
    { key: 'credit', label: 'Crédit', width: '9rem', numeric: true },
    { key: 'lettering', label: 'Lettrage', width: '7rem', hideBelow: 'laptop' },
  ];
  protected readonly rowId = (row: EntryLineRow) => row.public_id;
  protected readonly rowLabel = (row: EntryLineRow) =>
    `${row.entry.entry_number || 'Brouillon'} · ${row.account.code}`;

  protected readonly journals = toSignal(
    inject(AccountingApi)
      .journals()
      .pipe(
        map((page) => page.results),
        catchError(() => of([] as Journal[])),
      ),
    { initialValue: [] as Journal[] },
  );

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly search = computed(() => this.params().get(PARAM.search)?.trim() ?? '');
  protected readonly state = computed<LineState>(() => {
    const value = this.params().get(PARAM.state) as LineState | null;
    return value && STATES.some((item) => item.id === value) ? value : 'posted';
  });
  protected readonly journal = computed(() => this.params().get(PARAM.journal) ?? '');
  protected readonly prefix = computed(() => this.params().get(PARAM.prefix) ?? '');
  protected readonly from = computed(() => this.params().get(PARAM.from) ?? '');
  protected readonly to = computed(() => this.params().get(PARAM.to) ?? '');
  protected readonly page = computed(() => Math.max(1, Number(this.params().get(PARAM.page)) || 1));
  protected readonly searchText = signal(this.route.snapshot.queryParamMap.get(PARAM.search) ?? '');
  private readonly searchTyped = new Subject<string>();
  protected readonly panelShown = signal(false);

  protected readonly activeFilterCount = computed(
    () =>
      [this.state() !== 'posted', !!this.journal(), !!this.from(), !!this.to()].filter(Boolean)
        .length,
  );
  protected readonly hasCriteria = computed(
    () => this.activeFilterCount() > 0 || !!this.search() || !!this.prefix(),
  );
  protected readonly facets = computed<readonly SearchFacet[]>(() => {
    const facets: SearchFacet[] = [
      {
        id: 'state',
        kind: 'filter',
        label: 'État',
        value: STATES.find((item) => item.id === this.state())?.label ?? '',
      },
    ];
    const journal = this.journals().find((item) => item.public_id === this.journal());
    if (journal) {
      facets.push({ id: 'journal', kind: 'filter', label: 'Journal', value: journal.code });
    }
    if (this.from() || this.to()) {
      facets.push({
        id: 'dates',
        kind: 'filter',
        label: 'Dates',
        value: `${this.from() || '…'} → ${this.to() || '…'}`,
      });
    }
    return facets;
  });

  private readonly filters = computed(() => ({
    state: this.state(),
    journal: this.journal(),
    dateFrom: this.from(),
    dateTo: this.to(),
    search: this.search(),
  }));
  private readonly query = computed(() => ({
    ...this.filters(),
    accountPrefix: this.prefix(),
    page: this.page(),
  }));
  protected readonly list = requestState(() => this.api.lines(untracked(this.query)), {
    immediate: false,
  });
  protected readonly classes = requestState(() => this.api.classes(untracked(this.filters)), {
    immediate: false,
  });
  protected readonly total = computed(() =>
    (this.classes.value() ?? []).reduce((sum, item) => sum + item.count, 0),
  );
  protected readonly rows = computed(() => this.list.value()?.results ?? []);
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, ENTRY_ERRORS) : null;
  });
  protected readonly filterForm = new FormGroup({
    state: new FormControl<LineState>('posted', { nonNullable: true }),
    journal: new FormControl('', { nonNullable: true }),
    from: new FormControl('', { nonNullable: true }),
    to: new FormControl('', { nonNullable: true }),
  });

  constructor() {
    effect(() => {
      this.query();
      untracked(() => this.list.reload());
    });
    effect(() => {
      this.filters();
      untracked(() => this.classes.reload());
    });
    effect(() => {
      if (this.list.error()?.kind === 'not-found' && untracked(this.page) > 1) {
        untracked(() => this.navigate({ [PARAM.page]: null }, true));
      }
    });
    effect(() =>
      this.filterForm.setValue({
        state: this.state(),
        journal: this.journal(),
        from: this.from(),
        to: this.to(),
      }),
    );
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

  /** A side of a line, in the reference currency; blank when zero. */
  protected side(row: EntryLineRow, side: 'reference_debit' | 'reference_credit'): string {
    return isZeroDecimal(row[side]) ? '' : row[side];
  }

  protected choosePrefix(prefix: string | null): void {
    this.navigate({ [PARAM.prefix]: prefix, [PARAM.page]: null });
  }

  protected onSearch(text: string): void {
    this.searchText.set(text);
    this.searchTyped.next(text);
  }

  protected applyFilters(): void {
    const value = this.filterForm.getRawValue();
    this.navigate({
      [PARAM.state]: value.state === 'posted' ? null : value.state,
      [PARAM.journal]: value.journal || null,
      [PARAM.from]: value.from || null,
      [PARAM.to]: value.to || null,
      [PARAM.page]: null,
    });
  }

  protected resetFilters(): void {
    this.searchText.set('');
    this.navigate({
      [PARAM.search]: null,
      [PARAM.state]: null,
      [PARAM.journal]: null,
      [PARAM.prefix]: null,
      [PARAM.from]: null,
      [PARAM.to]: null,
      [PARAM.page]: null,
    });
  }

  protected removeFacet(facet: SearchFacet): void {
    const params: Params =
      facet.id === 'dates'
        ? { [PARAM.from]: null, [PARAM.to]: null }
        : { [facet.id === 'state' ? PARAM.state : PARAM.journal]: null };
    this.navigate({ ...params, [PARAM.page]: null });
  }

  protected setPage(page: number): void {
    this.navigate({ [PARAM.page]: page > 1 ? page : null });
  }

  protected open(row: EntryLineRow): void {
    void this.router.navigate([this.entriesUrl, row.entry.public_id]);
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
