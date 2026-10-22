import { NgTemplateOutlet } from '@angular/common';
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
import { ActivatedRoute, Params, Router } from '@angular/router';
import { Observable, catchError, debounceTime, firstValueFrom, map, of } from 'rxjs';

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
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { localToday } from '../../../shared/utils/dates';
import { saveFile } from '../../../shared/utils/save-file';
import { AccountingApi } from '../../accounting/data-access/accounting-api';
import { Journal } from '../../accounting/data-access/accounting-models';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { TransfersApi } from '../../transfers/transfers-api';
import { BALANCE_PAGE_SIZE, ReportingApi } from '../data-access/reporting-api';
import {
  BalanceColumns,
  BalanceRow,
  ReportWarning,
  TrialBalance,
} from '../data-access/reporting-models';
import { LEDGER_PARAM, LEDGER_PATHS } from '../ledger/ledger-presentation';
import {
  BALANCE_ERRORS,
  BALANCE_PARAM,
  PERIODS,
  PeriodKind,
  periodOf,
  warningText,
} from './balance-presentation';

const ACCOUNTING = `${APP_ROOT}/comptabilite`;
const ALL_JOURNALS = '*';
const OPTION_UNPOSTED = 'brouillons';
const OPTION_HIERARCHY = 'hierarchie';

/** A row of the table: a class or a group of the hierarchy, or an account. */
type Line =
  | {
      readonly kind: 'group';
      readonly key: string;
      readonly code: string;
      readonly name: string;
      readonly level: number;
      readonly columns: BalanceColumns;
      readonly folded: boolean;
    }
  | {
      readonly kind: 'account';
      readonly key: string;
      readonly row: BalanceRow;
      readonly indent: boolean;
      readonly menu: readonly DropdownItem[];
    };

/**
 * Comptabilité › Analyse › Balance générale, as Odoo's (note backend 0051): the period, the
 * journals and the options of the URL; six columns (opening and closing net, each on its
 * side); the classes and groups with their sub-totals on request; a menu on each account
 * toward its ledger or its lines; the workbook (XLSX) of the same balance. Every figure is
 * the server's.
 */
@Component({
  selector: 'alco-balance-page',
  imports: [
    NgTemplateOutlet,
    ReactiveFormsModule,
    AlcoAmountPipe,
    AlcoButton,
    AlcoDropdown,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoIcon,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
    AlcoPagination,
  ],
  templateUrl: './balance-page.html',
  styleUrl: './balance-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BalancePage {
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
  protected readonly amountKeys: readonly (keyof BalanceColumns)[] = [
    'opening_debit',
    'opening_credit',
    'debit',
    'credit',
    'closing_debit',
    'closing_credit',
  ];

  // ---- State of the URL ---------------------------------------------------------------
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly periodKind = computed<PeriodKind>(() => {
    const wanted = this.params().get(BALANCE_PARAM.period);
    return PERIODS.find((item) => item.id === wanted)?.id ?? 'annee';
  });
  /** Journal codes; none: every journal. */
  private readonly journalCodes = computed(() => this.params().getAll(BALANCE_PARAM.journal));
  protected readonly unposted = computed(() => this.params().get(BALANCE_PARAM.unposted) === 'oui');
  protected readonly hierarchy = computed(
    () => this.params().get(BALANCE_PARAM.hierarchy) === 'oui',
  );
  private readonly searchText = computed(() => this.params().get(BALANCE_PARAM.search) ?? '');
  protected readonly page = computed(() => Number(this.params().get(BALANCE_PARAM.page)) || 1);

  // ---- References: fiscal years, journals, currency precision --------------------------
  private readonly years = requestState(() =>
    this.accounting.fiscalYears().pipe(map((page) => page.results)),
  );
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
  protected readonly decimals = computed(() => {
    const code = this.session.activeCompany()?.currency;
    return this.currencies().find((item) => item.code === code)?.decimal_places ?? 0;
  });

  protected readonly period = computed(() =>
    periodOf(this.periodKind(), localToday(), this.years.value() ?? [], {
      from: this.params().get(BALANCE_PARAM.from),
      to: this.params().get(BALANCE_PARAM.to),
    }),
  );
  /** The journals chosen, as the server knows them (an unknown code is left out). */
  private readonly chosenJournals = computed<readonly Journal[]>(() => {
    const codes = this.journalCodes();
    return (this.journals.value() ?? []).filter((item) => codes.includes(item.code));
  });

  // ---- The balance ---------------------------------------------------------------------
  protected readonly balance = requestState(() => this.load(), { immediate: false });
  protected readonly failure = computed(() => {
    const error = this.balance.error();
    return error ? toUserError(error, BALANCE_ERRORS) : null;
  });
  protected readonly warnings = computed(() =>
    (this.balance.value()?.warnings ?? [])
      .map((warning: ReportWarning) => ({ code: warning.code, text: warningText(warning) }))
      .filter((warning): warning is { code: string; text: string } => warning.text !== null),
  );
  private readonly folded = signal<ReadonlySet<string>>(new Set());

  /** The table's rows: the accounts, under their classes and groups with « Hiérarchie ». */
  protected readonly lines = computed<readonly Line[]>(() => {
    const balance = this.balance.value();
    if (!balance) {
      return [];
    }
    const accounts = balance.results.map((row) => this.accountLine(row));
    if (!this.hierarchy()) {
      return accounts;
    }
    const groups = new Map(balance.groups.map((group) => [group.code, group]));
    const folded = this.folded();
    const lines: Line[] = [];
    let shownClass: string | null = null;
    let shownGroup: string | null = null;
    for (const line of accounts) {
      if (line.kind !== 'account') {
        continue;
      }
      const code = line.row.account.code;
      for (const prefix of [code.slice(0, 1), code.slice(0, 2)]) {
        const group = groups.get(prefix);
        const shown: string | null = prefix.length === 1 ? shownClass : shownGroup;
        if (!group || shown === prefix || prefix === code) {
          continue;
        }
        if (prefix.length === 1) {
          shownClass = prefix;
          shownGroup = null;
        } else {
          shownGroup = prefix;
        }
        if (prefix.length === 2 && folded.has(prefix.slice(0, 1))) {
          continue;
        }
        lines.push({
          kind: 'group',
          key: `group-${prefix}`,
          code: prefix,
          name: group.name,
          level: group.level,
          columns: group.columns,
          folded: folded.has(prefix),
        });
      }
      if (folded.has(code.slice(0, 1)) || folded.has(code.slice(0, 2))) {
        continue;
      }
      lines.push({ ...line, indent: true });
    }
    return lines;
  });

  // ---- Filters (Odoo's buttons) --------------------------------------------------------
  protected readonly periodItems = computed<readonly DropdownItem[]>(() =>
    PERIODS.map((item) => ({
      id: item.id,
      label: item.label,
      checked: item.id === this.periodKind(),
    })),
  );
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
    return chosen.length === 0
      ? 'Tous les journaux'
      : `Journaux : ${chosen.map((item) => item.code).join(', ')}`;
  });
  protected readonly optionItems = computed<readonly DropdownItem[]>(() => [
    {
      id: OPTION_UNPOSTED,
      label: 'Inclure les écritures non comptabilisées',
      checked: this.unposted(),
    },
    { id: OPTION_HIERARCHY, label: 'Hiérarchie et sous-totaux', checked: this.hierarchy() },
  ]);

  protected readonly fromControl = new FormControl('', { nonNullable: true });
  protected readonly toControl = new FormControl('', { nonNullable: true });
  protected readonly searchControl = new FormControl('', { nonNullable: true });

  // ---- Export (XLSX, as Odoo's) --------------------------------------------------------
  protected readonly canExport = computed(
    () => this.session.can('imports_exports.export') && this.session.can('reporting.read'),
  );
  protected readonly exporting = signal(false);

  constructor() {
    effect(() => {
      // Any change of a filter or of the page: one new read, once the references are known.
      this.period();
      this.chosenJournals();
      this.unposted();
      this.searchText();
      this.page();
      const ready =
        (this.years.value() !== null || this.years.error()) &&
        (this.journals.value() !== null || this.journals.error());
      if (ready) {
        untracked(() => this.balance.reload());
      }
    });
    effect(() => {
      const period = this.period();
      const search = this.searchText();
      untracked(() => {
        this.fromControl.setValue(period.from, { emitEvent: false });
        this.toControl.setValue(period.to, { emitEvent: false });
        if (this.searchControl.value !== search) {
          this.searchControl.setValue(search, { emitEvent: false });
        }
      });
    });
    const destroyRef = inject(DestroyRef);
    this.searchControl.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed(destroyRef))
      .subscribe((text) =>
        this.navigate({ [BALANCE_PARAM.search]: text.trim() || null, [BALANCE_PARAM.page]: null }),
      );
  }

  protected choosePeriod(item: DropdownItem): void {
    const kind = item.id as PeriodKind;
    const period = this.period();
    this.navigate({
      [BALANCE_PARAM.period]: kind === 'annee' ? null : kind,
      // A personal period starts from the dates on screen.
      [BALANCE_PARAM.from]: kind === 'perso' ? period.from : null,
      [BALANCE_PARAM.to]: kind === 'perso' ? period.to : null,
      [BALANCE_PARAM.page]: null,
    });
  }

  protected setDates(): void {
    const from = this.fromControl.value;
    const to = this.toControl.value;
    if (from && to) {
      this.navigate({
        [BALANCE_PARAM.from]: from,
        [BALANCE_PARAM.to]: to,
        [BALANCE_PARAM.page]: null,
      });
    }
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
      [BALANCE_PARAM.journal]: next.length ? next : null,
      [BALANCE_PARAM.page]: null,
    });
  }

  protected toggleOption(item: DropdownItem): void {
    if (item.id === OPTION_UNPOSTED) {
      this.includeUnposted(!this.unposted());
    } else if (item.id === OPTION_HIERARCHY) {
      this.navigate({ [BALANCE_PARAM.hierarchy]: this.hierarchy() ? null : 'oui' });
    }
  }

  protected includeUnposted(include: boolean): void {
    this.navigate({ [BALANCE_PARAM.unposted]: include ? 'oui' : null, [BALANCE_PARAM.page]: null });
  }

  /** A class or a group folded or unfolded, as Odoo's hierarchy. */
  protected toggleGroup(code: string): void {
    this.folded.update((folded) => {
      const next = new Set(folded);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  }

  protected setPage(page: number): void {
    this.navigate({ [BALANCE_PARAM.page]: page > 1 ? page : null });
  }

  /** « 0 » stays empty, as Odoo's and the entries' lines: a side without amount. */
  protected isZero(amount: string): boolean {
    return Number(amount) === 0;
  }

  protected async exportWorkbook(): Promise<void> {
    if (this.exporting()) {
      return;
    }
    this.exporting.set(true);
    try {
      const run = await firstValueFrom(
        this.transfers.createExport('reporting.balance', this.exportParameters(), 'xlsx'),
      );
      if (run.status !== 'completed') {
        this.toast.error(
          'L’export a échoué. Réessayez ; si le problème continue, contactez le support.',
        );
        return;
      }
      const file = await firstValueFrom(this.transfers.download(run.public_id));
      saveFile(file.blob, file.filename ?? run.filename ?? 'balance-generale.xlsx');
    } catch {
      this.toast.error(
        'L’export a échoué. Réessayez ; si le problème continue, contactez le support.',
      );
    } finally {
      this.exporting.set(false);
    }
  }

  /** The export follows the balance on screen: its dates, journals, option and search. */
  private exportParameters(): Readonly<Record<string, unknown>> {
    const period = this.period();
    return {
      date_from: period.from,
      date_to: period.to,
      journal: this.chosenJournals().map((item) => item.public_id),
      include_unposted: this.unposted(),
      search: this.searchText(),
    };
  }

  private accountLine(row: BalanceRow): Line {
    const period = this.period();
    const code = encodeURIComponent(row.account.code);
    const dates = `${LEDGER_PARAM.from}=${period.from}&${LEDGER_PARAM.to}=${period.to}`;
    const menu: DropdownItem[] = [
      {
        id: 'ledger',
        label: 'Grand livre',
        icon: 'book',
        route: `${ACCOUNTING}/${LEDGER_PATHS.account}?${LEDGER_PARAM.account}=${code}&${dates}`,
      },
    ];
    if (this.navigation.canOpenUrl(`${ACCOUNTING}/ecritures`)) {
      menu.push({
        id: 'lines',
        label: 'Écritures comptables',
        icon: 'accounting',
        route: `${ACCOUNTING}/ecritures?classe=${code}&${dates}${this.unposted() ? '&etat=all' : ''}`,
      });
    }
    return { kind: 'account', key: row.account.public_id, row, indent: false, menu };
  }

  private navigate(params: Params): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
    });
  }

  private load(): Observable<TrialBalance> {
    const period = untracked(this.period);
    return this.reporting.balance({
      dateFrom: period.from,
      dateTo: period.to,
      journals: untracked(this.chosenJournals).map((item) => item.public_id),
      includeUnposted: untracked(this.unposted),
      search: untracked(this.searchText),
      page: untracked(this.page),
    });
  }
}
