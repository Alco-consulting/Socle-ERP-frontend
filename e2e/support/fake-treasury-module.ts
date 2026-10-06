import { Request, Route } from '@playwright/test';

/**
 * The rest of Trésorerie (Module 6) in the fake API, on the same data as the reconciliation
 * fake (fake-treasury.ts): accounts (record, balance, creation, modification, deactivation),
 * operations (filters, record, creation, draft edit, commands), transfers, statements (record,
 * the server's check, closing), line exclusion, and the import of statements through the
 * generic pipeline. Shaped like the OpenAPI schemas, with the contract's permissions, statuses
 * and errors. Every figure the server would compute (balances, a statement's check, an
 * import's checks) is an explicit fixture: nothing is computed here.
 */

export interface TreasuryCommands {
  readonly answer: (route: Route, status: number, json: unknown) => Promise<void>;
  readonly paged: <T>(route: Route, items: readonly T[]) => Promise<void>;
  readonly event: (objectType: string, objectId: string, action: string) => void;
  readonly uuid: () => string;
}

export const D = (units: string) => `${units}.000000`;
const NOW = '2026-10-04T10:00:00Z';

export const error = (code: string, details: unknown = null) => ({
  error: { code, message: code, details, correlation_id: 'e2e' },
});

/** The server's balance of each account of company A (fixture figures). */
export const BALANCES: Readonly<Record<string, readonly [string, string, string, string]>> = {
  'BQ-GNF': ['1000000', '3150000', '35000', '4115000'],
  CAISSE: ['250000', '0', '0', '250000'],
};

/** The server's check of each statement (fixture figures, never recomputed). */
export interface StateJson {
  statement: string;
  statement_balance: string;
  lines_total: string;
  treasury_balance: string;
  accounting_balance: string | null;
  accounting_currency: string;
  statement_vs_treasury: string;
  statement_vs_accounting: string | null;
  unreconciled_lines: [];
  unreconciled_operations: [];
  opening_balance: string;
  computed_closing_balance: string;
  closing_difference: string;
  balanced: boolean;
  reconciled_total: string;
  unreconciled_total: string;
  excluded_total: string;
  reconciled_count: number;
  unreconciled_count: number;
  excluded_count: number;
}

export function state(statement: string, values: Partial<StateJson>): StateJson {
  return {
    statement,
    statement_balance: D('0'),
    lines_total: D('0'),
    treasury_balance: D('0'),
    accounting_balance: D('0'),
    accounting_currency: 'GNF',
    statement_vs_treasury: D('0'),
    statement_vs_accounting: D('0'),
    unreconciled_lines: [],
    unreconciled_operations: [],
    opening_balance: D('0'),
    computed_closing_balance: D('0'),
    closing_difference: D('0'),
    balanced: true,
    reconciled_total: D('0'),
    unreconciled_total: D('0'),
    excluded_total: D('0'),
    reconciled_count: 0,
    unreconciled_count: 0,
    excluded_count: 0,
    ...values,
  };
}

/** What the import of a statement file does, by its name (scenario fixtures). */
interface ImportScenario {
  readonly summary: Record<string, number>;
  readonly rows: readonly {
    line: number;
    status: 'warning' | 'error';
    field: string;
    code: string;
    details?: Record<string, string>;
  }[];
  readonly creations: number;
  readonly skipped: number;
  /** The statement created (with its lines and the server's check), when it imports. */
  readonly statement?: {
    readonly reference: string;
    readonly period: readonly [string, string];
    readonly balances: readonly [opening: string, closing: string];
    readonly lines: readonly {
      date: string;
      direction: 'inflow' | 'outflow';
      amount: string;
      description: string;
      external_id: string;
    }[];
    readonly check: Partial<StateJson>;
  };
}

export const IMPORT_SCENARIOS: Readonly<Record<string, ImportScenario>> = {
  // A new statement, imported with a difference to check (opening + lines ≠ closing).
  'releve-octobre.csv': {
    summary: { total: 2, valid: 1, warnings: 1, errors: 0, duplicates: 0 },
    rows: [
      {
        line: 2,
        status: 'warning',
        field: 'closing_balance',
        code: 'statement_unbalanced',
        details: { computed: '5700000', difference: '-10000' },
      },
    ],
    creations: 1,
    skipped: 0,
    statement: {
      reference: 'REL-2026-10',
      period: ['2026-10-01', '2026-10-31'],
      balances: ['5415000', '5690000'],
      lines: [
        {
          date: '2026-10-05',
          direction: 'inflow',
          amount: '300000',
          description: 'VIR CLI-004',
          external_id: 'TX-201',
        },
        {
          date: '2026-10-07',
          direction: 'outflow',
          amount: '15000',
          description: 'FRAIS OCTOBRE',
          external_id: 'TX-202',
        },
      ],
      check: {
        statement_balance: D('5690000'),
        lines_total: D('285000'),
        opening_balance: D('5415000'),
        computed_closing_balance: D('5700000'),
        closing_difference: D('-10000'),
        balanced: false,
        unreconciled_total: D('285000'),
        unreconciled_count: 2,
        treasury_balance: D('4115000'),
        statement_vs_treasury: D('1575000'),
        accounting_balance: D('4115000'),
        statement_vs_accounting: D('1575000'),
      },
    },
  },
  // The September statement again: already present, ignored whole.
  'releve-septembre.csv': {
    summary: { total: 5, valid: 0, warnings: 0, errors: 0, duplicates: 5 },
    rows: [],
    creations: 0,
    skipped: 1,
  },
  // Refused rows: nothing imports.
  'releve-errone.csv': {
    summary: { total: 3, valid: 1, warnings: 0, errors: 2, duplicates: 0 },
    rows: [
      { line: 2, status: 'error', field: 'external_id', code: 'line_already_imported' },
      { line: 4, status: 'error', field: 'external_id', code: 'duplicate_in_file' },
    ],
    creations: 0,
    skipped: 0,
  },
};

/** The statement import fields (`TreasuryStatements.fields` of the backend). */
export const STATEMENT_IMPORT_FIELDS = [
  { name: 'account', kind: 'code', required: true },
  { name: 'statement_reference', kind: 'text', required: true },
  { name: 'statement_date', kind: 'date', required: true },
  { name: 'period_start', kind: 'date', required: true },
  { name: 'period_end', kind: 'date', required: true },
  { name: 'opening_balance', kind: 'decimal', required: true },
  { name: 'closing_balance', kind: 'decimal', required: true },
  { name: 'line_date', kind: 'date', required: true },
  { name: 'amount', kind: 'decimal', required: true },
  { name: 'value_date', kind: 'date', required: false },
  { name: 'description', kind: 'text', required: false },
  { name: 'bank_reference', kind: 'text', required: false },
  { name: 'external_id', kind: 'text', required: false },
  { name: 'running_balance', kind: 'decimal', required: false },
];

export interface ImportRunJson {
  public_id: string;
  company: string;
  status: string;
  filename: string;
  scenario: ImportScenario | null;
  columns: Record<string, string>;
  options: Record<string, string>;
  summary: Record<string, unknown>;
}

export function runJson(run: ImportRunJson) {
  return {
    public_id: run.public_id,
    import_type: 'treasury.statements',
    status: run.status,
    filename: run.filename,
    headers: STATEMENT_IMPORT_FIELDS.map((field) => field.name),
    columns: run.columns,
    options: run.options,
    summary: run.summary,
    error: {},
  };
}

/** The uploaded file's name, read from the multipart body. */
export function uploadedName(request: Request): string {
  const text = (request.postDataBuffer() ?? Buffer.from('')).toString('utf-8');
  return /filename="([^"]+)"/.exec(text)?.[1] ?? 'import.csv';
}

export const STAMP = NOW;
