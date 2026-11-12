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
import { listPaging } from '../../../shared/ui/pagination/page-size';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { isoDay } from '../../accounting/entries/entry-presentation';
import { PartnersApi } from '../../partners/data-access/partners-api';
import {
  Direction,
  OperationStatus,
  OperationType,
  TreasuryOperation,
} from '../data-access/reconciliation-models';
import { TreasuryApi } from '../data-access/treasury-api';
import {
  DIRECTIONS,
  OPERATION_STATUS,
  OPERATION_TYPES,
  TREASURY_ERRORS,
  operationTypeLabel,
} from '../treasury-presentation';

const PARAM = {
  account: 'compte',
  type: 'type',
  direction: 'sens',
  status: 'etat',
  from: 'du',
  to: 'au',
  reference: 'reference',
  reconciled: 'rapprochee',
  page: 'page',
} as const;
const TYPES = OPERATION_TYPES.map((item) => item.id);
const DIRECTION_IDS: readonly Direction[] = ['inflow', 'outflow'];
const STATUSES = Object.keys(OPERATION_STATUS) as OperationStatus[];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Trésorerie › Opérations, on the API (`GET treasury/operations/`): the API's filters only —
 * account (by code, from the company's accounts), type, direction, state, dates, reference,
 * reconciled or not —, its pages; the list's state lives in the URL. Amounts as the server
 * gives them, in their currency's decimals; nothing is summed here.
 */
@Component({
  selector: 'alco-treasury-operation-list',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoAmountPipe,
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
  templateUrl: './operation-list.html',
  styleUrl: '../../accounting/accounting-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreasuryOperationListPage {
  private readonly api = inject(TreasuryApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly session = inject(SessionStore);

  protected readonly types = OPERATION_TYPES;
  protected readonly directions = DIRECTION_IDS.map((id) => ({ id, label: DIRECTIONS[id] }));
  protected readonly statuses = STATUSES.map((id) => ({ id, label: OPERATION_STATUS[id].label }));
  protected readonly day = isoDay;
  protected readonly typeLabel = operationTypeLabel;
  protected readonly canCreate = computed(() => this.session.can('treasury.create'));

  protected readonly columns: readonly TableColumn[] = [
    { key: 'date', label: 'Date', width: '6.5rem' },
    { key: 'reference', label: 'Opération' },
    { key: 'account', label: 'Compte', width: '8rem', hideBelow: 'tablet' },
    { key: 'type', label: 'Type', hideBelow: 'laptop' },
    { key: 'counterparty', label: 'Tiers', hideBelow: 'laptop' },
    { key: 'amount', label: 'Montant', numeric: true },
    { key: 'status', label: 'État', width: '9rem', hideBelow: 'tablet' },
  ];
  protected readonly rowId = (row: TreasuryOperation) => row.public_id;
  protected readonly rowLabel = (row: TreasuryOperation) => this.name(row);

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private readonly param = (name: string) => this.params().get(name)?.trim() || null;
  protected readonly accountCode = computed(() => this.param(PARAM.account)?.toUpperCase() ?? null);
  protected readonly type = computed<OperationType | null>(() => {
    const value = this.param(PARAM.type);
    return TYPES.includes(value as OperationType) ? (value as OperationType) : null;
  });
  protected readonly direction = computed<Direction | null>(() => {
    const value = this.param(PARAM.direction);
    return DIRECTION_IDS.includes(value as Direction) ? (value as Direction) : null;
  });
  protected readonly status = computed<OperationStatus | null>(() => {
    const value = this.param(PARAM.status);
    return STATUSES.includes(value as OperationStatus) ? (value as OperationStatus) : null;
  });
  protected readonly dateFrom = computed(() => this.date(PARAM.from));
  protected readonly dateTo = computed(() => this.date(PARAM.to));
  protected readonly reference = computed(() => this.param(PARAM.reference));
  protected readonly reconciled = computed<boolean | null>(() => {
    const value = this.param(PARAM.reconciled);
    return value === 'oui' ? true : value === 'non' ? false : null;
  });
  protected readonly page = computed(() => Math.max(1, Number(this.params().get(PARAM.page)) || 1));
  /** 20 par page par défaut ; 40, 50 ou 100 au choix, dans l'adresse et retenu. */
  protected readonly paging = listPaging(this.params);
  protected readonly activeFilterCount = computed(
    () =>
      [
        this.accountCode(),
        this.type(),
        this.direction(),
        this.status(),
        this.dateFrom() || this.dateTo(),
        this.reference(),
        this.reconciled() !== null,
      ].filter(Boolean).length,
  );

  /** The company's accounts: the account of the URL is found among them by its code. */
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
    const accounts = this.accounts.value();
    if (code && accounts === null) {
      return null; // the account is found first
    }
    return {
      account: code
        ? (this.accountChoices().find((item) => item.code === code)?.public_id ?? null)
        : null,
      operationType: this.type(),
      direction: this.direction(),
      status: this.status(),
      dateFrom: this.dateFrom(),
      dateTo: this.dateTo(),
      reference: this.reference(),
      reconciled: this.reconciled(),
      page: this.page(),
      pageSize: this.paging.size(),
    };
  });
  protected readonly list = requestState(() => this.api.operations(untracked(this.query) ?? {}), {
    immediate: false,
  });
  protected readonly rows = computed(() => this.list.value()?.results ?? []);
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, TREASURY_ERRORS) : null;
  });
  protected readonly decimals = signal<ReadonlyMap<string, number>>(new Map());

  protected readonly filterForm = new FormGroup({
    account: new FormControl('', { nonNullable: true }),
    type: new FormControl('', { nonNullable: true }),
    direction: new FormControl('', { nonNullable: true }),
    status: new FormControl('', { nonNullable: true }),
    dateFrom: new FormControl('', { nonNullable: true }),
    dateTo: new FormControl('', { nonNullable: true }),
    reference: new FormControl('', { nonNullable: true }),
    reconciled: new FormControl('', { nonNullable: true }),
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
      const query = this.query();
      if (query && !this.unknownAccount()) {
        untracked(() => this.list.reload());
      }
    });
    effect(() => {
      if (this.list.error()?.kind === 'not-found' && untracked(this.page) > 1) {
        untracked(() => this.navigate({ [PARAM.page]: null }, true));
      }
    });
    effect(() => {
      const reconciled = this.reconciled();
      this.filterForm.setValue({
        account: this.accountCode() ?? '',
        type: this.type() ?? '',
        direction: this.direction() ?? '',
        status: this.status() ?? '',
        dateFrom: this.dateFrom() ?? '',
        dateTo: this.dateTo() ?? '',
        reference: this.reference() ?? '',
        reconciled: reconciled === null ? '' : reconciled ? 'oui' : 'non',
      });
    });
  }

  protected places(currency: string): number {
    return this.decimals().get(currency) ?? 0;
  }

  protected statusLook(operation: TreasuryOperation) {
    return OPERATION_STATUS[operation.status];
  }

  protected name(operation: TreasuryOperation): string {
    return operation.reference || operation.description || this.typeLabel(operation.operation_type);
  }

  protected applyFilters(): void {
    const value = this.filterForm.getRawValue();
    this.navigate({
      [PARAM.account]: value.account || null,
      [PARAM.type]: value.type || null,
      [PARAM.direction]: value.direction || null,
      [PARAM.status]: value.status || null,
      [PARAM.from]: value.dateFrom || null,
      [PARAM.to]: value.dateTo || null,
      [PARAM.reference]: value.reference.trim() || null,
      [PARAM.reconciled]: value.reconciled || null,
      [PARAM.page]: null,
    });
  }

  protected resetFilters(): void {
    this.navigate(Object.fromEntries(Object.values(PARAM).map((name) => [name, null])));
  }

  protected setPage(page: number): void {
    this.navigate({ [PARAM.page]: page > 1 ? page : null });
  }

  protected setPageSize(size: number): void {
    this.navigate(this.paging.choose(size, PARAM.page));
  }

  protected open(operation: TreasuryOperation): void {
    void this.router.navigate([operation.public_id], { relativeTo: this.route });
  }

  private date(name: string): string | null {
    const value = this.param(name);
    return value && ISO_DATE.test(value) ? value : null;
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
