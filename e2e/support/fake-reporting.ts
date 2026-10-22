import { Route } from '@playwright/test';

import { FakeAccounting } from './fake-accounting';
import { EntryJson, FakeAccountingEntries, LineJson } from './fake-accounting-entries';
import { FakePartners, PartnersContext } from './fake-partners';

/**
 * Reporting's ledgers (`reporting/ledger/<account>/`, `reporting/partners/<id>/ledger/`), its
 * trial balance (`reporting/balance/`, note backend 0051) and a partner's collective accounts
 * (`accounting/partners/<id>/accounts/`) in the fake API,
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

/** The SYSCOHADA names of the fixture codes' classes and groups (the server's data). */
const GROUP_NAMES: Readonly<Record<string, string>> = {
  '4': 'Comptes de tiers',
  '40': 'Fournisseurs et comptes rattachés',
  '41': 'Clients et comptes rattachés',
  '6': 'Comptes de charges des activités ordinaires',
  '60': 'Achats et variations de stocks',
};
const COLUMNS = [
  'opening_debit',
  'opening_credit',
  'debit',
  'credit',
  'closing_debit',
  'closing_credit',
] as const;
type Columns = Record<(typeof COLUMNS)[number], bigint>;
const empty = (): Columns => ({
  opening_debit: 0n,
  opening_credit: 0n,
  debit: 0n,
  credit: 0n,
  closing_debit: 0n,
  closing_credit: 0n,
});
const add = (sum: Columns, value: Columns) => {
  for (const key of COLUMNS) {
    sum[key] += value[key];
  }
};
const json = (value: Columns) =>
  Object.fromEntries(COLUMNS.map((key) => [key, decimal(value[key])])) as Record<string, string>;

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
    if (parts[0] === 'balance' && parts.length === 1) {
      return this.balance(route, url, permissions, company);
    }
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

  /**
   * The trial balance of the fake entries, as the server's: six columns (opening and closing
   * net on their side), the classes and groups, the journals and pending entries asked, the
   * unposted entries of the period said.
   */
  private async balance(
    route: Route,
    url: URL,
    permissions: readonly string[],
    company: string,
  ): Promise<void> {
    if (!permissions.includes('reporting.read')) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    const from = url.searchParams.get('date_from') ?? '';
    const to = url.searchParams.get('date_to') ?? '';
    const books = this.accounting.books(company);
    const year = books.years.find((item) => item.start_date <= from && to <= item.end_date);
    if (!year || from > to) {
      return this.answer(route, 400, error('reporting_scope_invalid'));
    }
    const journals = url.searchParams.getAll('journal');
    const pending = url.searchParams.get('include_unposted') === 'true';
    const search = (url.searchParams.get('search') ?? '').toLowerCase();
    const counted = (entry: EntryJson) =>
      pending || entry.status === 'validated' || entry.status === 'locked';
    const inScope = this.entries
      .entries(company)
      .filter(
        (entry) =>
          entry.entry_date >= year.start_date &&
          entry.entry_date <= to &&
          (journals.length === 0 || journals.includes(entry.journal.public_id)),
      );
    const totals = new Map<string, { opening: bigint; debit: bigint; credit: bigint }>();
    for (const entry of inScope.filter(counted)) {
      for (const line of entry.lines) {
        const sum = totals.get(line.account.public_id) ?? { opening: 0n, debit: 0n, credit: 0n };
        const debit = units(line.reference_debit);
        const credit = units(line.reference_credit);
        if (entry.entry_date < from) {
          sum.opening += debit - credit;
        } else {
          sum.debit += debit;
          sum.credit += credit;
        }
        totals.set(line.account.public_id, sum);
      }
    }
    const rows = books.accounts
      .filter(
        (account) =>
          totals.has(account.public_id) &&
          (!search ||
            account.code.toLowerCase().includes(search) ||
            account.name.toLowerCase().includes(search)),
      )
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((account) => {
        const sum = totals.get(account.public_id)!;
        const closing = sum.opening + sum.debit - sum.credit;
        const columns: Columns = {
          opening_debit: sum.opening > 0n ? sum.opening : 0n,
          opening_credit: sum.opening < 0n ? -sum.opening : 0n,
          debit: sum.debit,
          credit: sum.credit,
          closing_debit: closing > 0n ? closing : 0n,
          closing_credit: closing < 0n ? -closing : 0n,
        };
        return { account, opening: sum.opening, closing, columns };
      });
    const all = empty();
    const groups = new Map<string, Columns>();
    for (const row of rows) {
      add(all, row.columns);
      for (const width of [1, 2]) {
        const code = row.account.code.slice(0, width);
        const group = groups.get(code) ?? empty();
        add(group, row.columns);
        groups.set(code, group);
      }
    }
    const unposted = inScope.filter(
      (entry) =>
        (entry.status === 'draft' || entry.status === 'submitted') && entry.entry_date >= from,
    ).length;
    const size = Number(url.searchParams.get('page_size')) || 50;
    const number = Number(url.searchParams.get('page')) || 1;
    return this.answer(route, 200, {
      scope: {
        fiscal_year: { public_id: year.public_id, code: year.code },
        period: null,
        date_from: from,
        date_to: to,
      },
      comparative_scope: null,
      totals: {
        opening: '0.000000',
        debit: decimal(all.debit),
        credit: decimal(all.credit),
        closing: '0.000000',
      },
      columns: json(all),
      groups: [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([code, columns]) => ({
          code,
          name: GROUP_NAMES[code] ?? '',
          level: code.length,
          columns: json(columns),
        })),
      comparison: null,
      warnings:
        !pending && unposted > 0
          ? [
              {
                code: 'unposted_entries',
                message: 'Draft or submitted entries of the period are left out.',
                details: { count: unposted },
              },
            ]
          : [],
      count: rows.length,
      next: null,
      previous: null,
      results: rows.slice((number - 1) * size, number * size).map((row) => ({
        account: {
          public_id: row.account.public_id,
          code: row.account.code,
          name: row.account.name,
          account_type: row.account.account_type,
        },
        opening: decimal(row.opening),
        debit: decimal(row.columns.debit),
        credit: decimal(row.columns.credit),
        closing: decimal(row.closing),
        ...json(row.columns),
        comparison: null,
        drilldown: { level: 'ledger', account: row.account.public_id },
      })),
    });
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
