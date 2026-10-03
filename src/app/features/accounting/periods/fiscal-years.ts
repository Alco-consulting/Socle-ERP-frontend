import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { AlcoTable, AlcoCell, TableColumn } from '../../../shared/tables/table';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoCard } from '../../../shared/ui/card/card';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import {
  ACCOUNTING_REFERENTIAL_ERRORS,
  FISCAL_YEAR_STATUS,
  PERIOD_STATUS,
  dateRange,
} from '../accounting-presentation';
import { FiscalYear, Period } from '../data-access/accounting-models';
import { AccountingApi } from '../data-access/accounting-api';

/** The fiscal year shown is in the URL, so that « Retour » and a link keep it. */
const PARAM = 'exercice';

/**
 * Comptabilité › Configuration › Exercices et périodes, read only: the fiscal years of the
 * company and the periods of one of them, with the states the server gives (open,
 * closed). Creating, closing or reopening stays with a later module (`manage_periods`).
 */
@Component({
  selector: 'alco-fiscal-years',
  imports: [
    AlcoBadge,
    AlcoCard,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoLoading,
    AlcoPageHeader,
    AlcoTable,
  ],
  templateUrl: './fiscal-years.html',
  styleUrl: './fiscal-years.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FiscalYearsPage {
  private readonly api = inject(AccountingApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly yearStatus = FISCAL_YEAR_STATUS;
  protected readonly dateRange = dateRange;

  protected readonly years = requestState(() =>
    this.api.fiscalYears().pipe(map((page) => page.results)),
  );

  private readonly requested = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get(PARAM))),
    { initialValue: this.route.snapshot.queryParamMap.get(PARAM) },
  );

  /** The one asked in the URL, else an open one, else the most recent (the server's order). */
  protected readonly selected = computed<FiscalYear | null>(() => {
    const years = this.years.value() ?? [];
    return (
      years.find((year) => year.public_id === this.requested()) ??
      years.find((year) => year.status === 'open') ??
      years[0] ??
      null
    );
  });

  protected readonly periods = requestState(
    () =>
      this.api.periods(untracked(this.selected)?.public_id ?? '').pipe(map((page) => page.results)),
    { immediate: false },
  );

  protected readonly periodColumns: readonly TableColumn[] = [
    { key: 'code', label: 'Code', width: '8rem' },
    { key: 'label', label: 'Libellé' },
    { key: 'dates', label: 'Dates' },
    { key: 'status', label: 'État', width: '9rem' },
  ];
  protected readonly periodId = (period: Period) => period.public_id;

  protected readonly loadError = computed(() => {
    const error = this.years.error() ?? this.periods.error();
    return error ? toUserError(error, ACCOUNTING_REFERENTIAL_ERRORS) : null;
  });

  constructor() {
    effect(() => {
      if (this.selected()) {
        untracked(() => this.periods.reload());
      }
    });
  }

  protected periodLook(period: Period) {
    return PERIOD_STATUS[period.status];
  }

  protected select(year: FiscalYear): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [PARAM]: year.public_id },
      replaceUrl: true,
    });
  }

  protected retry(): void {
    this.years.reload();
  }
}
