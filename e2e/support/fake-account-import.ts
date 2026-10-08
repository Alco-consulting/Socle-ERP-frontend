import { Route } from '@playwright/test';

import { AccountJson, FakeAccounting } from './fake-accounting';
import { PartnersContext } from './fake-partners';
import { uploadedName } from './fake-treasury-module';

/**
 * The import of a chart of accounts (`accounting.accounts`) in the fake API, shaped like the
 * OpenAPI schemas (`ImportsExportsImportRun`, rows), company scoped, with the contract's
 * permissions (`imports_exports.*` and `accounting.manage_accounts`). It does NOT play the
 * server's checks: each file name is an explicit scenario (`ACCOUNT_IMPORT_SCENARIOS`) giving
 * its summary, its rows and the accounts it creates — flat (no parent), as the server does.
 */

export const ACCOUNT_IMPORT_FIELDS = [
  { name: 'code', kind: 'code', required: true },
  { name: 'name', kind: 'text', required: true },
  { name: 'account_type', kind: 'text', required: true },
];
const HEADERS = ['Code', 'Nom du compte', 'Type'];
const STAMP = '2026-10-08T09:00:00Z';

interface Row {
  line: number;
  status: 'error';
  field: string;
  code: string;
  details?: Record<string, unknown>;
}

interface Scenario {
  summary: Record<string, number>;
  rows: Row[];
  /** [code, name, account_type] of each account the import creates. */
  accounts: [string, string, string][];
  skipped: number;
}

export const ACCOUNT_IMPORT_SCENARIOS: Record<string, Scenario> = {
  'plan-comptable.csv': {
    summary: { total: 4, valid: 3, warnings: 0, errors: 0, duplicates: 1, units: 4 },
    rows: [],
    accounts: [
      ['101100', 'Capital engagé non appelé', 'equity'],
      ['521100', 'Banques locales', 'asset'],
      ['605100', 'Fournitures non stockables – Eau', 'expense'],
    ],
    skipped: 1,
  },
  'plan-errone.csv': {
    summary: { total: 3, valid: 1, warnings: 0, errors: 2, duplicates: 0, units: 3 },
    rows: [
      {
        line: 3,
        status: 'error',
        field: 'account_type',
        code: 'unknown_account_type',
        details: { value: 'Capitaux Propres' },
      },
      { line: 4, status: 'error', field: 'name', code: 'required' },
    ],
    accounts: [],
    skipped: 0,
  },
};

/**
 * What the server reads in each file (encoding, delimiter), or why it cannot decide: an
 * explicit fixture by file name — nothing is detected here. Default: UTF-8 with BOM, « ; ».
 */
export const ACCOUNT_FILE_READINGS: Record<
  string,
  { encoding: string; delimiter: string } | string
> = {
  'plan-comptable.csv': { encoding: 'utf-8-sig', delimiter: ';' },
  'plan-utf8.csv': { encoding: 'utf-8', delimiter: ',' },
  'plan-windows.csv': { encoding: 'cp1252', delimiter: ';' },
  'plan-tabulation.csv': { encoding: 'utf-8', delimiter: '\t' },
  'plan-ambigu.csv': 'imports_delimiter_undetermined',
  'plan-illisible.csv': 'imports_encoding_undetermined',
  'plan-casse.csv': 'imports_parse_failed',
};

interface Run {
  public_id: string;
  company: string;
  status: string;
  filename: string;
  scenario: Scenario | null;
  columns: Record<string, string>;
  options: Record<string, string>;
  summary: Record<string, unknown>;
}

const error = (code: string, details: unknown = null) => ({
  error: { code, message: code, details, correlation_id: 'e2e' },
});

function runJson(run: Run) {
  return {
    public_id: run.public_id,
    import_type: 'accounting.accounts',
    status: run.status,
    filename: run.filename,
    headers: HEADERS,
    columns: run.columns,
    options: run.options,
    summary: run.summary,
    error: {},
  };
}

export class FakeAccountImport {
  private readonly runs = new Map<string, Run>();
  /** Files already imported, by company: sent again, the server refuses them. */
  private readonly imported = new Set<string>();
  /** The next validation fails on the server (500), once. */
  private failNextValidation = false;

  constructor(
    private readonly context: PartnersContext,
    private readonly accounting: FakeAccounting,
  ) {}

  /** Makes the next `validate` answer 500, like an unexpected server failure. */
  breakNextValidation(): void {
    this.failNextValidation = true;
  }

  async install(): Promise<void> {
    // Registered after the other fakes: tried first, falls back for the other import types.
    await this.context.page.route('**/api/v1/imports-exports/**', (route) => this.handle(route));
  }

  private async answer(route: Route, status: number, json?: unknown): Promise<void> {
    this.context.calls.push(route.request());
    await route.fulfill({ status, json });
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1/imports-exports/', '');
    const company = await this.context.companyOf(request);
    if (path === 'imports/' && request.method() === 'POST') {
      const body = request.postDataJSON() as { import_type?: string };
      if (body.import_type !== 'accounting.accounts') {
        return route.fallback();
      }
      const permissions = await this.context.permissionsOf(request);
      if (
        !permissions.includes('imports_exports.create') ||
        !permissions.includes('accounting.manage_accounts')
      ) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
      const run: Run = {
        public_id: `acc-run-${this.runs.size + 1}`,
        company,
        status: 'created',
        filename: '',
        scenario: null,
        columns: {},
        options: {},
        summary: {},
      };
      this.runs.set(run.public_id, run);
      return this.answer(route, 201, runJson(run));
    }
    const [, id, command] = path.split('/');
    const run = this.runs.get(id);
    if (!run) {
      return route.fallback();
    }
    if (run.company !== company) {
      return this.answer(route, 404, error('not_found'));
    }
    const scenario = () => run.scenario ?? ACCOUNT_IMPORT_SCENARIOS['plan-errone.csv'];
    switch (command) {
      case 'upload':
        run.filename = uploadedName(request);
        if (this.imported.has(`${company}:${run.filename}`)) {
          return this.answer(route, 400, error('imports_file_already_imported'));
        }
        run.scenario = ACCOUNT_IMPORT_SCENARIOS[run.filename] ?? null;
        run.status = 'uploaded';
        break;
      case 'parse': {
        const reading =
          ACCOUNT_FILE_READINGS[run.filename] ?? ACCOUNT_FILE_READINGS['plan-comptable.csv'];
        // An option forced in « Options avancées » decides, as on the server: it settles
        // what the file alone left undecided.
        const forced = (request.postDataJSON() ?? {}) as Record<string, string>;
        const settled =
          (reading === 'imports_delimiter_undetermined' && forced['delimiter']) ||
          (reading === 'imports_encoding_undetermined' && forced['encoding']);
        if (typeof reading === 'string' && !settled) {
          return this.answer(route, 400, error(reading));
        }
        const found = typeof reading === 'string' ? { encoding: 'utf-8', delimiter: ';' } : reading;
        run.options = { ...found, ...forced };
        run.status = 'parsed';
        run.summary = { total: scenario().summary['total'] };
        break;
      }
      case 'map': {
        const body = request.postDataJSON() as {
          columns: Record<string, string>;
          options?: Record<string, string>;
        };
        run.columns = body.columns;
        run.options = { ...run.options, ...(body.options ?? {}) };
        run.status = 'mapped';
        break;
      }
      case 'validate':
        if (this.failNextValidation) {
          this.failNextValidation = false;
          return this.answer(route, 500, error('server_error'));
        }
        run.summary = { ...scenario().summary };
        run.status = 'validated';
        break;
      case 'rows': {
        const status = new URL(request.url()).searchParams.get('status');
        const rows = scenario()
          .rows.filter((row) => row.status === status)
          .map((row) => ({
            line_number: row.line,
            status: row.status,
            raw: {},
            messages: [
              {
                level: 'error',
                field: row.field,
                code: row.code,
                message: row.code,
                details: row.details ?? {},
              },
            ],
          }));
        return this.answer(route, 200, {
          count: rows.length,
          next: null,
          previous: null,
          results: rows,
        });
      }
      case 'preview':
        run.summary = {
          ...run.summary,
          preview: {
            creations: { accounts: scenario().accounts.length },
            updates: 0,
            skipped_duplicates: scenario().skipped,
          },
        };
        run.status = 'previewed';
        break;
      case 'execute': {
        const books = this.accounting.books(company);
        for (const [code, name, type] of scenario().accounts) {
          books.accounts.push(account(code, name, type));
        }
        books.accounts.sort((a, b) => a.code.localeCompare(b.code));
        this.imported.add(`${company}:${run.filename}`);
        run.summary = {
          ...run.summary,
          created: scenario().accounts.length,
          imported: scenario().accounts.length,
          duplicates: scenario().skipped,
        };
        run.status = 'completed';
        break;
      }
      case 'cancel':
        run.status = 'cancelled';
        break;
    }
    return this.answer(route, 200, runJson(run));
  }
}

/** An imported account: flat (no parent), no class, the service's defaults. */
function account(code: string, name: string, type: string): AccountJson {
  return {
    public_id: `20000000-0000-4000-9000-${code.padStart(12, '0')}`,
    code,
    name,
    description: '',
    parent: null,
    account_type: type,
    account_class: '',
    allow_entries: true,
    letterable: false,
    status: 'active',
    has_children: false,
    created_at: STAMP,
    updated_at: STAMP,
  };
}
