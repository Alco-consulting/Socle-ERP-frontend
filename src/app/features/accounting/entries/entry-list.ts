import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';

import { toUserError } from '../../../core/errors/user-error';
import { Paginated } from '../../../core/http/api-client';
import { requestState } from '../../../core/http/request-state';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoFilterBar, FavoriteOption } from '../../../shared/filters/filter-bar';
import { AlcoAutocomplete, AutocompleteOption } from '../../../shared/forms/autocomplete';
import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { sumDecimals } from '../../../shared/utils/decimal';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { AlcoDomainTransfers } from '../../transfers/domain-transfers';
import { EntryStatus, FiscalYear, Journal } from '../data-access/accounting-models';
import { AccountingApi } from '../data-access/accounting-api';
import { accountCodeSearch, codeOption, partnerCodeSearch } from '../data-access/code-searches';
import { ENTRY_PAGE_SIZE, EntriesApi } from '../data-access/entries-api';
import { Entry, EntryKind } from '../data-access/entry-models';
import {
  ENTRY_ERRORS,
  ENTRY_KINDS,
  ENTRY_STATUS,
  ENTRY_STATUSES,
  ENTRY_TRANSFER,
  isoDay,
} from './entry-presentation';

const PARAM = {
  status: 'etat',
  kind: 'type',
  journal: 'journal',
  fiscalYear: 'exercice',
  from: 'du',
  to: 'au',
  account: 'compte',
  partner: 'tiers',
  page: 'page',
} as const;
const KINDS = Object.keys(ENTRY_KINDS) as EntryKind[];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMPTY_PAGE: Paginated<Entry> = { count: 0, next: null, previous: null, results: [] };

/** A code of the filters that matches nothing in the company (said, no request). */
type UnknownCode = 'account' | 'partner';

interface ListQuery {
  readonly status: EntryStatus | null;
  readonly kind: EntryKind | null;
  readonly journal: string | null;
  readonly fiscalYear: string | null;
  readonly dateFrom: string | null;
  readonly dateTo: string | null;
  readonly accountCode: string | null;
  readonly partnerCode: string | null;
  readonly page: number;
}

/**
 * Comptabilité › Écritures, on the API (`GET accounting/entries/`): its filters only (state,
 * type, journal, fiscal year, dates, account and partner — the API has no text search), its
 * pages and its order (latest first). The list's state lives in the URL. The debit total is
 * a reading aid summed from the lines the server returns.
 */
@Component({
  selector: 'alco-entry-list',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoButton,
    AlcoCell,
    AlcoDomainTransfers,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoFilterBar,
    AlcoAutocomplete,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
    AlcoPagination,
    AlcoTable,
  ],
  templateUrl: './entry-list.html',
  styleUrls: ['../accounting-list.scss', './entry-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntryListPage {
  private readonly api = inject(EntriesApi);
  private readonly accounting = inject(AccountingApi);
  protected readonly searchAccounts = accountCodeSearch(this.accounting);
  protected readonly searchPartners = partnerCodeSearch(this.api);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly session = inject(SessionStore);

  protected readonly transfer = ENTRY_TRANSFER;
  protected readonly pageSize = ENTRY_PAGE_SIZE;
  protected readonly statuses = ENTRY_STATUSES.map((id) => ({ id, label: ENTRY_STATUS[id].label }));
  protected readonly kinds = KINDS.map((id) => ({ id, label: ENTRY_KINDS[id] }));
  protected readonly favorites: readonly FavoriteOption[] = [
    { id: 'draft', label: 'Brouillons' },
    { id: 'submitted', label: 'Soumises, à valider' },
    { id: 'validated', label: 'Validées' },
  ];
  protected readonly day = isoDay;
  protected readonly canCreate = computed(() => this.session.can('accounting.create'));

  protected readonly columns: readonly TableColumn[] = [
    { key: 'number', label: 'N°', width: '10rem' },
    { key: 'date', label: 'Date', width: '7rem' },
    { key: 'journal', label: 'Journal', width: '6rem' },
    { key: 'reference', label: 'Référence', hideBelow: 'laptop' },
    { key: 'description', label: 'Libellé' },
    { key: 'amount', label: 'Débit total', numeric: true, hideBelow: 'tablet' },
    { key: 'status', label: 'État', width: '9rem' },
  ];
  protected readonly rowId = (row: Entry) => row.public_id;
  protected readonly rowLabel = (row: Entry) =>
    `${row.entry_number || 'Brouillon'} ${row.description}`;

  // ---- State of the list, from the URL --------------------------------------------------
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private readonly param = (name: string) => this.params().get(name)?.trim() || null;
  protected readonly status = computed<EntryStatus | null>(() => {
    const value = this.param(PARAM.status);
    return ENTRY_STATUSES.includes(value as EntryStatus) ? (value as EntryStatus) : null;
  });
  protected readonly kind = computed<EntryKind | null>(() => {
    const value = this.param(PARAM.kind);
    return KINDS.includes(value as EntryKind) ? (value as EntryKind) : null;
  });
  protected readonly journal = computed(() => this.param(PARAM.journal));
  protected readonly fiscalYear = computed(() => this.param(PARAM.fiscalYear));
  protected readonly dateFrom = computed(() => this.date(PARAM.from));
  protected readonly dateTo = computed(() => this.date(PARAM.to));
  protected readonly accountCode = computed(() => this.param(PARAM.account));
  protected readonly partnerCode = computed(() => this.param(PARAM.partner));
  protected readonly page = computed(() => Math.max(1, Number(this.params().get(PARAM.page)) || 1));

  protected readonly activeFilterCount = computed(
    () =>
      [
        this.status(),
        this.kind(),
        this.journal(),
        this.fiscalYear(),
        this.dateFrom() || this.dateTo(),
        this.accountCode(),
        this.partnerCode(),
      ].filter(Boolean).length,
  );
  private readonly query = computed<ListQuery>(() => ({
    status: this.status(),
    kind: this.kind(),
    journal: this.journal(),
    fiscalYear: this.fiscalYear(),
    dateFrom: this.dateFrom(),
    dateTo: this.dateTo(),
    accountCode: this.accountCode(),
    partnerCode: this.partnerCode(),
    page: this.page(),
  }));

  protected readonly unknownCodes = signal<readonly UnknownCode[]>([]);
  protected readonly unknownCodeTitle = computed(() =>
    this.unknownCodes().includes('account')
      ? `Aucun compte de cette société n’a le code « ${this.accountCode()} ».`
      : `Aucun tiers de cette société n’a le code « ${this.partnerCode()} ».`,
  );
  protected readonly list = requestState(() => this.load(untracked(this.query)), {
    immediate: false,
  });
  protected readonly rows = computed(() => this.list.value()?.results ?? []);
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, ENTRY_ERRORS) : null;
  });

  // ---- Options of the filters (the server's journals and fiscal years) -------------------
  protected readonly journals = signal<readonly Journal[]>([]);
  protected readonly fiscalYears = signal<readonly FiscalYear[]>([]);
  private readonly decimals = signal<ReadonlyMap<string, number>>(new Map());

  protected readonly filterForm = new FormGroup({
    status: new FormControl('', { nonNullable: true }),
    kind: new FormControl('', { nonNullable: true }),
    journal: new FormControl('', { nonNullable: true }),
    fiscalYear: new FormControl('', { nonNullable: true }),
    dateFrom: new FormControl('', { nonNullable: true }),
    dateTo: new FormControl('', { nonNullable: true }),
    account: new FormControl<AutocompleteOption | null>(null),
    partner: new FormControl<AutocompleteOption | null>(null),
  });

  constructor() {
    this.accounting
      .journals()
      .pipe(catchError(() => of(EMPTY_PAGE as unknown as Paginated<Journal>)))
      .subscribe((page) => this.journals.set(page.results));
    this.accounting
      .fiscalYears()
      .pipe(catchError(() => of(EMPTY_PAGE as unknown as Paginated<FiscalYear>)))
      .subscribe((page) => this.fiscalYears.set(page.results));
    inject(PartnersApi)
      .currencies()
      .pipe(
        map((page) => new Map(page.results.map((item) => [item.code, item.decimal_places]))),
        catchError(() => of(new Map<string, number>())),
      )
      .subscribe((decimals) => this.decimals.set(decimals));

    effect(() => {
      this.query();
      untracked(() => this.list.reload());
    });
    effect(() => {
      if (this.list.error()?.kind === 'not-found' && untracked(this.page) > 1) {
        untracked(() => this.navigate({ [PARAM.page]: null }, true));
      }
    });
    effect(() => {
      this.filterForm.setValue({
        status: this.status() ?? '',
        kind: this.kind() ?? '',
        journal: this.journal() ?? '',
        fiscalYear: this.fiscalYear() ?? '',
        dateFrom: this.dateFrom() ?? '',
        dateTo: this.dateTo() ?? '',
        account: codeOption(this.accountCode()),
        partner: codeOption(this.partnerCode()),
      });
    });
  }

  protected statusLook(entry: Entry) {
    return ENTRY_STATUS[entry.status];
  }

  protected kindLabel(entry: Entry): string | null {
    return entry.kind === 'standard' ? null : ENTRY_KINDS[entry.kind];
  }

  /** Reading aid: the debits of the lines the server returned, summed exactly. */
  protected debitTotal(entry: Entry): string {
    return sumDecimals(entry.lines.map((line) => line.debit));
  }

  protected decimalsOf(entry: Entry): number {
    return this.decimals().get(entry.currency) ?? 0;
  }

  protected applyFilters(): void {
    const value = this.filterForm.getRawValue();
    this.navigate({
      [PARAM.status]: value.status || null,
      [PARAM.kind]: value.kind || null,
      [PARAM.journal]: value.journal || null,
      [PARAM.fiscalYear]: value.fiscalYear || null,
      [PARAM.from]: value.dateFrom || null,
      [PARAM.to]: value.dateTo || null,
      [PARAM.account]: value.account?.id ?? null,
      [PARAM.partner]: value.partner?.id ?? null,
      [PARAM.page]: null,
    });
  }

  protected resetFilters(): void {
    this.navigate(Object.fromEntries(Object.values(PARAM).map((name) => [name, null])));
  }

  protected applyFavorite(status: string): void {
    this.navigate({
      ...Object.fromEntries(Object.values(PARAM).map((name) => [name, null])),
      [PARAM.status]: status,
    });
  }

  protected setPage(page: number): void {
    this.navigate({ [PARAM.page]: page > 1 ? page : null });
  }

  protected open(entry: Entry): void {
    void this.router.navigate(['..', entry.public_id], { relativeTo: this.route });
  }

  /**
   * The account and the partner are filtered by code (readable, shareable URL): the server
   * finds the object of that exact code first; an unknown code is said, nothing listed.
   */
  private load(query: ListQuery): Observable<Paginated<Entry>> {
    const account = query.accountCode
      ? this.accounting.accountByCode(query.accountCode)
      : of(undefined);
    const partner = query.partnerCode ? this.api.partnerByCode(query.partnerCode) : of(undefined);
    return forkJoin([account, partner]).pipe(
      switchMap(([accountFound, partnerFound]) => {
        const unknown: UnknownCode[] = [];
        if (accountFound === null) {
          unknown.push('account');
        }
        if (partnerFound === null) {
          unknown.push('partner');
        }
        this.unknownCodes.set(unknown);
        if (unknown.length > 0) {
          return of(EMPTY_PAGE);
        }
        return this.api.list({
          status: query.status,
          kind: query.kind,
          journal: query.journal,
          fiscalYear: query.fiscalYear,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          account: accountFound?.public_id ?? null,
          partner: partnerFound?.public_id ?? null,
          page: query.page,
        });
      }),
    );
  }

  private date(name: string): string | null {
    const value = this.param(name);
    return value && ISO_DATE.test(value) ? value : null;
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
