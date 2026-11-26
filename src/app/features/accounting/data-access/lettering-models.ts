/**
 * Shapes of the lettering contract (V2.1, lot A4: `backend/docs/api/openapi.yaml`, schemas
 * `AccountingLetterableLine`, `AccountingLettering`, `AccountingPreview`, `AccountingProposal`).
 * Amounts are the API's decimal strings (reference currency, 6 places), never numbers.
 */

/** `Accounting_Reference`. */
export interface LetteringReference {
  readonly public_id: string;
  readonly code: string;
}

/** `Accounting_EntryReference`. */
export interface EntryReference {
  readonly public_id: string;
  readonly entry_number: string;
}

export type LetteringSide = 'debit' | 'credit';

/** State of a line, as the server computes it. */
export type LineLetteringStatus = 'open' | 'partial' | 'lettered';

/** `status` filter of `GET letterable-lines/`: `open` includes partly lettered lines. */
export type LineStatusFilter = 'open' | 'lettered';

export type LetteringStatus = 'active' | 'cancelled';
export type LetteringKind = 'manual' | 'automatic';

/** `AccountingLetterableLine`: a posted line of a letterable account. */
export interface LetterableLine {
  readonly public_id: string;
  readonly entry: EntryReference;
  readonly entry_date: string;
  /** The journal's code. */
  readonly journal: string;
  readonly document_reference: string;
  readonly account: LetteringReference;
  readonly partner: LetteringReference | null;
  readonly label: string;
  readonly side: LetteringSide;
  readonly currency: string;
  readonly amount: string;
  readonly lettered_amount: string;
  readonly open_amount: string;
  readonly status: LineLetteringStatus;
}

/** `AccountingLetteringItem`: the amount lettered on one line. */
export interface LetteringItem {
  readonly line: string;
  readonly entry: EntryReference;
  readonly entry_date: string;
  readonly side: LetteringSide;
  readonly amount: string;
}

/** `AccountingLettering`: never modified; cancelled by `unletter/`, kept with who, when, why. */
export interface Lettering {
  readonly public_id: string;
  readonly reference: string;
  readonly kind: LetteringKind;
  readonly status: LetteringStatus;
  readonly account: LetteringReference;
  readonly partner: LetteringReference | null;
  readonly currency: string;
  readonly amount: string;
  /** A line kept a residual open when it was made. */
  readonly partial: boolean;
  readonly created_by: string;
  readonly created_at: string;
  readonly cancelled_by: string | null;
  readonly cancelled_at: string | null;
  readonly cancellation_reason: string;
  readonly items: readonly LetteringItem[];
}

/** `AccountingPreviewRow`: what the lettering would do on one line. */
export interface PreviewRow {
  readonly line: string;
  readonly entry: EntryReference;
  readonly side: LetteringSide;
  readonly open_amount: string;
  readonly amount: string;
  readonly residual: string;
}

/** `AccountingPreview`: the server's result, nothing written. */
export interface LetteringPreview {
  readonly account: LetteringReference;
  readonly partner: LetteringReference | null;
  readonly debit_total: string;
  readonly credit_total: string;
  readonly amount: string;
  readonly balanced: boolean;
  readonly partial: boolean;
  readonly rows: readonly PreviewRow[];
}

/** `AccountingProposalLine`. */
export interface ProposalLine {
  readonly public_id: string;
  readonly entry: EntryReference;
  readonly entry_date: string;
  readonly label: string;
}

/** `AccountingProposal`: a debit and a credit line the server proposes to letter together. */
export interface LetteringProposal {
  readonly account: LetteringReference;
  readonly partner: LetteringReference | null;
  readonly currency: string;
  readonly amount: string;
  readonly debit: ProposalLine;
  readonly credit: ProposalLine;
}

/** `AccountingLetteringWriteRequest` (`write_off` is never sent: the account is enough). */
export interface LetteringRequest {
  readonly lines: readonly string[];
  readonly allow_partial: boolean;
  /** The difference between the sides goes to this account; all lettered in full (note 0065). */
  readonly write_off_account?: string | null;
  readonly idempotency_key?: string;
}

/** `AccountingProposalConfirmRequest`. */
export interface ProposalConfirmRequest {
  readonly debit: string;
  readonly credit: string;
  readonly idempotency_key?: string;
}

/** Server-side filters of `GET letterable-lines/` (public ids). */
export interface LetterableLineFilters {
  readonly account?: string | null;
  readonly partner?: string | null;
  readonly status?: LineStatusFilter | null;
  readonly dateFrom?: string | null;
  readonly dateTo?: string | null;
  readonly lettering?: string | null;
  readonly page?: number;
}

/** Server-side filters of `GET letterings/` (public ids). */
export interface LetteringFilters {
  readonly account?: string | null;
  readonly partner?: string | null;
  readonly status?: LetteringStatus | null;
  readonly reference?: string | null;
  readonly dateFrom?: string | null;
  readonly dateTo?: string | null;
  readonly page?: number;
}
