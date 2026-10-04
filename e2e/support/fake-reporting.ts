import { Route } from '@playwright/test';

import { FakeAccounting } from './fake-accounting';
import { EntryJson, FakeAccountingEntries, LineJson } from './fake-accounting-entries';
import { FakePartners, PartnersContext } from './fake-partners';

/**
 * Reporting's ledgers (`reporting/ledger/<account>/`, `reporting/partners/<id>/ledger/`) and
 * a partner's collective accounts (`accounting/partners/<id>/accounts/`) in the fake API,
 * shaped like the OpenAPI schemas. Fixtures only: the rows are the validated and locked lines
 * of the fake entries (so that a row opens an entry that exists), with an opening of zero and
 * a cumulative balance that keeps the figures consistent — never a rule of the server.
 * Permissions and the required scope (`fiscal_year`) are the contract's.
 */

const SCALE = 6n;
const units = (value: string) => {
  const [integer, fraction = ''] = value.replace('-', '').split('.');
  const amount =
    BigInt(integer || '0') * 10n ** SCALE + BigInt(fraction.padEnd(6, '0').slice(0, 6));
  return value.startsWith('-') ? -amount : amount;
};
const decimal = (amount: bigint) => {
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const fraction = String(absolute % 10n ** SCALE).padStart(6, '0');
  return `${negative ? '-' : ''}${absolute / 10n ** SCALE}.${fraction}`;
};

const error = (code: string) => ({
  error: { code, message: code, details: null, correlation_id: 'e2e' },
});

export class FakeReporting {
  constructor(
    private readonly context: PartnersContext,
    private readonly accounting: FakeAccounting,
    private readonly entries: FakeAccountingEntries,
    private readonly partners: FakePartners,
  ) {}

  async install(): Promise<void> {
    const page = this.context.page;
    await page.route('**/api/v1/reporting/**', (route) => this.reports(route));
    // Registered after the accounting fake: tried first for this path.
    await page.route('**/api/v1/accounting/partners/**', (route) => this.collective(route));
  }

  private async answer(route: Route, status: number, json: unknown): Promise<void> {
    this.context.calls.push(route.request());
    await route.fulfill({ status, json });
  }

  private async reports(route: Route): Promise<void> {
    const request = route.request();
    const permissions = await this.context.permissionsOf(request);
    const company = await this.context.companyOf(request);
    const url = new URL(request.url());
    const parts = url.pathname.replace('/api/v1/reporting/', '').split('/').filter(Boolean);
    const isPartner = parts[0] === 'partners' && parts[2] === 'ledger';
    const isAccount = parts[0] === 'ledger' && parts.length === 2;
    if (!isPartner && !isAccount) {
      return this.answer(route, 404, error('not_found'));
    }
    const permission = isPartner ? 'reporting.read_auxiliary' : 'reporting.read';
    if (!permissions.includes(permission)) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    const books = this.accounting.books(company);
    const year = books.years.find((item) => item.public_id === url.searchParams.get('fiscal_year'));
    if (!year) {
      return this.answer(route, 400, error('reporting_scope_required'));
    }
    const id = parts[1];
    const subject = isPartner
      ? this.partners.list(company).find((item) => item.public_id === id)
      : books.accounts.find((item) => item.public_id === id);
    if (!subject) {
      return this.answer(route, 404, error('not_found'));
    }
    const matches = (line: LineJson) =>
      isPartner ? line.partner?.public_id === id : line.account.public_id === id;
    const posted = this.entries
      .entries(company)
      .filter(
        (entry) =>
          (entry.status === 'validated' || entry.status === 'locked') &&
          entry.entry_date >= year.start_date &&
          entry.entry_date <= year.end_date,
      )
      .sort((a, b) => a.entry_date.localeCompare(b.entry_date));
    let running = 0n;
    let debit = 0n;
    let credit = 0n;
    const rows = posted.flatMap((entry: EntryJson) =>
      entry.lines.filter(matches).map((line) => {
        debit += units(line.reference_debit);
        credit += units(line.reference_credit);
        running += units(line.reference_debit) - units(line.reference_credit);
        return {
          line: line.public_id,
          entry: entry.public_id,
          entry_date: entry.entry_date,
          entry_number: entry.entry_number,
          journal: entry.journal.code,
          account: line.account.public_id,
          account_code: line.account.code,
          label: line.label || entry.description,
          document_reference: entry.document_reference,
          partner: line.partner
            ? {
                public_id: line.partner.public_id,
                code: line.partner.code,
                name:
                  this.partners
                    .list(company)
                    .find((item) => item.public_id === line.partner?.public_id)?.name ?? '',
              }
            : null,
          debit: decimal(units(line.reference_debit)),
          credit: decimal(units(line.reference_credit)),
          balance: decimal(running),
          drilldown: { level: 'entry', entry: entry.public_id, line: line.public_id },
        };
      }),
    );
    const size = Number(url.searchParams.get('page_size')) || 50;
    const number = Number(url.searchParams.get('page')) || 1;
    const header = {
      scope: {
        fiscal_year: { public_id: year.public_id, code: year.code },
        period: null,
        date_from: year.start_date,
        date_to: year.end_date,
      },
      comparative_scope: null,
      opening_balance: '0.000000',
      total_debit: decimal(debit),
      total_credit: decimal(credit),
      closing_balance: decimal(running),
      warnings: [],
      count: rows.length,
      next: null,
      previous: null,
      results: rows.slice((number - 1) * size, number * size),
    };
    return this.answer(
      route,
      200,
      isPartner
        ? { ...header, partner: { public_id: id, code: subject.code, name: subject.name } }
        : {
            ...header,
            account: {
              public_id: id,
              code: subject.code,
              name: subject.name,
              account_type: 'account_type' in subject ? subject.account_type : '',
            },
          },
    );
  }

  /** A partner's collective account codes, matched with the chart (fixture data). */
  private async collective(route: Route): Promise<void> {
    const request = route.request();
    const permissions = await this.context.permissionsOf(request);
    if (!permissions.includes('accounting.read')) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    const company = await this.context.companyOf(request);
    const id = new URL(request.url()).pathname.split('/').filter(Boolean).at(-2);
    const partner = this.partners.list(company).find((item) => item.public_id === id);
    if (!partner) {
      return this.answer(route, 404, error('not_found'));
    }
    const accounts = this.accounting.books(company).accounts;
    const rows = (
      [
        ['customer', partner.customer_account_code],
        ['supplier', partner.supplier_account_code],
      ] as const
    )
      .filter(([, code]) => code)
      .map(([role, code]) => {
        const account = accounts.find((item) => item.code === code);
        return {
          role,
          code,
          account: account ? { public_id: account.public_id, code: account.code } : null,
          postable: !!account,
        };
      });
    return this.answer(route, 200, rows);
  }
}
