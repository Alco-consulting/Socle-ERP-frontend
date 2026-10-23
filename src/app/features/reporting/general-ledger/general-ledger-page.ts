import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { Observable, catchError, debounceTime, firstValueFrom, map, of, switchMap } from 'rxjs';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { APP_ROOT } from '../../../core/navigation/applications';
import { NavigationService } from '../../../core/navigation/navigation.service';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoDropdown, DropdownItem } from '../../../shared/ui/dropdown/dropdown';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoIcon } from '../../../shared/ui/icon/icon';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { localToday } from '../../../shared/utils/dates';
import { saveFile } from '../../../shared/utils/save-file';
import { AccountingApi } from '../../accounting/data-access/accounting-api';
import { Journal } from '../../accounting/data-access/accounting-models';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { TransfersApi } from '../../transfers/transfers-api';
import {
  BALANCE_PAGE_SIZE,
  GENERAL_LEDGER_LINES,
  ReportingApi,
} from '../data-access/reporting-api';
import { GeneralLedger, GeneralLedgerRow, LedgerRow } from '../data-access/reporting-models';
import { BALANCE_ERRORS, warningText } from '../balance/balance-presentation';
import {
  AlcoReportPeriod,
  PERIOD_PARAM,
  PeriodChoice,
  day,
  periodFromUrl,
  periodParams,
} from '../report-period/report-period';

const ACCOUNTING = `${APP_ROOT}/comptabilite`;
const ALL_JOURNALS = '*';
const OPTION_DRAFTS = 'brouillons';

/** URL of the general ledger, as Odoo's filters: readable and shareable. */
export const GENERAL_LEDGER_PARAM = {
  ...PERIOD_PARAM,
  /** One account, unfolded (from the balance or the account's record). */
  account: 'compte',
  journal: 'journal',
  unposted: 'brouillons',
  search: 'q',
  page: 'page',
} as const;

/** The ledger read; or the code of the URL no account of the company has. */
type Loaded =
  | { readonly kind: 'ledger'; readonly ledger: GeneralLedger }
  | { readonly kind: 'unknown'; readonly code: string };

/** The lines of an unfolded account, read page by page (« Charger plus »). */
interface AccountLines {
  readonly rows: readonly LedgerRow[];
  readonly count: number;
  readonly page: number;
  readonly loading: boolean;
  readonly failed: boolean;
}

/**
 * Comptabilité › Analyse › Grand livre général, as Odoo's (note backend 0053): the same bar as
 * the balance (PDF, XLSX, search, period, journals, entries); every account and its totals,
 * unfolded by a click into its « Solde initial » and its lines with their running balance.
 * Every figure is the server's.
 */
@Component({
  selector: 'alco-general-ledger-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoAmountPipe,
    AlcoButton,
    AlcoDropdown,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoIcon,
    AlcoInput,
    AlcoLoading,
    AlcoPagination,
    AlcoReportPeriod,
  ],
  templateUrl: './general-ledger-page.html',
  styleUrl: './general-ledger-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GeneralLedgerPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly reporting = inject(ReportingApi);
  private readonly accounting = inject(AccountingApi);
  private readonly partners = inject(PartnersApi);
  private readonly transfers = inject(TransfersApi);
  private readonly navigation = inject(NavigationService);
  private readonly toast = inject(AlcoToastService);
  protected readonly session = inject(SessionStore);

  protected readonly pageSize = BALANCE_PAGE_SIZE;
  protected readonly accountingUrl = ACCOUNTING;

  // ---- State of the URL ---------------------------------------------------------------
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private readonly dates = computed(() => periodFromUrl(this.params(), localToday()));
  protected readonly periodKind = computed(() => this.dates().kind);
  protected readonly anchor = computed(() => this.dates().anchor);
  protected readonly period = computed(() => this.dates().period);
  /** One account (`?compte=411100`): found by its code, shown alone and unfolded. */
  private readonly accountCode = computed(
    () => this.params().get(GENERAL_LEDGER_PARAM.account) ?? '',
  );
  private readonly journalCodes = computed(() =>
    this.params().getAll(GENERAL_LEDGER_PARAM.journal),
  );
  protected readonly drafts = computed(
    () => this.params().get(GENERAL_LEDGER_PARAM.unposted) === 'oui',
  );
  private readonly searchText = computed(
    () => this.params().get(GENERAL_LEDGER_PARAM.search) ?? '',
  );
  protected readonly page = computed(
    () => Number(this.params().get(GENERAL_LEDGER_PARAM.page)) || 1,
  );

  // ---- References: journals, currency precision ----------------------------------------
  private readonly journals = requestState(() =>
    this.accounting.journals().pipe(map((page) => page.results)),
  );
  private readonly currencies = toSignal(
    this.partners.currencies().pipe(
      map((page) => page.results),
      catchError(() => of([])),
    ),
    { initialValue: [] },
  );
  protected readonly currency = computed(() => this.session.activeCompany()?.currency ?? '');
  protected readonly decimals = computed(
    () => this.currencies().find((item) => item.code === this.currency())?.decimal_places ?? 0,
  );
  private readonly chosenJournals = computed<readonly Journal[]>(() => {
    const codes = this.journalCodes();
    return (this.journals.value() ?? []).filter((item) => codes.includes(item.code));
  });

  // ---- The general ledger ---------------------------------------------------------------
  protected readonly ledger = requestState(() => this.load(), { immediate: false });
  protected readonly report = computed(() => {
    const loaded = this.ledger.value();
    return loaded?.kind === 'ledger' ? loaded.ledger : null;
  });
  protected readonly unknownCode = computed(() => {
    const loaded = this.ledger.value();
    return loaded?.kind === 'unknown' ? loaded.code : null;
  });
  protected readonly failure = computed(() => {
    const error = this.ledger.error();
    return error ? toUserError(error, BALANCE_ERRORS) : null;
  });
  protected readonly unposted = computed(() =>
    (this.report()?.warnings ?? []).some((warning) => warning.code === 'unposted_entries'),
  );
  protected readonly notes = computed(() =>
    (this.report()?.warnings ?? [])
      .map((warning) => warningText(warning))
      .filter((text): text is string => text !== null),
  );
  protected readonly draftsUrl = `${ACCOUNTING}/ecritures`;
  protected readonly draftsQuery = computed(() => ({ etat: 'draft', au: this.period().to }));
  /** The accounts unfolded, and the lines read of each. */
  protected readonly unfolded = signal<ReadonlySet<string>>(new Set());
  protected readonly lines = signal<ReadonlyMap<string, AccountLines>>(new Map());

  // ---- Filters (Odoo's buttons) --------------------------------------------------------
  protected readonly journalItems = computed<readonly DropdownItem[]>(() => {
    const codes = this.journalCodes();
    return [
      { id: ALL_JOURNALS, label: 'Tous les journaux', checked: codes.length === 0 },
      ...(this.journals.value() ?? []).map((item, index) => ({
        id: item.code,
        label: `${item.code} — ${item.name}`,
        checked: codes.includes(item.code),
        dividerBefore: index === 0,
      })),
    ];
  });
  protected readonly journalsLabel = computed(() => {
    const chosen = this.chosenJournals();
    return chosen.length === 0 ? 'Tous les journaux' : chosen.map((item) => item.code).join(', ');
  });
  protected readonly optionsLabel = computed(
    () =>
      `${this.drafts() ? 'Toutes les pièces' : 'Pièces comptabilisées'}, Comptabilité d’engagement`,
  );
  protected readonly optionItems = computed<readonly DropdownItem[]>(() => [
    { id: OPTION_DRAFTS, label: 'Écritures brouillon', checked: this.drafts() },
  ]);
  protected readonly searchControl = new FormControl('', { nonNullable: true });

  // ---- Export (PDF, XLSX, as Odoo's) ---------------------------------------------------
  protected readonly canExport = computed(
    () => this.session.can('imports_exports.export') && this.session.can('reporting.read'),
  );
  protected readonly canOpenLines = computed(() =>
    this.navigation.canOpenUrl(`${ACCOUNTING}/ecritures`),
  );
  protected readonly exporting = signal<'pdf' | 'xlsx' | null>(null);
  private readonly accountIds = new Map<string, string | null>();

  constructor() {
    effect(() => {
      // Any change of a filter or of the page: one new read, the lines read again.
      this.period();
      this.accountCode();
      this.chosenJournals();
      this.drafts();
      this.searchText();
      this.page();
      if (this.journals.value() !== null || this.journals.error()) {
        untracked(() => {
          this.lines.set(new Map());
          this.ledger.reload();
        });
      }
    });
    effect(() => {
      // The accounts unfolded keep their lines, read again with the new filters; one account
      // asked by the URL opens unfolded.
      const found = this.report();
      if (!found) {
        return;
      }
      untracked(() => {
        const alone = this.accountCode() ? found.results.map((row) => row.account.public_id) : [];
        const open = new Set([...this.unfolded(), ...alone]);
        this.unfolded.set(open);
        for (const row of found.results) {
          if (open.has(row.account.public_id) && !this.lines().has(row.account.public_id)) {
            this.readLines(row.account.public_id, 1);
          }
        }
      });
    });
    effect(() => {
      const search = this.searchText();
      untracked(() => {
        if (this.searchControl.value !== search) {
          this.searchControl.setValue(search, { emitEvent: false });
        }
      });
    });
    const destroyRef = inject(DestroyRef);
    this.searchControl.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed(destroyRef))
      .subscribe((text) =>
        this.navigate({
          [GENERAL_LEDGER_PARAM.search]: text.trim() || null,
          [GENERAL_LEDGER_PARAM.page]: null,
        }),
      );
  }

  protected choosePeriod(choice: PeriodChoice): void {
    this.navigate({
      ...periodParams(choice, this.anchor(), this.period()),
      [GENERAL_LEDGER_PARAM.page]: null,
    });
  }

  protected toggleJournal(item: DropdownItem): void {
    const codes = this.journalCodes();
    const next =
      item.id === ALL_JOURNALS
        ? []
        : codes.includes(item.id)
          ? codes.filter((code) => code !== item.id)
          : [...codes, item.id];
    this.navigate({
      [GENERAL_LEDGER_PARAM.journal]: next.length ? next : null,
      [GENERAL_LEDGER_PARAM.page]: null,
    });
  }

  protected toggleOption(item: DropdownItem): void {
    if (item.id === OPTION_DRAFTS) {
      this.navigate({
        [GENERAL_LEDGER_PARAM.unposted]: this.drafts() ? null : 'oui',
        [GENERAL_LEDGER_PARAM.page]: null,
      });
    }
  }

  /** An account unfolded (its lines read once) or folded, as Odoo's. */
  protected toggle(row: GeneralLedgerRow): void {
    const id = row.account.public_id;
    const open = new Set(this.unfolded());
    if (open.delete(id)) {
      this.unfolded.set(open);
      return;
    }
    open.add(id);
    this.unfolded.set(open);
    if (!this.lines().has(id)) {
      this.readLines(id, 1);
    }
  }

  protected loadMore(row: GeneralLedgerRow): void {
    const read = this.lines().get(row.account.public_id);
    if (read && !read.loading) {
      this.readLines(row.account.public_id, read.page + 1);
    }
  }

  protected setPage(page: number): void {
    this.navigate({ [GENERAL_LEDGER_PARAM.page]: page > 1 ? page : null });
  }

  protected isZero(amount: string): boolean {
    return Number(amount) === 0;
  }

  protected isNegative(amount: string): boolean {
    return amount.startsWith('-') && !this.isZero(amount);
  }

  protected date(value: string): string {
    return day(value);
  }

  /** « Écritures comptables » of an account, on the same dates. */
  protected linesQuery(row: GeneralLedgerRow): Params {
    const period = this.period();
    return {
      classe: row.account.code,
      du: period.from,
      au: period.to,
      ...(this.drafts() ? { etat: 'all' } : {}),
    };
  }

  /** The ⋮ of a line: its entry. */
  protected lineMenu(row: LedgerRow): readonly DropdownItem[] {
    return [{ id: 'entry', label: 'Voir la pièce', route: `${ACCOUNTING}/ecritures/${row.entry}` }];
  }

  protected async exportFile(format: 'pdf' | 'xlsx'): Promise<void> {
    if (this.exporting()) {
      return;
    }
    this.exporting.set(format);
    const failed = 'L’export a échoué. Réessayez ; si le problème continue, contactez le support.';
    try {
      const run = await firstValueFrom(
        this.transfers.createExport('reporting.general_ledger', this.exportParameters(), format),
      );
      if (run.status !== 'completed') {
        this.toast.error(failed);
        return;
      }
      const file = await firstValueFrom(this.transfers.download(run.public_id));
      saveFile(file.blob, file.filename ?? run.filename ?? `grand-livre-general.${format}`);
    } catch {
      this.toast.error(failed);
    } finally {
      this.exporting.set(null);
    }
  }

  /** The export follows the ledger on screen: its period, account, journals, entries, search. */
  private exportParameters(): Readonly<Record<string, unknown>> {
    const period = this.period();
    const only = this.accountIds.get(this.accountCode()) ?? null;
    return {
      date_from: period.from,
      date_to: period.to,
      ...(only ? { account: only } : {}),
      journal: this.chosenJournals().map((item) => item.public_id),
      include_unposted: this.drafts(),
      search: this.searchText(),
    };
  }

  private readLines(accountId: string, page: number): void {
    const scope = this.report()?.scope;
    if (!scope) {
      return;
    }
    const before = this.lines().get(accountId);
    this.setLines(accountId, {
      rows: before?.rows ?? [],
      count: before?.count ?? 0,
      page: before?.page ?? 0,
      loading: true,
      failed: false,
    });
    const period = this.period();
    this.reporting
      .accountLedger(accountId, {
        fiscalYear: scope.fiscal_year.public_id,
        dateFrom: period.from,
        dateTo: period.to,
        journals: this.chosenJournals().map((item) => item.public_id),
        includeUnposted: this.drafts(),
        page,
        pageSize: GENERAL_LEDGER_LINES,
      })
      .subscribe({
        next: (found) =>
          this.setLines(accountId, {
            rows: [...(page > 1 ? (before?.rows ?? []) : []), ...found.results],
            count: found.count,
            page,
            loading: false,
            failed: false,
          }),
        error: () =>
          this.setLines(accountId, {
            rows: before?.rows ?? [],
            count: before?.count ?? 0,
            page: before?.page ?? 0,
            loading: false,
            failed: true,
          }),
      });
  }

  private setLines(accountId: string, read: AccountLines): void {
    const next = new Map(this.lines());
    next.set(accountId, read);
    this.lines.set(next);
  }

  private navigate(params: Params): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
    });
  }

  private load(): Observable<Loaded> {
    const period = untracked(this.period);
    const code = untracked(this.accountCode);
    const account$ = code ? this.accountOf(code) : of(null);
    return account$.pipe(
      switchMap((account): Observable<Loaded> => {
        if (code && !account) {
          return of({ kind: 'unknown', code });
        }
        return this.reporting
          .generalLedger({
            dateFrom: period.from,
            dateTo: period.to,
            account,
            journals: untracked(this.chosenJournals).map((item) => item.public_id),
            includeUnposted: untracked(this.drafts),
            search: untracked(this.searchText),
            page: untracked(this.page),
          })
          .pipe(map((ledger): Loaded => ({ kind: 'ledger', ledger })));
      }),
    );
  }

  /** The account of a code, found once; an unknown code shows nothing of another account. */
  private accountOf(code: string): Observable<string | null> {
    const known = this.accountIds.get(code);
    if (known !== undefined) {
      return of(known);
    }
    return this.accounting.accountByCode(code).pipe(
      map((account) => {
        const id = account?.public_id ?? null;
        this.accountIds.set(code, id);
        return id;
      }),
    );
  }
}
