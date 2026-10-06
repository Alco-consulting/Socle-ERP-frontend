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
import { firstValueFrom, forkJoin, map } from 'rxjs';

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
import { AlcoObjectHistory } from '../../audit/object-history';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { TreasuryAccount } from '../data-access/reconciliation-models';
import { TreasuryApi } from '../data-access/treasury-api';
import {
  ACCOUNT_STATUS,
  TREASURY_AUDIT_TYPES,
  TREASURY_ERRORS,
  accountTypeLabel,
} from '../treasury-presentation';

const TREASURY = `${APP_ROOT}/comptabilite/tresorerie`;

/**
 * A treasury account (`GET treasury/accounts/{id}/`): its fields as the server gives them —
 * bank identifiers masked unless the user manages accounts —, its balance today
 * (`…/balance/`, computed by the server), and its relations through the API's own filters:
 * operations (`operations/?account`), statements (`statements/?account`), lines to reconcile
 * (`statement-lines/?account&status=unreconciled`, to the reconciliation), history (Audit).
 * Actions: Modifier, Désactiver / Réactiver (`treasury.manage_accounts`, confirmed).
 */
@Component({
  selector: 'alco-treasury-account-detail',
  imports: [
    DatePipe,
    RouterLink,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoButton,
    AlcoDropdown,
    AlcoErrorState,
    AlcoLoading,
    AlcoObjectHistory,
    AlcoPageHeader,
    AlcoSmartButton,
  ],
  templateUrl: './account-detail.html',
  styleUrl: '../../accounting/accounting-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreasuryAccountDetailPage {
  private readonly api = inject(TreasuryApi);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly confirm = inject(AlcoConfirmService);
  private readonly toast = inject(AlcoToastService);
  private readonly navigation = inject(NavigationService);
  protected readonly session = inject(SessionStore);

  private readonly id = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('id') ?? '')),
    { requireSync: true },
  );
  protected readonly record = requestState(() => this.api.account(untracked(this.id)), {
    immediate: false,
  });
  protected readonly account = computed(() => this.record.value());
  protected readonly loadError = computed(() => {
    const error = this.record.error();
    return error ? toUserError(error, TREASURY_ERRORS) : null;
  });
  protected readonly balance = requestState(() => this.api.balance(untracked(this.id)), {
    immediate: false,
  });
  /** The relations' counts: three requests, whatever the account. */
  protected readonly counts = requestState(
    () => {
      const accountId = untracked(this.id);
      return forkJoin({
        operations: this.api.operationCount({ account: accountId }),
        statements: this.api.statementCount(accountId),
        unreconciled: this.api.lineCount({ account: accountId, status: 'unreconciled' }),
      });
    },
    { immediate: false },
  );
  protected readonly decimals = signal<ReadonlyMap<string, number>>(new Map());
  protected readonly busy = signal(false);
  protected readonly actionError = signal<UserError | null>(null);

  protected readonly operationsUrl = `${TREASURY}/operations`;
  protected readonly statementsUrl = `${TREASURY}/releves`;
  protected readonly reconciliationUrl = `${TREASURY}/rapprochements`;
  protected readonly accounting = `${APP_ROOT}/comptabilite`;
  protected readonly typeLabel = accountTypeLabel;
  protected readonly auditType = TREASURY_AUDIT_TYPES.account;
  protected readonly canManage = computed(() => this.session.can('treasury.manage_accounts'));
  protected readonly canSeeHistory = computed(() => this.session.can('audit.read'));
  protected readonly canOpenReconciliation = computed(() =>
    this.navigation.canOpenUrl(this.reconciliationUrl),
  );
  protected readonly canOpenChart = computed(() =>
    this.navigation.canOpenUrl(`${this.accounting}/plan-comptable`),
  );
  private readonly history = viewChild(AlcoObjectHistory);
  protected readonly historyCount = computed(() => this.history()?.total() ?? null);
  protected readonly status = computed(() => {
    const account = this.account();
    return account ? ACCOUNT_STATUS[account.status] : null;
  });
  protected readonly actions = computed<readonly DropdownItem[]>(() => {
    const account = this.account();
    if (!account || !this.canManage()) {
      return [];
    }
    return account.status === 'active'
      ? [{ id: 'deactivate', label: 'Désactiver le compte', icon: 'lock', disabled: this.busy() }]
      : [{ id: 'reactivate', label: 'Réactiver le compte', icon: 'check', disabled: this.busy() }];
  });

  constructor() {
    inject(PartnersApi)
      .currencies()
      .pipe(map((page) => new Map(page.results.map((item) => [item.code, item.decimal_places]))))
      .subscribe({ next: (decimals) => this.decimals.set(decimals), error: () => undefined });
    effect(() => {
      this.id();
      untracked(() => {
        this.record.reload();
        this.balance.reload();
        this.counts.reload();
      });
    });
    effect(() => {
      const loaded = this.record.value();
      if (loaded) {
        untracked(() => this.breadcrumbs.nameCurrent(`${loaded.code} — ${loaded.name}`));
      }
    });
  }

  protected places(currency: string): number {
    return this.decimals().get(currency) ?? 0;
  }

  protected async onAction(item: DropdownItem): Promise<void> {
    const account = this.account();
    if (!account || this.busy()) {
      return;
    }
    const activate = item.id === 'reactivate';
    const confirmed = await this.confirm.confirm({
      title: `${activate ? 'Réactiver' : 'Désactiver'} le compte ${account.code} ?`,
      message: activate
        ? 'Le compte sera de nouveau proposé pour les nouvelles opérations.'
        : 'Le compte reste, avec ses opérations et ses relevés ; il ne sera plus proposé pour de nouvelles opérations. Vous pourrez le réactiver.',
      confirmLabel: activate ? 'Réactiver' : 'Désactiver',
    });
    if (!confirmed) {
      return;
    }
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await firstValueFrom(this.api.setAccountActive(account.public_id, activate));
      this.toast.success(activate ? 'Compte réactivé.' : 'Compte désactivé.');
      this.record.reload();
      this.history()?.reload();
    } catch (failure) {
      const error = toApiError(failure);
      if (error.kind !== 'unauthenticated') {
        this.actionError.set(toUserError(error, TREASURY_ERRORS));
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected bankDetails(account: TreasuryAccount): boolean {
    return Boolean(
      account.bank_name ||
      account.bank_branch ||
      account.account_number ||
      account.iban ||
      account.bic,
    );
  }
}
