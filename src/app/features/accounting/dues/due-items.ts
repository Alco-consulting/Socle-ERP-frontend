import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { APP_ROOT } from '../../../core/navigation/applications';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { DUE_PAGE_SIZE, DueApi } from '../data-access/due-api';
import { DueItem } from '../data-access/due-models';
import { isoDay } from '../entries/entry-presentation';
import { DUE_ERRORS, DUE_ROLES, DUE_STATUS } from './due-presentation';
import { DueScope } from './due-scope';

/**
 * The installments (`GET due-items/`), earliest due first, as the server computed and settled
 * them: due date, amount, settled, open, state. Each opens its record (settlements, schedule,
 * entry). A table from the tablet up, cards on a phone.
 */
@Component({
  selector: 'alco-due-items',
  imports: [
    RouterLink,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoButton,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoLoading,
    AlcoPagination,
    AlcoTable,
  ],
  templateUrl: './due-items.html',
  styleUrls: ['../accounting-list.scss', './due-lists.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoDueItems {
  private readonly api = inject(DueApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly scope = input.required<DueScope>();
  readonly decimals = input<ReadonlyMap<string, number>>(new Map());
  readonly filtered = input(false);
  readonly pageChange = output<number>();
  readonly pastEnd = output<void>();
  readonly resetFilters = output<void>();

  protected readonly pageSize = DUE_PAGE_SIZE;
  protected readonly entriesUrl = `${APP_ROOT}/comptabilite/ecritures`;
  protected readonly day = isoDay;
  protected readonly columns: readonly TableColumn[] = [
    { key: 'due', label: 'Échéance', width: '8rem' },
    { key: 'partner', label: 'Tiers' },
    { key: 'entry', label: 'Écriture' },
    { key: 'amount', label: 'Montant', numeric: true, hideBelow: 'laptop' },
    { key: 'settled', label: 'Réglé', numeric: true, hideBelow: 'laptop' },
    { key: 'open', label: 'Ouvert', numeric: true },
    { key: 'status', label: 'État', width: '9rem' },
  ];
  protected readonly rowId = (row: DueItem) => row.public_id;

  protected readonly list = requestState(
    () => {
      const scope = untracked(this.scope);
      return this.api.items({
        partner: scope.partner,
        account: scope.account,
        role: scope.role,
        status: scope.status,
        dueFrom: scope.dateFrom,
        dueTo: scope.dateTo,
        page: scope.page,
      });
    },
    { immediate: false },
  );
  protected readonly rows = computed(() => this.list.value()?.results ?? []);
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, DUE_ERRORS) : null;
  });

  constructor() {
    effect(() => {
      this.scope();
      untracked(() => this.list.reload());
    });
    effect(() => {
      if (this.list.error()?.kind === 'not-found' && untracked(this.scope).page > 1) {
        untracked(() => this.pastEnd.emit());
      }
    });
  }

  protected statusLook(item: DueItem) {
    return DUE_STATUS[item.status];
  }

  protected roleLabel(item: DueItem): string {
    return DUE_ROLES[item.role];
  }

  protected decimalsOf(currency: string): number {
    return this.decimals().get(currency) ?? 0;
  }

  protected open(item: DueItem): void {
    void this.router.navigate([item.public_id], { relativeTo: this.route });
  }

  protected setPage(page: number): void {
    this.pageChange.emit(page);
  }
}
