import { NgTemplateOutlet } from '@angular/common';
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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, catchError, firstValueFrom, map, of } from 'rxjs';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { APP_ROOT } from '../../../core/navigation/applications';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoIcon } from '../../../shared/ui/icon/icon';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { localToday } from '../../../shared/utils/dates';
import { saveFile } from '../../../shared/utils/save-file';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { TransfersApi } from '../../transfers/transfers-api';
import { ReportingApi } from '../data-access/reporting-api';
import { IncomeStatement, StatementAccount } from '../data-access/reporting-models';
import { GENERAL_LEDGER_PARAM, LEDGER_PATHS } from '../general-ledger/general-ledger-presentation';
import {
  AlcoReportPeriod,
  Period,
  PeriodChoice,
  PERIOD_PARAM,
  periodFromUrl,
  periodParams,
} from '../report-period/report-period';
import { INCOME_STATEMENT_ERRORS, blockPairs, totalLabel } from './income-statement-presentation';

const ACCOUNTING = `${APP_ROOT}/comptabilite`;

/**
 * Comptabilité › Analyse › Compte de résultat (note backend 0055): charges on the left,
 * products on the right, block facing block; the profit with the charges, the loss with the
 * products; the year by default. Every figure is the server's.
 */
@Component({
  selector: 'alco-income-statement-page',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    AlcoAmountPipe,
    AlcoButton,
    AlcoErrorState,
    AlcoIcon,
    AlcoLoading,
    AlcoReportPeriod,
  ],
  templateUrl: './income-statement-page.html',
  styleUrl: './income-statement-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IncomeStatementPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly reporting = inject(ReportingApi);
  private readonly partners = inject(PartnersApi);
  private readonly transfers = inject(TransfersApi);
  private readonly toast = inject(AlcoToastService);
  protected readonly session = inject(SessionStore);

  protected readonly totalLabel = totalLabel;

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private readonly dates = computed(() => periodFromUrl(this.params(), localToday(), 'annee'));
  protected readonly periodKind = computed(() => this.dates().kind);
  protected readonly anchor = computed(() => this.dates().anchor);
  protected readonly period = computed<Period>(() => this.dates().period);

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

  protected readonly statement = requestState(() => this.load(), { immediate: false });
  protected readonly failure = computed(() => {
    const error = this.statement.error();
    return error ? toUserError(error, INCOME_STATEMENT_ERRORS) : null;
  });
  protected readonly pairs = computed(() => {
    const found = this.statement.value();
    return found ? blockPairs(found) : [];
  });
  private readonly warnings = computed(() => this.statement.value()?.warnings ?? []);
  protected readonly unposted = computed(() =>
    this.warnings().some((warning) => warning.code === 'unposted_entries'),
  );
  /** The server's result against the books' (income less expense), when they differ. */
  protected readonly mismatch = computed(() => {
    const details = this.warnings().find(
      (warning) => warning.code === 'income_statement_result_mismatch',
    )?.details;
    return details
      ? { statement: String(details['statement']), books: String(details['books']) }
      : null;
  });
  protected readonly draftsUrl = `${ACCOUNTING}/ecritures`;
  protected readonly draftsQuery = computed(() => ({ etat: 'draft', au: this.period().to }));

  /** The lines unfolded to their accounts, by side and code. */
  private readonly open = signal<ReadonlySet<string>>(new Set());

  protected readonly canExport = computed(
    () =>
      this.session.can('imports_exports.export') &&
      this.session.can('reporting.read_financial_statements'),
  );
  protected readonly exporting = signal<'pdf' | 'xlsx' | null>(null);

  constructor() {
    effect(() => {
      this.period();
      untracked(() => this.statement.reload());
    });
  }

  protected choosePeriod(choice: PeriodChoice): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: periodParams(choice, this.anchor(), this.period(), 'annee'),
      queryParamsHandling: 'merge',
    });
  }

  protected isOpen(side: string, code: string): boolean {
    return this.open().has(`${side}-${code}`);
  }

  protected toggle(side: string, code: string): void {
    const key = `${side}-${code}`;
    this.open.update((open) => {
      const next = new Set(open);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  /** The general ledger of an account, on the same dates. */
  protected ledgerQuery(account: StatementAccount): Record<string, string> {
    const period = this.period();
    return {
      [GENERAL_LEDGER_PARAM.account]: account.code,
      [PERIOD_PARAM.period]: 'perso',
      [PERIOD_PARAM.from]: period.from,
      [PERIOD_PARAM.to]: period.to,
    };
  }

  protected readonly ledgerUrl = `${ACCOUNTING}/${LEDGER_PATHS.account}`;

  protected isZero(amount: string): boolean {
    return Number(amount) === 0;
  }

  protected isNegative(amount: string): boolean {
    return amount.startsWith('-') && !this.isZero(amount);
  }

  protected async exportFile(format: 'pdf' | 'xlsx'): Promise<void> {
    if (this.exporting()) {
      return;
    }
    this.exporting.set(format);
    const failed = 'L’export a échoué. Réessayez ; si le problème continue, contactez le support.';
    const period = this.period();
    try {
      const run = await firstValueFrom(
        this.transfers.createExport(
          'reporting.income_statement',
          { date_from: period.from, date_to: period.to },
          format,
        ),
      );
      if (run.status !== 'completed') {
        this.toast.error(failed);
        return;
      }
      const file = await firstValueFrom(this.transfers.download(run.public_id));
      saveFile(file.blob, file.filename ?? run.filename ?? `compte-de-resultat.${format}`);
    } catch {
      this.toast.error(failed);
    } finally {
      this.exporting.set(null);
    }
  }

  private load(): Observable<IncomeStatement> {
    const period = untracked(this.period);
    return this.reporting.incomeStatement(period.from, period.to);
  }
}
