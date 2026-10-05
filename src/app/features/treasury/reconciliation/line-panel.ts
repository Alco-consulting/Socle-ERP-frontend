import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable, firstValueFrom, forkJoin, map, of, switchMap } from 'rxjs';

import { UserError, toUserError } from '../../../core/errors/user-error';
import { toApiError } from '../../../core/http/api-error';
import { requestState } from '../../../core/http/request-state';
import { APP_ROOT } from '../../../core/navigation/applications';
import { NavigationService } from '../../../core/navigation/navigation.service';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { isoDay } from '../../accounting/entries/entry-presentation';
import { AUDIT_TYPES, AlcoObjectHistory } from '../../audit/object-history';
import {
  Reconciliation,
  StatementLine,
  TreasuryOperation,
} from '../data-access/reconciliation-models';
import { TreasuryApi } from '../data-access/treasury-api';
import { DereconcileDialogService } from './dereconcile-dialog';
import {
  DIRECTIONS,
  LETTERING_STATE,
  LINE_STATUS,
  RECONCILIATION_ERRORS,
  RECONCILIATION_STATUS,
  STALE_CODES,
} from './reconciliation-presentation';
import { ReconciliationScope } from './reconciliation-scope';

/** What a command did to the line (the list is then read again). */
export interface LineChange {
  readonly message: string;
}

/** A line's reconciliations (newest first) and the operations they name. */
interface LineRecord {
  readonly reconciliations: readonly Reconciliation[];
  readonly operations: ReadonlyMap<string, TreasuryOperation>;
}

/**
 * The record of one bank line: its fields as the list gave them, and its reconciliations
 * (`GET reconciliations/?statement_line=`, A6.2) — the active one and those cancelled — with
 * the operations they name (`GET operations/{id}/`) and the lettering a confirmation created
 * (A6.1). « Dé-rapprocher » (`POST reconciliations/{id}/cancel/`, `treasury.reconcile`,
 * a reason) cancels the bank relation only: the payment, its entry, the lettering and the
 * installments stay as they are, and the screen says so. History: Audit
 * (`treasury.reconciliation`).
 */
@Component({
  selector: 'alco-line-panel',
  imports: [
    DatePipe,
    RouterLink,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoButton,
    AlcoErrorState,
    AlcoLoading,
    AlcoObjectHistory,
  ],
  templateUrl: './line-panel.html',
  styleUrl: './line-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoLinePanel {
  private readonly api = inject(TreasuryApi);
  private readonly toast = inject(AlcoToastService);
  private readonly dialog = inject(DereconcileDialogService);
  private readonly navigation = inject(NavigationService);
  private readonly session = inject(SessionStore);

  readonly line = input.required<StatementLine>();
  readonly scope = input.required<ReconciliationScope>();
  /** Decimals of the account's currency (display only). */
  readonly decimals = input(0);
  readonly closed = output<void>();
  readonly changed = output<LineChange>();
  readonly showProposals = output<void>();

  protected readonly day = isoDay;
  protected readonly directions = DIRECTIONS;
  protected readonly lineStatus = computed(() => LINE_STATUS[this.line().status]);
  protected readonly canReconcile = computed(() => this.session.can('treasury.reconcile'));
  protected readonly canSeeHistory = computed(() => this.session.can('audit.read'));
  protected readonly auditType = AUDIT_TYPES.reconciliation;
  protected readonly letteringUrl = `${APP_ROOT}/comptabilite/lettrage`;
  protected readonly entriesUrl = `${APP_ROOT}/comptabilite/ecritures`;
  protected readonly canOpenLettering = computed(() =>
    this.navigation.canOpenUrl(this.letteringUrl),
  );
  protected readonly canOpenEntries = computed(() => this.navigation.canOpenUrl(this.entriesUrl));

  protected readonly record = requestState(() => this.load(untracked(this.line).public_id), {
    immediate: false,
  });
  protected readonly reconciliations = computed(() => this.record.value()?.reconciliations ?? []);
  protected readonly failure = computed(() => {
    const error = this.record.error();
    return error ? toUserError(error, RECONCILIATION_ERRORS) : null;
  });
  /** The reconciliation whose history is shown: the active one, else the latest. */
  protected readonly latest = computed(() => this.reconciliations()[0] ?? null);
  protected readonly busy = signal(false);
  protected readonly actionError = signal<UserError | null>(null);
  private readonly history = viewChild(AlcoObjectHistory);

  constructor() {
    effect(() => {
      this.line();
      untracked(() => {
        this.actionError.set(null);
        this.record.reload();
      });
    });
  }

  protected operationsOf(reconciliation: Reconciliation): readonly (TreasuryOperation | string)[] {
    const operations = this.record.value()?.operations;
    return reconciliation.operations.map((id) => operations?.get(id) ?? id);
  }

  protected isOperation(item: TreasuryOperation | string): item is TreasuryOperation {
    return typeof item !== 'string';
  }

  protected reconciliationStatus(reconciliation: Reconciliation) {
    return RECONCILIATION_STATUS[reconciliation.status];
  }

  protected letteringState(status: string) {
    return (
      LETTERING_STATE[status] ?? { label: status, tone: 'neutral' as const, icon: 'info' as const }
    );
  }

  protected async dereconcile(reconciliation: Reconciliation): Promise<void> {
    if (this.busy()) {
      return;
    }
    const reason = await this.dialog.ask({
      lineDate: isoDay(this.line().line_date),
      lettering: reconciliation.lettering?.reference ?? null,
    });
    if (reason === null) {
      return;
    }
    this.busy.set(true);
    this.actionError.set(null);
    try {
      const cancelled = await firstValueFrom(
        this.api.cancelReconciliation(reconciliation.public_id, reason),
      );
      const lettering = cancelled.lettering;
      const kept =
        lettering && lettering.status === 'active'
          ? ` Le lettrage ${lettering.reference} reste actif : la facture reste réglée.`
          : '';
      const message =
        `Rapprochement annulé : la ligne du ${isoDay(this.line().line_date)} est de nouveau à rapprocher. ` +
        `L’opération et son écriture sont inchangées.${kept}`;
      this.toast.success('Rapprochement annulé.');
      this.changed.emit({ message });
    } catch (failure) {
      const error = toApiError(failure);
      if (error.kind === 'unauthenticated') {
        return;
      }
      this.actionError.set(toUserError(error, RECONCILIATION_ERRORS));
      if (error.code && STALE_CODES.has(error.code)) {
        this.record.reload();
        this.history()?.reload();
      }
    } finally {
      this.busy.set(false);
    }
  }

  /** The line's reconciliations, then the operations they name (one request per operation). */
  private load(lineId: string): Observable<LineRecord> {
    return this.api.reconciliationsOfLine(lineId).pipe(
      switchMap((page) => {
        const ids = [...new Set(page.results.flatMap((item) => item.operations))];
        const operations: Observable<readonly TreasuryOperation[]> = ids.length
          ? forkJoin(ids.map((id) => this.api.operation(id)))
          : of([]);
        return operations.pipe(
          map((found) => ({
            reconciliations: page.results,
            operations: new Map(found.map((item) => [item.public_id, item])),
          })),
        );
      }),
    );
  }
}
