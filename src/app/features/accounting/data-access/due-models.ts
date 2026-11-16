/**
 * Shapes of the due dates contract (V2.1, lot A5: `backend/docs/api/openapi.yaml`, schemas
 * `AccountingDueItem`, `AccountingDueItemDetail`, `AccountingDueSchedule`,
 * `AccountingPendingLine`). Amounts are the API's decimal strings (reference currency,
 * 6 places); dates are ISO dates. Every due date, amount and state is the server's.
 */

export type DueRole = 'customer' | 'supplier';
export type DueItemStatus = 'open' | 'partial' | 'settled';

export interface DueReference {
  readonly public_id: string;
  readonly code: string;
}

export interface DuePartnerReference extends DueReference {
  readonly name: string;
}

export interface DueEntryReference {
  readonly public_id: string;
  readonly entry_number: string;
  readonly entry_date: string;
}

/** `AccountingDueItem`: one installment. */
export interface DueItem {
  readonly public_id: string;
  /** The schedule's public id. */
  readonly schedule: string;
  readonly sequence: number;
  readonly due_date: string;
  readonly percentage: string;
  readonly partner: DuePartnerReference;
  readonly role: DueRole;
  readonly account: DueReference;
  readonly entry: DueEntryReference;
  readonly line: string;
  readonly currency: string;
  readonly amount: string;
  readonly settled_amount: string;
  readonly open_amount: string;
  readonly status: DueItemStatus;
  readonly last_settled_on: string | null;
}

/** The part of an installment settled by one lettering. */
export interface DueSettlement {
  readonly lettering: { readonly public_id: string; readonly reference: string };
  readonly amount: string;
  readonly settled_on: string;
}

export interface DueItemDetail extends DueItem {
  readonly settlements: readonly DueSettlement[];
}

/** An installment inside its schedule. */
export interface ScheduleItem {
  readonly public_id: string;
  readonly sequence: number;
  readonly due_date: string;
  readonly percentage: string;
  readonly amount: string;
  readonly settled_amount: string;
  readonly open_amount: string;
  readonly status: DueItemStatus;
  readonly last_settled_on: string | null;
}

/** `AccountingDueSchedule`. */
export interface DueSchedule {
  readonly public_id: string;
  readonly line: string;
  readonly entry: DueEntryReference;
  readonly partner: DuePartnerReference;
  readonly account: DueReference;
  readonly role: DueRole;
  /** Le délai appliqué, en jours après la date de référence (0 : à réception). */
  readonly payment_days: number;
  readonly reference_date: string;
  readonly currency: string;
  readonly amount: string;
  readonly created_at: string;
  readonly recomputed_at: string | null;
  readonly items: readonly ScheduleItem[];
}

/** `AccountingPendingLine`: an invoice line without due dates yet. */
export interface PendingLine {
  readonly public_id: string;
  readonly entry: DueEntryReference;
  readonly document_date: string | null;
  readonly partner: DuePartnerReference;
  readonly account: DueReference;
  readonly role: DueRole;
  readonly label: string;
  readonly currency: string;
  readonly amount: string;
}

/** Server-side filters of `GET due-items/` (public ids). */
export interface DueItemFilters {
  readonly partner?: string | null;
  readonly account?: string | null;
  readonly role?: DueRole | null;
  readonly status?: DueItemStatus | null;
  readonly dueFrom?: string | null;
  readonly dueTo?: string | null;
  readonly entry?: string | null;
  readonly page?: number;
}

/** Server-side filters of `GET due-schedules/pending-lines/` (public ids). */
export interface PendingLineFilters {
  readonly role?: DueRole | null;
  readonly partner?: string | null;
  readonly account?: string | null;
  readonly dateFrom?: string | null;
  readonly dateTo?: string | null;
  readonly page?: number;
}

/** `AccountingRecomputeRequest`. */
export interface RecomputeRequest {
  readonly reason: string;
  /** De 0 à 365 jours ; absent : le délai du tiers, tel qu'il est aujourd'hui. */
  readonly payment_days?: number;
  readonly reference_date?: string;
}
