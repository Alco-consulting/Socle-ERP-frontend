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
import { Subject, debounceTime, firstValueFrom, map } from 'rxjs';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoFilterBar, GroupOption } from '../../../shared/filters/filter-bar';
import { AlcoSearchBar, SearchFacet } from '../../../shared/filters/search-bar';
import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoCell, AlcoTable, TableColumn, TableGroup } from '../../../shared/tables/table';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoIcon } from '../../../shared/ui/icon/icon';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { AlcoDomainTransfers } from '../../transfers/domain-transfers';
import {
  ACCOUNTING_REFERENTIAL_ERRORS,
  ACCOUNT_TYPES,
  RECORD_STATUS,
  accountTypeLabel,
  accountTypeText,
} from '../accounting-presentation';
import { Account, AccountType, ActiveInactive } from '../data-access/accounting-models';
import { ACCOUNT_PAGE_SIZE, AccountingApi } from '../data-access/accounting-api';
import { ACCOUNT_TRANSFER } from './account-transfer';

const PARAM = {
  search: 'q',
  status: 'etat',
  type: 'type',
  group: 'groupe',
  prefix: 'prefixe',
  page: 'page',
} as const;
/** A code prefix of the URL: the characters a code may hold. */
const PREFIX = /^[A-Za-z0-9._-]{1,32}$/;
const STATUSES: readonly ActiveInactive[] = ['active', 'inactive'];

/** Grouping of the page shown (the API does not group): by the class it gives. */
const GROUP_OPTIONS: readonly GroupOption[] = [{ id: 'groupe', label: 'Groupe' }];

/**
 * Comptabilité › Plan comptable, on the API (`GET accounting/accounts/`): the server's
 * search (code, name), filters (state, type, code prefix), pages (50) and order (by code).
 * The hierarchy is the server's: a row says whether it has sub-accounts; the record shows
 * its parent and children. Every row is of the active company: no company column.
 */
@Component({
  selector: 'alco-account-list',
  imports: [
    ReactiveFormsModule,
    RouterLink,
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
  styleUrls: ['../accounting-list.scss', './account-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountListPage {
  private readonly api = inject(AccountingApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AlcoToastService);
  protected readonly session = inject(SessionStore);

  protected readonly types = ACCOUNT_TYPES;
  protected readonly statuses = STATUSES.map((id) => ({ id, label: RECORD_STATUS[id].label }));
  protected readonly groupOptions = GROUP_OPTIONS;
  protected readonly pageSize = ACCOUNT_PAGE_SIZE;
  protected readonly typeText = accountTypeText;
  protected readonly canManage = computed(() => this.session.can('accounting.manage_accounts'));
  /** « Actions ▾ › Importer des comptes » (`accounting.accounts`): flat, checked by the server. */
  protected readonly transfer = ACCOUNT_TRANSFER;
  protected readonly canImport = computed(
    () => this.canManage() && this.session.can('imports_exports.create'),
  );

  /** Odoo's list: code, name, type, lettering (switched here), currency. */
  protected readonly columns: readonly TableColumn[] = [
    { key: 'code', label: 'Code', width: '9rem' },
    { key: 'name', label: 'Nom du compte' },
    { key: 'type', label: 'Type', hideBelow: 'tablet' },
    { key: 'letterable', label: 'Autoriser le lettrage', width: '11rem' },
    { key: 'currency', label: 'Devise du compte', width: '9rem', hideBelow: 'laptop' },
  ];
  /** « Autoriser le lettrage » switched from the list: the server's answer, by account. */
  private readonly letterableSaved = signal<ReadonlyMap<string, boolean>>(new Map());
  protected readonly switching = signal<string | null>(null);
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
  protected readonly groupBy = computed(() =>
    GROUP_OPTIONS.some((option) => option.id === this.params().get(PARAM.group))
      ? this.params().get(PARAM.group)
      : null,
  );
  protected readonly page = computed(() => Math.max(1, Number(this.params().get(PARAM.page)) || 1));
  /** The code prefix chosen in the panel (`?prefixe=16`): a filter, never a hierarchy. */
  protected readonly prefix = computed(() => {
    const value = this.params().get(PARAM.prefix)?.trim() ?? '';
    return PREFIX.test(value) ? value.toUpperCase() : null;
  });

  protected readonly searchText = signal(this.route.snapshot.queryParamMap.get(PARAM.search) ?? '');
  private readonly searchTyped = new Subject<string>();

  protected readonly activeFilterCount = computed(
    () => [this.status(), this.type(), this.prefix()].filter((v) => v !== null).length,
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
    const prefix = this.prefix();
    if (prefix) {
      facets.push({ id: 'prefix', kind: 'filter', label: 'Code commençant par', value: prefix });
    }
    if (this.groupBy()) {
      facets.push({ id: 'group', kind: 'group', label: 'Regroupé par', value: 'Groupe' });
    }
    return facets;
  });

  private readonly query = computed(() => ({
    search: this.search(),
    status: this.status(),
    accountType: this.type(),
    codePrefix: this.prefix(),
    page: this.page(),
  }));
  protected readonly list = requestState(() => this.api.accounts(untracked(this.query)), {
    immediate: false,
  });

  /** The panel « Tous / 1 › 10…19 / 2… »: counts of the server for the same criteria. */
  private readonly prefixQuery = computed(() => ({
    search: this.search(),
    status: this.status(),
    accountType: this.type(),
  }));
  protected readonly prefixes = requestState(
    () => this.api.accountPrefixes(untracked(this.prefixQuery)),
    { immediate: false },
  );
  protected readonly totalAccounts = computed(() =>
    (this.prefixes.value() ?? []).reduce((total, group) => total + group.count, 0),
  );
  /** First characters opened in the panel (the chosen prefix's is always open). */
  protected readonly opened = signal<ReadonlySet<string>>(new Set());
  /** On a phone the panel is folded until asked for. */
  protected readonly panelShown = signal(false);
  protected readonly rows = computed(() => this.list.value()?.results ?? []);
  /** Rows of the page shown, grouped by the group the server gives (`code_group`). */
  protected readonly groups = computed<readonly TableGroup<Account>[] | null>(() => {
    if (!this.groupBy()) {
      return null;
    }
    const groups = new Map<string, Account[]>();
    for (const account of this.rows()) {
      const key = account.code_group || '';
      groups.set(key, [...(groups.get(key) ?? []), account]);
    }
    return [...groups].map(([key, rows]) => ({
      key,
      label: key ? `Groupe ${key}` : 'Sans groupe',
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
  });

  constructor() {
    effect(() => {
      this.query();
      untracked(() => this.list.reload());
    });
    effect(() => {
      this.prefixQuery();
      untracked(() => this.prefixes.reload());
    });
    effect(() => {
      if (this.list.error()?.kind === 'not-found' && untracked(this.page) > 1) {
        untracked(() => this.navigate({ [PARAM.page]: null }, true));
      }
    });
    effect(() => {
      this.filterForm.setValue({ status: this.status() ?? '', type: this.type() ?? '' });
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

  protected letterable(account: Account): boolean {
    return this.letterableSaved().get(account.public_id) ?? account.letterable;
  }

  /** The switch of a row: the server decides (it refuses while active letterings exist). */
  protected async setLetterable(account: Account, event: Event): Promise<void> {
    const box = event.target as HTMLInputElement;
    const wanted = box.checked;
    this.switching.set(account.public_id);
    try {
      const saved = await firstValueFrom(
        this.api.updateAccount(account.public_id, { letterable: wanted }),
      );
      this.letterableSaved.update((map) => new Map(map).set(saved.public_id, saved.letterable));
      this.toast.success(
        `Lettrage ${saved.letterable ? 'autorisé' : 'retiré'} pour le compte ${saved.code}.`,
      );
    } catch (failure) {
      box.checked = !wanted;
      this.toast.error(toUserError(failure, ACCOUNTING_REFERENTIAL_ERRORS).title);
    } finally {
      this.switching.set(null);
    }
  }

  protected isOpen(first: string): boolean {
    return this.opened().has(first) || (this.prefix() ?? '').startsWith(first);
  }

  protected toggle(first: string): void {
    const next = new Set(this.opened());
    if (this.isOpen(first)) {
      next.delete(first);
    } else {
      next.add(first);
    }
    this.opened.set(next);
  }

  /** A prefix of the panel, or all accounts (`null`). */
  protected choosePrefix(prefix: string | null): void {
    this.navigate({ [PARAM.prefix]: prefix, [PARAM.page]: null });
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
      [PARAM.page]: null,
    });
  }

  protected resetFilters(): void {
    this.searchText.set('');
    this.navigate({
      [PARAM.search]: null,
      [PARAM.status]: null,
      [PARAM.type]: null,
      [PARAM.prefix]: null,
      [PARAM.page]: null,
    });
  }

  protected removeFacet(facet: SearchFacet): void {
    const param = {
      status: PARAM.status,
      type: PARAM.type,
      prefix: PARAM.prefix,
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
