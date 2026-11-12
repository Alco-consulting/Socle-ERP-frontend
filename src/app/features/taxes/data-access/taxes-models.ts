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
