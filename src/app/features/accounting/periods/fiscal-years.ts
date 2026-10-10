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
import { firstValueFrom, map } from 'rxjs';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoTable, AlcoCell, TableColumn } from '../../../shared/tables/table';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoCard } from '../../../shared/ui/card/card';
import { AlcoConfirmService } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
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
 * Comptabilité › Configuration › Exercices et périodes: the fiscal years of the company and
 * the periods of one of them, with the states the server gives. With
 * `accounting.manage_periods`: « Nouvel exercice » (created with its monthly periods), the
 * monthly periods of a year that has none, and « Clôturer » / « Rouvrir » on each period (its
 * commands; an entry is validated only in an open period of an open fiscal year). Closing a
 * whole fiscal year stays with the Clôture module, which runs its checks.
 */
@Component({
  selector: 'alco-fiscal-years',
  imports: [
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
  templateUrl: './fiscal-years.html',
  styleUrl: './fiscal-years.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FiscalYearsPage {
  private readonly api = inject(AccountingApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(SessionStore);
  private readonly toast = inject(AlcoToastService);
  private readonly confirm = inject(AlcoConfirmService);

  protected readonly yearStatus = FISCAL_YEAR_STATUS;
  protected readonly dateRange = dateRange;
  protected readonly canManage = computed(() => this.session.can('accounting.manage_periods'));

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

  protected readonly periodColumns = computed<readonly TableColumn[]>(() => [
    { key: 'code', label: 'Code', width: '8rem' },
    { key: 'label', label: 'Libellé' },
    { key: 'dates', label: 'Dates' },
    { key: 'status', label: 'État', width: '9rem' },
    ...(this.canManage() ? [{ key: 'actions', label: 'Actions', width: '9rem' }] : []),
  ]);
  protected readonly periodId = (period: Period) => period.public_id;
  /** The period a command is running for. */
  protected readonly switching = signal<string | null>(null);
  protected readonly creatingPeriods = signal(false);

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

  /** « Créer les périodes mensuelles » of a year that has none: one per calendar month. */
  protected async createPeriods(year: FiscalYear): Promise<void> {
    if (this.creatingPeriods()) {
      return;
    }
    this.creatingPeriods.set(true);
    try {
      const created = await firstValueFrom(this.api.createMonthlyPeriods(year.public_id));
      this.toast.success(`${created.length} périodes mensuelles créées.`);
      this.periods.reload();
    } catch (failure) {
      this.toast.error(toUserError(failure, ACCOUNTING_REFERENTIAL_ERRORS).title);
    } finally {
      this.creatingPeriods.set(false);
    }
  }

  /** « Clôturer » after a confirmation that says what waits: the drafts of the period. */
  protected async close(period: Period): Promise<void> {
    const drafts = await firstValueFrom(this.api.draftCount(period.public_id)).catch(() => 0);
    const waiting =
      drafts === 0
        ? ''
        : drafts === 1
          ? ' 1 brouillon de cette période attendra sa réouverture pour être validé.'
          : ` ${drafts} brouillons de cette période attendront sa réouverture pour être validés.`;
    const confirmed = await this.confirm.confirm({
      title: `Clôturer ${period.label} ?`,
      message: `Plus aucune écriture ne pourra être validée dans cette période.${waiting} Vous pourrez la rouvrir.`,
      confirmLabel: 'Clôturer la période',
    });
    if (confirmed) {
      await this.setOpen(period, false);
    }
  }

  protected async reopen(period: Period): Promise<void> {
    await this.setOpen(period, true);
  }

  private async setOpen(period: Period, open: boolean): Promise<void> {
    this.switching.set(period.public_id);
    try {
      const saved = await firstValueFrom(this.api.setPeriodOpen(period.public_id, open));
      this.toast.success(`Période ${saved.label} ${open ? 'rouverte' : 'clôturée'}.`);
      this.periods.reload();
    } catch (failure) {
      this.toast.error(toUserError(failure, ACCOUNTING_REFERENTIAL_ERRORS).title);
    } finally {
      this.switching.set(null);
    }
  }
}
