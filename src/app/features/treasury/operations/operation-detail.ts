import { DatePipe } from '@angular/common';
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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, catchError, firstValueFrom, map, of } from 'rxjs';

import { UserError, toUserError } from '../../../core/errors/user-error';
import { toApiError } from '../../../core/http/api-error';
import { requestState } from '../../../core/http/request-state';
import { APP_ROOT } from '../../../core/navigation/applications';
import { NavigationService } from '../../../core/navigation/navigation.service';
import { BreadcrumbService } from '../../../core/navigation/route-trail';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoConfirmService } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoDropdown, DropdownItem } from '../../../shared/ui/dropdown/dropdown';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoSmartButton } from '../../../shared/ui/smart-button/smart-button';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { AlcoEntryDocuments } from '../../accounting/entries/entry-documents';
import { isoDay } from '../../accounting/entries/entry-presentation';
import { AlcoObjectHistory } from '../../audit/object-history';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { TreasuryOperation } from '../data-access/reconciliation-models';
import { TreasuryApi } from '../data-access/treasury-api';
import { TreasuryPostingDialogService } from '../posting-dialog';
import { TreasuryReasonDialogService } from '../reason-dialog';
import {
  DIRECTIONS,
  OPERATION_DOCUMENTS,
  OPERATION_STATUS,
  TREASURY_AUDIT_TYPES,
  TREASURY_ERRORS,
  TREASURY_STALE_CODES,
  operationTypeLabel,
} from '../treasury-presentation';

const TREASURY = `${APP_ROOT}/comptabilite/tresorerie`;
type Command = 'confirm' | 'cancel' | 'account' | 'unpost' | 'correct';

/**
 * A treasury operation (`GET treasury/operations/{id}/`): its fields as the server gives them
 * and its real relations — account, offset account, partner, accounting entry, transfer,
 * related operation, reconciliation (by the account and the reconciled flag), documents
 * (`treasury.operation`, upload while a draft) and history (Audit). The commands are the
 * server's (`confirm`, `cancel` with a reason, `account` with an optional journal, `unpost`,
 * `correct` with a reason and a date), offered by the operation's state and the permissions,
 * confirmed; the server decides and its refusals are said by their code. A transfer leg
 * changes only through its transfer.
 */
@Component({
  selector: 'alco-treasury-operation-detail',
  imports: [
    DatePipe,
    RouterLink,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoButton,
    AlcoDropdown,
    AlcoEntryDocuments,
    AlcoErrorState,
    AlcoLoading,
    AlcoObjectHistory,
    AlcoPageHeader,
    AlcoSmartButton,
  ],
  templateUrl: './operation-detail.html',
  styleUrl: '../../accounting/accounting-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreasuryOperationDetailPage {
  private readonly api = inject(TreasuryApi);
  private readonly router = inject(Router);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly confirm = inject(AlcoConfirmService);
  private readonly reasons = inject(TreasuryReasonDialogService);
  private readonly postings = inject(TreasuryPostingDialogService);
  private readonly toast = inject(AlcoToastService);
  private readonly navigation = inject(NavigationService);
  protected readonly session = inject(SessionStore);

  private readonly id = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('id') ?? '')),
    { requireSync: true },
  );
  protected readonly record = requestState(() => this.api.operation(untracked(this.id)), {
    immediate: false,
  });
  protected readonly operation = computed(() => this.record.value());
  protected readonly loadError = computed(() => {
    const error = this.record.error();
    return error ? toUserError(error, TREASURY_ERRORS) : null;
  });
  protected readonly decimals = signal<ReadonlyMap<string, number>>(new Map());
  protected readonly busy = signal(false);
  protected readonly actionError = signal<UserError | null>(null);

  protected readonly accounting = `${APP_ROOT}/comptabilite`;
  /** An account's « Transactions », as Odoo (note backend 0043). */
  protected readonly transactionsUrl = `${TREASURY}/operations`;
  protected readonly operationsUrl = `${TREASURY}/operations`;
  protected readonly transfersUrl = `${TREASURY}/virements`;
  protected readonly reconciliationUrl = `${TREASURY}/rapprochements`;
  protected readonly entriesUrl = `${APP_ROOT}/comptabilite/ecritures`;
  protected readonly directions = DIRECTIONS;
  protected readonly typeLabel = operationTypeLabel;
  protected readonly day = isoDay;
  protected readonly documentsType = OPERATION_DOCUMENTS;
  protected readonly auditType = TREASURY_AUDIT_TYPES.operation;
  protected readonly canSeeHistory = computed(() => this.session.can('audit.read'));
  protected readonly canSeeDocuments = computed(() => this.session.can('documents.read'));
  protected readonly canOpenEntries = computed(() => this.navigation.canOpenUrl(this.entriesUrl));
  protected readonly canOpenPartners = computed(() =>
    this.navigation.canOpenUrl(`${this.accounting}/tiers`),
  );
  protected readonly canOpenChart = computed(() =>
    this.navigation.canOpenUrl(`${this.accounting}/plan-comptable`),
  );
  private readonly history = viewChild(AlcoObjectHistory);
  protected readonly historyCount = computed(() => this.history()?.total() ?? null);
  protected readonly status = computed(() => {
    const operation = this.operation();
    return operation ? OPERATION_STATUS[operation.status] : null;
  });

  /** The commands of the operation's state, with the user's permissions (server decides). */
  protected readonly commands = computed<readonly DropdownItem[]>(() => {
    const operation = this.operation();
    if (!operation || operation.transfer) {
      return [];
    }
    const can = (permission: string) => this.session.can(permission);
    const items: DropdownItem[] = [];
    const disabled = this.busy();
    if (operation.status === 'draft' && can('treasury.confirm')) {
      items.push({ id: 'confirm', label: 'Confirmer', icon: 'check', disabled });
    }
    if (operation.status === 'confirmed' && can('treasury.account')) {
      items.push({ id: 'account', label: 'Comptabiliser', icon: 'book', disabled });
    }
    if (
      (operation.status === 'draft' || operation.status === 'confirmed') &&
      !operation.reconciled &&
      can('treasury.confirm')
    ) {
      items.push({ id: 'cancel', label: 'Annuler l’opération', icon: 'close', disabled });
    }
    if (operation.status === 'accounted' && can('treasury.account')) {
      items.push({
        id: 'unpost',
        label: 'Défaire la comptabilisation',
        icon: 'reverse',
        disabled,
      });
      if (!operation.related_operation) {
        items.push({ id: 'correct', label: 'Corriger (contre-opération)', icon: 'edit', disabled });
      }
    }
    return items;
  });
  protected readonly canEdit = computed(() => {
    const operation = this.operation();
    return (
      !!operation &&
      operation.status === 'draft' &&
      !operation.transfer &&
      this.session.can('treasury.update')
    );
  });

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
      untracked(() => this.record.reload());
    });
    effect(() => {
      const loaded = this.record.value();
      if (loaded) {
        untracked(() => this.breadcrumbs.nameCurrent(this.title(loaded)));
      }
    });
  }

  protected title(operation: TreasuryOperation): string {
    return (
      operation.reference || operation.description || operationTypeLabel(operation.operation_type)
    );
  }

  protected places(currency: string): number {
    return this.decimals().get(currency) ?? 0;
  }

  protected async onCommand(item: DropdownItem): Promise<void> {
    const operation = this.operation();
    if (!operation || this.busy()) {
      return;
    }
    const command = item.id as Command;
    const call = await this.ask(command, operation);
    if (!call) {
      return;
    }
    this.busy.set(true);
    this.actionError.set(null);
    try {
      const result = await firstValueFrom(call.request);
      this.toast.success(call.done);
      if (command === 'correct') {
        await this.router.navigate([this.operationsUrl, result.public_id]);
        return;
      }
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

  /** The confirmation of a command, then its request; `null` when the user cancelled. */
  private async ask(
    command: Command,
    operation: TreasuryOperation,
  ): Promise<{ request: Observable<TreasuryOperation>; done: string } | null> {
    const id = operation.public_id;
    switch (command) {
      case 'confirm': {
        const confirmed = await this.confirm.confirm({
          title: 'Confirmer l’opération ?',
          message:
            'L’opération confirmée compte dans le solde du compte ; elle ne se modifie plus. Elle pourra ensuite être comptabilisée.',
          confirmLabel: 'Confirmer l’opération',
        });
        return confirmed
          ? { request: this.api.confirmOperation(id), done: 'Opération confirmée.' }
          : null;
      }
      case 'cancel': {
        const answer = await this.reasons.ask({
          title: 'Annuler l’opération ?',
          message:
            'L’opération est conservée, annulée, avec le motif ; elle ne compte plus dans le solde.',
          confirmLabel: 'Annuler l’opération',
          tone: 'danger',
        });
        return answer
          ? { request: this.api.cancelOperation(id, answer.reason), done: 'Opération annulée.' }
          : null;
      }
      case 'account': {
        const account = await firstValueFrom(
          this.api.account(operation.treasury_account.public_id).pipe(catchError(() => of(null))),
        );
        const choice = await this.postings.ask({
          title: 'Comptabiliser l’opération ?',
          message:
            'Le serveur crée une écriture en brouillon dans la comptabilité : elle suit ensuite son propre workflow (soumission, validation).',
          defaultJournal: account?.journal?.code ?? null,
        });
        return choice
          ? {
              request: this.api.accountOperation(id, choice),
              done: 'Opération comptabilisée : écriture créée en brouillon.',
            }
          : null;
      }
      case 'unpost': {
        const confirmed = await this.confirm.confirm({
          title: 'Défaire la comptabilisation ?',
          message:
            'Possible tant que l’écriture est un brouillon : le serveur la retire et l’opération redevient confirmée.',
          confirmLabel: 'Défaire la comptabilisation',
          tone: 'danger',
        });
        return confirmed
          ? { request: this.api.unpostOperation(id), done: 'Comptabilisation défaite.' }
          : null;
      }
      case 'correct': {
        const answer = await this.reasons.ask({
          title: 'Corriger l’opération ?',
          message:
            'Le serveur crée une opération de correction, en sens inverse, liée à celle-ci (une seule) ; l’opération comptabilisée reste.',
          confirmLabel: 'Créer la correction',
          date: { label: 'Date de la correction', value: operation.operation_date },
        });
        return answer
          ? {
              request: this.api.correctOperation(id, {
                reason: answer.reason,
                operation_date: answer.date ?? operation.operation_date,
              }),
              done: 'Opération de correction créée.',
            }
          : null;
      }
    }
  }

  private reloadAll(): void {
    this.record.reload();
    this.history()?.reload();
  }
}
