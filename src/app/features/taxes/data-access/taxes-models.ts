/** Where a tax may be chosen: on sales, on purchases, or on both. */
export type TaxUse = 'sale' | 'purchase' | 'both';
export type RecordStatus = 'active' | 'inactive';

/** A tax of the API (`GET taxes/`): its simple form. */
export interface Tax {
  readonly public_id: string;
  /** Made by the server from the name; never shown (a tax is chosen by its name). */
  readonly code: string;
  readonly name: string;
  /** Decimal string, 4 decimals, in percent (« 18.0000 »). */
  readonly rate: string;
  readonly type_tax_use: TaxUse;
  /** Codes of the chart (logical references), blank when none or not this side. */
  readonly sale_account_code: string;
  readonly purchase_account_code: string;
  /** Withheld from the amount due (« retenue à la source ») instead of added. */
  readonly withholding: boolean;
  readonly category: string;
  readonly country: string;
  readonly status: RecordStatus;
  readonly created_at: string;
  readonly updated_at: string;
}

/** What the form sends (`POST taxes/`, `PATCH taxes/<id>/`); the server makes the code. */
export interface TaxWrite {
  readonly name: string;
  readonly rate: string;
  readonly type_tax_use: TaxUse;
  readonly sale_account_code: string;
  readonly purchase_account_code: string;
  readonly withholding: boolean;
}

export interface TaxQuery {
  readonly search?: string;
  readonly status?: RecordStatus | null;
  /** Several: the taxes usable on a sale are « sale » and « both ». */
  readonly uses?: readonly TaxUse[];
  readonly page?: number;
  readonly pageSize?: number;
}

/** « Créer les taxes de Guinée »: the taxes created, the names already taken (kept). */
export interface DefaultTaxes {
  readonly created: readonly Tax[];
  readonly existing: readonly string[];
}

/** `TaxesSettings`: whether a declaration is checked before it is validated. */
export interface TaxSettings {
  readonly declaration_check_required: boolean;
}

export type DeclarationStatus = 'draft' | 'checked' | 'validated' | 'declared' | 'paid';
/** The commands of a declaration, one per step (`taxes/declarations/<id>/<command>/`). */
export type DeclarationCommand = 'check' | 'validate' | 'declare' | 'mark-paid';
export type VatSide = 'sale' | 'purchase';

/** A VAT declaration (`GET taxes/declarations/`); amounts are decimal strings. */
export interface Declaration {
  readonly public_id: string;
  readonly declaration_type: string;
  readonly country: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly status: DeclarationStatus;
  /** What is due from the entries (negative: a VAT credit); frozen once validated. */
  readonly calculated_amount: string;
  /** What is written on the tax form. */
  readonly declared_amount: string;
  /** Declared − calculated. */
  readonly difference: string;
  /** The VAT credit of the previous periods used at the liquidation (note backend 0067). */
  readonly carried_credit: string;
  /** What the liquidation leaves to pay; null until the validation. */
  readonly amount_due: string | null;
  /** The liquidation entry (public id and number), posted at the validation. */
  readonly closing_entry: string | null;
  readonly closing_entry_number: string;
  /** The payment's entry in the bank or cash journal. */
  readonly payment_entry: string | null;
  readonly payment_entry_number: string;
  readonly checked_at: string | null;
  readonly validated_at: string | null;
  readonly declared_at: string | null;
  readonly paid_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** `mark-paid/`: the journal the VAT due is paid from, and when (note backend 0067). */
export interface DeclarationPayment {
  readonly journal: string | null;
  readonly payment_date: string | null;
}

export interface VatLine {
  readonly tax: { readonly public_id: string; readonly code: string; readonly name: string };
  readonly side: VatSide;
  readonly base: string;
  readonly amount: string;
}

/** The record: its VAT as the posted entries give it now, and the commands open to it. */
export interface DeclarationDetail extends Declaration {
  readonly vat: {
    readonly lines: readonly VatLine[];
    readonly collected: string;
    readonly deductible: string;
    readonly payable: string;
  };
  readonly next_steps: readonly DeclarationCommand[];
}
