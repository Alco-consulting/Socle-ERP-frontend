/** The analytics API's shapes (notes backend 0004, 0063), as the screens use them. */

export type AnalyticStatus = 'active' | 'inactive';

/** An analytic plan (Odoo's word; an axis on the server): Chantiers, Départements… */
export interface AnalyticAxis {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly status: AnalyticStatus;
}

export interface AxisReference {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
}

/** An analytic account of a plan (a value on the server): Kipé, Ratoma… */
export interface AnalyticValue {
  readonly public_id: string;
  readonly axis: AxisReference;
  readonly code: string;
  readonly label: string;
  readonly description: string;
  readonly status: AnalyticStatus;
}

export interface ValueReference {
  readonly public_id: string;
  readonly code: string;
  readonly label: string;
  readonly status: AnalyticStatus;
}

export interface RuleLine {
  readonly sequence: number;
  readonly value: ValueReference;
  readonly percentage: string;
}

/** A distribution model: applied by itself to the accounts of its prefix (note backend 0063). */
export interface AnalyticRule {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
  readonly axis: AxisReference;
  readonly account_prefix: string;
  readonly status: AnalyticStatus;
  readonly lines: readonly RuleLine[];
}

/** Its code is made from its name by the server (note backend 0064). */
export interface RuleWrite {
  readonly name: string;
  readonly axis: string;
  readonly account_prefix: string;
  readonly lines: readonly { value: string; percentage: string }[];
}

/** A share of a distribution, as an invoice line keeps it. */
export interface DistributionShare {
  readonly value: string;
  readonly percentage: string;
  /** For display: the value's code and its plan's code. */
  readonly code: string;
  readonly axis: string;
}

export interface Sides {
  readonly debit: string;
  readonly credit: string;
}

/** `GET reporting/analytics/axes/{id}/`: what each analytic account received. */
export interface AxisReportRow {
  readonly value: { readonly public_id: string; readonly code: string; readonly label: string };
  readonly debit: string;
  readonly credit: string;
  readonly balance: string;
}

export interface AxisReport {
  readonly count: number;
  readonly axis: AxisReference;
  readonly allocated: Sides;
  readonly unallocated: Sides;
  readonly results: readonly AxisReportRow[];
}
