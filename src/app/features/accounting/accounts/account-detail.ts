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
import { catchError, firstValueFrom, map, of } from 'rxjs';

import { UserError, toUserError } from '../../../core/errors/user-error';
import { toApiError } from '../../../core/http/api-error';
import { requestState } from '../../../core/http/request-state';
import { BreadcrumbService } from '../../../core/navigation/route-trail';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoConfirmService } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoDropdown, DropdownItem } from '../../../shared/ui/dropdown/dropdown';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import {
  ACCOUNTING_REFERENTIAL_ERRORS,
  RECORD_STATUS,
  accountTypeLabel,
} from '../accounting-presentation';
import { Account } from '../data-access/accounting-models';
import { ACCOUNT_PAGE_SIZE, AccountingApi } from '../data-access/accounting-api';
import { APP_ROOT } from '../../../core/navigation/applications';
import { NavigationService } from '../../../core/navigation/navigation.service';
import { AlcoSmartButton } from '../../../shared/ui/smart-button/smart-button';
import { AUDIT_TYPES, AlcoObjectHistory } from '../../audit/object-history';
import { RelationsApi } from '../../relations/data-access/relations-api';
import { LetteringApi } from '../data-access/lettering-api';

/**
 * An account (`GET accounting/accounts/{id}/`) and its place in the hierarchy the server
 * keeps: its parent (one request) and its direct sub-accounts (`children/`, paged).
 * Actions of the API allowed by `accounting.manage_accounts`: Modifier, Désactiver /
 * Réactiver. Smart buttons: its entries (the entry list's `count`), its ledger (Analyse ›
 * Grand livre, `reporting.read`), its sub-accounts (the page already read), its lettering
 * (a letterable account only: its open lines, the `count` of `letterable-lines/`) and its
 * history (Audit, `audit.read`) — one request per relation, never one per item.
 */
@Component({
  selector: 'alco-account-detail',
  imports: [
    DatePipe,
    RouterLink,
    AlcoBadge,
    AlcoButton,
    AlcoCell,
    AlcoDropdown,
    AlcoErrorState,
    AlcoLoading,
    AlcoPageHeader,
    AlcoObjectHistory,
    AlcoPagination,
    AlcoSmartButton,
    AlcoTable,
  ],
  templateUrl: './account-detail.html',
  styleUrl: '../accounting-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountDetailPage {
  private readonly api = inject(AccountingApi);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly confirm = inject(AlcoConfirmService);
  private readonly toast = inject(AlcoToastService);
  protected readonly session = inject(SessionStore);

  private readonly id = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('id') ?? '')),
    { requireSync: true },
  );
  protected readonly record = requestState(() => this.api.account(untracked(this.id)), {
    immediate: false,
  });
  protected readonly account = signal<Account | null>(null);
  /** `undefined`: loading; `null`: no parent (or not readable). */
  protected readonly parent = signal<Account | null | undefined>(undefined);
  protected readonly childPage = signal(1);
  protected readonly children = requestState(
    () => this.api.children(untracked(this.id), untracked(this.childPage)),
    { immediate: false },
  );
  protected readonly busy = signal(false);
  protected readonly actionError = signal<UserError | null>(null);

  // ---- Related objects ---------------------------------------------------------------
  private readonly relations = inject(RelationsApi);
  private readonly navigation = inject(NavigationService);
  protected readonly entries = requestState(
    () => this.relations.entryCount(null, { account: untracked(this.id) }),
    { immediate: false },
  );
  protected readonly entriesUrl = `${APP_ROOT}/comptabilite/ecritures`;
  protected readonly ledgerUrl = `${APP_ROOT}/comptabilite/analyse/grand-livre`;
  protected readonly letteringUrl = `${APP_ROOT}/comptabilite/lettrage`;
  private readonly lettering = inject(LetteringApi);
  /** Lettering of the account: offered when the server says it is letterable. */
  protected readonly canOpenLettering = computed(
    () => !!this.account()?.letterable && this.canOpen('lettrage'),
  );
  protected readonly openLines = requestState(
    () => this.lettering.openLineCount({ account: untracked(this.id) }),
    { immediate: false },
  );
  protected readonly canOpenLedger = computed(() => this.canOpen('analyse/grand-livre'));
  protected readonly auditType = AUDIT_TYPES.account;
  protected readonly canSeeHistory = computed(() => this.session.can('audit.read'));
  private readonly history = viewChild(AlcoObjectHistory);
  protected readonly historyCount = computed(() => this.history()?.total() ?? null);

  protected readonly typeLabel = accountTypeLabel;
  protected readonly pageSize = ACCOUNT_PAGE_SIZE;
  protected readonly canManage = computed(() => this.session.can('accounting.manage_accounts'));
  protected readonly status = computed(() => {
    const account = this.account();
    return account ? RECORD_STATUS[account.status] : null;
  });
  protected readonly loadError = computed(() => {
    const error = this.record.error();
    return error ? toUserError(error, ACCOUNTING_REFERENTIAL_ERRORS) : null;
  });
  protected readonly actions = computed<readonly DropdownItem[]>(() => {
    const account = this.account();
    if (!account || !this.canManage()) {
      return [];
    }
    return account.status === 'active'
      ? [{ id: 'deactivate', label: 'Désactiver', icon: 'lock', disabled: this.busy() }]
      : [{ id: 'reactivate', label: 'Réactiver', icon: 'refresh', disabled: this.busy() }];
  });

  protected readonly childColumns: readonly TableColumn[] = [
    { key: 'code', label: 'Code', width: '9rem' },
    { key: 'name', label: 'Intitulé' },
    { key: 'status', label: 'État', width: '8rem' },
  ];
  protected readonly childId = (row: Account) => row.public_id;

  constructor() {
    effect(() => {
      this.id();
      untracked(() => {
        this.account.set(null);
        this.parent.set(undefined);
        this.childPage.set(1);
        this.record.reload();
        this.entries.reload();
      });
    });
    effect(() => {
      const loaded = this.record.value();
      if (loaded) {
        untracked(() => this.show(loaded, true));
      }
    });
  }

  /** The application and the screen are both open to the user (never one alone). */
  private canOpen(path: string): boolean {
    return this.navigation.canOpenUrl(`${APP_ROOT}/comptabilite/${path}`);
  }

  protected statusLook(account: Account) {
    return RECORD_STATUS[account.status];
  }

  protected setChildPage(page: number): void {
    this.childPage.set(page);
    this.children.reload();
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
        ? 'Le compte sera de nouveau proposé pour les écritures, selon ses réglages.'
        : 'Le compte reste, avec son historique ; il ne sera plus proposé pour de nouvelles écritures. Vous pourrez le réactiver.',
      confirmLabel: activate ? 'Réactiver' : 'Désactiver',
    });
    if (!confirmed) {
      return;
    }
    this.busy.set(true);
    this.actionError.set(null);
    try {
      this.show(
        await firstValueFrom(this.api.setAccountActive(account.public_id, activate)),
        false,
      );
      this.toast.success(activate ? 'Compte réactivé.' : 'Compte désactivé.');
    } catch (failure) {
      const error = toApiError(failure);
      if (error.kind !== 'unauthenticated') {
        this.actionError.set(toUserError(error, ACCOUNTING_REFERENTIAL_ERRORS));
      }
    } finally {
      this.busy.set(false);
    }
  }

  private show(account: Account, withHierarchy: boolean): void {
    this.account.set(account);
    this.breadcrumbs.nameCurrent(`${account.code} — ${account.name}`);
    if (!withHierarchy) {
      return;
    }
    if (account.letterable && this.canOpen('lettrage')) {
      this.openLines.reload();
    }
    if (account.parent) {
      this.api
        .account(account.parent)
        .pipe(catchError(() => of(null)))
        .subscribe((parent) => this.parent.set(parent));
    } else {
      this.parent.set(null);
    }
    if (account.has_children) {
      this.children.reload();
    }
  }
}
