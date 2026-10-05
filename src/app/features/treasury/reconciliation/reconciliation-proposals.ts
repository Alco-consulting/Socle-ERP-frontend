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
import { NavigationService } from '../../../core/navigation/navigation.service';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoConfirmService } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { isoDay } from '../../accounting/entries/entry-presentation';
import {
  ConfirmedProposal,
  ProposalChoice,
  ReconciliationProposal,
} from '../data-access/reconciliation-models';
import { RECONCILIATION_PAGE_SIZE, TreasuryApi } from '../data-access/treasury-api';
import {
  DIRECTIONS,
  RECONCILIATION_ERRORS,
  STALE_CODES,
  criterionLabel,
} from './reconciliation-presentation';
import { ReconciliationScope } from './reconciliation-scope';

/** A confirmed proposal, with the line it reconciled (as the proposal showed it). */
interface Outcome {
  readonly line: ReconciliationProposal['line'];
  readonly result: ConfirmedProposal;
}

/**
 * The server's reconciliation proposals (`GET reconciliation-proposals/`): shown as given —
 * amounts, difference, criteria, days apart, the invoice it may settle — never computed here.
 * A proposal is not a reconciliation: the selected ones are confirmed together
 * (`POST reconciliation-proposals/confirm/`, `treasury.reconcile`), all or none; the server
 * checks each again and refuses a stale one (`treasury_reconciliation_proposal_stale`). The
 * invoice is settled only when asked, line by line (`invoice_line`, `accounting.letter`),
 * through Accounting's lettering. The proposals are read again after each answer.
 */
@Component({
  selector: 'alco-reconciliation-proposals',
  imports: [
    RouterLink,
    AlcoAmountPipe,
    AlcoButton,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoLoading,
    AlcoPagination,
  ],
  templateUrl: './reconciliation-proposals.html',
  styleUrls: ['../../accounting/accounting-list.scss', './reconciliation-proposals.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoReconciliationProposals {
  private readonly api = inject(TreasuryApi);
  private readonly toast = inject(AlcoToastService);
  private readonly confirmDialog = inject(AlcoConfirmService);
  private readonly session = inject(SessionStore);
  private readonly navigation = inject(NavigationService);

  readonly scope = input.required<ReconciliationScope>();
  readonly decimals = input<ReadonlyMap<string, number>>(new Map());
  readonly pageChange = output<number>();
  readonly pastEnd = output<void>();

  protected readonly pageSize = RECONCILIATION_PAGE_SIZE;
  protected readonly day = isoDay;
  protected readonly directions = DIRECTIONS;
  protected readonly criterion = criterionLabel;
  protected readonly letteringUrl = `${APP_ROOT}/comptabilite/lettrage`;
  protected readonly canReconcile = computed(() => this.session.can('treasury.reconcile'));
  protected readonly canLetter = computed(() => this.session.can('accounting.letter'));
  protected readonly canOpenLettering = computed(() =>
    this.navigation.canOpenUrl(this.letteringUrl),
  );

  protected readonly list = requestState(
    () => {
      const scope = untracked(this.scope);
      return this.api.proposals({
        account: scope.account,
        statement: scope.statement,
        page: scope.page,
      });
    },
    { immediate: false },
  );
  protected readonly proposals = computed(() => this.list.value()?.results ?? []);
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, RECONCILIATION_ERRORS) : null;
  });

  // ---- Selection (lines of the proposals shown) and the invoices to settle ------------------
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly settle = signal<ReadonlySet<string>>(new Set());
  protected readonly selectedCount = computed(() => this.selected().size);
  protected readonly confirming = signal(false);
  protected readonly actionError = signal<UserError | null>(null);
  protected readonly outcomes = signal<readonly Outcome[]>([]);

  constructor() {
    effect(() => {
      this.scope();
      untracked(() => {
        this.clearSelection();
        this.list.reload();
      });
    });
    effect(() => {
      if (this.list.error()?.kind === 'not-found' && untracked(this.scope).page > 1) {
        untracked(() => this.pastEnd.emit());
      }
    });
  }

  protected places(): number {
    return this.decimals().get(this.scope().currency) ?? 0;
  }

  protected isSelected(proposal: ReconciliationProposal): boolean {
    return this.selected().has(proposal.line.public_id);
  }

  protected settles(proposal: ReconciliationProposal): boolean {
    return this.settle().has(proposal.line.public_id);
  }

  protected toggle(proposal: ReconciliationProposal): void {
    const key = proposal.line.public_id;
    const next = new Set(this.selected());
    if (next.has(key)) {
      next.delete(key);
      const settle = new Set(this.settle());
      settle.delete(key);
      this.settle.set(settle);
    } else {
      next.add(key);
    }
    this.selected.set(next);
  }

  protected toggleSettle(proposal: ReconciliationProposal): void {
    const key = proposal.line.public_id;
    const next = new Set(this.settle());
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
      if (!this.selected().has(key)) {
        this.selected.set(new Set([...this.selected(), key]));
      }
    }
    this.settle.set(next);
  }

  protected selectionLabel(proposal: ReconciliationProposal): string {
    return `Sélectionner la proposition pour la ligne du ${isoDay(proposal.line.line_date)} ${proposal.line.description || ''}`.trim();
  }

  protected clearSelection(): void {
    this.selected.set(new Set());
    this.settle.set(new Set());
  }

  protected async confirm(): Promise<void> {
    const chosen = this.proposals().filter((proposal) => this.isSelected(proposal));
    if (this.confirming() || chosen.length === 0) {
      return;
    }
    const settled = chosen.filter((proposal) => proposal.settlement && this.settles(proposal));
    const lines = chosen.length > 1 ? `${chosen.length} lignes` : 'la ligne';
    const invoices =
      settled.length === 0
        ? 'Aucune facture ne sera lettrée.'
        : `${settled.length > 1 ? `${settled.length} factures seront réglées` : 'La facture sera réglée'} par le lettrage de son paiement (Comptabilité).`;
    const confirmed = await this.confirmDialog.confirm({
      title: chosen.length > 1 ? `Rapprocher ${chosen.length} lignes ?` : 'Rapprocher la ligne ?',
      message: `Le serveur vérifie à nouveau chaque proposition puis rapproche ${lines} avec l’opération proposée, tout ou rien. ${invoices}`,
      confirmLabel:
        chosen.length > 1 ? `Rapprocher ${chosen.length} lignes` : 'Rapprocher la ligne',
    });
    if (!confirmed) {
      return;
    }
    const items: ProposalChoice[] = chosen.map((proposal) => {
      const invoice = proposal.settlement && this.settles(proposal) ? proposal.settlement : null;
      return invoice
        ? {
            line: proposal.line.public_id,
            operation: proposal.operation.public_id,
            invoice_line: invoice.invoice_line.public_id,
          }
        : { line: proposal.line.public_id, operation: proposal.operation.public_id };
    });
    this.confirming.set(true);
    this.actionError.set(null);
    try {
      const results = await firstValueFrom(this.api.confirmProposals(items));
      const byLine = new Map(chosen.map((proposal) => [proposal.line.public_id, proposal.line]));
      this.outcomes.set(
        results.map((result) => ({
          line: byLine.get(result.reconciliation.statement_line) ?? chosen[0].line,
          result,
        })),
      );
      this.toast.success(
        results.length > 1 ? `${results.length} lignes rapprochées.` : 'Ligne rapprochée.',
      );
      this.clearSelection();
      this.list.reload();
    } catch (failure) {
      const error = toApiError(failure);
      if (error.kind === 'unauthenticated') {
        return;
      }
      this.actionError.set(toUserError(error, RECONCILIATION_ERRORS));
      if (error.code && STALE_CODES.has(error.code)) {
        // What the screen showed no longer stands: the server's current proposals.
        this.clearSelection();
        this.list.reload();
      }
    } finally {
      this.confirming.set(false);
    }
  }

  protected setPage(page: number): void {
    this.pageChange.emit(page);
  }
}
