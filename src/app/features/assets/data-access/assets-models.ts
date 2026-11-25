/** A reference of the API: its public id and code. */
export interface CodeRef {
  readonly public_id: string;
  readonly code: string;
}

export type RecordStatus = 'active' | 'inactive';
export type AssetStatus = 'draft' | 'acquired' | 'in_service' | 'disposed' | 'cancelled';
export type DepreciationMethod = 'linear' | 'declining';
export type LineStatus = 'planned' | 'recorded' | 'accounted' | 'superseded' | 'cancelled';
export type DisposalKind = 'sale' | 'scrapping' | 'other';

/** `AssetsCategory`: the accounts, journal and usual duration of a kind of asset. */
export interface AssetCategory {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
  readonly status: RecordStatus;
  readonly journal: CodeRef | null;
  readonly asset_account: CodeRef | null;
  readonly accumulated_depreciation_account: CodeRef | null;
  readonly depreciation_expense_account: CodeRef | null;
  readonly disposal_value_account: CodeRef | null;
  readonly disposal_proceeds_account: CodeRef | null;
  readonly default_method: DepreciationMethod;
  readonly default_duration_months: number;
}

/** What the category form sends; accounts and journal by public id (`null`: none). */
export interface CategoryWrite {
  readonly code: string;
  readonly name: string;
  readonly journal: string | null;
  readonly asset_account: string | null;
  readonly accumulated_depreciation_account: string | null;
  readonly depreciation_expense_account: string | null;
  readonly disposal_value_account: string | null;
  readonly disposal_proceeds_account: string | null;
  readonly default_method: DepreciationMethod;
  readonly default_duration_months: number;
  readonly default_prorata: 'none' | 'daily';
  readonly default_residual_rule: 'last_period' | 'exact';
}

/** « Créer les catégories usuelles »: those created, the names already there (kept). */
export interface DefaultCategories {
  readonly created: readonly AssetCategory[];
  readonly existing: readonly string[];
}

/** Computed by the server, in the reference currency; never stored. */
export interface AssetValues {
  readonly gross_value: string;
  readonly residual_value: string;
  readonly accumulated_depreciation: string;
  readonly accumulated_impairment: string;
  readonly net_book_value: string;
  readonly fully_depreciated: boolean;
}

export interface Asset {
  readonly public_id: string;
  /** Given by the server when the asset is confirmed (« MAT-000001 »). */
  readonly code: string;
  readonly name: string;
  readonly reference: string;
  readonly category: CodeRef;
  readonly status: AssetStatus;
  readonly acquisition_date: string;
  readonly commissioning_date: string | null;
  readonly disposal_date: string | null;
  readonly currency: string;
  readonly gross_value: string;
  readonly residual_value: string;
  readonly values: AssetValues | null;
  readonly method: DepreciationMethod;
  readonly duration_months: number;
  readonly partner: CodeRef | null;
  readonly reason: string;
}

export interface AssetWrite {
  readonly category: string;
  readonly name: string;
  readonly reference: string;
  readonly acquisition_date: string;
  readonly currency: string;
  readonly gross_value: string;
  readonly duration_months: number;
  readonly partner: string | null;
}

export interface AssetQuery {
  readonly search?: string;
  readonly status?: AssetStatus | null;
  readonly page?: number;
}

export interface DepreciationLine {
  readonly public_id: string;
  readonly sequence: number;
  readonly period_start: string;
  readonly period_end: string;
  readonly amount: string;
  readonly cumulative: string;
  readonly net_value: string;
  readonly status: LineStatus;
  readonly accounting_entry: string | null;
}

/** A version of an asset's plan: the accounting one is posted, the tax one only computed. */
export interface DepreciationPlan {
  readonly public_id: string;
  readonly kind: 'accounting' | 'tax';
  readonly version: number;
  readonly status: 'active' | 'superseded' | 'closed';
  readonly lines: readonly DepreciationLine[];
}

export interface DisposalWrite {
  readonly kind: DisposalKind;
  readonly disposal_date: string;
  readonly reason: string;
  readonly proceeds?: string;
  /** Where a sale's price is due (customer, bank…). */
  readonly proceeds_account?: string;
}

/** « Comptabiliser les dotations jusqu'au… »: how many posted, the assets refused. */
export interface PostedDepreciation {
  readonly posted: number;
  readonly failures: readonly {
    readonly asset: { readonly public_id: string; readonly code: string; readonly name: string };
    readonly code: string;
  }[];
}
