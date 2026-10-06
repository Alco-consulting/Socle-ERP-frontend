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
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, catchError, firstValueFrom, map, of } from 'rxjs';

import { UserError, toUserError } from '../../../core/errors/user-error';
import { toApiError } from '../../../core/http/api-error';
import { requestState } from '../../../core/http/request-state';
import { APP_ROOT } from '../../../core/navigation/applications';
import { BreadcrumbService } from '../../../core/navigation/route-trail';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoConfirmService } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoDropdown, DropdownItem } from '../../../shared/ui/dropdown/dropdown';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { isoDay } from '../../accounting/entries/entry-presentation';
import { AlcoObjectHistory } from '../../audit/object-history';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { Transfer, TreasuryOperation } from '../data-access/reconciliation-models';
import { TreasuryApi } from '../data-access/treasury-api';
import { TreasuryPostingDialogService } from '../posting-dialog';
import { TreasuryReasonDialogService } from '../reason-dialog';
import {
  DIRECTIONS,
  OPERATION_STATUS,
  TREASURY_AUDIT_TYPES,
  TREASURY_ERRORS,
  TREASURY_STALE_CODES,
} from '../treasury-presentation';

const TREASURY = `${APP_ROOT}/comptabilite/tresorerie`;

/**
 * A transfer between two treasury accounts (`GET treasury/transfers/{id}/`): its accounts,
 * amounts (and the conversion the server fixed when the currencies differ), and its two legs
 * — operations, each with its own record. The commands move both legs together (`confirm`,
 * `cancel` with a reason, `account` with an optional journal), offered by the legs' state and
 * the permissions, confirmed; the server decides. History: Audit.
 */
@Component({
  selector: 'alco-treasury-transfer-detail',
  imports: [
    DatePipe,
    RouterLink,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoButton,
    AlcoCell,
    AlcoDropdown,
    AlcoErrorState,
    AlcoLoading,
    AlcoObjectHistory,
    AlcoPageHeader,
    AlcoTable,
  ],
  templateUrl: './transfer-detail.html',
  styleUrl: '../../accounting/accounting-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreasuryTransferDetailPage {
  private readonly api = inject(TreasuryApi);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly confirm = inject(AlcoConfirmService);
  private readonly reasons = inject(TreasuryReasonDialogService);
  private readonly postings = inject(TreasuryPostingDialogService);
  private readonly toast = inject(AlcoToastService);
  protected readonly session = inject(SessionStore);

  private readonly id = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('id') ?? '')),
    { requireSync: true },
  );
  protected readonly record = requestState(() => this.api.transfer(untracked(this.id)), {
    immediate: false,
  });
  protected readonly transfer = computed(() => this.record.value());
  protected readonly loadError = computed(() => {
    const error = this.record.error();
    return error ? toUserError(error, TREASURY_ERRORS) : null;
  });
  protected readonly decimals = signal<ReadonlyMap<string, number>>(new Map());
  protected readonly busy = signal(false);
  protected readonly actionError = signal<UserError | null>(null);

  protected readonly accountsUrl = `${TREASURY}/comptes`;
  protected readonly operationsUrl = `${TREASURY}/operations`;
  protected readonly day = isoDay;
  protected readonly auditType = TREASURY_AUDIT_TYPES.transfer;
  protected readonly canSeeHistory = computed(() => this.session.can('audit.read'));
  private readonly history = viewChild(AlcoObjectHistory);
  protected readonly legColumns: readonly TableColumn[] = [
    { key: 'account', label: 'Compte' },
    { key: 'direction', label: 'Sens' },
    { key: 'amount', label: 'Montant', numeric: true },
    { key: 'status', label: 'État' },
  ];
  protected readonly legId = (leg: TreasuryOperation) => leg.public_id;

  /** The legs' state as the server gives it (both legs move together). */
  protected readonly legStatus = computed(() => this.transfer()?.operations[0]?.status ?? null);
  protected readonly status = computed(() => {
    const status = this.legStatus();
    return status ? OPERATION_STATUS[status] : null;
  });
  protected readonly commands = computed<readonly DropdownItem[]>(() => {
    const status = this.legStatus();
    const can = (permission: string) => this.session.can(permission);
    const disabled = this.busy();
    const items: DropdownItem[] = [];
    if (status === 'draft' && can('treasury.confirm')) {
      items.push({ id: 'confirm', label: 'Confirmer le virement', icon: 'check', disabled });
    }
    if (status === 'confirmed' && can('treasury.account')) {
      items.push({ id: 'account', label: 'Comptabiliser', icon: 'book', disabled });
    }
    if ((status === 'draft' || status === 'confirmed') && can('treasury.confirm')) {
      items.push({ id: 'cancel', label: 'Annuler le virement', icon: 'close', disabled });
    }
    return items;
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

  protected title(transfer: Transfer): string {
    return transfer.reference || `Virement du ${isoDay(transfer.transfer_date)}`;
  }

  protected places(currency: string | undefined): number {
    return currency ? (this.decimals().get(currency) ?? 0) : 0;
  }

  protected legDirection(leg: TreasuryOperation): string {
    return DIRECTIONS[leg.direction];
  }

  protected legStatusLook(leg: TreasuryOperation) {
    return OPERATION_STATUS[leg.status];
  }

  /** The leg of an account (the source pays, the destination receives), as the server gave it. */
  protected legOf(
    transfer: Transfer,
    direction: 'inflow' | 'outflow',
  ): TreasuryOperation | undefined {
    return transfer.operations.find((item) => item.direction === direction);
  }

  protected async onCommand(item: DropdownItem): Promise<void> {
    const transfer = this.transfer();
    if (!transfer || this.busy()) {
      return;
    }
    const call = await this.ask(item.id, transfer);
    if (!call) {
      return;
    }
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await firstValueFrom(call.request);
      this.toast.success(call.done);
      this.record.reload();
      this.history()?.reload();
    } catch (failure) {
      const error = toApiError(failure);
      if (error.kind === 'unauthenticated') {
        return;
      }
      this.actionError.set(toUserError(error, TREASURY_ERRORS));
      if (error.code && TREASURY_STALE_CODES.has(error.code)) {
        this.record.reload();
      }
    } finally {
      this.busy.set(false);
    }
  }

  private async ask(
    command: string,
    transfer: Transfer,
  ): Promise<{ request: Observable<Transfer>; done: string } | null> {
    const id = transfer.public_id;
    if (command === 'confirm') {
      const confirmed = await this.confirm.confirm({
        title: 'Confirmer le virement ?',
        message:
          'Les deux opérations du virement sont confirmées ensemble ; elles comptent dans les soldes.',
        confirmLabel: 'Confirmer le virement',
      });
      return confirmed
        ? { request: this.api.confirmTransfer(id), done: 'Virement confirmé.' }
        : null;
    }
    if (command === 'cancel') {
      const answer = await this.reasons.ask({
        title: 'Annuler le virement ?',
        message: 'Les deux opérations sont annulées ensemble et conservées, avec le motif.',
        confirmLabel: 'Annuler le virement',
        tone: 'danger',
      });
      return answer
        ? { request: this.api.cancelTransfer(id, answer.reason), done: 'Virement annulé.' }
        : null;
    }
    const choice = await this.postings.ask({
      title: 'Comptabiliser le virement ?',
      message: 'Le serveur crée l’écriture du virement en brouillon dans la comptabilité.',
      defaultJournal: null,
    });
    return choice
      ? {
          request: this.api.accountTransfer(id, choice),
          done: 'Virement comptabilisé : écriture créée en brouillon.',
        }
      : null;
  }
}
