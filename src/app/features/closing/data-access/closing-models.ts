/**
 * Closing as the API gives it (backend/docs/api/openapi.yaml, `closing`). Every state is the
 * server's: the screens never decide that a step succeeded or a period is closed.
 */

export type ClosingScope = 'period' | 'fiscal_year';
export type RunStatus = 'in_progress' | 'closed' | 'completed' | 'cancelled' | 'reopened';
export type StepCode =
  | 'pre_close_checks'
  | 'inventory'
  | 'depreciation'
  | 'provisions'
  | 'fx'
  | 'tax_check'
  | 'validation'
  | 'result'
  | 'close'
  | 'opening';
export type StepStatus = 'pending' | 'succeeded' | 'failed' | 'skipped';
export type CheckLevel = 'ok' | 'warning' | 'blocking';

/** `ClosingCodeReference`. */
export interface CodeReference {
  readonly public_id: string;
  readonly code: string;
}

/** `ClosingStepSummary`. */
export interface StepSummary {
  readonly code: StepCode;
  readonly sequence: number;
  readonly status: StepStatus;
  readonly attempts: number;
  readonly finished_at: string | null;
}

/** `ClosingReopening`: the fiscal year (`periods` empty), or one period (note backend 0036). */
export interface Reopening {
  readonly public_id: string;
  readonly reason: string;
  readonly reopened_by: string;
  readonly periods: readonly string[];
  readonly fiscal_year_reopened: boolean;
  readonly created_at: string;
}

/** `ClosingRun`. */
export interface ClosingRun {
  readonly public_id: string;
  readonly scope: ClosingScope;
  readonly fiscal_year: CodeReference;
  readonly period: CodeReference | null;
  readonly status: RunStatus;
  readonly current_step: StepCode | '';
  readonly result: string | null;
  readonly next_fiscal_year: CodeReference | null;
  readonly failed_step: StepCode | '';
  readonly reason: string;
  readonly created_at: string;
  readonly closed_at: string | null;
  readonly completed_at: string | null;
  readonly cancelled_at: string | null;
  readonly steps: readonly StepSummary[];
  readonly reopenings: readonly Reopening[];
}

/** `ClosingCheck`. */
export interface ClosingCheck {
  readonly step: StepCode;
  readonly attempt: number;
  readonly code: string;
  readonly level: CheckLevel;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly source: string;
}

/** `ClosingStep`, with the checks of its latest attempt. */
export interface ClosingStep {
  readonly public_id: string;
  readonly code: StepCode;
  readonly sequence: number;
  readonly status: StepStatus;
  readonly attempts: number;
  readonly finished_at: string | null;
  readonly result: Readonly<Record<string, unknown>>;
  readonly checks: readonly ClosingCheck[];
}

/** `ClosingRunPeriod`: a period of the closing's scope. */
export interface RunPeriod {
  readonly public_id: string;
  readonly code: string;
  readonly label: string;
  readonly start_date: string;
  readonly end_date: string;
  readonly status: 'open' | 'closed';
}
