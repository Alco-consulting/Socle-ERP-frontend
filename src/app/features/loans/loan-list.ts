import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { debounceTime } from 'rxjs';

import { toUserError } from '../../core/errors/user-error';
import { requestState } from '../../core/http/request-state';
import { SessionStore } from '../../core/session/session.store';
import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoAmountPipe } from '../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../shared/tables/table';
import { AlcoBadge } from '../../shared/ui/badge/badge';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoEmptyState } from '../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../shared/ui/pagination/pagination';
import { referencePlaces } from '../currencies/reference-places';
import { LOAN_PAGE_SIZE, LoansApi } from './data-access/loans-api';
import { Loan } from './data-access/loans-models';
import { LOAN_ERRORS, LOAN_STATUS } from './loans-presentation';

/** Comptabilité › Emprunts: each loan, its principal and what remains owed. */
@Component({
  selector: 'alco-loan-list',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoButton,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
    AlcoPagination,
    AlcoTable,
  ],
  templateUrl: './loan-list.html',
  styleUrl: './loans-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoanListPage {
  private readonly api = inject(LoansApi);
  private readonly session = inject(SessionStore);

  protected readonly canCreate = computed(() => this.session.can('loans.create'));
  protected readonly places = referencePlaces();
  protected readonly pageSize = LOAN_PAGE_SIZE;
  protected readonly page = signal(1);
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly loans = requestState(() =>
    this.api.loans({ search: this.search.value.trim(), page: this.page() }),
  );
  protected readonly columns: readonly TableColumn[] = [
    { key: 'name', label: 'Emprunt' },
    { key: 'type', label: 'Type', width: '7rem', hideBelow: 'tablet' },
    { key: 'maturity', label: 'Fin', width: '8rem', hideBelow: 'tablet' },
    { key: 'principal', label: 'Capital', width: '10rem', numeric: true },
    { key: 'outstanding', label: 'Restant dû', width: '10rem', numeric: true },
    { key: 'status', label: 'État', width: '8rem' },
  ];
  protected readonly rowId = (row: Loan) => row.public_id;
  protected readonly loadError = computed(() => {
    const error = this.loans.error();
    return error ? toUserError(error, LOAN_ERRORS) : null;
  });

  constructor() {
    this.search.valueChanges.pipe(debounceTime(300), takeUntilDestroyed()).subscribe(() => {
      this.page.set(1);
      this.loans.reload();
    });
  }

  protected statusLook(row: Loan) {
    return LOAN_STATUS[row.status];
  }

  /** A draft owes nothing yet: its principal is what it will owe. */
  protected outstandingOf(row: Loan): string {
    return row.status === 'draft' ? row.principal_amount : row.position.outstanding;
  }

  protected goTo(page: number): void {
    this.page.set(page);
    this.loans.reload();
  }
}
