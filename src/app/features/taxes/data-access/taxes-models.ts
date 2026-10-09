/** Odoo's « Type de taxe ». */
export type TaxUse = 'sale' | 'purchase' | 'none';
/** Odoo's « Portée de la taxe »; empty: goods and services. */
export type TaxScope = '' | 'consu' | 'service';
/** Odoo's « Calcul de la taxe » (only the percentage is computed by the server). */
export type AmountType = 'percent';
/** Odoo's « Inclus dans le prix »; empty: « Par défaut ». */
export type PriceInclusion = '' | 'tax_included' | 'tax_excluded';
/** Odoo's « Basé sur » of a repartition line. */
export type RepartitionType = 'base' | 'tax';
export type RecordStatus = 'active' | 'inactive';

/** A line of « Répartition pour les factures » or « … pour les notes de crédit ». */
export interface RepartitionLine {
  readonly repartition_type: RepartitionType;
  /** Decimal string, signed; 100 for the base line. */
  readonly factor_percent: string;
  /** A code of the chart (logical reference), or empty. */
  readonly account_code: string;
  /** Odoo's « Grilles de taxes ». */
  readonly grids: readonly string[];
}

/** A tax of the API (`GET taxes/`), as Odoo's form shows it. */
export interface Tax {
  readonly public_id: string;
  /** Made by the server from the name; never shown (Odoo names a tax). */
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly country: string;
  readonly status: RecordStatus;
  readonly type_tax_use: TaxUse;
  readonly tax_scope: TaxScope;
  readonly amount_type: AmountType;
  /** Decimal string, 4 decimals. */
  readonly amount: string;
  readonly price_include_override: PriceInclusion;
  readonly include_base_amount: boolean;
  readonly description: string;
  readonly invoice_label: string;
  /** Odoo's « Groupe de taxes », by its name ('' : none). */
  readonly heading: string;
  readonly fiscal_positions: readonly string[];
  readonly tax_category_code: string;
  readonly legal_notes: string;
  readonly invoice_lines: readonly RepartitionLine[];
  readonly refund_lines: readonly RepartitionLine[];
  readonly created_at: string;
  readonly updated_at: string;
}

/** What the form sends (`POST taxes/`, `PATCH taxes/<id>/`); the server makes the code. */
export interface TaxWrite {
  readonly name: string;
  readonly country: string;
  readonly type_tax_use: TaxUse;
  readonly tax_scope: TaxScope;
  readonly amount_type: AmountType;
  readonly amount: string;
  readonly price_include_override: PriceInclusion;
  readonly include_base_amount: boolean;
  readonly description: string;
  readonly invoice_label: string;
  readonly heading: string;
  readonly fiscal_positions: readonly string[];
  readonly tax_category_code: string;
  readonly legal_notes: string;
  readonly invoice_lines: readonly RepartitionLine[];
  readonly refund_lines: readonly RepartitionLine[];
}

export interface TaxQuery {
  readonly search?: string;
  readonly status?: RecordStatus | null;
  /** Several: Odoo's « Ventes ou Achats » is both. */
  readonly uses?: readonly TaxUse[];
  readonly page?: number;
}

/** A « Groupe de taxes » or a « Position fiscale » of the company. */
export interface NamedRecord {
  readonly public_id: string;
  readonly name: string;
}
