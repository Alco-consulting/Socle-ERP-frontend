/**
 * Partners as the API gives them (backend/docs/api/openapi.yaml, `partners`). Nothing is
 * added: no field, no state, no rule of our own.
 */

export type PartnerStatus = 'active' | 'inactive';

/** `role` filter of the list: customers, suppliers, or neither. */
export type PartnerRole = 'customer' | 'supplier' | 'other';

/** `PartnersPartnerSummary`: a row of the list. */
export interface PartnerSummary {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
  readonly legal_name: string;
  readonly is_customer: boolean;
  readonly is_supplier: boolean;
  readonly country: string;
  readonly tax_identifier: string;
  readonly status: PartnerStatus;
}

/** `PartnersPaymentTerm`. */
export interface PaymentTerm {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
  readonly status: PartnerStatus;
  readonly lines: readonly { sequence: number; percentage: string; days: number }[];
}

/** `PartnersPartner`: the record. */
export interface Partner extends PartnerSummary {
  readonly registration_number: string;
  readonly address: string;
  readonly city: string;
  readonly phone: string;
  readonly email: string;
  readonly default_currency: string | null;
  readonly customer_payment_term: PaymentTerm | null;
  readonly supplier_payment_term: PaymentTerm | null;
  readonly default_tax_code: string;
  readonly customer_account_code: string;
  readonly supplier_account_code: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * `PartnersPartnerWriteRequest`: exactly the writable fields (never `public_id`, `status`,
 * `company` nor dates). `accounting_settings` is left out: no screen edits it yet.
 */
export interface PartnerWrite {
  readonly code: string;
  readonly name: string;
  readonly legal_name: string;
  readonly is_customer: boolean;
  readonly is_supplier: boolean;
  readonly tax_identifier: string;
  readonly registration_number: string;
  readonly country: string;
  readonly address: string;
  readonly city: string;
  readonly phone: string;
  readonly email: string;
  readonly default_currency: string | null;
  readonly customer_payment_term: string | null;
  readonly supplier_payment_term: string | null;
  readonly default_tax_code: string;
  readonly customer_account_code: string;
  readonly supplier_account_code: string;
}

/** The code is never changed after creation (the API ignores it in a PATCH). */
export type PartnerUpdate = Partial<Omit<PartnerWrite, 'code'>>;

/** Server-side filters of `GET partners/` (all optional). */
export interface PartnerQuery {
  readonly search?: string | null;
  readonly role?: PartnerRole | null;
  readonly status?: PartnerStatus | null;
  readonly country?: string | null;
  readonly page?: number;
  readonly pageSize?: number;
}

/** `CurrenciesCurrency` (shared ISO catalogue). */
export interface CurrencyOption {
  readonly code: string;
  readonly name: string;
  /** Precision of the currency (display of amounts only; the server rounds). */
  readonly decimal_places: number;
  readonly status: PartnerStatus;
}
