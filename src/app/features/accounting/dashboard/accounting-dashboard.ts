import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin, map, of, switchMap } from 'rxjs';

import { toUserError } from '../../../core/errors/user-error';
import { ApiError } from '../../../core/http/api-error';
import { requestState } from '../../../core/http/request-state';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoCard } from '../../../shared/ui/card/card';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import {
  ACCOUNTING_REFERENTIAL_ERRORS,
  FISCAL_YEAR_STATUS,
  PERIOD_STATUS,
  dateRange,
  journalTypeLabel,
} from '../accounting-presentation';
import { FiscalYear, Period } from '../data-access/accounting-models';
import { AccountingApi } from '../data-access/accounting-api';

interface OpenYear {
  readonly year: FiscalYear;
  readonly periods: readonly Period[];
}

/**
 * Comptabilité › Tableau de bord, on the API: a workspace, block by block, each with its
 * own loading and error. Only what the server says — open fiscal years and their periods,
 * entries waiting (the server's `count`), active journals, size of the chart of accounts.
 * Nothing is computed here; no block makes one request per item (no N+1).
 */
@Component({
  selector: 'alco-accounting-dashboard',
  imports: [
    RouterLink,
    AlcoBadge,
    AlcoButton,
    AlcoCard,
    AlcoErrorState,
    AlcoLoading,
    AlcoPageHeader,
  ],
  templateUrl: './accounting-dashboard.html',
  styleUrl: './accounting-dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountingDashboardPage {
  private readonly api = inject(AccountingApi);
  protected readonly session = inject(SessionStore);

  protected readonly yearStatus = FISCAL_YEAR_STATUS;
  protected readonly periodStatus = PERIOD_STATUS;
  protected readonly dateRange = dateRange;
  protected readonly journalTypeLabel = journalTypeLabel;

  /** Open fiscal years (the server's status) with their periods. */
  protected readonly years = requestState(() =>
    this.api
      .fiscalYears('open')
      .pipe(
        switchMap((page) =>
          page.results.length === 0
            ? of([] as OpenYear[])
            : forkJoin(
                page.results.map((year) =>
                  this.api
                    .periods(year.public_id)
                    .pipe(map((periods): OpenYear => ({ year, periods: periods.results }))),
                ),
              ),
        ),
      ),
  );

  /** Entries waiting, counted by the server. */
  protected readonly entries = requestState(() =>
    forkJoin({
      draft: this.api.entryCount('draft'),
      submitted: this.api.entryCount('submitted'),
    }),
  );

  protected readonly journals = requestState(() =>
    this.api.journals({ status: 'active' }).pipe(map((page) => page.results)),
  );

  protected readonly chart = requestState(() =>
    forkJoin({ all: this.api.accountCount(), postable: this.api.accountCount(true) }),
  );

  /** « Exercice 2026 », « Aucun exercice ouvert » — the server's open fiscal years. */
  protected readonly yearLabel = computed(() => {
    const years = this.years.value();
    if (!years) {
      return '';
    }
    if (years.length === 0) {
      return 'Aucun exercice ouvert';
    }
    return `${years.length > 1 ? 'Exercices ouverts' : 'Exercice'} : ${years
      .map((item) => item.year.label)
      .join(', ')}`;
  });

  protected readonly subtitle = computed(() =>
    [this.session.activeCompany()?.name, this.yearLabel()].filter(Boolean).join(' · '),
  );

  protected failure(error: ApiError | null) {
    return error ? toUserError(error, ACCOUNTING_REFERENTIAL_ERRORS) : null;
  }
}
