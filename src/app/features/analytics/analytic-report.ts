import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, catchError, of } from 'rxjs';

import { toUserError } from '../../core/errors/user-error';
import { requestState } from '../../core/http/request-state';
import { SessionStore } from '../../core/session/session.store';
import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoAmountPipe } from '../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../shared/tables/table';
import { AlcoEmptyState } from '../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { localToday } from '../../shared/utils/dates';
import { subtractDecimals } from '../../shared/utils/decimal';
import { referencePlaces } from '../currencies/reference-places';
import {
  AlcoReportPeriod,
  PeriodChoice,
  periodFromUrl,
  periodParams,
} from '../reporting/report-period/report-period';
import { ANALYTIC_ERRORS } from './analytics-presentation';
import { AnalyticsApi } from './data-access/analytics-api';
import { AxisReport, AxisReportRow } from './data-access/analytics-models';

const PLAN = 'plan';

/**
 * Comptabilité › Analyse › Analytique, as Odoo's: what each analytic account of a plan
 * received over the period (posted entries only), and what nobody distributed.
 */
@Component({
  selector: 'alco-analytic-report',
  imports: [
    AlcoAmountPipe,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
    AlcoReportPeriod,
    AlcoTable,
  ],
  templateUrl: './analytic-report.html',
  styleUrls: ['./analytics-page.scss', './analytic-report.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticReportPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(AnalyticsApi);
  protected readonly session = inject(SessionStore);

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private readonly dates = computed(() => periodFromUrl(this.params(), localToday(), 'annee'));
  protected readonly periodKind = computed(() => this.dates().kind);
  protected readonly anchor = computed(() => this.dates().anchor);
  protected readonly period = computed(() => this.dates().period);
  protected readonly places = referencePlaces();
  protected readonly currency = computed(() => this.session.activeCompany()?.currency ?? '');

  protected readonly plans = toSignal(this.api.axes().pipe(catchError(() => of([]))), {
    initialValue: null,
  });
  /** The plan of the URL, or the first one. */
  protected readonly plan = computed(() => {
    const plans = this.plans() ?? [];
    const wanted = this.params().get(PLAN);
    return plans.find((plan) => plan.public_id === wanted) ?? plans[0] ?? null;
  });

  protected readonly report = requestState(() => this.load(), { immediate: false });
  protected readonly failure = computed(() => {
    const error = this.report.error();
    return error ? toUserError(error, ANALYTIC_ERRORS) : null;
  });
  protected readonly columns: readonly TableColumn[] = [
    { key: 'account', label: 'Compte analytique' },
    { key: 'debit', label: 'Débit', width: '10rem', numeric: true, hideBelow: 'tablet' },
    { key: 'credit', label: 'Crédit', width: '10rem', numeric: true, hideBelow: 'tablet' },
    { key: 'balance', label: 'Solde', width: '10rem', numeric: true },
  ];
  protected readonly rowId = (row: AxisReportRow) => row.value.public_id;

  constructor() {
    effect(() => {
      // A new plan or period: the report again.
      this.plan();
      this.period();
      this.report.reload();
    });
  }

  protected choosePlan(planId: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [PLAN]: planId },
      queryParamsHandling: 'merge',
    });
  }

  protected choosePeriod(choice: PeriodChoice): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: periodParams(choice, this.anchor(), this.period(), 'annee'),
      queryParamsHandling: 'merge',
    });
  }

  /** Debit less credit: what an account cost (positive) or brought (negative). */
  protected balanceOf(sides: { debit: string; credit: string }): string {
    return subtractDecimals(sides.debit, sides.credit);
  }

  private load(): Observable<AxisReport | null> {
    const plan = this.plan();
    if (!plan) {
      return of(null);
    }
    const dates = this.period();
    return this.api.axisReport(plan.public_id, dates.from, dates.to);
  }
}
