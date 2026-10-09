/** `active` / `inactive`: a currency of the catalogue is offered only when active. */
export type CurrencyStatus = 'active' | 'inactive';

/** Where the symbol is written: « $ 100 » (`before`), « 100 GNF » (`after`). */
export type SymbolPosition = 'before' | 'after';

/** A currency of the shared ISO 4217 catalogue (`GET currencies/`). */
export interface Currency {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
  readonly symbol: string;
  readonly decimal_places: number;
  readonly status: CurrencyStatus;
  readonly position: SymbolPosition;
  /** « Unité monétaire » (« Dollars ») and « Sous-unité monétaire » (« Cents »). */
  readonly unit_label: string;
  readonly subunit_label: string;
}

/** What the form sends: the code and decimal places only at creation (never changed). */
export interface CurrencyWrite {
  readonly name: string;
  readonly symbol: string;
  readonly position: SymbolPosition;
  readonly unit_label: string;
  readonly subunit_label: string;
}

export interface CurrencyCreate extends CurrencyWrite {
  readonly code: string;
  readonly decimal_places: number;
}

export interface CurrencyQuery {
  readonly search?: string;
  readonly status?: CurrencyStatus | null;
  readonly page?: number;
}

/**
 * `1 currency = rate quote_currency` on `rate_date`, for the active company: the quote is its
 * reference currency (« GNF par unité »). Never changed: a wrong rate is withdrawn.
 */
export interface CurrencyRate {
  readonly public_id: string;
  readonly currency: string;
  readonly quote_currency: string;
  /** Decimal string, 12 decimals (« 8650.000000000000 »). */
  readonly rate: string;
  readonly rate_date: string;
  readonly source: string;
  readonly retrieved_at: string | null;
  readonly status: 'active' | 'withdrawn';
  readonly created_at: string;
}

export interface RateWrite {
  readonly currency: string;
  readonly rate: string;
  readonly rate_date: string;
  readonly source: string;
}
