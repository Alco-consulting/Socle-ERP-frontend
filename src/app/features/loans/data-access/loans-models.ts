/** The loans API's shapes (note backend 0062), as the screens use them. */

export interface CodeRef {
  readonly public_id: string;
  readonly code: string;
}

export type RecordStatus = 'active' | 'inactive';
export type LoanStatus = 'draft' | 'active' | 'completed' | 'cancelled';
export type Frequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual';
export type RepaymentMethod = 'annuity' | 'constant_principal' | 'custom';
export type LineStatus = 'planned' | 'partial' | 'paid' | 'superseded';
export type PrepaymentStrategy = 'reduce_installment' | 'reduce_duration';

export interface LoanType {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
  readonly status: RecordStatus;
  readonly journal: CodeRef | null;
  readonly principal_account: CodeRef | null;
  readonly interest_account: CodeRef | null;
  readonly fee_account: CodeRef | null;
}

export interface LoanTypeWrite {
  readonly code: string;
  readonly name: string;
  readonly journal: string | null;
  readonly principal_account: string | null;
  readonly interest_account: string | null;
  readonly fee_account: string | null;
}

export interface DefaultTypes {
  readonly created: readonly LoanType[];
  readonly existing: readonly string[];
}

/** What is owed, from the loan's events: never stored. */
export interface LoanPosition {
  readonly drawn: string;
  readonly principal_repaid: string;
  readonly prepaid: string;
  readonly outstanding: string;
  readonly interest_paid: string;
  readonly fees_paid: string;
  readonly next_installment: string | null;
}

export interface LoanFee {
  readonly public_id: string;
  readonly kind: 'initial' | 'periodic';
  readonly label: string;
  readonly amount: string;
}

export interface Loan {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
  readonly reference: string;
  readonly loan_type: CodeRef;
  readonly partner: CodeRef;
  readonly status: LoanStatus;
  readonly currency: string;
  readonly principal_amount: string;
  readonly start_date: string;
  readonly first_payment_date: string;
  readonly maturity_date: string | null;
  readonly interest_rate: string;
  readonly payment_frequency: Frequency;
  readonly repayment_method: RepaymentMethod;
  readonly installments: number;
  readonly day_count: string;
  readonly rounding: string;
  readonly fees: readonly LoanFee[];
  readonly position: LoanPosition;
  readonly reason: string;
}

/** A fixed-rate loan, its interest « taux × mois / 12 », rounded half up. */
export interface LoanWrite {
  readonly loan_type: string;
  readonly partner: string;
  readonly currency: string;
  readonly name: string;
  readonly reference: string;
  readonly principal_amount: string;
  readonly start_date: string;
  readonly first_payment_date: string;
  readonly interest_rate: string;
  readonly rate_type: 'fixed';
  readonly payment_frequency: Frequency;
  readonly repayment_method: RepaymentMethod;
  readonly installments: number;
  readonly day_count: 'periodic';
  readonly rounding: 'half_up';
  readonly fees: readonly { kind: 'initial'; label: string; amount: string }[];
}

export interface LoanQuery {
  readonly search?: string;
  readonly page?: number;
}

export interface ScheduleLine {
  readonly public_id?: string;
  readonly sequence: number;
  readonly due_date: string;
  readonly opening_balance: string;
  readonly principal: string;
  readonly interest: string;
  readonly fees: string;
  readonly total: string;
  readonly closing_balance: string;
  readonly status?: LineStatus;
}

export interface LoanSchedule {
  readonly public_id: string;
  readonly version: number;
  readonly lines: readonly ScheduleLine[];
}

/** The schedule a draft would get, computed by the server's engine. */
export interface SimulatedSchedule {
  readonly lines: readonly ScheduleLine[];
  readonly total_interest: string;
  readonly total: string;
}

export interface SimulationRequest {
  readonly currency: string;
  readonly principal_amount: string;
  readonly start_date: string;
  readonly first_payment_date: string;
  readonly interest_rate: string;
  readonly payment_frequency: Frequency;
  readonly repayment_method: RepaymentMethod;
  readonly installments: number;
  readonly day_count: string;
  readonly rounding: string;
}

export interface Prepayment {
  readonly prepayment_date: string;
  readonly amount: string;
  readonly strategy: PrepaymentStrategy;
  readonly reason: string;
  readonly interest?: string;
  readonly journal: string;
}
