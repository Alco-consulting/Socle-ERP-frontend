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
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { SessionStore } from '../../../core/session/session.store';
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
import { Transfer } from '../data-access/reconciliation-models';
import { TREASURY_PAGE_SIZE, TreasuryApi } from '../data-access/treasury-api';
import { OPERATION_STATUS, TREASURY_ERRORS } from '../treasury-presentation';

/**
 * Trésorerie › Virements, on the API (`GET treasury/transfers/`, pages only: the API has no
 * filter): source and destination accounts, date, amounts, and the state of its legs as
 * the server gives them (a transfer has no state of its own; its two operations move
 * together).
 */
@Component({
  selector: 'alco-treasury-transfer-list',
  imports: [
    RouterLink,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoButton,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoLoading,
    AlcoPageHeader,
    AlcoPagination,
    AlcoTable,
  ],
  templateUrl: './transfer-list.html',
  styleUrl: '../../accounting/accounting-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreasuryTransferListPage {
  private readonly api = inject(TreasuryApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly session = inject(SessionStore);

  protected readonly pageSize = TREASURY_PAGE_SIZE;
  protected readonly day = isoDay;
  protected readonly canCreate = computed(() => this.session.can('treasury.create'));
  protected readonly columns: readonly TableColumn[] = [
    { key: 'date', label: 'Date', width: '6.5rem' },
    { key: 'reference', label: 'Virement' },
    { key: 'route', label: 'De → vers' },
    { key: 'amount', label: 'Montant', numeric: true },
    { key: 'status', label: 'État', width: '9rem', hideBelow: 'tablet' },
  ];
  protected readonly rowId = (row: Transfer) => row.public_id;
  protected readonly rowLabel = (row: Transfer) => this.name(row);

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly page = computed(() => Math.max(1, Number(this.params().get('page')) || 1));
  protected readonly list = requestState(() => this.api.transfers(untracked(this.page)), {
    immediate: false,
  });
  protected readonly rows = computed(() => this.list.value()?.results ?? []);
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, TREASURY_ERRORS) : null;
  });
  protected readonly decimals = signal<ReadonlyMap<string, number>>(new Map());

  constructor() {
    inject(PartnersApi)
      .currencies()
      .pipe(
        map((page) => new Map(page.results.map((item) => [item.code, item.decimal_places]))),
        catchError(() => of(new Map<string, number>())),
      )
      .subscribe((decimals) => this.decimals.set(decimals));
    effect(() => {
      this.page();
      untracked(() => this.list.reload());
    });
    effect(() => {
      if (this.list.error()?.kind === 'not-found' && untracked(this.page) > 1) {
        untracked(() => this.navigate({ page: null }, true));
      }
    });
  }

  protected name(transfer: Transfer): string {
    return (
      transfer.reference || transfer.description || `Virement du ${isoDay(transfer.transfer_date)}`
    );
  }

  /** The source leg (the outflow), as the server gave it: its currency and state. */
  protected source(transfer: Transfer) {
    return (
      transfer.operations.find((item) => item.direction === 'outflow') ?? transfer.operations[0]
    );
  }

  protected places(currency: string | undefined): number {
    return currency ? (this.decimals().get(currency) ?? 0) : 0;
  }

  protected statusLook(transfer: Transfer) {
    const leg = this.source(transfer);
    return leg ? OPERATION_STATUS[leg.status] : null;
  }

  protected setPage(page: number): void {
    this.navigate({ page: page > 1 ? page : null });
  }

  protected open(transfer: Transfer): void {
    void this.router.navigate([transfer.public_id], { relativeTo: this.route });
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
