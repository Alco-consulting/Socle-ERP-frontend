import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoFilterBar } from '../../../shared/filters/filter-bar';
import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { isoDay } from '../../accounting/entries/entry-presentation';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { AlcoDomainTransfers } from '../../transfers/domain-transfers';
import { Statement } from '../data-access/reconciliation-models';
import { TREASURY_PAGE_SIZE, TreasuryApi } from '../data-access/treasury-api';
import { STATEMENT_STATUS, STATEMENT_TRANSFER, TREASURY_ERRORS } from '../treasury-presentation';

const PARAM = { account: 'compte', status: 'etat', page: 'page' } as const;
const STATUSES: readonly Statement['status'][] = ['open', 'closed'];

/**
 * Trésorerie › Relevés, on the API (`GET treasury/statements/?account&status`): the
 * statements of the company or of one account (by code), by state, server pages; the list's
 * state lives in the URL. « Actions ▾ » holds the import of statements (`treasury.statements`,
 * the generic pipeline: `imports_exports.*` + `treasury.manage_statements`).
 */
@Component({
  selector: 'alco-treasury-statement-list',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoButton,
    AlcoCell,
    AlcoDomainTransfers,
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
  templateUrl: './statement-list.html',
  styleUrl: '../../accounting/accounting-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreasuryStatementListPage {
  private readonly api = inject(TreasuryApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly session = inject(SessionStore);

  protected readonly transfer = STATEMENT_TRANSFER;
  protected readonly statuses = STATUSES.map((id) => ({ id, label: STATEMENT_STATUS[id].label }));
  protected readonly pageSize = TREASURY_PAGE_SIZE;
  protected readonly day = isoDay;
  protected readonly columns: readonly TableColumn[] = [
    { key: 'reference', label: 'Relevé' },
    { key: 'account', label: 'Compte', width: '8rem' },
    { key: 'period', label: 'Période', hideBelow: 'tablet' },
    { key: 'opening', label: 'Solde d’ouverture', numeric: true, hideBelow: 'laptop' },
    { key: 'closing', label: 'Solde de clôture', numeric: true },
    { key: 'status', label: 'État', width: '8rem', hideBelow: 'tablet' },
  ];
  protected readonly rowId = (row: Statement) => row.public_id;
  protected readonly rowLabel = (row: Statement) => this.name(row);

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly accountCode = computed(
    () => this.params().get(PARAM.account)?.trim().toUpperCase() || null,
  );
  protected readonly status = computed<Statement['status'] | null>(() => {
    const value = this.params().get(PARAM.status);
    return STATUSES.includes(value as Statement['status']) ? (value as Statement['status']) : null;
  });
  protected readonly page = computed(() => Math.max(1, Number(this.params().get(PARAM.page)) || 1));
  protected readonly activeFilterCount = computed(
    () => [this.accountCode(), this.status()].filter(Boolean).length,
  );

  protected readonly accounts = requestState(() => this.api.accounts());
  protected readonly accountChoices = computed(() => this.accounts.value()?.results ?? []);
  protected readonly unknownAccount = computed(
    () =>
      this.accountCode() !== null &&
      this.accounts.value() !== null &&
      !this.accountChoices().some((item) => item.code === this.accountCode()),
  );
  private readonly query = computed(() => {
    const code = this.accountCode();
    if (code && this.accounts.value() === null) {
      return null;
    }
    return {
      account: code
        ? (this.accountChoices().find((item) => item.code === code)?.public_id ?? null)
        : null,
      status: this.status(),
      page: this.page(),
    };
  });
  protected readonly list = requestState(
    () => this.api.statementList(untracked(this.query) ?? {}),
    {
      immediate: false,
    },
  );
  protected readonly rows = computed(() => this.list.value()?.results ?? []);
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, TREASURY_ERRORS) : null;
  });
  protected readonly decimals = signal<ReadonlyMap<string, number>>(new Map());
  /** The currency of each account (a statement is in its account's currency). */
  protected readonly currencyOf = computed(
    () => new Map(this.accountChoices().map((item) => [item.public_id, item.currency])),
  );

  protected readonly filterForm = new FormGroup({
    account: new FormControl('', { nonNullable: true }),
    status: new FormControl('', { nonNullable: true }),
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
      if (this.query() && !this.unknownAccount()) {
        untracked(() => this.list.reload());
      }
    });
    effect(() => {
      if (this.list.error()?.kind === 'not-found' && untracked(this.page) > 1) {
        untracked(() => this.navigate({ [PARAM.page]: null }, true));
      }
    });
    effect(() => {
      this.filterForm.setValue({ account: this.accountCode() ?? '', status: this.status() ?? '' });
    });
  }

  protected name(statement: Statement): string {
    return statement.reference || `Relevé du ${isoDay(statement.statement_date)}`;
  }

  protected currency(statement: Statement): string {
    return this.currencyOf().get(statement.treasury_account.public_id) ?? '';
  }

  protected places(statement: Statement): number {
    return this.decimals().get(this.currency(statement)) ?? 0;
  }

  protected statusLook(statement: Statement) {
    return STATEMENT_STATUS[statement.status];
  }

  protected applyFilters(): void {
    const value = this.filterForm.getRawValue();
    this.navigate({
      [PARAM.account]: value.account || null,
      [PARAM.status]: value.status || null,
      [PARAM.page]: null,
    });
  }

  protected resetFilters(): void {
    this.navigate({ [PARAM.account]: null, [PARAM.status]: null, [PARAM.page]: null });
  }

  protected setPage(page: number): void {
    this.navigate({ [PARAM.page]: page > 1 ? page : null });
  }

  protected open(statement: Statement): void {
    void this.router.navigate([statement.public_id], { relativeTo: this.route });
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
