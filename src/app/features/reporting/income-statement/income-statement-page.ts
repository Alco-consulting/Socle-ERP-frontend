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
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { localToday } from '../../../shared/utils/dates';
import { saveFile } from '../../../shared/utils/save-file';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { TransfersApi } from '../../transfers/transfers-api';
import { ReportingApi } from '../data-access/reporting-api';
import { IncomeStatement } from '../data-access/reporting-models';
import {
  AlcoReportPeriod,
  Period,
  PeriodChoice,
  periodFromUrl,
  periodParams,
} from '../report-period/report-period';
import { AlcoStatementSheet, ledgerLink } from '../statement-sheet/statement-sheet';
import { INCOME_STATEMENT_ERRORS, incomeFoot, incomePairs } from './income-statement-presentation';

const ACCOUNTING = `${APP_ROOT}/comptabilite`;

/**
 * Comptabilité › Analyse › Compte de résultat (note backend 0055): charges on the left,
 * products on the right, block facing block, each with its total on its title and its
 * accounts under it; the profit with the charges, the loss with the products; the year by
 * default. Every figure is the server's.
 */
@Component({
  selector: 'alco-income-statement-page',
  imports: [
    RouterLink,
    AlcoAmountPipe,
    AlcoButton,
    AlcoErrorState,
    AlcoLoading,
    AlcoReportPeriod,
    AlcoStatementSheet,
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
    const dates = this.period();
    return found ? incomePairs(found, (account) => ledgerLink(account.code, dates)) : [];
  });
  protected readonly foot = computed(() => {
    const found = this.statement.value();
    return found ? incomeFoot(found) : [];
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
