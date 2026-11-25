import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';
import {
  DefaultTypes,
  Loan,
  LoanQuery,
  LoanSchedule,
  LoanType,
  LoanTypeWrite,
  LoanWrite,
  Prepayment,
  SimulatedSchedule,
  SimulationRequest,
} from './loans-models';

export const LOAN_PAGE_SIZE = 50;
const TYPE_PAGE_SIZE = 100;

const base = 'loans/';
const id = (value: string) => encodeURIComponent(value);

/** The loans of the API (note backend 0062): types, loans, schedules, payments from a journal. */
@Injectable({ providedIn: 'root' })
export class LoansApi {
  private readonly api = inject(ApiClient);

  types(status: 'active' | null = null): Observable<Paginated<LoanType>> {
    return this.api.get<Paginated<LoanType>>(`${base}types/`, {
      params: { status, page_size: TYPE_PAGE_SIZE },
    });
  }

  type(typeId: string): Observable<LoanType> {
    return this.api.get<LoanType>(`${base}types/${id(typeId)}/`);
  }

  createType(loanType: LoanTypeWrite): Observable<LoanType> {
    return this.api.post<LoanType>(`${base}types/`, loanType);
  }

  updateType(typeId: string, changes: Partial<LoanTypeWrite>): Observable<LoanType> {
    return this.api.patch<LoanType>(`${base}types/${id(typeId)}/`, changes);
  }

  /** « Créer les types usuels », with the company's own accounts. */
  createDefaultTypes(): Observable<DefaultTypes> {
    return this.api.post<DefaultTypes>(`${base}types/defaults/`);
  }

  loans(query: LoanQuery = {}): Observable<Paginated<Loan>> {
    return this.api.get<Paginated<Loan>>(base, {
      params: {
        search: query.search || null,
        page: query.page && query.page > 1 ? query.page : null,
        page_size: LOAN_PAGE_SIZE,
      },
    });
  }

  loan(loanId: string): Observable<Loan> {
    return this.api.get<Loan>(`${base}${id(loanId)}/`);
  }

  createLoan(loan: LoanWrite): Observable<Loan> {
    return this.api.post<Loan>(base, loan);
  }

  updateLoan(loanId: string, changes: Partial<LoanWrite>): Observable<Loan> {
    return this.api.patch<Loan>(`${base}${id(loanId)}/`, changes);
  }

  /** The funds received in a bank or cash journal, posted at once (note backend 0062). */
  activate(loanId: string, journal: string): Observable<Loan> {
    return this.api.post<Loan>(`${base}${id(loanId)}/activate/`, { journal });
  }

  cancel(loanId: string, reason: string): Observable<Loan> {
    return this.api.post<Loan>(`${base}${id(loanId)}/cancel/`, { reason });
  }

  schedule(loanId: string): Observable<LoanSchedule> {
    return this.api.get<LoanSchedule>(`${base}${id(loanId)}/schedule/`);
  }

  simulate(request: SimulationRequest): Observable<SimulatedSchedule> {
    return this.api.post<SimulatedSchedule>(`${base}simulate/`, request);
  }

  /** What remains due on the installment, paid from a bank or cash journal and posted. */
  pay(lineId: string, paymentDate: string, journal: string): Observable<unknown> {
    return this.api.post<unknown>(`${base}installments/${id(lineId)}/pay/`, {
      payment_date: paymentDate,
      journal,
    });
  }

  prepay(loanId: string, prepayment: Prepayment): Observable<unknown> {
    return this.api.post<unknown>(`${base}${id(loanId)}/prepay/`, prepayment);
  }
}
