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
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { LETTERING_PAGE_SIZE, LetteringApi } from '../data-access/lettering-api';
import { LetteringProposal } from '../data-access/lettering-models';
import { isoDay } from '../entries/entry-presentation';
import { LETTERING_ERRORS, STALE_CODES, newIdempotencyKey } from './lettering-presentation';
import { LetteringScope } from './lettering-scope';

/** A proposal is named by its two lines (the API gives no identifier of its own). */
const keyOf = (proposal: LetteringProposal) =>
  `${proposal.debit.public_id}:${proposal.credit.public_id}`;

/**
 * The server's lettering proposals (`GET letterings/proposals/`): shown as given, never
 * computed here. A proposal is not a lettering: « Confirmer » sends it to
 * `POST letterings/proposals/confirm/`, which checks it again (it may be stale: a line
 * lettered in between) and letters it as automatic. One confirmation at a time, one
 * idempotency key per proposal kept while it is retried; the proposals are read again after
 * each answer.
 */
@Component({
  selector: 'alco-lettering-proposals',
  imports: [
    RouterLink,
    AlcoAmountPipe,
    AlcoButton,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoLoading,
    AlcoPagination,
  ],
  templateUrl: './lettering-proposals.html',
  styleUrls: ['../accounting-list.scss', './lettering-proposals.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoLetteringProposals {
  private readonly api = inject(LetteringApi);
  private readonly toast = inject(AlcoToastService);
  private readonly session = inject(SessionStore);

  readonly scope = input.required<LetteringScope>();
  readonly decimals = input<ReadonlyMap<string, number>>(new Map());
  readonly pageChange = output<number>();
  readonly pastEnd = output<void>();

  protected readonly pageSize = LETTERING_PAGE_SIZE;
  protected readonly entriesUrl = `${APP_ROOT}/comptabilite/ecritures`;
  protected readonly day = isoDay;
  protected readonly keyOf = keyOf;
  protected readonly canLetter = computed(() => this.session.can('accounting.letter'));

  protected readonly list = requestState(
    () => {
      const scope = untracked(this.scope);
      return this.api.proposals({
        account: scope.account,
        partner: scope.partner,
        page: scope.page,
      });
    },
    { immediate: false },
  );
  protected readonly proposals = computed(() => this.list.value()?.results ?? []);
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, LETTERING_ERRORS) : null;
  });
  /** The proposal being confirmed (its key); every « Confirmer » waits for its answer. */
  protected readonly confirming = signal<string | null>(null);
  protected readonly actionError = signal<UserError | null>(null);
  private readonly keys = new Map<string, string>();

  constructor() {
    effect(() => {
      this.scope();
      untracked(() => this.list.reload());
    });
    effect(() => {
      if (this.list.error()?.kind === 'not-found' && untracked(this.scope).page > 1) {
        untracked(() => this.pastEnd.emit());
      }
    });
  }

  protected decimalsOf(currency: string): number {
    return this.decimals().get(currency) ?? 0;
  }

  protected confirmLabel(proposal: LetteringProposal): string {
    return `Confirmer la proposition ${proposal.debit.entry.entry_number} / ${proposal.credit.entry.entry_number}`;
  }

  protected async confirm(proposal: LetteringProposal): Promise<void> {
    if (this.confirming() !== null) {
      return;
    }
    const key = keyOf(proposal);
    this.confirming.set(key);
    this.actionError.set(null);
    let idempotencyKey = this.keys.get(key);
    if (!idempotencyKey) {
      idempotencyKey = newIdempotencyKey();
      this.keys.set(key, idempotencyKey);
    }
    try {
      const created = await firstValueFrom(
        this.api.confirmProposal({
          debit: proposal.debit.public_id,
          credit: proposal.credit.public_id,
          idempotency_key: idempotencyKey,
        }),
      );
      this.keys.delete(key);
      this.toast.success(`Lettrage ${created.reference} créé.`);
      this.list.reload();
    } catch (failure) {
      const error = toApiError(failure);
      if (error.kind === 'unauthenticated') {
        return;
      }
      if (error.code === 'accounting_lettering_exists') {
        this.keys.delete(key);
        this.toast.info('Ce lettrage était déjà enregistré : rien n’a été créé une seconde fois.');
        this.list.reload();
        return;
      }
      this.actionError.set(toUserError(error, LETTERING_ERRORS));
      if (error.code && STALE_CODES.has(error.code)) {
        // The proposal no longer stands: the server's current proposals.
        this.keys.delete(key);
        this.list.reload();
      }
    } finally {
      this.confirming.set(null);
    }
  }

  protected setPage(page: number): void {
    this.pageChange.emit(page);
  }
}
