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
/** Odoo's « Comptes à recevoir », « Comptes à payer », as the accounts' detailed types. */
const tiersTypes = (asked: readonly string[], both = true) => {
  const types = asked.map((item) =>
    item === 'receivable' ? 'asset_receivable' : 'liability_payable',
  );
  return types.length || !both ? types : ['asset_receivable', 'liability_payable'];
};

const SHORT = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];
/** The server's heading of a period (« oct. 2026 », « 2026 »…). */
const label = (from: string, to: string) => {
  const [year, month, first] = from.split('-').map(Number);
  const [endYear, endMonth, end] = to.split('-').map(Number);
  const full = first === 1 && endYear === year && end === new Date(endYear, endMonth, 0).getDate();
  if (full && endMonth === month) {
    return `${SHORT[month - 1]} ${year}`;
  }
  if (full && month === 1 && endMonth === 12) {
    return String(year);
  }
  if (full && (month - 1) % 3 === 0 && endMonth === month + 2) {
    return `${SHORT[month - 1]} - ${SHORT[endMonth - 1]} ${year}`;
  }
  const day = (value: string) => value.split('-').reverse().join('/');
  return `Du ${day(from)} au ${day(to)}`;
};
interface Figures {
  opening: bigint;
  closing: bigint;
  debits: bigint[];
  credits: bigint[];
}
const empty = (periods: number): Figures => ({
  opening: 0n,
  closing: 0n,
  debits: Array<bigint>(periods).fill(0n),
  credits: Array<bigint>(periods).fill(0n),
});
const add = (sum: Figures, value: Figures) => {
  sum.opening += value.opening;
  sum.closing += value.closing;
  value.debits.forEach((amount, index) => (sum.debits[index] += amount));
  value.credits.forEach((amount, index) => (sum.credits[index] += amount));
};
const json = (value: Figures) => ({
  opening: decimal(value.opening),
  closing: decimal(value.closing),
  movements: value.debits.map((debit, index) => ({
    debit: decimal(debit),
    credit: decimal(value.credits[index]),
  })),
});

const statementLine = (code: string, name: string, amount = '0', account?: [string, string]) => ({
  code,
  name,
  amount: `${amount}.000000`,
  accounts: account
    ? [
        {
          public_id: `acc-${account[0]}`,
          code: account[0],
          name: account[1],
          amount: `${amount}.000000`,
        },
      ]
    : [],
});
const statementBlock = (code: string, name: string, total: string, lines: unknown[]) => ({
  code,
  name,
  total: `${total}.000000`,
  lines,
});

/**
 * The compte de résultat (`reporting/income-statement/`, note backend 0055): a fixture in the
 * server's shape — charges 590 000, products 1 000 000, a profit of 410 000 — never computed.
 */
const incomeStatement = (from: string, to: string) => ({
  scope: {
    fiscal_year: { public_id: 'fy-2026', code: '2026' },
    period: null,
    date_from: from,
    date_to: to,
  },
  charges: {
    blocks: [
      statementBlock('operating', 'Charges d’exploitation', '500000', [
        statementLine('60', 'Achats et variations de stocks', '400000', [
          '601100',
          'Achats de marchandises',
        ]),
        statementLine('61', 'Transports'),
        statementLine('62', 'Services extérieurs A', '100000', ['622000', 'Locations']),
        statementLine('63', 'Services extérieurs B'),
        statementLine('64', 'Impôts et taxes'),
        statementLine('65', 'Autres charges'),
        statementLine('66', 'Charges de personnel'),
        statementLine('68', 'Dotations aux amortissements'),
        statementLine('69', 'Dotations aux provisions et aux dépréciations'),
      ]),
      statementBlock('financial', 'Charges financières', '30000', [
        statementLine('67', 'Frais financiers et charges assimilées', '30000', [
          '671000',
          'Intérêts',
        ]),
        statementLine('697', 'Dotations aux provisions et aux dépréciations financières'),
      ]),
      statementBlock('hao', 'Charges HAO', '0', [
        statementLine('81', 'Valeurs comptables des cessions d’immobilisations'),
        statementLine('83', 'Charges hors activités ordinaires'),
        statementLine('85', 'Dotations hors activités ordinaires'),
      ]),
      statementBlock('tax', 'Participation et impôt sur le résultat', '60000', [
        statementLine('87', 'Participation des travailleurs'),
        statementLine('89', 'Impôts sur le résultat', '60000', [
          '891000',
          'Impôt sur les bénéfices',
        ]),
      ]),
    ],
    total: '590000.000000',
  },
  products: {
    blocks: [
      statementBlock('operating', 'Produits d’exploitation', '1000000', [
        statementLine('70', 'Ventes', '1000000', ['701100', 'Ventes de marchandises']),
        statementLine('71', 'Subventions d’exploitation'),
        statementLine('72', 'Production immobilisée'),
        statementLine('73', 'Variations des stocks de biens et de services produits'),
        statementLine('75', 'Autres produits'),
        statementLine('78', 'Transferts de charges'),
        statementLine('79', 'Reprises de provisions, de dépréciations et autres'),
      ]),
      statementBlock('financial', 'Produits financiers', '0', [
        statementLine('77', 'Revenus financiers et produits assimilés'),
        statementLine('787', 'Transferts de charges financières'),
        statementLine('797', 'Reprises de provisions et dépréciations financières'),
      ]),
      statementBlock('hao', 'Produits HAO', '0', [
        statementLine('82', 'Produits des cessions d’immobilisations'),
        statementLine('84', 'Produits hors activités ordinaires'),
        statementLine('86', 'Reprises de charges, provisions et dépréciations HAO'),
        statementLine('88', 'Subventions d’équilibre'),
      ]),
    ],
    total: '1000000.000000',
  },
  result: '410000.000000',
  profit: '410000.000000',
  loss: '0.000000',
  total: '1000000.000000',
  unclassified: [],
  warnings: [],
});

const sheetAccount = (code: string, name: string, amount: string) => ({
  public_id: `acc-${code}`,
  code,
  name,
  amount: `${amount}.000000`,
});
const sheetBlock = (
  code: string,
  name: string,
  row: number,
  total: string,
  accounts: unknown[],
  result: string | null = null,
) => ({ code, name, row, total: `${total}.000000`, accounts, result });

/**
 * The bilan (`reporting/balance-sheet/`, note backend 0056): a fixture in the server's shape —
 * 16 500 000 on each side, a result of 2 500 000 — never computed.
 */
const balanceSheet = (to: string) => ({
  scope: {
    fiscal_year: { public_id: 'fy-2026', code: '2026' },
    period: null,
    date_from: `${to.slice(0, 4)}-01-01`,
    date_to: to,
  },
  assets: {
    blocks: [
      sheetBlock('fixed', 'Actif immobilisé', 1, '2000000', [
        sheetAccount('244100', 'Matériel de bureau', '3000000'),
        sheetAccount('284100', 'Amortissements du matériel', '-1000000'),
      ]),
      sheetBlock('current', 'Actif circulant', 3, '5000000', [
        sheetAccount('411100', 'Clients', '5000000'),
      ]),
      sheetBlock('cash', 'Trésorerie actif', 4, '9500000', [
        sheetAccount('521000', 'Banque principale', '9500000'),
      ]),
    ],
    total: '16500000.000000',
  },
  liabilities: {
    blocks: [
      sheetBlock(
        'equity',
        'Capitaux propres',
        1,
        '12500000',
        [sheetAccount('101300', 'Capital souscrit, appelé, versé', '10000000')],
        '2500000.000000',
      ),
      sheetBlock('financial', 'Dettes financières', 2, '2000000', [
        sheetAccount('162000', 'Emprunts', '2000000'),
      ]),
      sheetBlock('current', 'Passif circulant', 3, '2000000', [
        sheetAccount('401100', 'Fournisseurs', '2000000'),
      ]),
      sheetBlock('cash', 'Trésorerie passif', 4, '0', []),
    ],
    total: '16500000.000000',
  },
  result: '2500000.000000',
  result_name: 'Résultat de l’exercice',
  unclassified: [],
  warnings: [],
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
    if (parts[0] === 'balance' && parts.length === 1) {
      return this.balance(route, url, permissions, company);
    }
    if (parts[0] === 'general-ledger' && parts.length === 1) {
      return this.generalLedger(route, url, permissions, company);
    }
    if (parts[0] === 'partner-ledger' && parts.length === 1) {
      return this.partnersLedger(route, url, permissions, company);
    }
    if (parts[0] === 'balance-sheet' && parts.length === 1) {
      if (!permissions.includes('reporting.read_financial_statements')) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
      const to = url.searchParams.get('date_to');
      if (!url.searchParams.get('date_from') || !to) {
        return this.answer(route, 400, error('reporting_scope_required'));
      }
      return this.answer(route, 200, balanceSheet(to));
    }
    if (parts[0] === 'income-statement' && parts.length === 1) {
      if (!permissions.includes('reporting.read_financial_statements')) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
      const from = url.searchParams.get('date_from');
      const to = url.searchParams.get('date_to');
      if (!from || !to) {
        return this.answer(route, 400, error('reporting_scope_required'));
      }
      return this.answer(route, 200, incomeStatement(from, to));
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
    // Partner ledger: the lines of the tiers accounts asked (Odoo's receivable, payable).
    const tiers = tiersTypes(url.searchParams.getAll('tiers'), false);
    const typeOf = (accountId: string) =>
      books.accounts.find((item) => item.public_id === accountId)?.detailed_type ?? '';
    const matches = (line: LineJson) =>
      isPartner
        ? line.partner?.public_id === id &&
          (tiers.length === 0 || tiers.includes(typeOf(line.account.public_id)))
        : line.account.public_id === id;
    const from = url.searchParams.get('date_from') || year.start_date;
    const to = url.searchParams.get('date_to') || year.end_date;
    const journals = url.searchParams.getAll('journal');
    const pending = url.searchParams.get('include_unposted') === 'true';
    const counted = this.entries
      .entries(company)
      .filter(
        (entry) =>
          (pending || entry.status === 'validated' || entry.status === 'locked') &&
          entry.entry_date >= year.start_date &&
          entry.entry_date <= to &&
          (journals.length === 0 || journals.includes(entry.journal.public_id)),
      )
      .sort((a, b) => a.entry_date.localeCompare(b.entry_date));
    // The « Solde initial »: the debits and the credits before the period (as the server's).
    let openingDebit = 0n;
    let openingCredit = 0n;
    for (const entry of counted.filter((item) => item.entry_date < from)) {
      for (const line of entry.lines.filter(matches)) {
        openingDebit += units(line.reference_debit);
        openingCredit += units(line.reference_credit);
      }
    }
    let running = openingDebit - openingCredit;
    let debit = 0n;
    let credit = 0n;
    const rows = counted
      .filter((entry) => entry.entry_date >= from)
      .flatMap((entry: EntryJson) =>
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
            lettering: '',
            due_date: null,
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
        date_from: from,
        date_to: to,
      },
      comparative_scope: null,
      opening_balance: decimal(openingDebit - openingCredit),
      opening_debit: decimal(openingDebit),
      opening_credit: decimal(openingCredit),
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
   * The trial balance of the fake entries, as the server's (notes backend 0051, 0052): the
   * opening at the start of the first period, each period's movements (the comparison's
   * earlier ones first), the closing at the end; the classes and groups; the journals and
   * drafts asked; the drafts before or within the period said.
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
    const holds = (day: string) =>
      books.years.find((item) => item.start_date <= day && day <= item.end_date);
    const year = holds(from);
    const starts = url.searchParams.getAll('column_from');
    const ends = url.searchParams.getAll('column_to');
    const periods = [
      ...starts.map((start, index) => ({ from: start, to: ends[index] })),
      { from, to },
    ];
    const ordered = periods.every(
      (period, index) =>
        period.from <= period.to && (index === 0 || periods[index - 1].to < period.from),
    );
    if (!year || to > year.end_date || starts.length !== ends.length || !ordered) {
      return this.answer(route, 400, error('reporting_scope_invalid'));
    }
    const first = periods[0];
    const openingYear = holds(first.from);
    const start = openingYear?.start_date ?? first.from;
    const journals = url.searchParams.getAll('journal');
    const pending = url.searchParams.get('include_unposted') === 'true';
    const search = (url.searchParams.get('search') ?? '').toLowerCase();
    const inScope = this.entries
      .entries(company)
      .filter(
        (entry) =>
          entry.entry_date >= start &&
          entry.entry_date <= to &&
          (journals.length === 0 || journals.includes(entry.journal.public_id)),
      );
    const counted = inScope.filter(
      (entry) => pending || entry.status === 'validated' || entry.status === 'locked',
    );
    const found = new Map<string, Figures>();
    for (const entry of counted) {
      for (const line of entry.lines) {
        const sum = found.get(line.account.public_id) ?? empty(periods.length);
        const debit = units(line.reference_debit);
        const credit = units(line.reference_credit);
        const day = entry.entry_date;
        if (openingYear && day >= openingYear.start_date && day < first.from) {
          sum.opening += debit - credit;
        }
        if (day >= year.start_date) {
          sum.closing += debit - credit;
        }
        const index = periods.findIndex((period) => period.from <= day && day <= period.to);
        if (index >= 0) {
          sum.debits[index] += debit;
          sum.credits[index] += credit;
        }
        found.set(line.account.public_id, sum);
      }
    }
    const rows = books.accounts
      .filter(
        (account) =>
          found.has(account.public_id) &&
          (!search ||
            account.code.toLowerCase().includes(search) ||
            account.name.toLowerCase().includes(search)),
      )
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((account) => ({ account, figures: found.get(account.public_id)! }));
    const all = empty(periods.length);
    const groups = new Map<string, Figures>();
    for (const row of rows) {
      add(all, row.figures);
      for (const width of [1, 2]) {
        const code = row.account.code.slice(0, width);
        const group = groups.get(code) ?? empty(periods.length);
        add(group, row.figures);
        groups.set(code, group);
      }
    }
    const unposted = inScope.filter(
      (entry) => entry.status === 'draft' || entry.status === 'submitted',
    ).length;
    const size = Number(url.searchParams.get('page_size')) || 50;
    const number = Number(url.searchParams.get('page')) || 1;
    const last = periods.length - 1;
    return this.answer(route, 200, {
      scope: {
        fiscal_year: { public_id: year.public_id, code: year.code },
        period: null,
        date_from: from,
        date_to: to,
      },
      comparative_scope: null,
      periods: periods.map((period) => ({
        date_from: period.from,
        date_to: period.to,
        label: label(period.from, period.to),
      })),
      totals: {
        opening: decimal(all.opening),
        debit: decimal(all.debits[last]),
        credit: decimal(all.credits[last]),
        closing: decimal(all.closing),
      },
      movements: json(all).movements,
      groups: [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([code, figures]) => ({
          code,
          name: GROUP_NAMES[code] ?? '',
          level: code.length,
          ...json(figures),
        })),
      comparison: null,
      warnings:
        !pending && unposted > 0
          ? [
              {
                code: 'unposted_entries',
                message: 'Draft or submitted entries before or within the period are left out.',
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
        debit: decimal(row.figures.debits[last]),
        credit: decimal(row.figures.credits[last]),
        ...json(row.figures),
        comparison: null,
        drilldown: { level: 'ledger', account: row.account.public_id },
      })),
    });
  }

  /**
   * The general ledger of the fake entries, as the server's (note backend 0053): per account,
   * its debits and credits before the period, the period's, its balance at the end; the
   * drafts before or within the period said.
   */
  private async generalLedger(
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
    const only = url.searchParams.get('account');
    const journals = url.searchParams.getAll('journal');
    const pending = url.searchParams.get('include_unposted') === 'true';
    const search = (url.searchParams.get('search') ?? '').toLowerCase();
    const inYear = this.entries
      .entries(company)
      .filter(
        (entry) =>
          entry.entry_date >= year.start_date &&
          entry.entry_date <= to &&
          (journals.length === 0 || journals.includes(entry.journal.public_id)),
      );
    interface Sums {
      od: bigint;
      oc: bigint;
      d: bigint;
      c: bigint;
    }
    const found = new Map<string, Sums>();
    for (const entry of inYear.filter(
      (item) => pending || item.status === 'validated' || item.status === 'locked',
    )) {
      for (const line of entry.lines) {
        const sum = found.get(line.account.public_id) ?? { od: 0n, oc: 0n, d: 0n, c: 0n };
        const debit = units(line.reference_debit);
        const credit = units(line.reference_credit);
        if (entry.entry_date < from) {
          sum.od += debit;
          sum.oc += credit;
        } else {
          sum.d += debit;
          sum.c += credit;
        }
        found.set(line.account.public_id, sum);
      }
    }
    const figures = (sum: Sums) => ({
      opening_debit: decimal(sum.od),
      opening_credit: decimal(sum.oc),
      opening: decimal(sum.od - sum.oc),
      debit: decimal(sum.d),
      credit: decimal(sum.c),
      total_debit: decimal(sum.od + sum.d),
      total_credit: decimal(sum.oc + sum.c),
      closing: decimal(sum.od - sum.oc + sum.d - sum.c),
    });
    const rows = books.accounts
      .filter(
        (account) =>
          found.has(account.public_id) &&
          (!only || account.public_id === only) &&
          (!search ||
            account.code.toLowerCase().includes(search) ||
            account.name.toLowerCase().includes(search)),
      )
      .sort((a, b) => a.code.localeCompare(b.code));
    const total: Sums = { od: 0n, oc: 0n, d: 0n, c: 0n };
    for (const account of rows) {
      const sum = found.get(account.public_id)!;
      total.od += sum.od;
      total.oc += sum.oc;
      total.d += sum.d;
      total.c += sum.c;
    }
    const unposted = inYear.filter(
      (entry) => entry.status === 'draft' || entry.status === 'submitted',
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
      period: label(from, to),
      totals: figures(total),
      warnings:
        !pending && unposted > 0
          ? [
              {
                code: 'unposted_entries',
                message: 'Draft or submitted entries before or within the period are left out.',
                details: { count: unposted },
              },
            ]
          : [],
      count: rows.length,
      next: null,
      previous: null,
      results: rows.slice((number - 1) * size, number * size).map((account) => ({
        account: {
          public_id: account.public_id,
          code: account.code,
          name: account.name,
          account_type: account.account_type,
        },
        ...figures(found.get(account.public_id)!),
        drilldown: { level: 'ledger', account: account.public_id },
      })),
    });
  }

  /**
   * The partner ledger of the fake entries, as the server's (note backend 0054): per partner
   * of the tiers accounts asked, its debits and credits before the period, the period's, its
   * balance at the end.
   */
  private async partnersLedger(
    route: Route,
    url: URL,
    permissions: readonly string[],
    company: string,
  ): Promise<void> {
    if (!permissions.includes('reporting.read_auxiliary')) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    const from = url.searchParams.get('date_from') ?? '';
    const to = url.searchParams.get('date_to') ?? '';
    const books = this.accounting.books(company);
    const year = books.years.find((item) => item.start_date <= from && to <= item.end_date);
    if (!year || from > to) {
      return this.answer(route, 400, error('reporting_scope_invalid'));
    }
    const only = url.searchParams.get('partner');
    const types = tiersTypes(url.searchParams.getAll('tiers'));
    const journals = url.searchParams.getAll('journal');
    const pending = url.searchParams.get('include_unposted') === 'true';
    const search = (url.searchParams.get('search') ?? '').toLowerCase();
    const typeOf = (accountId: string) =>
      books.accounts.find((item) => item.public_id === accountId)?.detailed_type ?? '';
    const found = new Map<string, { od: bigint; oc: bigint; d: bigint; c: bigint }>();
    for (const entry of this.entries
      .entries(company)
      .filter(
        (item) =>
          item.entry_date >= year.start_date &&
          item.entry_date <= to &&
          (pending || item.status === 'validated' || item.status === 'locked') &&
          (journals.length === 0 || journals.includes(item.journal.public_id)),
      )) {
      for (const line of entry.lines) {
        const partner = line.partner?.public_id;
        if (!partner || !types.includes(typeOf(line.account.public_id))) {
          continue;
        }
        const sum = found.get(partner) ?? { od: 0n, oc: 0n, d: 0n, c: 0n };
        const debit = units(line.reference_debit);
        const credit = units(line.reference_credit);
        if (entry.entry_date < from) {
          sum.od += debit;
          sum.oc += credit;
        } else {
          sum.d += debit;
          sum.c += credit;
        }
        found.set(partner, sum);
      }
    }
    const figures = (sum: { od: bigint; oc: bigint; d: bigint; c: bigint }) => ({
      opening_debit: decimal(sum.od),
      opening_credit: decimal(sum.oc),
      opening: decimal(sum.od - sum.oc),
      debit: decimal(sum.d),
      credit: decimal(sum.c),
      total_debit: decimal(sum.od + sum.d),
      total_credit: decimal(sum.oc + sum.c),
      closing: decimal(sum.od - sum.oc + sum.d - sum.c),
    });
    const rows = this.partners
      .list(company)
      .filter(
        (partner) =>
          found.has(partner.public_id) &&
          (!only || partner.public_id === only) &&
          (!search ||
            partner.code.toLowerCase().includes(search) ||
            partner.name.toLowerCase().includes(search)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    const total = { od: 0n, oc: 0n, d: 0n, c: 0n };
    for (const partner of rows) {
      const sum = found.get(partner.public_id)!;
      total.od += sum.od;
      total.oc += sum.oc;
      total.d += sum.d;
      total.c += sum.c;
    }
    return this.answer(route, 200, {
      scope: {
        fiscal_year: { public_id: year.public_id, code: year.code },
        period: null,
        date_from: from,
        date_to: to,
      },
      comparative_scope: null,
      period: label(from, to),
      totals: figures(total),
      warnings: [],
      count: rows.length,
      next: null,
      previous: null,
      results: rows.map((partner) => ({
        partner: { public_id: partner.public_id, code: partner.code, name: partner.name },
        ...figures(found.get(partner.public_id)!),
        drilldown: { level: 'partner_ledger', partner: partner.public_id },
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
