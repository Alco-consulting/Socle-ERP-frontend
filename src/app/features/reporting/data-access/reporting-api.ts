import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from '../../../core/http/api-client';
import {
  AccountLedger,
  BalanceQuery,
  BalanceSheet,
  GeneralLedger,
  GeneralLedgerQuery,
  IncomeStatement,
  PartnersLedger,
  PartnersLedgerQuery,
  LedgerQuery,
  PartnerLedger,
  TrialBalance,
} from './reporting-models';

/** Lines per page of a ledger. */
export const LEDGER_PAGE_SIZE = 50;
/** Accounts per page of the balance: the server's most, a company's whole balance in practice. */
export const BALANCE_PAGE_SIZE = 200;
/** Lines of an unfolded account of the general ledger, then « Charger plus », as Odoo's. */
export const GENERAL_LEDGER_LINES = 80;

const id = (value: string) => encodeURIComponent(value);

/**
 * Reporting's ledgers and trial balance (`reporting/`), company scoped by the interceptor:
 * one experience of the ledger, on the paginated report of the server (never the accounting
 * module's consultation ledger).
 */
@Injectable({ providedIn: 'root' })
export class ReportingApi {
  private readonly api = inject(ApiClient);

  /** `reporting.read`. */
  accountLedger(accountId: string, query: LedgerQuery): Observable<AccountLedger> {
    return this.api.get<AccountLedger>(`reporting/ledger/${id(accountId)}/`, {
      params: {
        fiscal_year: query.fiscalYear,
        date_from: query.dateFrom ?? null,
        date_to: query.dateTo ?? null,
        include_descendants: query.includeDescendants ? true : null,
        journal: query.journals ?? [],
        include_unposted: query.includeUnposted ? true : null,
        page: query.page && query.page > 1 ? query.page : null,
        page_size: query.pageSize ?? LEDGER_PAGE_SIZE,
      },
    });
  }

  /** `reporting.read`: Odoo's « Balance comptable » (notes backend 0051, 0052). */
  balance(query: BalanceQuery): Observable<TrialBalance> {
    return this.api.get<TrialBalance>('reporting/balance/', {
      params: {
        date_from: query.dateFrom,
        date_to: query.dateTo,
        column_from: query.earlier.map((period) => period.from),
        column_to: query.earlier.map((period) => period.to),
        journal: query.journals,
        include_unposted: query.includeUnposted ? true : null,
        search: query.search || null,
        page: query.page > 1 ? query.page : null,
        page_size: BALANCE_PAGE_SIZE,
      },
    });
  }

  /** `reporting.read`: Odoo's « Grand livre général » (note backend 0053). */
  generalLedger(query: GeneralLedgerQuery): Observable<GeneralLedger> {
    return this.api.get<GeneralLedger>('reporting/general-ledger/', {
      params: {
        date_from: query.dateFrom,
        date_to: query.dateTo,
        account: query.account,
        journal: query.journals,
        include_unposted: query.includeUnposted ? true : null,
        search: query.search || null,
        page: query.page > 1 ? query.page : null,
        page_size: BALANCE_PAGE_SIZE,
      },
    });
  }

  /** `reporting.read_financial_statements`: the compte de résultat (note backend 0055). */
  incomeStatement(dateFrom: string, dateTo: string): Observable<IncomeStatement> {
    return this.api.get<IncomeStatement>('reporting/income-statement/', {
      params: { date_from: dateFrom, date_to: dateTo },
    });
  }

  /** `reporting.read_financial_statements`: the bilan at `dateTo` (note backend 0056). */
  balanceSheet(dateFrom: string, dateTo: string): Observable<BalanceSheet> {
    return this.api.get<BalanceSheet>('reporting/balance-sheet/', {
      params: { date_from: dateFrom, date_to: dateTo },
    });
  }

  /** `reporting.read_auxiliary`. */
  partnerLedger(partnerId: string, query: LedgerQuery): Observable<PartnerLedger> {
    return this.api.get<PartnerLedger>(`reporting/partners/${id(partnerId)}/ledger/`, {
      params: {
        fiscal_year: query.fiscalYear,
        date_from: query.dateFrom ?? null,
        date_to: query.dateTo ?? null,
        journal: query.journals ?? [],
        include_unposted: query.includeUnposted ? true : null,
        tiers: query.tiers ?? [],
        page: query.page && query.page > 1 ? query.page : null,
        page_size: query.pageSize ?? LEDGER_PAGE_SIZE,
      },
    });
  }

  /** `reporting.read_auxiliary`: Odoo's « Grand livre des partenaires » (note backend 0054). */
  partnersLedger(query: PartnersLedgerQuery): Observable<PartnersLedger> {
    return this.api.get<PartnersLedger>('reporting/partner-ledger/', {
      params: {
        date_from: query.dateFrom,
        date_to: query.dateTo,
        partner: query.partner,
        tiers: query.tiers,
        journal: query.journals,
        include_unposted: query.includeUnposted ? true : null,
        search: query.search || null,
        page: query.page > 1 ? query.page : null,
        page_size: BALANCE_PAGE_SIZE,
      },
    });
  }
}
