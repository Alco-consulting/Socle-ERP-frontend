/**
 * Shapes of the aged balance contract (V2.1, lot A5: `reporting/aged-balance/`,
 * `reporting/aging-policy/`). Buckets, amounts, days past due: the server's, never computed
 * here. Amounts are decimal strings in the company's reference currency.
 */

export type AgingRole = 'customer' | 'supplier';

/** A bucket of the company's policy: `not_due`, `1-30`, …, `121+`. */
export interface AgingBucket {
  readonly code: string;
  readonly first_day: number | null;
  readonly last_day: number | null;
}

export interface BucketAmount {
  readonly code: string;
  readonly amount: string;
}

export interface AgedAmounts {
  readonly buckets: readonly BucketAmount[];
  readonly total: string;
  readonly unscheduled: string;
  readonly unapplied: string;
  readonly balance: string;
}

export interface AgedPartnerRef {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
}

export interface AgedPartnerRow extends AgedAmounts {
  readonly partner: AgedPartnerRef;
  readonly oldest_due_date: string | null;
}

/** `GET reporting/aged-balance/`: header and a page of partners. */
export interface AgedBalance {
  readonly as_of: string;
  readonly role: AgingRole;
  readonly currency: string;
  readonly buckets: readonly AgingBucket[];
  readonly totals: AgedAmounts;
  readonly count: number;
  readonly next: string | null;
  readonly previous: string | null;
  readonly results: readonly AgedPartnerRow[];
}

export type AgedDocumentKind = 'installment' | 'unscheduled' | 'unapplied';

export interface AgedDocument {
  readonly kind: AgedDocumentKind;
  readonly due_item: string | null;
  readonly schedule: string | null;
  readonly line: string;
  readonly entry: {
    readonly public_id: string;
    readonly entry_number: string;
    readonly entry_date: string;
  };
  readonly account: string;
  readonly document_reference: string;
  readonly label: string;
  readonly due_date: string | null;
  readonly days_past_due: number | null;
  readonly bucket: string | null;
  readonly amount: string;
  readonly open_amount: string;
}

/** `GET reporting/aged-balance/partners/<id>/`: header, the partner and a page of documents. */
export interface AgedPartner {
  readonly as_of: string;
  readonly role: AgingRole;
  readonly currency: string;
  readonly buckets: readonly AgingBucket[];
  readonly totals: AgedAmounts;
  readonly partner: AgedPartnerRef;
  readonly count: number;
  readonly next: string | null;
  readonly previous: string | null;
  readonly results: readonly AgedDocument[];
}

/** `GET`/`PUT reporting/aging-policy/`. */
export interface AgingPolicy {
  readonly limits: readonly number[];
  readonly default: boolean;
  readonly buckets: readonly AgingBucket[];
}
