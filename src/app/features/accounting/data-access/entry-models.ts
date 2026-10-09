/**
 * Accounting entries as the API gives them (backend/docs/api/openapi.yaml,
 * `AccountingEntry`, `AccountingLine`, write requests). Amounts are decimal strings, never
 * numbers; the state, the number, the period and the rates are the server's.
 */

import { EntryStatus } from './accounting-models';

export type EntryKind = 'standard' | 'reversal' | 'correction';
export type EntryOrigin = 'manual' | 'system';
export type RoundingMode =
  'half_up' | 'half_even' | 'half_down' | 'up' | 'down' | 'ceiling' | 'floor';

/** `AccountingCodeReference`: a related object named by its code. */
export interface CodeReference {
  readonly public_id: string;
  readonly code: string;
}

/** `AccountingLine`. */
export interface EntryLine {
  readonly public_id: string;
  readonly sequence: number;
  readonly account: CodeReference;
  readonly label: string;
  readonly debit: string;
  readonly credit: string;
  readonly reference_debit: string;
  readonly reference_credit: string;
  readonly partner: CodeReference | null;
  readonly tax: CodeReference | null;
  readonly tax_rule: string | null;
  readonly tax_base_amount: string | null;
  readonly analytic_allocation: string | null;
}

/** `AccountingEntry`. `entry_number` is empty until the server validates the entry. */
export interface Entry {
  readonly public_id: string;
  readonly entry_number: string;
  readonly status: EntryStatus;
  readonly kind: EntryKind;
  readonly journal: CodeReference;
  readonly fiscal_year: CodeReference;
  readonly period: CodeReference;
  readonly entry_date: string;
  readonly document_date: string | null;
  readonly document_reference: string;
  readonly description: string;
  readonly currency: string;
  readonly reference_currency: string;
  readonly exchange_rate: string;
  readonly rate_details: unknown;
  readonly rounding: string;
  readonly origin: EntryOrigin;
  readonly source_type: string;
  readonly source_id: string;
  readonly related_entry: string | null;
  readonly reason: string;
  readonly created_by: string;
  readonly created_at: string;
  readonly submitted_by: string | null;
  readonly submitted_at: string | null;
  readonly validated_by: string | null;
  readonly validated_at: string | null;
  readonly locked_by: string | null;
  readonly locked_at: string | null;
  readonly updated_at: string;
  readonly lines: readonly EntryLine[];
}

/** `AccountingLineWriteRequest` (analytics are not written by this screen). */
export interface EntryLineWrite {
  readonly account: string;
  readonly label?: string;
  readonly debit?: string;
  readonly credit?: string;
  readonly partner?: string | null;
  readonly tax?: string | null;
  readonly tax_base_amount?: string | null;
}

/** `AccountingEntryWriteRequest`: only the fields a user enters. */
export interface EntryWrite {
  readonly journal: string;
  readonly entry_date: string;
  readonly description: string;
  readonly document_reference?: string;
  readonly document_date?: string | null;
  readonly currency?: string;
  readonly rounding?: RoundingMode;
  readonly lines: readonly EntryLineWrite[];
}

/**
 * `PatchedAccountingEntryWriteRequest`: the fields changed. The server requires `lines`
 * with a new journal, date, currency or rounding (`accounting_entry_lines_required`).
 */
export type EntryChanges = Partial<EntryWrite>;

/** `AccountingReverseRequest`. */
export interface ReverseRequest {
  readonly entry_date: string;
  readonly reason: string;
  readonly description?: string;
}

/** `AccountingSettings`: what the company's rules say (read only here). */
export interface AccountingSettings {
  readonly submission_required: boolean;
  readonly parent_accounts_postable: boolean;
}

/** Server-side filters of `GET accounting/entries/` (the API has no text search). */
export interface EntryQuery {
  readonly status?: EntryStatus | null;
  readonly kind?: EntryKind | null;
  readonly journal?: string | null;
  readonly fiscalYear?: string | null;
  readonly account?: string | null;
  readonly partner?: string | null;
  readonly dateFrom?: string | null;
  readonly dateTo?: string | null;
  readonly page?: number;
}

/** The commands of the workflow (`POST accounting/entries/{id}/<command>/`). */
export type EntryCommand = 'submit' | 'reject' | 'validate' | 'lock';

/** `TaxesTax`, for the choice of a line's tax. */
export interface TaxOption {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
  /** Odoo's « Type de taxe » (sale, purchase, none): it names the tax in a list. */
  readonly type_tax_use: string;
  readonly category: string;
  readonly country: string;
  readonly status: string;
}
