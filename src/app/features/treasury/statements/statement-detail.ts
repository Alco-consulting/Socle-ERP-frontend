import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { Observable, catchError, firstValueFrom, map, of } from 'rxjs';

import { UserError, toUserError } from '../../../core/errors/user-error';
import { toApiError } from '../../../core/http/api-error';
import { requestState } from '../../../core/http/request-state';
import { APP_ROOT } from '../../../core/navigation/applications';
import { NavigationService } from '../../../core/navigation/navigation.service';
import { BreadcrumbService } from '../../../core/navigation/route-trail';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoConfirmService } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { AlcoWorkflowSteps } from '../../../shared/ui/workflow-steps/workflow-steps';
import { isoDay } from '../../accounting/entries/entry-presentation';
import { AlcoObjectHistory } from '../../audit/object-history';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { StatementLine, StatementLineStatus } from '../data-access/reconciliation-models';
import { TREASURY_PAGE_SIZE, TreasuryApi } from '../data-access/treasury-api';
import { TreasuryReasonDialogService } from '../reason-dialog';
import {
  DIRECTIONS,
  LINE_STATUS,
  STATEMENT_STATUS,
  TREASURY_AUDIT_TYPES,
  TREASURY_ERRORS,
  TREASURY_STALE_CODES,
} from '../treasury-presentation';

const TREASURY = `${APP_ROOT}/comptabilite/tresorerie`;
const PARAM = { status: 'etat', page: 'page' } as const;
const LINE_STATES: readonly StatementLineStatus[] = ['unreconciled', 'reconciled', 'excluded'];

/** The statement's steps; where it stands comes from the server's state, never computed here. */
const STEPS = [
  { id: 'imported', label: 'Importé' },
  { id: 'checked', label: 'Vérifié' },
  { id: 'reconciled', label: 'Rapproché' },
  { id: 'closed', label: 'Clôturé' },
];

/**
 * A bank statement (`GET treasury/statements/{id}/`) and its check by the server
 * (`…/reconciliation/`, A6): opening balance + lines = closing balance (`balanced`,
 * `closing_difference`), the balances of the treasury and the ledger at its end, the totals by
 * state. Nothing is recomputed nor corrected here: a difference is said, and the statement
 * cannot be closed while it stands (the server refuses). Its lines (`statement-lines/?statement`,
 * server pages, by state): a reconciled line is protected and leads to its reconciliation (A6);
 * an unreconciled one leads to the reconciliation, or is set aside with a reason
 * (`treasury.reconcile`); an excluded one can be brought back. Close: `treasury.manage_statements`.
 */
@Component({
  selector: 'alco-treasury-statement-detail',
  imports: [
    RouterLink,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoButton,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoLoading,
    AlcoObjectHistory,
    AlcoPageHeader,
    AlcoPagination,
    AlcoTable,
    AlcoWorkflowSteps,
  ],
  templateUrl: './statement-detail.html',
  styleUrls: ['../../accounting/accounting-sheet.scss', './statement-detail.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreasuryStatementDetailPage {
  private readonly api = inject(TreasuryApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly confirm = inject(AlcoConfirmService);
  private readonly reasons = inject(TreasuryReasonDialogService);
  private readonly toast = inject(AlcoToastService);
  private readonly navigation = inject(NavigationService);
  protected readonly session = inject(SessionStore);

  private readonly id = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('id') ?? '')),
    { requireSync: true },
  );
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly lineState = computed<StatementLineStatus | null>(() => {
    const value = this.params().get(PARAM.status);
    return LINE_STATES.includes(value as StatementLineStatus)
      ? (value as StatementLineStatus)
      : null;
  });
  protected readonly page = computed(() => Math.max(1, Number(this.params().get(PARAM.page)) || 1));

  protected readonly record = requestState(() => this.api.statement(untracked(this.id)), {
    immediate: false,
  });
  protected readonly statement = computed(() => this.record.value());
  protected readonly loadError = computed(() => {
    const error = this.record.error();
    return error ? toUserError(error, TREASURY_ERRORS) : null;
  });
  protected readonly check = requestState(() => this.api.statementState(untracked(this.id)), {
    immediate: false,
  });
  /** The account (its currency and code), as the server gives it. */
  protected readonly account = requestState(
    () => this.api.account(untracked(this.statement)?.treasury_account.public_id ?? ''),
    { immediate: false },
  );
  private readonly lineQuery = computed(() => ({
    statement: this.id(),
    status: this.lineState(),
    page: this.page(),
  }));
  protected readonly lines = requestState(() => this.api.lines(untracked(this.lineQuery)), {
    immediate: false,
  });
  protected readonly lineRows = computed(() => this.lines.value()?.results ?? []);
  protected readonly decimals = signal<ReadonlyMap<string, number>>(new Map());
  protected readonly busy = signal(false);
  protected readonly actionError = signal<UserError | null>(null);

  protected readonly pageSize = TREASURY_PAGE_SIZE;
  protected readonly steps = STEPS;
  protected readonly day = isoDay;
  protected readonly lineStates = LINE_STATES.map((id) => ({ id, label: LINE_STATUS[id].label }));
  protected readonly accountsUrl = `${TREASURY}/comptes`;
  protected readonly reconciliationUrl = `${TREASURY}/rapprochements`;
  protected readonly auditType = TREASURY_AUDIT_TYPES.statement;
  protected readonly canSeeHistory = computed(() => this.session.can('audit.read'));
  protected readonly canReconcile = computed(() => this.session.can('treasury.reconcile'));
  protected readonly canManage = computed(() => this.session.can('treasury.manage_statements'));
  protected readonly canOpenReconciliation = computed(() =>
    this.navigation.canOpenUrl(this.reconciliationUrl),
  );
  private readonly history = viewChild(AlcoObjectHistory);
  protected readonly lineColumns: readonly TableColumn[] = [
    { key: 'date', label: 'Date', width: '6.5rem' },
    { key: 'description', label: 'Libellé' },
    { key: 'reference', label: 'Référence', hideBelow: 'laptop' },
    { key: 'amount', label: 'Montant', numeric: true },
    { key: 'status', label: 'État', width: '9rem', hideBelow: 'tablet' },
    { key: 'actions', label: 'Actions' },
  ];
  protected readonly lineId = (line: StatementLine) => line.public_id;

  protected readonly status = computed(() => {
    const statement = this.statement();
    return statement ? STATEMENT_STATUS[statement.status] : null;
  });
  /** Where the statement stands, read from the server's state (closed, balanced, counts). */
  protected readonly step = computed(() => {
    const statement = this.statement();
    const check = this.check.value();
    if (statement?.status === 'closed') {
      return 'closed';
    }
    if (!check || !check.balanced) {
      return 'checked';
    }
    return check.unreconciled_count > 0 ? 'reconciled' : 'closed';
  });
  protected readonly currency = computed(() => this.account.value()?.currency ?? '');
  protected readonly places = computed(() => this.decimals().get(this.currency()) ?? 0);

  constructor() {
    inject(PartnersApi)
      .currencies()
      .pipe(
        map((page) => new Map(page.results.map((item) => [item.code, item.decimal_places]))),
        catchError(() => of(new Map<string, number>())),
      )
      .subscribe((decimals) => this.decimals.set(decimals));
    effect(() => {
      this.id();
      untracked(() => {
        this.record.reload();
        this.check.reload();
      });
    });
    effect(() => {
      this.lineQuery();
      untracked(() => this.lines.reload());
    });
    effect(() => {
      const loaded = this.record.value();
      if (loaded) {
        untracked(() => {
          this.breadcrumbs.nameCurrent(this.name());
          if (this.account.value()?.public_id !== loaded.treasury_account.public_id) {
            this.account.reload();
          }
        });
      }
    });
    effect(() => {
      if (this.lines.error()?.kind === 'not-found' && untracked(this.page) > 1) {
        untracked(() => this.navigate({ [PARAM.page]: null }, true));
      }
    });
  }

  protected name(): string {
    const statement = this.statement();
    return statement
      ? statement.reference || `Relevé du ${isoDay(statement.statement_date)}`
      : 'Relevé';
  }

  protected lineStatus(line: StatementLine) {
    return LINE_STATUS[line.status];
  }

  protected direction(line: StatementLine): string {
    return DIRECTIONS[line.direction];
  }

  protected reconcileParams(view: 'a-rapprocher' | 'propositions' | 'rapprochees'): Params {
    const statement = this.statement();
    return {
      compte: statement?.treasury_account.code,
      releve: statement?.public_id,
      vue: view === 'a-rapprocher' ? null : view,
    };
  }

  protected setLineState(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.navigate({ [PARAM.status]: value || null, [PARAM.page]: null });
  }

  protected setPage(page: number): void {
    this.navigate({ [PARAM.page]: page > 1 ? page : null });
  }

  protected async close(): Promise<void> {
    const statement = this.statement();
    if (!statement || this.busy()) {
      return;
    }
    const confirmed = await this.confirm.confirm({
      title: `Clôturer le relevé ${this.name()} ?`,
      message:
        'Un relevé clôturé ne change plus. Le serveur refuse la clôture tant que le solde d’ouverture plus les lignes diffère du solde de clôture.',
      confirmLabel: 'Clôturer le relevé',
    });
    if (!confirmed) {
      return;
    }
    await this.run(() => this.api.closeStatement(statement.public_id), 'Relevé clôturé.');
  }

  protected async exclude(line: StatementLine): Promise<void> {
    const answer = await this.reasons.ask({
      title: `Exclure la ligne du ${isoDay(line.line_date)} ?`,
      message:
        'La ligne est mise de côté du rapprochement, avec le motif ; elle n’est ni supprimée ni corrigée. Elle pourra être réintégrée.',
      confirmLabel: 'Exclure la ligne',
    });
    if (!answer) {
      return;
    }
    await this.run(
      () => this.api.excludeLine(line.public_id, answer.reason),
      'Ligne exclue du rapprochement.',
    );
  }

  protected async include(line: StatementLine): Promise<void> {
    await this.run(
      () => this.api.includeLine(line.public_id),
      'Ligne réintégrée : elle est de nouveau à rapprocher.',
    );
  }

  /** One command, then the statement, its check, its lines and its history read again. */
  private async run(request: () => Observable<unknown>, done: string): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await firstValueFrom(request());
      this.toast.success(done);
      this.reloadAll();
    } catch (failure) {
      const error = toApiError(failure);
      if (error.kind === 'unauthenticated') {
        return;
      }
      this.actionError.set(toUserError(error, TREASURY_ERRORS));
      if (error.code && TREASURY_STALE_CODES.has(error.code)) {
        this.reloadAll();
      }
    } finally {
      this.busy.set(false);
    }
  }

  private reloadAll(): void {
    this.record.reload();
    this.check.reload();
    this.lines.reload();
    this.history()?.reload();
  }

  private navigate(params: Params, replaceUrl = false): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }
}
