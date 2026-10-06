import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoFilterBar } from '../../../shared/filters/filter-bar';
import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import {
  RecordStatus,
  TreasuryAccount,
  TreasuryAccountType,
} from '../data-access/reconciliation-models';
import { TREASURY_PAGE_SIZE, TreasuryApi } from '../data-access/treasury-api';
import {
  ACCOUNT_STATUS,
  ACCOUNT_TYPES,
  TREASURY_ERRORS,
  accountTypeLabel,
} from '../treasury-presentation';

const PARAM = { type: 'type', status: 'etat', search: 'recherche', page: 'page' } as const;
const TYPES = ACCOUNT_TYPES.map((item) => item.id);
const STATUSES: readonly RecordStatus[] = ['active', 'inactive'];

/**
 * Trésorerie › Comptes de trésorerie, on the API (`GET treasury/accounts/`): the API's
 * filters only (type, state, search), its pages; the list's state lives in the URL. The type
 * (bank, cash, other) is the server's `account_type`, never a category made up here.
 */
@Component({
  selector: 'alco-treasury-account-list',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoBadge,
    AlcoButton,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoFilterBar,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
    AlcoPagination,
    AlcoTable,
  ],
  templateUrl: './account-list.html',
  styleUrl: '../../accounting/accounting-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreasuryAccountListPage {
  private readonly api = inject(TreasuryApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly session = inject(SessionStore);

  protected readonly types = ACCOUNT_TYPES;
  protected readonly statuses = STATUSES.map((id) => ({ id, label: ACCOUNT_STATUS[id].label }));
  protected readonly pageSize = TREASURY_PAGE_SIZE;
  protected readonly typeLabel = accountTypeLabel;
  protected readonly canManage = computed(() => this.session.can('treasury.manage_accounts'));

  protected readonly columns: readonly TableColumn[] = [
    { key: 'code', label: 'Code', width: '9rem' },
    { key: 'name', label: 'Libellé' },
    { key: 'type', label: 'Type', width: '7rem' },
    { key: 'currency', label: 'Devise', width: '6rem' },
    { key: 'ledger', label: 'Compte comptable', hideBelow: 'laptop' },
    { key: 'status', label: 'État', width: '8rem', hideBelow: 'tablet' },
  ];
  protected readonly rowId = (row: TreasuryAccount) => row.public_id;
  protected readonly rowLabel = (row: TreasuryAccount) => `${row.code} ${row.name}`;

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly type = computed<TreasuryAccountType | null>(() => {
    const value = this.params().get(PARAM.type);
    return TYPES.includes(value as TreasuryAccountType) ? (value as TreasuryAccountType) : null;
  });
  protected readonly status = computed<RecordStatus | null>(() => {
    const value = this.params().get(PARAM.status);
    return STATUSES.includes(value as RecordStatus) ? (value as RecordStatus) : null;
  });
  protected readonly search = computed(() => this.params().get(PARAM.search)?.trim() || null);
  protected readonly page = computed(() => Math.max(1, Number(this.params().get(PARAM.page)) || 1));
  protected readonly activeFilterCount = computed(
    () => [this.type(), this.status(), this.search()].filter(Boolean).length,
  );

  private readonly query = computed(() => ({
    accountType: this.type(),
    status: this.status(),
    search: this.search(),
    page: this.page(),
  }));
  protected readonly list = requestState(() => this.api.accountList(untracked(this.query)), {
    immediate: false,
  });
  protected readonly rows = computed(() => this.list.value()?.results ?? []);
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, TREASURY_ERRORS) : null;
  });

  protected readonly filterForm = new FormGroup({
    type: new FormControl('', { nonNullable: true }),
    status: new FormControl('', { nonNullable: true }),
    search: new FormControl('', { nonNullable: true }),
  });

  constructor() {
    effect(() => {
      this.query();
      untracked(() => this.list.reload());
    });
    effect(() => {
      if (this.list.error()?.kind === 'not-found' && untracked(this.page) > 1) {
        untracked(() => this.navigate({ [PARAM.page]: null }, true));
      }
    });
    effect(() => {
      this.filterForm.setValue({
        type: this.type() ?? '',
        status: this.status() ?? '',
        search: this.search() ?? '',
      });
    });
  }

  protected statusLook(account: TreasuryAccount) {
    return ACCOUNT_STATUS[account.status];
  }

  protected applyFilters(): void {
    const value = this.filterForm.getRawValue();
    this.navigate({
      [PARAM.type]: value.type || null,
      [PARAM.status]: value.status || null,
      [PARAM.search]: value.search.trim() || null,
      [PARAM.page]: null,
    });
  }

  protected resetFilters(): void {
    this.navigate({
      [PARAM.type]: null,
      [PARAM.status]: null,
      [PARAM.search]: null,
      [PARAM.page]: null,
    });
  }

  protected setPage(page: number): void {
    this.navigate({ [PARAM.page]: page > 1 ? page : null });
  }

  protected open(account: TreasuryAccount): void {
    void this.router.navigate([account.public_id], { relativeTo: this.route });
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
