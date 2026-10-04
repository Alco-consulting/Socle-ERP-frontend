import { Route } from '@playwright/test';

import { FakeAccounting } from './fake-accounting';
import { FakeAccountingEntries } from './fake-accounting-entries';
import { PartnersContext } from './fake-partners';

/**
 * The dashboards of the fake API (`dashboards/journals/`, `dashboards/alerts/`) and the
 * treasury operations an entry accounts (`treasury/operations/?accounting_entry=`), shaped
 * like the OpenAPI schemas (`DashboardsJournalsResponse`, `DashboardsAlertsResponse`,
 * `TreasuryPaginatedOperationList`). The permissions are the contract's (`x-permissions` and
 * the treasury part's `dashboards.read_treasury` + `treasury.read`). Figures are fixtures:
 * the entry counts are those of the fake entries (so that a counter opens a list of the
 * same size), balances and alerts are given as such, never computed by a rule.
 */

interface TreasuryFixture {
  readonly journal: string;
  readonly code: string;
  readonly name: string;
  readonly account_type: 'bank' | 'cash' | 'other';
  readonly currency: string;
  readonly balance: string;
  readonly unreconciled_statement_lines: number;
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
    },
    {
      journal: 'CAI',
      code: 'CAISSE',
      name: 'Caisse du siège',
      account_type: 'cash',
      currency: 'GNF',
      balance: '1250000.000000',
      unreconciled_statement_lines: 0,
    },
  ],
};

/** Alerts and indicators of each company, by source. */
const ALERTS: Readonly<
  Record<
    string,
    {
      alerts: { source: string; code: string; level: string; target: string }[];
      indicators: { source: string; code: string; count: number }[];
    }
  >
> = {
  A: {
    alerts: [{ source: 'closing', code: 'pending_entries', level: 'blocking', target: '2026-09' }],
    indicators: [
      { source: 'taxes', code: 'declarations_not_validated', count: 2 },
      { source: 'treasury', code: 'statement_lines_unreconciled', count: 3 },
      { source: 'loans', code: 'installments_overdue', count: 0 },
      { source: 'imports_exports', code: 'imports_failed', count: 1 },
    ],
  },
};

/** The permission that reads each source of the alerts (backend's `ALERT_PERMISSIONS`). */
const SOURCE_PERMISSIONS: Readonly<Record<string, string>> = {
  closing: 'closing.read',
  taxes: 'taxes.read',
  treasury: 'treasury.read',
  loans: 'loans.read',
  imports_exports: 'imports_exports.read',
};

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
    if (resource === 'alerts') {
      if (!permissions.includes('dashboards.read')) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
      return this.answer(route, 200, this.alerts(company, permissions, header, url));
    }
    return this.answer(route, 404, error('not_found'));
  }

  private journals(
    company: string,
    permissions: readonly string[],
    header: object,
    url: URL,
  ): object {
    const cash =
      permissions.includes('dashboards.read_treasury') && permissions.includes('treasury.read');
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
                }))
            : null,
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

  private alerts(
    company: string,
    permissions: readonly string[],
    header: object,
    url: URL,
  ): object {
    const readable = (source: string) => permissions.includes(SOURCE_PERMISSIONS[source] ?? '');
    const year = this.accounting.books(company).years.find((item) => item.status === 'open');
    const fixture = ALERTS[company] ?? { alerts: [], indicators: [] };
    return {
      company: header,
      scope: {
        fiscal_year: { public_id: year?.public_id ?? '', code: year?.code ?? '' },
        period: null,
        date_from: url.searchParams.get('date_from'),
        date_to: url.searchParams.get('date_to'),
      },
      alerts: fixture.alerts
        .filter((alert) => readable(alert.source))
        .map(({ target, ...alert }) => ({
          ...alert,
          message: 'Server text (never shown).',
          details: { run: 'run-e2e', scope: 'period', target },
        })),
      indicators: fixture.indicators
        .filter((indicator) => readable(indicator.source))
        .map((indicator) => ({ ...indicator, level: null })),
      sources: Object.keys(SOURCE_PERMISSIONS).filter(readable),
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
