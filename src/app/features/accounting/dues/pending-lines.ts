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
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { UserError, toUserError } from '../../../core/errors/user-error';
import { toApiError } from '../../../core/http/api-error';
import { requestState } from '../../../core/http/request-state';
import { APP_ROOT } from '../../../core/navigation/applications';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoConfirmService } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { DUE_PAGE_SIZE, DueApi } from '../data-access/due-api';
import { DueSchedule, PendingLine } from '../data-access/due-models';
import { isoDay } from '../entries/entry-presentation';
import { DUE_ERRORS, DUE_ROLES, DUE_STALE_CODES, INELIGIBLE_REASONS } from './due-presentation';
import { DueScope, dueScopeKey } from './due-scope';

/**
 * The invoices without due dates yet (`GET due-schedules/pending-lines/`) and their
 * generation (`POST due-schedules/`, `accounting.manage_due_dates`): the server picks the
 * payment term, computes the dates and amounts, settles them from the lettering — all or
 * none. The result shown is the server's answer; the list is read again after it.
 */
@Component({
  selector: 'alco-pending-lines',
  imports: [
    RouterLink,
    AlcoAmountPipe,
    AlcoButton,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoLoading,
    AlcoPagination,
    AlcoTable,
  ],
  templateUrl: './pending-lines.html',
  styleUrls: ['../accounting-list.scss', './due-lists.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoPendingLines {
  private readonly api = inject(DueApi);
  private readonly confirm = inject(AlcoConfirmService);
  private readonly toast = inject(AlcoToastService);
  private readonly session = inject(SessionStore);

  readonly scope = input.required<DueScope>();
  readonly decimals = input<ReadonlyMap<string, number>>(new Map());
  readonly pageChange = output<number>();
  readonly pastEnd = output<void>();

  protected readonly pageSize = DUE_PAGE_SIZE;
  protected readonly entriesUrl = `${APP_ROOT}/comptabilite/ecritures`;
  protected readonly day = isoDay;
  protected readonly canGenerate = computed(() => this.session.can('accounting.manage_due_dates'));
  protected readonly columns: readonly TableColumn[] = [
    { key: 'entry', label: 'Écriture' },
    { key: 'partner', label: 'Tiers' },
    { key: 'label', label: 'Libellé', hideBelow: 'laptop' },
    { key: 'amount', label: 'Montant', numeric: true },
  ];
  protected readonly rowId = (row: PendingLine) => row.public_id;
  protected readonly rowLabel = (row: PendingLine) =>
    `${row.entry.entry_number} ${row.partner.code}`;

  protected readonly list = requestState(
    () => {
      const scope = untracked(this.scope);
      return this.api.pendingLines({
        role: scope.role,
        partner: scope.partner,
        account: scope.account,
        dateFrom: scope.dateFrom,
        dateTo: scope.dateTo,
        page: scope.page,
      });
    },
    { immediate: false },
  );
  protected readonly rows = computed(() => this.list.value()?.results ?? []);
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, DUE_ERRORS) : null;
  });

  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly generating = signal(false);
  protected readonly actionError = signal<UserError | null>(null);
  /** The server's schedules of the last generation. */
  protected readonly generated = signal<readonly DueSchedule[]>([]);
  private lastScope = '';

  constructor() {
    effect(() => {
      const scope = this.scope();
      untracked(() => {
        const key = dueScopeKey(scope);
        if (key !== this.lastScope) {
          this.lastScope = key;
          this.selected.set(new Set());
        }
        this.list.reload();
      });
    });
    effect(() => {
      if (this.list.error()?.kind === 'not-found' && untracked(this.scope).page > 1) {
        untracked(() => this.pastEnd.emit());
      }
    });
  }

  protected roleLabel(line: PendingLine): string {
    return DUE_ROLES[line.role];
  }

  protected decimalsOf(currency: string): number {
    return this.decimals().get(currency) ?? 0;
  }

  protected isSelected(line: PendingLine): boolean {
    return this.selected().has(line.public_id);
  }

  protected toggle(line: PendingLine): void {
    const next = new Set(this.selected());
    if (next.has(line.public_id)) {
      next.delete(line.public_id);
    } else {
      next.add(line.public_id);
    }
    this.selected.set(next);
  }

  protected setPage(page: number): void {
    this.pageChange.emit(page);
  }

  /** Confirmed, then the server's command; one at a time. */
  protected async generate(): Promise<void> {
    const lines = [...this.selected()];
    if (lines.length === 0 || this.generating()) {
      return;
    }
    const confirmed = await this.confirm.confirm({
      title:
        lines.length > 1
          ? `Générer les échéances de ${lines.length} factures ?`
          : 'Générer les échéances de cette facture ?',
      message:
        'Le serveur calcule les dates et les montants selon la condition de paiement du tiers, à partir de la date de pièce (sinon de la date d’écriture), puis les règle selon le lettrage déjà fait. Tout ou rien : si une facture est refusée, aucune n’est échéancée.',
      confirmLabel: 'Générer les échéances',
    });
    if (!confirmed) {
      return;
    }
    this.generating.set(true);
    this.actionError.set(null);
    try {
      const schedules = await firstValueFrom(this.api.generate(lines));
      this.generated.set(schedules);
      this.toast.success(
        schedules.length > 1 ? `${schedules.length} échéanciers générés.` : 'Échéancier généré.',
      );
      this.selected.set(new Set());
      this.list.reload();
    } catch (failure) {
      const error = toApiError(failure);
      if (error.kind === 'unauthenticated') {
        return;
      }
      this.actionError.set(this.explain(toUserError(error, DUE_ERRORS), error.details));
      if (error.code && DUE_STALE_CODES.has(error.code)) {
        this.selected.set(new Set());
        this.list.reload();
      }
    } finally {
      this.generating.set(false);
    }
  }

  /** The server's details, said in words (which line, why, which partner). */
  private explain(error: UserError, details: unknown): UserError {
    const value = details as Record<string, unknown> | null;
    if (error.code === 'accounting_due_line_not_eligible' && value) {
      const reason = INELIGIBLE_REASONS[String(value['reason'])];
      return reason ? { ...error, message: `${error.message} Ici : ${reason}.` } : error;
    }
    if (error.code === 'accounting_due_payment_term_missing' && value?.['partner']) {
      return {
        ...error,
        title: `Le tiers ${String(value['partner'])} n’a pas de condition de paiement.`,
      };
    }
    return error;
  }
}
