import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { Observable, catchError, map, of, switchMap } from 'rxjs';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { APP_ROOT } from '../../../core/navigation/applications';
import { NavigationService } from '../../../core/navigation/navigation.service';
import { SessionStore } from '../../../core/session/session.store';
import {
  AutocompleteOption,
  AutocompleteSearch,
  AlcoAutocomplete,
} from '../../../shared/forms/autocomplete';
import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { localToday } from '../../../shared/utils/dates';
import { AccountingApi } from '../../accounting/data-access/accounting-api';
import { FiscalYear } from '../../accounting/data-access/accounting-models';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { AlcoDomainTransfers } from '../../transfers/domain-transfers';
import { LEDGER_PAGE_SIZE, ReportingApi } from '../data-access/reporting-api';
import { AccountLedger, LedgerRow, PartnerLedger } from '../data-access/reporting-models';
import { LEDGER_ERRORS, LEDGER_PARAM, LEDGER_TRANSFER, LedgerMode } from './ledger-presentation';

/** The object the ledger is read for, found by its code. */
interface Subject {
  readonly publicId: string;
  readonly code: string;
  readonly name: string;
  readonly hasChildren: boolean;
}

type Loaded =
  | { readonly kind: 'none' }
  | { readonly kind: 'unknown'; readonly code: string }
  | {
      readonly kind: 'ledger';
      readonly subject: Subject;
      readonly ledger: AccountLedger | PartnerLedger;
    };

const ACCOUNTING = `${APP_ROOT}/comptabilite`;

/**
 * Comptabilité › Analyse › Grand livre (`?compte=<code>`) and Grand livre auxiliaire
 * (`?tiers=<code>`): ONE ledger experience on Reporting's paginated reports
 * (`reporting/ledger/<account>/`, `reporting/partners/<partner>/ledger/`). The state is in the
 * URL (object, fiscal year or dates, sub-accounts, page), set by the record it is opened from.
 * Requests: fiscal years and currencies once; then the object's code (once per object) and
 * one page of the ledger. Openings, totals and running balances are the server's.
 */
@Component({
  selector: 'alco-ledger-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoAmountPipe,
    AlcoAutocomplete,
    AlcoCell,
    AlcoDomainTransfers,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
    AlcoPagination,
    AlcoTable,
  ],
  templateUrl: './ledger-page.html',
  styleUrl: './ledger-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LedgerPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly reporting = inject(ReportingApi);
  private readonly accounting = inject(AccountingApi);
  private readonly partners = inject(PartnersApi);
  private readonly navigation = inject(NavigationService);
  protected readonly session = inject(SessionStore);

  protected readonly mode: LedgerMode =
    (this.route.snapshot.data['ledger'] as LedgerMode | undefined) ?? 'account';
  protected readonly title = this.mode === 'account' ? 'Grand livre' : 'Grand livre auxiliaire';
  protected readonly transfer = LEDGER_TRANSFER;
  protected readonly pageSize = LEDGER_PAGE_SIZE;
  protected readonly accountingUrl = ACCOUNTING;

  // ---- State of the URL ---------------------------------------------------------------
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly code = computed(
    () =>
      this.params().get(this.mode === 'account' ? LEDGER_PARAM.account : LEDGER_PARAM.partner) ??
      '',
  );
  private readonly yearParam = computed(() => this.params().get(LEDGER_PARAM.fiscalYear));
  /** The balance's dates (`?du=…&au=…`): its year is the one that holds them. */
  protected readonly dates = computed(() => {
    const from = this.params().get(LEDGER_PARAM.from);
    const to = this.params().get(LEDGER_PARAM.to);
    return from && to ? { from, to } : null;
  });
  protected readonly descendants = computed(
    () => this.mode === 'account' && this.params().get(LEDGER_PARAM.descendants) === 'oui',
  );
  protected readonly page = computed(() => Number(this.params().get(LEDGER_PARAM.page)) || 1);

  // ---- References: fiscal years (choice of the scope), currency precision --------------
  protected readonly years = requestState(() =>
    this.accounting.fiscalYears().pipe(map((page) => page.results)),
  );
  private readonly currencies = toSignal(
    this.partners.currencies().pipe(
      map((page) => page.results),
      catchError(() => of([])),
    ),
    { initialValue: [] },
  );
  protected readonly decimals = computed(() => {
    const code = this.session.activeCompany()?.currency;
    return this.currencies().find((item) => item.code === code)?.decimal_places ?? 0;
  });

  /**
   * The fiscal year read: the URL's, or the one of its dates; else the open one that holds
   * today; else the first open one; else the most recent (the API lists them most recent
   * first). A choice of the screen, never a date the API would imply.
   */
  protected readonly fiscalYear = computed<FiscalYear | null>(() => {
    const years = this.years.value() ?? [];
    const wanted = this.yearParam();
    const from = this.dates()?.from;
    const today = localToday();
    const open = years.filter((year) => year.status === 'open');
    return (
      years.find((year) => year.public_id === wanted) ??
      (from ? years.find((year) => year.start_date <= from && from <= year.end_date) : undefined) ??
      open.find((year) => year.start_date <= today && today <= year.end_date) ??
      open[0] ??
      years[0] ??
      null
    );
  });

  // ---- The ledger ----------------------------------------------------------------------
  private readonly subjects = new Map<string, Subject | null>();
  protected readonly ledger = requestState(() => this.load(), { immediate: false });
  protected readonly loaded = computed(() => this.ledger.value());
  protected readonly failure = computed(() => {
    const error = this.ledger.error();
    return error ? toUserError(error, LEDGER_ERRORS) : null;
  });
  /** The ledger read, its object; the unknown code; or nothing chosen yet. */
  protected readonly report = computed(() => {
    const loaded = this.loaded();
    return loaded?.kind === 'ledger' ? loaded : null;
  });
  protected readonly unknownCode = computed(() => {
    const loaded = this.loaded();
    return loaded?.kind === 'unknown' ? loaded.code : null;
  });
  protected readonly nothingChosen = computed(
    () => this.loaded()?.kind === 'none' || (!this.loaded() && !this.ledger.loading()),
  );
  protected readonly subtitle = computed(() => {
    const report = this.report();
    return report ? `${report.subject.code} — ${report.subject.name}` : '';
  });
  protected readonly rows = computed<readonly LedgerRow[]>(
    () => this.report()?.ledger.results ?? [],
  );

  protected readonly columns = computed<readonly TableColumn[]>(() => [
    { key: 'entry_date', label: 'Date', width: '7rem' },
    { key: 'entry_number', label: 'N° d’écriture', width: '10rem' },
    { key: 'journal', label: 'Journal', width: '6rem', hideBelow: 'tablet' },
    this.mode === 'account'
      ? { key: 'partner', label: 'Tiers', width: '8rem', hideBelow: 'laptop' }
      : { key: 'account_code', label: 'Compte', width: '8rem' },
    { key: 'label', label: 'Libellé' },
    { key: 'debit', label: 'Débit', numeric: true },
    { key: 'credit', label: 'Crédit', numeric: true },
    { key: 'balance', label: 'Solde', numeric: true },
  ]);
  protected readonly rowId = (row: LedgerRow) => row.line;

  /** Export of the account's ledger: one account, without its sub-accounts. */
  protected readonly exportParameters = computed<Readonly<Record<string, string>>>(() => {
    const loaded = this.loaded();
    const year = this.fiscalYear();
    const dates = this.dates();
    const parameters: Record<string, string> =
      loaded?.kind === 'ledger' && year
        ? {
            account: loaded.subject.publicId,
            fiscal_year: year.public_id,
            ...(dates ? { date_from: dates.from, date_to: dates.to } : {}),
          }
        : {};
    return parameters;
  });
  protected readonly canExport = computed(
    () => this.mode === 'account' && !this.descendants() && this.loaded()?.kind === 'ledger',
  );

  // ---- The choice of the object --------------------------------------------------------
  protected readonly subjectControl = new FormControl<AutocompleteOption | null>(null);
  protected readonly yearControl = new FormControl('', { nonNullable: true });
  protected readonly descendantsControl = new FormControl(false, { nonNullable: true });
  protected readonly search: AutocompleteSearch = (term) =>
    this.mode === 'account'
      ? this.accounting.accounts({ search: term }).pipe(
          map((page) =>
            page.results.map((item) => ({
              id: item.public_id,
              label: item.code,
              detail: item.name,
            })),
          ),
        )
      : this.partners.list({ search: term, pageSize: 10 }).pipe(
          map((page) =>
            page.results.map((item) => ({
              id: item.public_id,
              label: item.code,
              detail: item.name,
            })),
          ),
        );

  constructor() {
    effect(() => {
      // Any change of the object, the year, the option or the page: one new read.
      this.code();
      this.fiscalYear();
      this.dates();
      this.descendants();
      this.page();
      if (this.years.value() !== null || this.years.error()) {
        untracked(() => this.ledger.reload());
      }
    });
    effect(() => {
      const year = this.fiscalYear();
      untracked(() => {
        this.yearControl.setValue(year?.public_id ?? '', { emitEvent: false });
        this.descendantsControl.setValue(this.descendants(), { emitEvent: false });
      });
    });
    this.subjectControl.valueChanges.subscribe((option) => {
      if (option) {
        this.navigate({
          [this.mode === 'account' ? LEDGER_PARAM.account : LEDGER_PARAM.partner]: option.label,
          [LEDGER_PARAM.descendants]: null,
          [LEDGER_PARAM.page]: null,
        });
      }
    });
    this.yearControl.valueChanges.subscribe((year) =>
      // Another year: the whole year, the balance's dates left behind.
      this.navigate({
        [LEDGER_PARAM.fiscalYear]: year || null,
        [LEDGER_PARAM.from]: null,
        [LEDGER_PARAM.to]: null,
        [LEDGER_PARAM.page]: null,
      }),
    );
    this.descendantsControl.valueChanges.subscribe((all) =>
      this.navigate({ [LEDGER_PARAM.descendants]: all ? 'oui' : null, [LEDGER_PARAM.page]: null }),
    );
  }

  protected setPage(page: number): void {
    this.navigate({ [LEDGER_PARAM.page]: page > 1 ? page : null });
  }

  /** « 28/09/2026 » from an ISO date of the API. */
  protected day(iso: string): string {
    return iso.split('-').reverse().join('/');
  }

  /** A partner's record, when the user may open Comptabilité › Contacts. */
  protected partnerUrl(publicId: string): string | null {
    return this.navigation.canOpenUrl(`${ACCOUNTING}/contacts`)
      ? `${ACCOUNTING}/contacts/${publicId}`
      : null;
  }

  private navigate(params: Params): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
    });
  }

  private load(): Observable<Loaded> {
    const code = untracked(this.code);
    const year = untracked(this.fiscalYear);
    if (!code || !year) {
      return of({ kind: 'none' });
    }
    const dates = untracked(this.dates);
    const query = {
      fiscalYear: year.public_id,
      dateFrom: dates?.from ?? null,
      dateTo: dates?.to ?? null,
      page: untracked(this.page),
      includeDescendants: untracked(this.descendants),
    };
    return this.subject(code).pipe(
      switchMap((subject): Observable<Loaded> => {
        if (!subject) {
          return of({ kind: 'unknown', code });
        }
        const ledger$: Observable<AccountLedger | PartnerLedger> =
          this.mode === 'account'
            ? this.reporting.accountLedger(subject.publicId, query)
            : this.reporting.partnerLedger(subject.publicId, query);
        return ledger$.pipe(map((ledger): Loaded => ({ kind: 'ledger', subject, ledger })));
      }),
    );
  }

  /** The object of a code, found by the server once per code. */
  private subject(code: string): Observable<Subject | null> {
    const known = this.subjects.get(code);
    if (known !== undefined) {
      return of(known);
    }
    const found$: Observable<Subject | null> =
      this.mode === 'account'
        ? this.accounting.accountByCode(code).pipe(
            map((account) =>
              account
                ? {
                    publicId: account.public_id,
                    code: account.code,
                    name: account.name,
                    hasChildren: account.has_children,
                  }
                : null,
            ),
          )
        : this.partners.byCode(code).pipe(
            map((partner) =>
              partner
                ? {
                    publicId: partner.public_id,
                    code: partner.code,
                    name: partner.name,
                    hasChildren: false,
                  }
                : null,
            ),
          );
    return found$.pipe(
      map((subject) => {
        this.subjects.set(code, subject);
        return subject;
      }),
    );
  }
}
