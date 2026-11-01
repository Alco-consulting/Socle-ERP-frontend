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
import { warningText } from '../balance/balance-presentation';
import { ReportingApi } from '../data-access/reporting-api';
import { BalanceSheet } from '../data-access/reporting-models';
import {
  AlcoReportPeriod,
  Period,
  PeriodChoice,
  day,
  periodFromUrl,
  periodParams,
} from '../report-period/report-period';
import { AlcoStatementSheet, analysisLink, ledgerLink } from '../statement-sheet/statement-sheet';
import { BALANCE_SHEET_ERRORS, sheetFoot, sheetPairs } from './balance-sheet-presentation';

const ACCOUNTING = `${APP_ROOT}/comptabilite`;

/**
 * Comptabilité › Analyse › Bilan (note backend 0056): the balances at the end of the period,
 * assets on the left, liabilities on the right, block facing block, each with its total on
 * its title and its accounts under it, the year's result in the equity; the year by default.
 * Every figure is the server's.
 */
@Component({
  selector: 'alco-balance-sheet-page',
  imports: [
    RouterLink,
    AlcoAmountPipe,
    AlcoButton,
    AlcoErrorState,
    AlcoLoading,
    AlcoReportPeriod,
    AlcoStatementSheet,
  ],
  templateUrl: './balance-sheet-page.html',
  styleUrl: './balance-sheet-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BalanceSheetPage {
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
  /** « 31/12/2026 »: the photo's date. */
  protected readonly at = computed(() => day(this.period().to));

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

  protected readonly sheet = requestState(() => this.load(), { immediate: false });
  protected readonly failure = computed(() => {
    const error = this.sheet.error();
    return error ? toUserError(error, BALANCE_SHEET_ERRORS) : null;
  });
  /** The rows lead to the general ledger, and the result to its statement, on the same dates. */
  protected readonly pairs = computed(() => {
    const found = this.sheet.value();
    if (!found) {
      return [];
    }
    const dates = { from: found.scope.date_from, to: found.scope.date_to };
    return sheetPairs(
      found,
      (account) => ledgerLink(account.code, dates),
      analysisLink('analyse/resultat', dates),
    );
  });
  protected readonly foot = computed(() => {
    const found = this.sheet.value();
    return found ? sheetFoot(found) : [];
  });
  private readonly warnings = computed(() => this.sheet.value()?.warnings ?? []);
  protected readonly unposted = computed(() =>
    this.warnings().some((warning) => warning.code === 'unposted_entries'),
  );
  protected readonly notes = computed(() =>
    this.warnings()
      .map((warning) => warningText(warning))
      .filter((text): text is string => text !== null),
  );
  /** Total assets against total liabilities, when they differ. */
  protected readonly unbalanced = computed(() => {
    const details = this.warnings().find(
      (warning) => warning.code === 'balance_sheet_unbalanced',
    )?.details;
    return details
      ? { assets: String(details['assets']), liabilities: String(details['liabilities']) }
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
      untracked(() => this.sheet.reload());
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
          'reporting.balance_sheet',
          { date_from: period.from, date_to: period.to },
          format,
        ),
      );
      if (run.status !== 'completed') {
        this.toast.error(failed);
        return;
      }
      const file = await firstValueFrom(this.transfers.download(run.public_id));
      saveFile(file.blob, file.filename ?? run.filename ?? `bilan.${format}`);
    } catch {
      this.toast.error(failed);
    } finally {
      this.exporting.set(null);
    }
  }

  private load(): Observable<BalanceSheet> {
    const period = untracked(this.period);
    return this.reporting.balanceSheet(period.from, period.to);
  }
}
