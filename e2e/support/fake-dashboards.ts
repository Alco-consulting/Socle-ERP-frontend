import { Route } from '@playwright/test';

import { FakeAccounting } from './fake-accounting';
import { FakeAccountingEntries } from './fake-accounting-entries';
import { PartnersContext } from './fake-partners';

/**
 * The accounting dashboard of the fake API (`dashboards/journals/`) and the treasury
 * operations an entry accounts (`treasury/operations/?accounting_entry=`), shaped like the
 * OpenAPI schemas (`DashboardsJournalsResponse`, `TreasuryPaginatedOperationList`). The
 * permissions are the contract's (`x-permissions`, the treasury part's
 * `dashboards.read_treasury` + `treasury.read`, the documents' `invoicing.read`). Figures are
 * fixtures: the entry counts are those of the fake entries (so that a figure opens a list of
 * the same size); balances, their curve and the documents are given as such. Only the weeks'
 * bounds follow `on`, as the contract says (note backend 0042).
 */

interface TreasuryFixture {
  readonly journal: string;
  readonly code: string;
  readonly name: string;
  readonly account_type: 'bank' | 'cash' | 'other';
  readonly currency: string;
  readonly balance: string;
  readonly unreconciled_statement_lines: number;
  /** Lines « à rapprocher », recorded without their counterpart (note backend 0050). */
  readonly lines_to_reconcile: number;
}

/** Treasury accounts of each company, by the code of their default journal. */
const TREASURY: Readonly<Record<string, readonly TreasuryFixture[]>> = {
  A: [
    {
      journal: 'BQ1',
      code: 'BANK-GNF',
      name: 'Compte courant BICIGUI',
      account_type: 'bank',
      currency: 'GNF',
      balance: '25480000.000000',
      unreconciled_statement_lines: 3,
      lines_to_reconcile: 1,
    },
    {
      journal: 'CAI',
      code: 'CAISSE',
      name: 'Caisse du siège',
      account_type: 'cash',
      currency: 'GNF',
      balance: '1250000.000000',
      unreconciled_statement_lines: 0,
      lines_to_reconcile: 0,
    },
  ],
};

/** A balance curve: the balance some days before `on` (0: on `on`). */
const HISTORY: Readonly<Record<string, readonly (readonly [days: number, balance: string])[]>> = {
  'BANK-GNF': [
    [30, '20000000.000000'],
    [3, '25480000.000000'],
    [0, '25480000.000000'],
  ],
  CAISSE: [
    [30, '1250000.000000'],
    [0, '1250000.000000'],
  ],
};

interface DocumentsFixture {
  readonly drafts: number;
  readonly draft_amount: string;
  readonly unpaid: number;
  readonly unpaid_amount: string;
  /** Overdue, last week, this week, the next two weeks, not due yet. */
  readonly weeks: readonly string[];
}

const ZERO = '0.000000';

/** The documents of each company's sales and purchase journals, by journal code. */
const DOCUMENTS: Readonly<Record<string, Readonly<Record<string, DocumentsFixture>>>> = {
  A: {
    VTE: {
      drafts: 1,
      draft_amount: '1180000.000000',
      unpaid: 2,
      unpaid_amount: '60331200.000000',
      weeks: ['50000000.000000', ZERO, '10331200.000000', ZERO, ZERO, ZERO],
    },
  },
};

const NO_DOCUMENT: DocumentsFixture = {
  drafts: 0,
  draft_amount: ZERO,
  unpaid: 0,
  unpaid_amount: ZERO,
  weeks: [ZERO, ZERO, ZERO, ZERO, ZERO, ZERO],
};

/** `on` moved by some days, as an ISO date. */
function shifted(on: string, days: number): string {
  const day = new Date(`${on}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** The six weeks' bounds around `on` (Monday first), as the contract gives them. */
function weekBounds(on: string): [string | null, string | null][] {
  const monday = shifted(on, -((new Date(`${on}T00:00:00Z`).getUTCDay() + 6) % 7));
  const starts = [-7, 0, 7, 14].map((days) => shifted(monday, days));
  return [
    [null, shifted(starts[0], -1)],
    ...starts.map((start): [string, string] => [start, shifted(start, 6)]),
    [shifted(starts[3], 7), null],
  ];
}

const COMPANY: Readonly<Record<string, { legal_name: string; reference_currency: string }>> = {
  A: { legal_name: 'Alco Guinée SARL (test)', reference_currency: 'GNF' },
  B: { legal_name: 'Alco Sénégal SA (test)', reference_currency: 'XOF' },
};

const error = (code: string) => ({
  error: { code, message: code, details: null, correlation_id: 'e2e' },
});

export class FakeDashboards {
  constructor(
    private readonly context: PartnersContext,
    private readonly accounting: FakeAccounting,
    private readonly entries: FakeAccountingEntries,
  ) {}

  async install(): Promise<void> {
    const page = this.context.page;
    await page.route('**/api/v1/dashboards/**', (route) => this.handle(route));
    await page.route('**/api/v1/treasury/operations/**', (route) => this.operations(route));
  }

  private async answer(route: Route, status: number, json: unknown): Promise<void> {
    this.context.calls.push(route.request());
    await route.fulfill({ status, json });
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const permissions = await this.context.permissionsOf(request);
    const company = await this.context.companyOf(request);
    const url = new URL(request.url());
    const resource = url.pathname.replace('/api/v1/dashboards/', '').replace(/\/$/, '');
    const header = {
      public_id: request.headers()['x-company-id'] ?? '',
      ...(COMPANY[company] ?? { legal_name: company, reference_currency: 'GNF' }),
    };
    if (resource === 'journals') {
      if (!permissions.includes('dashboards.read') || !permissions.includes('accounting.read')) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
      return this.answer(route, 200, this.journals(company, permissions, header, url));
    }
    if (resource === 'overview') {
      if (!permissions.includes('dashboards.read')) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
      return this.answer(route, 200, this.overview(company, permissions, header, url));
    }
    return this.answer(route, 404, error('not_found'));
  }

  /** The headline figures (fixed, fictitious): a section without its permission is restricted. */
  private overview(
    company: string,
    permissions: readonly string[],
    header: object,
    url: URL,
  ): object {
    const currency = COMPANY[company]?.reference_currency ?? 'GNF';
    const metric = (code: string, value: string) => ({
      code,
      unit: 'amount',
      value,
      currency,
      comparison: null,
    });
    const year = this.accounting.books(company).years[0];
    const readable = {
      financial: permissions.includes('reporting.read_financial_statements'),
      cash: permissions.includes('treasury.read'),
      receivables: permissions.includes('reporting.read_auxiliary'),
      payables: permissions.includes('reporting.read_auxiliary'),
    };
    const sections = [
      {
        section: 'financial',
        metrics: [
          metric('total_income', '61511200.000000'),
          metric('total_expense', '38240500.000000'),
          metric('result', '23270700.000000'),
        ],
      },
      { section: 'cash', metrics: [metric('booked_balance', '26730000.000000')] },
      { section: 'receivables', metrics: [metric('balance', '60331200.000000')] },
      { section: 'payables', metrics: [metric('balance', '2450000.000000')] },
    ];
    return {
      company: header,
      scope: {
        fiscal_year: { public_id: year?.public_id ?? '', code: year?.code ?? '' },
        period: null,
        date_from: url.searchParams.get('date_from') ?? year?.start_date ?? '2026-01-01',
        date_to: url.searchParams.get('date_to') ?? year?.end_date ?? '2026-12-31',
      },
      comparative_scope: null,
      sections: sections.filter((item) => readable[item.section as keyof typeof readable]),
      restricted: sections
        .filter((item) => !readable[item.section as keyof typeof readable])
        .map((item) => item.section),
    };
  }

  private journals(
    company: string,
    permissions: readonly string[],
    header: object,
    url: URL,
  ): object {
    const cash =
      permissions.includes('dashboards.read_treasury') && permissions.includes('treasury.read');
    const invoicing = permissions.includes('invoicing.read');
    const on = url.searchParams.get('on');
    const books = this.accounting.books(company);
    const entries = this.entries.entries(company);
    const journals = books.journals
      .filter((journal) => journal.status === 'active')
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((journal) => {
        const own = entries.filter((entry) => entry.journal.public_id === journal.public_id);
        const count = (status: string) => own.filter((entry) => entry.status === status).length;
        return {
          public_id: journal.public_id,
          code: journal.code,
          name: journal.name,
          journal_type: journal.journal_type,
          default_currency: journal.default_currency,
          entries: {
            total: own.length,
            draft: count('draft'),
            submitted: count('submitted'),
            validated: count('validated'),
            locked: count('locked'),
          },
          treasury_accounts: cash
            ? (TREASURY[company] ?? [])
                .filter((account) => account.journal === journal.code)
                .map((account) => ({
                  public_id: `t-${company}-${account.code}`,
                  code: account.code,
                  name: account.name,
                  account_type: account.account_type,
                  status: 'active',
                  currency: account.currency,
                  balance: account.balance,
                  unreconciled_statement_lines: account.unreconciled_statement_lines,
                  lines_to_reconcile: account.lines_to_reconcile,
                  history: on
                    ? (HISTORY[account.code] ?? []).map(([days, balance]) => ({
                        date: shifted(on, -days),
                        balance,
                      }))
                    : null,
                }))
            : null,
          ...this.documents(company, journal.code, journal.journal_type, invoicing, on),
        };
      });
    return {
      company: header,
      fiscal_year: null,
      on: url.searchParams.get('on'),
      restricted: cash ? [] : ['cash'],
      journals,
    };
  }

  private documents(
    company: string,
    code: string,
    type: string,
    invoicing: boolean,
    on: string | null,
  ): object {
    if (!invoicing || (type !== 'sales' && type !== 'purchase')) {
      return { invoices: null, due_weeks: null };
    }
    const { weeks, ...invoices } = DOCUMENTS[company]?.[code] ?? NO_DOCUMENT;
    return {
      invoices,
      due_weeks: on
        ? weekBounds(on).map(([date_from, date_to], index) => ({
            date_from,
            date_to,
            amount: weeks[index],
          }))
        : null,
    };
  }

  /**
   * The treasury operation an entry accounts: fixture — a posted entry of the bank journal
   * (BQ1) accounts one operation of the bank account; no other entry has one.
   */
  private async operations(route: Route): Promise<void> {
    const request = route.request();
    const permissions = await this.context.permissionsOf(request);
    if (!permissions.includes('treasury.read')) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    const company = await this.context.companyOf(request);
    const entryId = new URL(request.url()).searchParams.get('accounting_entry');
    const entry = this.entries.entries(company).find((item) => item.public_id === entryId);
    const results =
      entry && entry.journal.code === 'BQ1' && ['validated', 'locked'].includes(entry.status)
        ? [
            {
              public_id: `op-${entry.public_id}`,
              treasury_account: { public_id: `t-${company}-BANK-GNF`, code: 'BANK-GNF' },
              operation_type: 'deposit',
              direction: 'inflow',
              status: 'accounted',
              operation_date: entry.entry_date,
              amount: entry.lines[0]?.debit ?? '0.000000',
              currency: entry.currency,
              reference: `VIR-${entry.document_reference}`,
              accounting_entry: entry.public_id,
            },
          ]
        : [];
    return this.answer(route, 200, { count: results.length, next: null, previous: null, results });
  }
}
