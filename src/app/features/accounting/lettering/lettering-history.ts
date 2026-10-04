import { DatePipe } from '@angular/common';
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
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { LETTERING_PAGE_SIZE, LetteringApi } from '../data-access/lettering-api';
import { Lettering } from '../data-access/lettering-models';
import { LETTERING_ERRORS, LETTERING_KINDS, LETTERING_STATUS } from './lettering-presentation';
import { LetteringScope } from './lettering-scope';

/**
 * The letterings made (`GET letterings/`), active and cancelled: a cancelled lettering stays,
 * with who, when and why. Each opens its record (lines, unlettering, history).
 */
@Component({
  selector: 'alco-lettering-history',
  imports: [
    DatePipe,
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
  templateUrl: './lettering-history.html',
  styleUrls: ['../accounting-list.scss', './lettering-history.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoLetteringHistory {
  private readonly api = inject(LetteringApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly scope = input.required<LetteringScope>();
  readonly decimals = input<ReadonlyMap<string, number>>(new Map());
  readonly filtered = input(false);
  readonly pageChange = output<number>();
  readonly pastEnd = output<void>();
  readonly resetFilters = output<void>();

  protected readonly pageSize = LETTERING_PAGE_SIZE;
  protected readonly columns: readonly TableColumn[] = [
    { key: 'reference', label: 'Référence', width: '9rem' },
    { key: 'date', label: 'Date', width: '7rem' },
    { key: 'subject', label: 'Compte · tiers' },
    { key: 'kind', label: 'Nature', hideBelow: 'laptop' },
    { key: 'amount', label: 'Montant lettré', numeric: true },
    { key: 'status', label: 'État', width: '7rem' },
  ];
  protected readonly rowId = (row: Lettering) => row.public_id;

  protected readonly list = requestState(
    () => {
      const scope = untracked(this.scope);
      return this.api.letterings({
        account: scope.account,
        partner: scope.partner,
        status: scope.letteringStatus,
        reference: scope.reference,
        dateFrom: scope.dateFrom,
        dateTo: scope.dateTo,
        page: scope.page,
      });
    },
    { immediate: false },
  );
  protected readonly rows = computed(() => this.list.value()?.results ?? []);
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, LETTERING_ERRORS) : null;
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

  protected kindLabel(lettering: Lettering): string {
    return LETTERING_KINDS[lettering.kind];
  }

  protected statusLook(lettering: Lettering) {
    return LETTERING_STATUS[lettering.status];
  }

  protected decimalsOf(currency: string): number {
    return this.decimals().get(currency) ?? 0;
  }

  protected open(lettering: Lettering): void {
    void this.router.navigate([lettering.public_id], { relativeTo: this.route });
  }

  protected setPage(page: number): void {
    this.pageChange.emit(page);
  }
}
