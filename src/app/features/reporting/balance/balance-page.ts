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
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
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
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { AlcoPopover } from '../../../shared/ui/popover/popover';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { localToday } from '../../../shared/utils/dates';
import { saveFile } from '../../../shared/utils/save-file';
import { AccountingApi } from '../../accounting/data-access/accounting-api';
import { Journal } from '../../accounting/data-access/accounting-models';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { TransfersApi } from '../../transfers/transfers-api';
import { BALANCE_PAGE_SIZE, ReportingApi } from '../data-access/reporting-api';
import { AlcoBalanceSidesPipe, BalanceSides } from '../balance-sides';
import {
  BalanceFigures,
  BalanceMovement,
  BalanceRow,
  TrialBalance,
} from '../data-access/reporting-models';
import { GENERAL_LEDGER_PARAM, LEDGER_PATHS } from '../general-ledger/general-ledger-presentation';
import {
  AlcoReportPeriod,
  Period,
  PeriodChoice,
  isIsoDate,
  periodFromUrl,
  periodParams,
  periodQuery,
} from '../report-period/report-period';
import {
  BALANCE_ERRORS,
  BALANCE_PARAM,
  COMPARISONS,
  ComparisonKind,
  MAX_COMPARED,
  earlierPeriods,
  warningText,
} from './balance-presentation';

const ACCOUNTING = `${APP_ROOT}/comptabilite`;
const ALL_JOURNALS = '*';
const OPTION_DRAFTS = 'brouillons';
const OPTION_HIERARCHY = 'hierarchie';
const OPTION_UNFOLD = 'deplier';

/** Les chiffres d'une ligne, ses soldes scindés en débiteur et créditeur. */
interface SplitFigures {
  readonly opening: BalanceSides;
  readonly movements: readonly BalanceMovement[];
  readonly closing: BalanceSides;
}

/** A row of the table: a class or a group of the hierarchy, or an account. */
type Line =
  | {
      readonly kind: 'group';
      readonly key: string;
      readonly code: string;
      readonly name: string;
      readonly level: number;
      readonly figures: BalanceFigures;
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
 * Comptabilité › Analyse › Balance comptable, as Odoo's (notes backend 0051, 0052): PDF and
 * XLSX, the search, the period (◀ ▶), the comparison, the journals, the entries, all in the
 * URL; Solde initial et Solde final scindés en débiteur et créditeur (balance à six colonnes),
 * each period's Débit and Crédit; the ⋮ of an account toward its ledger or its lines. Every
 * figure is the server's.
 */
@Component({
  selector: 'alco-balance-page',
  imports: [
    NgTemplateOutlet,
    ReactiveFormsModule,
    RouterLink,
    AlcoAmountPipe,
    AlcoBalanceSidesPipe,
    AlcoButton,
    AlcoDropdown,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoIcon,
    AlcoInput,
    AlcoLoading,
    AlcoPagination,
    AlcoPopover,
    AlcoReportPeriod,
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
  protected readonly comparisons = COMPARISONS;
  protected readonly maxCompared = MAX_COMPARED;

  // ---- State of the URL ---------------------------------------------------------------
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  /** Odoo opens the balance on this month. */
  private readonly dates = computed(() => periodFromUrl(this.params(), localToday()));
  protected readonly periodKind = computed(() => this.dates().kind);
  protected readonly anchor = computed(() => this.dates().anchor);
  protected readonly period = computed<Period>(() => this.dates().period);
  protected readonly comparison = computed<ComparisonKind | null>(() => {
    const wanted = this.params().get(BALANCE_PARAM.comparison);
    return COMPARISONS.find((item) => item.id === wanted)?.id ?? null;
  });
  protected readonly compared = computed(() => {
    const count = Number(this.params().get(BALANCE_PARAM.count));
    return Number.isInteger(count) && count >= 1 && count <= MAX_COMPARED ? count : 1;
  });
  private readonly customCompared = computed<Period | null>(() => {
    const from = this.params().get(BALANCE_PARAM.compareFrom);
    const to = this.params().get(BALANCE_PARAM.compareTo);
    return isIsoDate(from) && isIsoDate(to) ? { from, to } : null;
  });
  protected readonly earlier = computed(() =>
    earlierPeriods(
      this.comparison(),
      this.compared(),
      this.periodKind(),
      this.period(),
      this.customCompared(),
    ),
  );
  /** Journal codes; none: every journal. */
  private readonly journalCodes = computed(() => this.params().getAll(BALANCE_PARAM.journal));
  protected readonly drafts = computed(() => this.params().get(BALANCE_PARAM.unposted) === 'oui');
  protected readonly hierarchy = computed(
    () => this.params().get(BALANCE_PARAM.hierarchy) === 'oui',
  );
  private readonly searchText = computed(() => this.params().get(BALANCE_PARAM.search) ?? '');
  protected readonly page = computed(() => Number(this.params().get(BALANCE_PARAM.page)) || 1);

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
  /** Odoo's banner: drafts before or within the period, left out. */
  protected readonly unposted = computed(() =>
    (this.balance.value()?.warnings ?? []).some((warning) => warning.code === 'unposted_entries'),
  );
  protected readonly notes = computed(() =>
    (this.balance.value()?.warnings ?? [])
      .map((warning) => warningText(warning))
      .filter((text): text is string => text !== null),
  );
  /** The drafts up to the period's end, in Écritures comptables. */
  protected readonly draftsUrl = `${ACCOUNTING}/ecritures`;
  protected readonly draftsQuery = computed(() => ({ etat: 'draft', au: this.period().to }));
  /**
   * La ligne Total : les totaux du serveur sur toutes les lignes. Les soldes y sont ceux des
   * colonnes débitrice et créditrice, quand le serveur les donne ; jamais calculés ici.
   */
  protected readonly total = computed<SplitFigures | null>(() => {
    const balance = this.balance.value();
    if (!balance) {
      return null;
    }
    const totals = balance.totals;
    return {
      opening: { debit: totals.opening_debit ?? null, credit: totals.opening_credit ?? null },
      movements: balance.movements,
      closing: { debit: totals.closing_debit ?? null, credit: totals.closing_credit ?? null },
    };
  });
  /** Le serveur ne donne pas encore les totaux des soldes débiteurs et créditeurs. */
  protected readonly totalsPending = computed(() => {
    const totals = this.balance.value()?.totals;
    return !!totals && totals.closing_debit === undefined;
  });
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
          figures: group,
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
  protected readonly comparisonButton = computed(() => {
    const chosen = COMPARISONS.find((item) => item.id === this.comparison());
    return chosen ? `Comparaison: ${chosen.title}` : 'Comparaison';
  });
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
    { id: OPTION_HIERARCHY, label: 'Hiérarchie et sous-totaux', checked: this.hierarchy() },
    ...(this.hierarchy()
      ? [{ id: OPTION_UNFOLD, label: 'Tout déplier', checked: this.folded().size === 0 }]
      : []),
  ]);

  protected readonly compareFromControl = new FormControl('', { nonNullable: true });
  protected readonly compareToControl = new FormControl('', { nonNullable: true });
  protected readonly searchControl = new FormControl('', { nonNullable: true });

  // ---- Export (PDF, XLSX, as Odoo's) ---------------------------------------------------
  protected readonly canExport = computed(
    () => this.session.can('imports_exports.export') && this.session.can('reporting.read'),
  );
  protected readonly exporting = signal<'pdf' | 'xlsx' | null>(null);

  constructor() {
    effect(() => {
      // Any change of a filter or of the page: one new read, once the journals are known.
      this.period();
      this.earlier();
      this.chosenJournals();
      this.drafts();
      this.searchText();
      this.page();
      if (this.journals.value() !== null || this.journals.error()) {
        untracked(() => this.balance.reload());
      }
    });
    effect(() => {
      const custom = this.customCompared();
      const search = this.searchText();
      untracked(() => {
        this.compareFromControl.setValue(custom?.from ?? '', { emitEvent: false });
        this.compareToControl.setValue(custom?.to ?? '', { emitEvent: false });
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

  /** A choice of the date menu, into the URL. */
  protected choosePeriod(choice: PeriodChoice): void {
    this.navigate({
      ...periodParams(choice, this.anchor(), this.period()),
      [BALANCE_PARAM.page]: null,
    });
  }

  protected compare(kind: ComparisonKind | null): void {
    const before = earlierPeriods('precedente', 1, this.periodKind(), this.period(), null)[0];
    this.navigate({
      [BALANCE_PARAM.comparison]: kind,
      [BALANCE_PARAM.count]: kind === 'precedente' || kind === 'exercice' ? this.compared() : null,
      // Personal dates start from the period before the one on screen.
      [BALANCE_PARAM.compareFrom]: kind === 'perso' ? before.from : null,
      [BALANCE_PARAM.compareTo]: kind === 'perso' ? before.to : null,
      [BALANCE_PARAM.page]: null,
    });
  }

  protected setCompared(event: Event): void {
    const count = Number((event.target as HTMLInputElement).value);
    if (Number.isInteger(count) && count >= 1 && count <= MAX_COMPARED) {
      this.navigate({ [BALANCE_PARAM.count]: count, [BALANCE_PARAM.page]: null });
    }
  }

  protected setComparedDates(): void {
    const from = this.compareFromControl.value;
    const to = this.compareToControl.value;
    if (from && to) {
      this.navigate({ [BALANCE_PARAM.compareFrom]: from, [BALANCE_PARAM.compareTo]: to });
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
    if (item.id === OPTION_DRAFTS) {
      this.navigate({
        [BALANCE_PARAM.unposted]: this.drafts() ? null : 'oui',
        [BALANCE_PARAM.page]: null,
      });
    } else if (item.id === OPTION_HIERARCHY) {
      this.navigate({ [BALANCE_PARAM.hierarchy]: this.hierarchy() ? null : 'oui' });
    } else if (item.id === OPTION_UNFOLD) {
      const groups = this.balance.value()?.groups ?? [];
      this.folded.set(
        this.folded().size === 0 ? new Set(groups.map((group) => group.code)) : new Set(),
      );
    }
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

  protected isZero(amount: string): boolean {
    return Number(amount) === 0;
  }

  protected async exportFile(format: 'pdf' | 'xlsx'): Promise<void> {
    if (this.exporting()) {
      return;
    }
    this.exporting.set(format);
    const failed = 'L’export a échoué. Réessayez ; si le problème continue, contactez le support.';
    try {
      const run = await firstValueFrom(
        this.transfers.createExport('reporting.balance', this.exportParameters(), format),
      );
      if (run.status !== 'completed') {
        this.toast.error(failed);
        return;
      }
      const file = await firstValueFrom(this.transfers.download(run.public_id));
      saveFile(file.blob, file.filename ?? run.filename ?? `balance-comptable.${format}`);
    } catch {
      this.toast.error(failed);
    } finally {
      this.exporting.set(null);
    }
  }

  /** The export follows the balance on screen: its periods, journals, entries and search. */
  private exportParameters(): Readonly<Record<string, unknown>> {
    const period = this.period();
    const earlier = this.earlier();
    return {
      date_from: period.from,
      date_to: period.to,
      column_from: earlier.map((item) => item.from),
      column_to: earlier.map((item) => item.to),
      journal: this.chosenJournals().map((item) => item.public_id),
      include_unposted: this.drafts(),
      search: this.searchText(),
    };
  }

  private accountLine(row: BalanceRow): Line {
    const period = this.period();
    const code = encodeURIComponent(row.account.code);
    const dates = `du=${period.from}&au=${period.to}`;
    const same = periodQuery(this.periodKind(), this.anchor(), period);
    const menu: DropdownItem[] = [
      {
        id: 'ledger',
        label: 'Grand livre général',
        route: `${ACCOUNTING}/${LEDGER_PATHS.account}?${GENERAL_LEDGER_PARAM.account}=${code}&${same}`,
      },
    ];
    if (this.navigation.canOpenUrl(`${ACCOUNTING}/ecritures`)) {
      menu.push({
        id: 'lines',
        label: 'Écritures comptables',
        route: `${ACCOUNTING}/ecritures?classe=${code}&${dates}${this.drafts() ? '&etat=all' : ''}`,
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
      earlier: untracked(this.earlier),
      journals: untracked(this.chosenJournals).map((item) => item.public_id),
      includeUnposted: untracked(this.drafts),
      search: untracked(this.searchText),
      page: untracked(this.page),
    });
  }
}
