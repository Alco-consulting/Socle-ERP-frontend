import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { catchError, firstValueFrom, map, of } from 'rxjs';

import { toUserError } from '../../core/errors/user-error';
import { requestState } from '../../core/http/request-state';
import { SessionStore } from '../../core/session/session.store';
import { AlcoCell, AlcoTable, TableColumn } from '../../shared/tables/table';
import { AlcoBadge } from '../../shared/ui/badge/badge';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoCard } from '../../shared/ui/card/card';
import { AlcoEmptyState } from '../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { AccountingApi } from '../accounting/data-access/accounting-api';
import { FiscalYear } from '../accounting/data-access/accounting-models';
import { CLOSING_ERRORS, RUN_STATUS, STEPS, dateRange, runSubject } from './closing-presentation';
import { ClosingApi } from './data-access/closing-api';
import { ClosingRun } from './data-access/closing-models';

const LIVE = new Set(['in_progress', 'closed', 'completed']);

/**
 * Comptabilité › Clôture: the open fiscal years, each with « Démarrer la clôture »
 * (`closing.start`) or its closing in progress, and the closings of the company. A fiscal
 * year closes with all its periods (note backend 0036).
 */
@Component({
  selector: 'alco-closing-list',
  imports: [
    DatePipe,
    RouterLink,
    AlcoBadge,
    AlcoButton,
    AlcoCard,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoLoading,
    AlcoPageHeader,
    AlcoTable,
  ],
  templateUrl: './closing-list.html',
  styleUrl: './closing-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClosingListPage {
  private readonly api = inject(ClosingApi);
  private readonly accounting = inject(AccountingApi);
  private readonly router = inject(Router);
  private readonly toast = inject(AlcoToastService);
  private readonly session = inject(SessionStore);

  protected readonly subject = runSubject;
  protected readonly dateRange = dateRange;
  protected readonly canStart = computed(() => this.session.can('closing.start'));

  protected readonly runs = requestState(() => this.api.runs().pipe(map((page) => page.results)));
  /** Open fiscal years; without `accounting.read`, none is offered. */
  protected readonly years = requestState(() =>
    this.accounting.fiscalYears('open').pipe(
      map((page) => page.results),
      catchError(() => of([] as FiscalYear[])),
    ),
  );

  protected readonly columns: readonly TableColumn[] = [
    { key: 'subject', label: 'Clôture' },
    { key: 'status', label: 'État', width: '9rem' },
    { key: 'step', label: 'Étape en cours', hideBelow: 'tablet' },
    { key: 'created_at', label: 'Démarrée le', width: '9rem', hideBelow: 'tablet' },
  ];
  protected readonly runId = (run: ClosingRun) => run.public_id;
  protected readonly starting = signal<string | null>(null);

  protected readonly loadError = computed(() => {
    const error = this.runs.error();
    return error ? toUserError(error, CLOSING_ERRORS) : null;
  });

  protected statusLook(run: ClosingRun) {
    return RUN_STATUS[run.status];
  }

  protected stepLabel(run: ClosingRun): string {
    return run.current_step ? STEPS[run.current_step] : '—';
  }

  /** The fiscal year's closing still running or done, if any. */
  protected liveRun(year: FiscalYear): ClosingRun | null {
    return (
      (this.runs.value() ?? []).find(
        (run) =>
          run.scope === 'fiscal_year' &&
          run.fiscal_year.public_id === year.public_id &&
          LIVE.has(run.status),
      ) ?? null
    );
  }

  protected async start(year: FiscalYear): Promise<void> {
    this.starting.set(year.public_id);
    try {
      const run = await firstValueFrom(this.api.startYear(year.public_id));
      await this.router.navigate(['/app/comptabilite/cloture', run.public_id]);
    } catch (failure) {
      this.toast.error(toUserError(failure, CLOSING_ERRORS).title);
    } finally {
      this.starting.set(null);
    }
  }
}
