import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, map } from 'rxjs';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoFilterBar, GroupOption } from '../../../shared/filters/filter-bar';
import { AlcoSearchBar, SearchFacet } from '../../../shared/filters/search-bar';
import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoCell, AlcoTable, TableColumn, TableGroup } from '../../../shared/tables/table';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoIcon } from '../../../shared/ui/icon/icon';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { AlcoDomainTransfers } from '../../transfers/domain-transfers';
import {
  ACCOUNTING_REFERENTIAL_ERRORS,
  ACCOUNT_TYPES,
  RECORD_STATUS,
  accountTypeLabel,
} from '../accounting-presentation';
import { Account, AccountType, ActiveInactive } from '../data-access/accounting-models';
import { ACCOUNT_PAGE_SIZE, AccountingApi } from '../data-access/accounting-api';
import { ACCOUNT_TRANSFER } from './account-transfer';

const PARAM = {
  search: 'q',
  status: 'etat',
  type: 'type',
  postable: 'imputable',
  group: 'groupe',
  page: 'page',
} as const;
const STATUSES: readonly ActiveInactive[] = ['active', 'inactive'];

/** Grouping of the page shown (the API does not group): by the class it gives. */
const GROUP_OPTIONS: readonly GroupOption[] = [{ id: 'classe', label: 'Classe' }];

/**
 * Comptabilité › Plan comptable, on the API (`GET accounting/accounts/`): the server's
 * search (code, name), filters (state, type, postable — postable as the server decides,
 * settings included), pages (50) and order (by code). The hierarchy is the server's:
 * a row says whether it has sub-accounts; the record shows its parent and children.
 */
@Component({
  selector: 'alco-account-list',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoBadge,
    AlcoButton,
    AlcoCell,
    AlcoDomainTransfers,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoFilterBar,
    AlcoFormField,
    AlcoIcon,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
    AlcoPagination,
    AlcoSearchBar,
    AlcoTable,
  ],
  templateUrl: './account-list.html',
  styleUrl: '../accounting-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountListPage {
  private readonly api = inject(AccountingApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly session = inject(SessionStore);

  protected readonly types = ACCOUNT_TYPES;
  protected readonly statuses = STATUSES.map((id) => ({ id, label: RECORD_STATUS[id].label }));
  protected readonly groupOptions = GROUP_OPTIONS;
  protected readonly pageSize = ACCOUNT_PAGE_SIZE;
  protected readonly typeLabel = accountTypeLabel;
  protected readonly canManage = computed(() => this.session.can('accounting.manage_accounts'));
  /** « Actions ▾ › Importer des comptes » (`accounting.accounts`): flat, checked by the server. */
  protected readonly transfer = ACCOUNT_TRANSFER;
  protected readonly canImport = computed(
    () => this.canManage() && this.session.can('imports_exports.create'),
  );

  protected readonly columns: readonly TableColumn[] = [
    { key: 'code', label: 'Code', width: '9rem' },
    { key: 'name', label: 'Intitulé' },
    { key: 'account_class', label: 'Classe', width: '6rem' },
    { key: 'type', label: 'Type', hideBelow: 'tablet' },
    { key: 'entries', label: 'Saisie', hideBelow: 'laptop' },
    { key: 'status', label: 'État', width: '8rem' },
  ];
  protected readonly rowId = (row: Account) => row.public_id;
  protected readonly rowLabel = (row: Account) => `${row.code} ${row.name}`;

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly search = computed(() => this.params().get(PARAM.search)?.trim() ?? '');
  protected readonly status = computed<ActiveInactive | null>(() => {
    const value = this.params().get(PARAM.status);
    return STATUSES.includes(value as ActiveInactive) ? (value as ActiveInactive) : null;
  });
  protected readonly type = computed<AccountType | null>(() => {
    const value = this.params().get(PARAM.type);
    return ACCOUNT_TYPES.some((type) => type.id === value) ? (value as AccountType) : null;
  });
  protected readonly postable = computed<boolean | null>(() => {
    const value = this.params().get(PARAM.postable);
    return value === 'oui' ? true : value === 'non' ? false : null;
  });
  protected readonly groupBy = computed(() =>
    GROUP_OPTIONS.some((option) => option.id === this.params().get(PARAM.group))
      ? this.params().get(PARAM.group)
      : null,
  );
  protected readonly page = computed(() => Math.max(1, Number(this.params().get(PARAM.page)) || 1));

  protected readonly searchText = signal(this.route.snapshot.queryParamMap.get(PARAM.search) ?? '');
  private readonly searchTyped = new Subject<string>();

  protected readonly activeFilterCount = computed(
    () =>
      [this.status(), this.type(), this.postable() === null ? null : 1].filter((v) => v !== null)
        .length,
  );
  protected readonly hasCriteria = computed(() => this.activeFilterCount() > 0 || !!this.search());

  protected readonly facets = computed<readonly SearchFacet[]>(() => {
    const facets: SearchFacet[] = [];
    const status = this.status();
    if (status) {
      facets.push({
        id: 'status',
        kind: 'filter',
        label: 'État',
        value: RECORD_STATUS[status].label,
      });
    }
    const type = this.type();
    if (type) {
      facets.push({ id: 'type', kind: 'filter', label: 'Type', value: accountTypeLabel(type) });
    }
    const postable = this.postable();
    if (postable !== null) {
      facets.push({
        id: 'postable',
        kind: 'filter',
        label: 'Imputable',
        value: postable ? 'Oui' : 'Non',
      });
    }
    if (this.groupBy()) {
      facets.push({ id: 'group', kind: 'group', label: 'Regroupé par', value: 'Classe' });
    }
    return facets;
  });

  private readonly query = computed(() => ({
    search: this.search(),
    status: this.status(),
    accountType: this.type(),
    postable: this.postable(),
    page: this.page(),
  }));
  protected readonly list = requestState(() => this.api.accounts(untracked(this.query)), {
    immediate: false,
  });
  protected readonly rows = computed(() => this.list.value()?.results ?? []);
  /** Rows of the page shown, grouped by the class the server gives (nothing is derived). */
  protected readonly groups = computed<readonly TableGroup<Account>[] | null>(() => {
    if (!this.groupBy()) {
      return null;
    }
    const groups = new Map<string, Account[]>();
    for (const account of this.rows()) {
      const key = account.account_class || '';
      groups.set(key, [...(groups.get(key) ?? []), account]);
    }
    return [...groups].map(([key, rows]) => ({
      key,
      label: key ? `Classe ${key}` : 'Sans classe',
      rows,
    }));
  });
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, ACCOUNTING_REFERENTIAL_ERRORS) : null;
  });

  protected readonly filterForm = new FormGroup({
    status: new FormControl('', { nonNullable: true }),
    type: new FormControl('', { nonNullable: true }),
    postable: new FormControl('', { nonNullable: true }),
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
      const postable = this.postable();
      this.filterForm.setValue({
        status: this.status() ?? '',
        type: this.type() ?? '',
        postable: postable === null ? '' : postable ? 'oui' : 'non',
      });
    });
    this.searchTyped
      .pipe(
        debounceTime(300),
        map((text) => text.trim()),
        takeUntilDestroyed(),
      )
      .subscribe((text) =>
        this.navigate({ [PARAM.search]: text || null, [PARAM.page]: null }, true),
      );
  }

  protected statusLook(account: Account) {
    return RECORD_STATUS[account.status];
  }

  protected onSearch(text: string): void {
    this.searchText.set(text);
    this.searchTyped.next(text);
  }

  protected applyFilters(): void {
    const value = this.filterForm.getRawValue();
    this.navigate({
      [PARAM.status]: value.status || null,
      [PARAM.type]: value.type || null,
      [PARAM.postable]: value.postable || null,
      [PARAM.page]: null,
    });
  }

  protected resetFilters(): void {
    this.searchText.set('');
    this.navigate({
      [PARAM.search]: null,
      [PARAM.status]: null,
      [PARAM.type]: null,
      [PARAM.postable]: null,
      [PARAM.page]: null,
    });
  }

  protected removeFacet(facet: SearchFacet): void {
    const param = {
      status: PARAM.status,
      type: PARAM.type,
      postable: PARAM.postable,
      group: PARAM.group,
    }[facet.id];
    if (param) {
      this.navigate({ [param]: null, [PARAM.page]: null });
    }
  }

  protected setGroupBy(groupBy: string | null): void {
    this.navigate({ [PARAM.group]: groupBy });
  }

  protected setPage(page: number): void {
    this.navigate({ [PARAM.page]: page > 1 ? page : null });
  }

  protected open(account: Account): void {
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
