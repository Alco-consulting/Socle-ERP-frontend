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
import { AlcoStatusTabs } from '../../../shared/filters/status-tabs';
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
import {
  GeneralLedgerFigures,
  LedgerQuery,
  LedgerRow,
  ReportScope,
  ReportWarning,
  TiersAccount,
} from '../data-access/reporting-models';
import { BALANCE_ERRORS, warningText } from '../balance/balance-presentation';
import {
  AlcoReportPeriod,
  PeriodChoice,
  day,
  periodFromUrl,
  periodParams,
} from '../report-period/report-period';
import {
  GENERAL_LEDGER_PARAM,
  LEDGER_VIEWS,
  LedgerMode,
  LedgerView,
  readLedgerView,
  rememberLedgerView,
  Subject,
  SubjectLines,
} from './general-ledger-presentation';
import { AlcoTAccounts } from './t-accounts';

const ACCOUNTING = `${APP_ROOT}/comptabilite`;
const ALL_JOURNALS = '*';
const OPTION_DRAFTS = 'brouillons';

const TIERS: readonly {
  readonly id: TiersAccount;
  readonly url: string;
  readonly label: string;
}[] = [
  { id: 'receivable', url: 'recevoir', label: 'Comptes à recevoir' },
  { id: 'payable', url: 'payer', label: 'Comptes à payer' },
];

interface Report {
  readonly scope: ReportScope;
  readonly period: string;
  readonly totals: GeneralLedgerFigures;
  readonly warnings: readonly ReportWarning[];
  readonly count: number;
  readonly subjects: readonly Subject[];
}

/** The report read; or the code of the URL nothing of the company has. */
type Loaded =
  | { readonly kind: 'ledger'; readonly report: Report }
  | { readonly kind: 'unknown'; readonly code: string };

/**
 * Comptabilité › Analyse › Grand livre général and Grand livre des partenaires, as Odoo's
 * (notes backend 0053, 0054): the bar of the reports (PDF, XLSX, search, period, journals,
 * entries); every account, or every partner of the tiers accounts, and its totals, unfolded by
 * a click into its « Solde initial » and its lines with their running balance. Every figure is
 * the server's.
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
    AlcoStatusTabs,
    AlcoTAccounts,
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

  protected readonly mode: LedgerMode =
    this.route.snapshot.data['ledger'] === 'partner' ? 'partner' : 'account';
  protected readonly title =
    this.mode === 'account' ? 'Grand livre général' : 'Grand livre des partenaires';
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
  /** One subject (`?compte=411100`, `?tiers=CLI-00001`): found by its code, alone, unfolded. */
  private readonly subjectCode = computed(
    () =>
      this.params().get(
        this.mode === 'account' ? GENERAL_LEDGER_PARAM.account : GENERAL_LEDGER_PARAM.partner,
      ) ?? '',
  );
  /** The tiers accounts chosen (partner ledger); none: both, as Odoo's. */
  private readonly tiers = computed<readonly TiersAccount[]>(() => {
    const wanted = this.params().getAll(GENERAL_LEDGER_PARAM.tiers);
    return TIERS.filter((item) => wanted.includes(item.url)).map((item) => item.id);
  });
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

  // ---- The ledger -----------------------------------------------------------------------
  protected readonly ledger = requestState(() => this.load(), { immediate: false });
  protected readonly report = computed(() => {
    const loaded = this.ledger.value();
    return loaded?.kind === 'ledger' ? loaded.report : null;
  });
  protected readonly unknownCode = computed(() => {
    const loaded = this.ledger.value();
    return loaded?.kind === 'unknown' ? loaded.code : null;
  });
  protected readonly unknownTitle = computed(() => {
    const code = this.unknownCode();
    return this.mode === 'account'
      ? `Aucun compte de cette société n’a le code « ${code} ».`
      : `Aucun tiers de cette société n’a le code « ${code} ».`;
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
      .map((warning) => this.noteOf(warning))
      .filter((text): text is string => text !== null),
  );
  protected readonly draftsUrl = `${ACCOUNTING}/ecritures`;
  protected readonly draftsQuery = computed(() => ({ etat: 'draft', au: this.period().to }));
  /** The subjects unfolded, and the lines read of each. */
  protected readonly unfolded = signal<ReadonlySet<string>>(new Set());
  protected readonly lines = signal<ReadonlyMap<string, SubjectLines>>(new Map());

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
  protected readonly tiersItems = computed<readonly DropdownItem[]>(() => {
    const chosen = this.tiers();
    return TIERS.map((item) => ({
      id: item.id,
      label: item.label,
      checked: chosen.length === 0 || chosen.includes(item.id),
    }));
  });
  protected readonly tiersLabel = computed(() => {
    const chosen = this.tiers();
    return chosen.length === 1
      ? (TIERS.find((item) => item.id === chosen[0])?.label ?? '')
      : 'Comptes à recevoir et à payer';
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
    () =>
      this.session.can('imports_exports.export') &&
      this.session.can(this.mode === 'account' ? 'reporting.read' : 'reporting.read_auxiliary'),
  );
  protected readonly canOpenEntries = computed(() =>
    this.navigation.canOpenUrl(
      this.mode === 'account' ? `${ACCOUNTING}/ecritures` : `${ACCOUNTING}/ecritures/pieces`,
    ),
  );
  protected readonly exporting = signal<'pdf' | 'xlsx' | null>(null);
  private readonly subjectIds = new Map<string, string | null>();

  constructor() {
    effect(() => {
      // Any change of a filter or of the page: one new read, the lines read again.
      this.period();
      this.subjectCode();
      this.tiers();
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
      // The subjects unfolded keep their lines, read again with the new filters; the one
      // asked by the URL opens unfolded.
      const found = this.report();
      if (!found) {
        return;
      }
      untracked(() => {
        const alone = this.subjectCode() ? found.subjects.map((subject) => subject.id) : [];
        const open = new Set([...this.unfolded(), ...alone]);
        this.unfolded.set(open);
        for (const subject of found.subjects) {
          if (open.has(subject.id) && !this.lines().has(subject.id)) {
            this.readLines(subject.id, 1);
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

  /** A tiers account on or off; both off is both on, as Odoo's. */
  protected toggleTiers(item: DropdownItem): void {
    const chosen = this.tiers().length ? this.tiers() : TIERS.map((entry) => entry.id);
    const next = chosen.includes(item.id as TiersAccount)
      ? chosen.filter((id) => id !== item.id)
      : [...chosen, item.id as TiersAccount];
    const urls = next.length === TIERS.length || next.length === 0 ? [] : next;
    this.navigate({
      [GENERAL_LEDGER_PARAM.tiers]: urls.length
        ? TIERS.filter((entry) => urls.includes(entry.id)).map((entry) => entry.url)
        : null,
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

  /** A subject unfolded (its lines read once) or folded, as Odoo's. */
  protected toggle(subject: Subject): void {
    const open = new Set(this.unfolded());
    if (open.delete(subject.id)) {
      this.unfolded.set(open);
      return;
    }
    open.add(subject.id);
    this.unfolded.set(open);
    if (!this.lines().has(subject.id)) {
      this.readLines(subject.id, 1);
    }
  }

  protected loadMore(subject: Subject): void {
    const read = this.lines().get(subject.id);
    if (read && !read.loading) {
      this.readLines(subject.id, read.page + 1);
    }
  }

  protected setPage(page: number): void {
    this.navigate({ [GENERAL_LEDGER_PARAM.page]: page > 1 ? page : null });
  }

  /** La vue tableau, ou les comptes en T ; le choix est retenu sur cet appareil. */
  protected readonly views = LEDGER_VIEWS;
  protected readonly view = signal<LedgerView>(readLedgerView());

  protected chooseView(id: string | null): void {
    const view: LedgerView = id === 'cards' ? 'cards' : 'table';
    this.view.set(view);
    rememberLedgerView(view);
  }

  /** Une carte arrive à l'écran : ses mouvements sont lus, une fois (les mêmes que le tableau). */
  protected showCard(subject: Subject): void {
    if (!this.lines().has(subject.id)) {
      this.readLines(subject.id, 1);
    }
  }

  /** Tous les mouvements d'un compte : la vue tableau, ce compte déplié. */
  protected openInTable(subject: Subject): void {
    this.chooseView('table');
    if (!this.unfolded().has(subject.id)) {
      this.toggle(subject);
    }
  }

  protected isZero(amount: string): boolean {
    return Number(amount) === 0;
  }

  protected isNegative(amount: string): boolean {
    return amount.startsWith('-') && !this.isZero(amount);
  }

  protected date(value: string | null | undefined): string {
    return value ? day(value) : '';
  }

  /** « Écritures comptables » of an account, or the entries of a partner, on the same dates. */
  protected entriesLink(subject: Subject): { readonly url: string[]; readonly query: Params } {
    const period = this.period();
    const dates = { du: period.from, au: period.to };
    return this.mode === 'account'
      ? {
          url: [ACCOUNTING, 'ecritures'],
          query: { classe: subject.code, ...dates, ...(this.drafts() ? { etat: 'all' } : {}) },
        }
      : { url: [ACCOUNTING, 'ecritures', 'pieces'], query: { tiers: subject.code, ...dates } };
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
    const type = this.mode === 'account' ? 'reporting.general_ledger' : 'reporting.partner_ledger';
    try {
      const run = await firstValueFrom(
        this.transfers.createExport(type, this.exportParameters(), format),
      );
      if (run.status !== 'completed') {
        this.toast.error(failed);
        return;
      }
      const file = await firstValueFrom(this.transfers.download(run.public_id));
      saveFile(file.blob, file.filename ?? run.filename ?? `grand-livre.${format}`);
    } catch {
      this.toast.error(failed);
    } finally {
      this.exporting.set(null);
    }
  }

  /** The export follows the ledger on screen: its period, subject, filters and search. */
  private exportParameters(): Readonly<Record<string, unknown>> {
    const period = this.period();
    const only = this.subjectIds.get(this.subjectCode()) ?? null;
    return {
      date_from: period.from,
      date_to: period.to,
      ...(only ? { [this.mode]: only } : {}),
      ...(this.mode === 'partner' ? { tiers: this.tiers() } : {}),
      journal: this.chosenJournals().map((item) => item.public_id),
      include_unposted: this.drafts(),
      search: this.searchText(),
    };
  }

  private noteOf(warning: ReportWarning): string | null {
    return warning.code === 'partner_opening_not_carried'
      ? 'Les soldes des partenaires commencent avec cet exercice : ceux des années précédentes ne sont pas reportés.'
      : warningText(warning);
  }

  private readLines(subjectId: string, page: number): void {
    const scope = this.report()?.scope;
    if (!scope) {
      return;
    }
    const before = this.lines().get(subjectId);
    this.setLines(subjectId, {
      rows: before?.rows ?? [],
      count: before?.count ?? 0,
      page: before?.page ?? 0,
      loading: true,
      failed: false,
    });
    const period = this.period();
    const query: LedgerQuery = {
      fiscalYear: scope.fiscal_year.public_id,
      dateFrom: period.from,
      dateTo: period.to,
      journals: this.chosenJournals().map((item) => item.public_id),
      includeUnposted: this.drafts(),
      tiers: this.tiers().length ? this.tiers() : TIERS.map((item) => item.id),
      page,
      pageSize: GENERAL_LEDGER_LINES,
    };
    const lines$: Observable<{ readonly results: readonly LedgerRow[]; readonly count: number }> =
      this.mode === 'account'
        ? this.reporting.accountLedger(subjectId, query)
        : this.reporting.partnerLedger(subjectId, query);
    lines$.subscribe({
      next: (found) =>
        this.setLines(subjectId, {
          rows: [...(page > 1 ? (before?.rows ?? []) : []), ...found.results],
          count: found.count,
          page,
          loading: false,
          failed: false,
        }),
      error: () =>
        this.setLines(subjectId, {
          rows: before?.rows ?? [],
          count: before?.count ?? 0,
          page: before?.page ?? 0,
          loading: false,
          failed: true,
        }),
    });
  }

  private setLines(subjectId: string, read: SubjectLines): void {
    const next = new Map(this.lines());
    next.set(subjectId, read);
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
    const code = untracked(this.subjectCode);
    const subject$ = code ? this.subjectOf(code) : of(null);
    return subject$.pipe(
      switchMap((subject): Observable<Loaded> => {
        if (code && !subject) {
          return of({ kind: 'unknown', code });
        }
        return this.read(subject).pipe(map((report): Loaded => ({ kind: 'ledger', report })));
      }),
    );
  }

  /** The general ledger or the partner ledger, as the lines of one report. */
  private read(subject: string | null): Observable<Report> {
    const period = untracked(this.period);
    const filters = {
      dateFrom: period.from,
      dateTo: period.to,
      journals: untracked(this.chosenJournals).map((item) => item.public_id),
      includeUnposted: untracked(this.drafts),
      search: untracked(this.searchText),
      page: untracked(this.page),
    };
    if (this.mode === 'account') {
      return this.reporting.generalLedger({ ...filters, account: subject }).pipe(
        map((found) => ({
          ...found,
          subjects: found.results.map((row) => ({
            id: row.account.public_id,
            code: row.account.code,
            label: `${row.account.code} ${row.account.name}`,
            figures: row,
          })),
        })),
      );
    }
    return this.reporting
      .partnersLedger({ ...filters, partner: subject, tiers: untracked(this.tiers) })
      .pipe(
        map((found) => ({
          ...found,
          subjects: found.results.map((row) => ({
            id: row.partner.public_id,
            code: row.partner.code,
            label: row.partner.name,
            figures: row,
          })),
        })),
      );
  }

  /** The account or the partner of a code, found once; an unknown code reads nothing else. */
  private subjectOf(code: string): Observable<string | null> {
    const known = this.subjectIds.get(code);
    if (known !== undefined) {
      return of(known);
    }
    const found$ =
      this.mode === 'account'
        ? this.accounting.accountByCode(code).pipe(map((item) => item?.public_id ?? null))
        : this.partners.byCode(code).pipe(map((item) => item?.public_id ?? null));
    return found$.pipe(
      map((id) => {
        this.subjectIds.set(code, id);
        return id;
      }),
    );
  }
}
