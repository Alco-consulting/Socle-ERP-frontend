/**
 * Accounting referential as the API gives it (backend/docs/api/openapi.yaml, `accounting`).
 * Every state here is the server's: the front end never decides that a fiscal year or a
 * period is open, a journal active or an account postable.
 */

export type OpenClosed = 'open' | 'closed';
export type ActiveInactive = 'active' | 'inactive';

/** `AccountingFiscalYear`. */
export interface FiscalYear {
  readonly public_id: string;
  readonly code: string;
  readonly label: string;
  readonly start_date: string;
  readonly end_date: string;
  readonly status: OpenClosed;
  readonly created_at: string;
  readonly updated_at: string;
}

/** `AccountingPeriod`. */
export interface Period {
  readonly public_id: string;
  readonly fiscal_year: string;
  readonly code: string;
  readonly label: string;
  readonly start_date: string;
  readonly end_date: string;
  readonly status: OpenClosed;
  readonly created_at: string;
  readonly updated_at: string;
}

export type JournalType = 'general' | 'sales' | 'purchase' | 'bank' | 'cash' | 'other';

/** `AccountingJournal`. */
export interface Journal {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
  readonly journal_type: JournalType;
  readonly default_currency: string | null;
  readonly sequence_prefix: string;
  readonly sequence_padding: number;
  readonly status: ActiveInactive;
  readonly created_at: string;
  readonly updated_at: string;
}

/** `AccountingJournalWriteRequest` (the code is ignored by a PATCH). */
export interface JournalWrite {
  readonly code: string;
  readonly name: string;
  readonly journal_type: JournalType;
  readonly default_currency: string | null;
  readonly sequence_prefix: string;
  readonly sequence_padding: number;
}

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense' | 'other';

/** `AccountingAccount`: `parent` and `has_children` are the hierarchy the server keeps. */
/** `detailed_type` of the API: the account's type, Odoo's list (its nature follows). */
export type DetailedType =
  | 'asset_receivable'
  | 'asset_cash'
  | 'asset_current'
  | 'asset_non_current'
  | 'asset_prepayments'
  | 'asset_fixed'
  | 'liability_payable'
  | 'liability_credit_card'
  | 'liability_current'
  | 'liability_non_current'
  | 'equity'
  | 'equity_unaffected'
  | 'income'
  | 'income_other'
  | 'expense'
  | 'expense_depreciation'
  | 'expense_direct_cost'
  | 'off_balance';

export interface Account {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly parent: string | null;
  readonly account_type: AccountType;
  readonly detailed_type: DetailedType | '';
  /** ISO code; `null`: entries in any currency. */
  readonly currency: string | null;
  /** Journals the account takes entries in (`public_id`s); empty: any journal. */
  readonly allowed_journals: readonly string[];
  /** Taxes proposed on an entry line using the account (`public_id`s). */
  readonly default_taxes: readonly string[];
  /** The code's first two characters, from the server (Odoo's « Groupe »). */
  readonly code_group: string;
  readonly account_class: string;
  readonly allow_entries: boolean;
  /** Its posted lines may be lettered (V2.1 A4). */
  readonly letterable: boolean;
  readonly status: ActiveInactive;
  readonly has_children: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * `AccountingAccountWriteRequest` as the form sends it (the code is ignored by a PATCH):
 * the type, its nature following on the server. The other fields of the API (description,
 * parent, class, entries allowed) are no longer on the form and keep their values.
 */
export interface AccountWrite {
  readonly code: string;
  readonly name: string;
  /** Omitted at the creation: the type the code takes under the chart standard (SYSCOHADA). */
  readonly detailed_type?: DetailedType;
  readonly currency: string | null;
  /** Omitted at the creation: lettered when the type is a customer or a supplier. */
  readonly letterable?: boolean;
  readonly allowed_journals: readonly string[];
  readonly default_taxes: readonly string[];
}

/** `GET accounting/accounts/prefixes/`: accounts per first character, then first two. */
export interface AccountPrefix {
  readonly prefix: string;
  readonly count: number;
  readonly children: readonly { readonly prefix: string; readonly count: number }[];
}

/** Server-side filters of `GET accounting/accounts/`. */
export interface AccountQuery {
  readonly search?: string | null;
  readonly status?: ActiveInactive | null;
  readonly accountType?: AccountType | null;
  /** Accounts an entry may use, as the server decides (settings included). */
  readonly postable?: boolean | null;
  /** The code starts with these characters (the chart browsed by its codes). */
  readonly codePrefix?: string | null;
  readonly page?: number;
}

/** Server-side filters of `GET accounting/journals/` (no text search in the API). */
export interface JournalQuery {
  readonly code?: string | null;
  readonly status?: ActiveInactive | null;
  readonly journalType?: JournalType | null;
  readonly page?: number;
}

/** `EntryStatus` of the API (for the counts of the dashboard only). */
export type EntryStatus = 'draft' | 'submitted' | 'validated' | 'locked';
