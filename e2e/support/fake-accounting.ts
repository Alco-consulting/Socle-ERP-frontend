import { Request, Route } from '@playwright/test';

import { PartnersContext } from './fake-partners';

/**
 * The accounting referential of the fake API (`accounting/`), shaped like the OpenAPI
 * schemas (`AccountingFiscalYear`, `AccountingPeriod`, `AccountingJournal`,
 * `AccountingAccount`, paginated lists) and company scoped like the server (another
 * company's record is a 404). Rules played as the backend does: code fixed after creation,
 * unique codes, postable = active + entries allowed + no sub-account (default settings),
 * order by code (by start date for periods, most recent first for fiscal years). The
 * entries are served by `FakeAccountingEntries`.
 */

const STAMP = '2026-09-01T09:00:00Z';
let sequence = 0;
const uuid = () => `10000000-0000-4000-9000-${String(++sequence).padStart(12, '0')}`;

export interface FiscalYearJson {
  public_id: string;
  code: string;
  label: string;
  start_date: string;
  end_date: string;
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
}

export interface PeriodJson extends Omit<FiscalYearJson, never> {
  fiscal_year: string;
}

export interface JournalJson {
  public_id: string;
  code: string;
  name: string;
  journal_type: string;
  default_currency: string | null;
  sequence_prefix: string;
  sequence_padding: number;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export interface AccountJson {
  public_id: string;
  code: string;
  name: string;
  description: string;
  parent: string | null;
  account_type: string;
  detailed_type: string;
  currency: string | null;
  allowed_journals: string[];
  default_taxes: string[];
  code_group: string;
  account_class: string;
  allow_entries: boolean;
  letterable: boolean;
  status: 'active' | 'inactive';
  has_children: boolean;
  created_at: string;
  updated_at: string;
}

interface Books {
  years: FiscalYearJson[];
  periods: PeriodJson[];
  journals: JournalJson[];
  accounts: AccountJson[];
  /** How many entries of each status the fake entries seed (fake-accounting-entries.ts). */
  entries: Record<string, number>;
}

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin'];

function year(code: string, status: 'open' | 'closed'): FiscalYearJson {
  return {
    public_id: uuid(),
    code: `FY${code}`,
    label: `Exercice ${code}`,
    start_date: `${code}-01-01`,
    end_date: `${code}-12-31`,
    status,
    created_at: STAMP,
    updated_at: STAMP,
  };
}

function periods(fiscal: FiscalYearJson, closed: number): PeriodJson[] {
  const y = fiscal.start_date.slice(0, 4);
  return MONTHS.map((month, index) => {
    const m = String(index + 1).padStart(2, '0');
    return {
      public_id: uuid(),
      fiscal_year: fiscal.public_id,
      code: `${y}-${m}`,
      label: `${month} ${y}`,
      start_date: `${y}-${m}-01`,
      end_date: `${y}-${m}-28`,
      status: index < closed ? 'closed' : 'open',
      created_at: STAMP,
      updated_at: STAMP,
    };
  });
}

function journal(
  code: string,
  name: string,
  type: string,
  extra: Partial<JournalJson> = {},
): JournalJson {
  return {
    public_id: uuid(),
    code,
    name,
    journal_type: type,
    default_currency: null,
    sequence_prefix: `${code}-`,
    sequence_padding: 6,
    status: 'active',
    created_at: STAMP,
    updated_at: STAMP,
    ...extra,
  };
}

function chart(
  rows: [string, string, string, string | null, Partial<AccountJson>?][],
): AccountJson[] {
  const accounts: AccountJson[] = rows.map(([code, name, type, , extra]) => ({
    public_id: uuid(),
    code,
    name,
    description: '',
    parent: null,
    account_type: type,
    detailed_type: '',
    currency: null,
    allowed_journals: [],
    default_taxes: [],
    code_group: code.slice(0, 2),
    account_class: code.charAt(0),
    allow_entries: true,
    letterable: false,
    status: 'active',
    has_children: false,
    created_at: STAMP,
    updated_at: STAMP,
    ...extra,
  }));
  rows.forEach(([, , , parentCode], index) => {
    const parent = accounts.find((item) => item.code === parentCode);
    if (parent) {
      accounts[index].parent = parent.public_id;
      parent.has_children = true;
    }
  });
  return accounts;
}

export function seedAccounting(): Record<string, Books> {
  const a2026 = year('2026', 'open');
  const a2025 = year('2025', 'closed');
  const b2026 = year('2026', 'open');
  return {
    A: {
      years: [a2026, a2025],
      periods: [...periods(a2026, 2), ...periods(a2025, 6)],
      journals: [
        journal('ACH', 'Achats', 'purchase'),
        journal('VTE', 'Ventes', 'sales'),
        journal('BQ1', 'Banque principale', 'bank', { default_currency: 'GNF' }),
        journal('CAI', 'Caisse', 'cash'),
        journal('OD', 'Opérations diverses', 'general'),
        journal('ANC', 'Ancien journal', 'other', { status: 'inactive' }),
      ],
      accounts: chart([
        ['4', 'Comptes de tiers', 'liability', null, { allow_entries: false }],
        ['40', 'Fournisseurs et comptes rattachés', 'liability', '4', { allow_entries: false }],
        ['401', 'Fournisseurs', 'liability', '40', { letterable: true }],
        ['404', 'Fournisseurs d’immobilisations', 'liability', '40'],
        ['41', 'Clients et comptes rattachés', 'asset', '4', { allow_entries: false }],
        ['411', 'Clients', 'asset', '41', { letterable: true }],
        ['6', 'Comptes de charges', 'expense', null, { allow_entries: false }],
        ['60', 'Achats', 'expense', '6', { allow_entries: false }],
        ['601', 'Achats de marchandises', 'expense', '60'],
        ['604', 'Achats stockés de matières', 'expense', '60', { status: 'inactive' }],
      ]),
      entries: { draft: 12, submitted: 4, validated: 29, locked: 3 },
    },
    B: {
      years: [b2026],
      periods: periods(b2026, 0),
      journals: [journal('SN-VTE', 'Ventes Dakar', 'sales', { default_currency: 'XOF' })],
      accounts: chart([
        ['7', 'Comptes de produits', 'income', null, { allow_entries: false }],
        ['701', 'Ventes de marchandises', 'income', '7'],
      ]),
      entries: { draft: 1, submitted: 0, validated: 5, locked: 0 },
    },
  };
}

const error = (code: string, details: unknown = null) => ({
  error: { code, message: code, details, correlation_id: 'e2e' },
});

const JOURNAL_FIELDS = [
  'name',
  'journal_type',
  'default_currency',
  'sequence_prefix',
  'sequence_padding',
];
const ACCOUNT_FIELDS = [
  'name',
  'description',
  'account_type',
  'detailed_type',
  'currency',
  'allowed_journals',
  'default_taxes',
  'account_class',
  'allow_entries',
  'letterable',
  'parent',
];

/** The nature of a type, as the server knows it (`DETAILED_NATURE`). */
function natureOf(detailed: unknown): string {
  const prefix = String(detailed ?? '').split('_')[0];
  return prefix === 'off' ? 'other' : prefix;
}

/** A few SYSCOHADA prefixes of the server's standard (`data/syscohada.json`): what tests use. */
const SYSCOHADA: readonly [string, string][] = [
  ['40', 'liability_payable'],
  ['41', 'asset_receivable'],
  ['52', 'asset_cash'],
  ['57', 'asset_cash'],
  ['6', 'expense'],
  ['7', 'income'],
];

function syscohadaTypeOf(code: string): string {
  return SYSCOHADA.find(([prefix]) => code.startsWith(prefix))?.[1] ?? 'liability_current';
}

/** Accounts per first character and first two of their code (counts of the server). */
function prefixesOf(accounts: readonly AccountJson[], url: URL) {
  const q = (name: string) => url.searchParams.get(name);
  const search = q('search')?.toLowerCase();
  const chosen = accounts.filter(
    (item) =>
      (!search ||
        item.code.toLowerCase().includes(search) ||
        item.name.toLowerCase().includes(search)) &&
      (!q('status') || item.status === q('status')) &&
      (!q('account_type') || item.account_type === q('account_type')),
  );
  const firsts = [...new Set(chosen.map((item) => item.code.charAt(0)))].sort();
  return firsts.map((first) => {
    const group = chosen.filter((item) => item.code.startsWith(first));
    const seconds = [
      ...new Set(group.filter((item) => item.code.length > 1).map((item) => item.code.slice(0, 2))),
    ].sort();
    return {
      prefix: first,
      count: group.length,
      children: seconds.map((prefix) => ({
        prefix,
        count: group.filter((item) => item.code.startsWith(prefix)).length,
      })),
    };
  });
}

export class FakeAccounting {
  readonly byCompany: Record<string, Books> = seedAccounting();

  constructor(private readonly context: PartnersContext) {}

  books(company: string): Books {
    return (this.byCompany[company] ??= {
      years: [],
      periods: [],
      journals: [],
      accounts: [],
      entries: {},
    });
  }

  async install(): Promise<void> {
    await this.context.page.route('**/api/v1/accounting/**', (route) => this.handle(route));
  }

  private async answer(route: Route, status: number, json?: unknown): Promise<void> {
    this.context.calls.push(route.request());
    await route.fulfill({ status, json });
  }

  private paged<T>(route: Route, items: T[]): Promise<void> {
    const url = new URL(route.request().url());
    const size = Number(url.searchParams.get('page_size')) || 50;
    const number = Number(url.searchParams.get('page')) || 1;
    const results = items.slice((number - 1) * size, number * size);
    if (number > 1 && results.length === 0) {
      return this.answer(route, 404, error('not_found'));
    }
    return this.answer(route, 200, { count: items.length, next: null, previous: null, results });
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const permissions = await this.context.permissionsOf(request);
    if (!permissions.includes('accounting.read')) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    const method = request.method();
    if (method !== 'GET' && !(await this.context.csrfOk(request))) {
      return this.answer(route, 403, error('csrf_failed'));
    }
    const books = this.books(await this.context.companyOf(request));
    const url = new URL(request.url());
    const query = (name: string) => url.searchParams.get(name);
    const [resource, id, command] = url.pathname.replace('/api/v1/accounting/', '').split('/');

    switch (resource) {
      case 'fiscal-years':
        return this.paged(
          route,
          books.years.filter((item) => !query('status') || item.status === query('status')),
        );
      case 'periods':
        return this.paged(
          route,
          books.periods.filter(
            (item) =>
              (!query('fiscal_year') || item.fiscal_year === query('fiscal_year')) &&
              (!query('status') || item.status === query('status')),
          ),
        );
      case 'journals':
        return this.journals(route, request, books, permissions, id, command);
      case 'accounts':
        return this.accounts(route, request, books, permissions, id, command);
      default:
        return this.answer(route, 404, error('not_found'));
    }
  }

  private async journals(
    route: Route,
    request: Request,
    books: Books,
    permissions: readonly string[],
    id: string,
    command: string,
  ): Promise<void> {
    const method = request.method();
    if (!id) {
      if (method === 'POST') {
        if (!permissions.includes('accounting.manage_journals')) {
          return this.answer(route, 403, error('company_permission_denied'));
        }
        const body = request.postDataJSON() as Record<string, unknown>;
        const code = String(body['code'] ?? '')
          .trim()
          .toUpperCase();
        if (books.journals.some((item) => item.code === code)) {
          return this.answer(route, 400, error('accounting_journal_code_exists'));
        }
        const created = journal(code, String(body['name']), String(body['journal_type']), {
          default_currency: (body['default_currency'] as string | null) ?? null,
          sequence_prefix: String(body['sequence_prefix'] ?? ''),
          sequence_padding: Number(body['sequence_padding'] ?? 6),
        });
        books.journals.push(created);
        return this.answer(route, 201, created);
      }
      const url = new URL(request.url());
      const q = (name: string) => url.searchParams.get(name);
      return this.paged(
        route,
        books.journals
          .filter(
            (item) =>
              (!q('code') || item.code === q('code')?.toUpperCase()) &&
              (!q('status') || item.status === q('status')) &&
              (!q('journal_type') || item.journal_type === q('journal_type')),
          )
          .sort((a, b) => a.code.localeCompare(b.code)),
      );
    }
    const found = books.journals.find((item) => item.public_id === id);
    if (!found) {
      return this.answer(route, 404, error('not_found'));
    }
    if (method === 'GET') {
      return this.answer(route, 200, found);
    }
    if (!permissions.includes('accounting.manage_journals')) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    if (method === 'PATCH') {
      const body = request.postDataJSON() as Record<string, unknown>;
      for (const name of JOURNAL_FIELDS) {
        if (name in body) {
          (found as unknown as Record<string, unknown>)[name] = body[name];
        }
      }
      return this.answer(route, 200, found);
    }
    found.status = command === 'deactivate' ? 'inactive' : 'active';
    return this.answer(route, 200, found);
  }

  private async accounts(
    route: Route,
    request: Request,
    books: Books,
    permissions: readonly string[],
    id: string,
    command: string,
  ): Promise<void> {
    const method = request.method();
    const postable = (item: AccountJson) =>
      item.status === 'active' && item.allow_entries && !item.has_children;
    if (!id) {
      if (method === 'POST') {
        if (!permissions.includes('accounting.manage_accounts')) {
          return this.answer(route, 403, error('company_permission_denied'));
        }
        const body = request.postDataJSON() as Record<string, unknown>;
        const code = String(body['code'] ?? '')
          .trim()
          .toUpperCase();
        if (books.accounts.some((item) => item.code === code)) {
          return this.answer(route, 400, error('accounting_account_code_exists'));
        }
        const parent = books.accounts.find((item) => item.public_id === body['parent']);
        // Neither type nor nature: the SYSCOHADA type of the code (only what the tests use).
        const detailed = String(
          body['detailed_type'] ?? (body['account_type'] ? '' : syscohadaTypeOf(code)),
        );
        const created: AccountJson = {
          ...chart([
            [code, String(body['name']), String(body['account_type'] ?? natureOf(detailed)), null],
          ])[0],
          allowed_journals: (body['allowed_journals'] as string[] | undefined) ?? [],
          default_taxes: (body['default_taxes'] as string[] | undefined) ?? [],
          description: String(body['description'] ?? ''),
          detailed_type: detailed,
          currency: (body['currency'] as string | null) ?? null,
          account_class: String(body['account_class'] ?? ''),
          allow_entries: body['allow_entries'] !== false,
          // Unless said, customers and suppliers are lettered.
          letterable:
            typeof body['letterable'] === 'boolean'
              ? body['letterable']
              : detailed === 'asset_receivable' || detailed === 'liability_payable',
          parent: parent?.public_id ?? null,
        };
        if (parent) {
          parent.has_children = true;
        }
        books.accounts.push(created);
        return this.answer(route, 201, created);
      }
      const url = new URL(request.url());
      const q = (name: string) => url.searchParams.get(name);
      const search = q('search')?.toLowerCase();
      const prefix = q('code_prefix')?.toUpperCase();
      return this.paged(
        route,
        books.accounts
          .filter(
            (item) =>
              (!q('code') || item.code === q('code')?.toUpperCase()) &&
              (!search ||
                item.code.toLowerCase().includes(search) ||
                item.name.toLowerCase().includes(search)) &&
              (!q('status') || item.status === q('status')) &&
              (!q('account_type') || item.account_type === q('account_type')) &&
              (!prefix || item.code.startsWith(prefix)) &&
              (q('postable') === null || postable(item) === (q('postable') === 'true')),
          )
          .sort((a, b) => a.code.localeCompare(b.code)),
      );
    }
    if (id === 'prefixes') {
      return this.answer(route, 200, prefixesOf(books.accounts, new URL(request.url())));
    }
    const found = books.accounts.find((item) => item.public_id === id);
    if (!found) {
      return this.answer(route, 404, error('not_found'));
    }
    if (command === 'children') {
      return this.paged(
        route,
        books.accounts.filter((item) => item.parent === found.public_id),
      );
    }
    if (method === 'GET') {
      return this.answer(route, 200, found);
    }
    if (!permissions.includes('accounting.manage_accounts')) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    if (method === 'PATCH') {
      const body = request.postDataJSON() as Record<string, unknown>;
      if ('parent' in body && body['parent']) {
        // A move under one of its own descendants is refused by the server.
        let cursor = books.accounts.find((item) => item.public_id === body['parent']);
        while (cursor) {
          if (cursor.public_id === found.public_id) {
            return this.answer(route, 400, error('accounting_account_cycle'));
          }
          cursor = books.accounts.find((item) => item.public_id === cursor?.parent);
        }
      }
      for (const name of ACCOUNT_FIELDS) {
        if (name in body) {
          (found as unknown as Record<string, unknown>)[name] = body[name];
        }
      }
      if (body['detailed_type'] && !('account_type' in body)) {
        found.account_type = natureOf(body['detailed_type']);
      }
      return this.answer(route, 200, found);
    }
    found.status = command === 'deactivate' ? 'inactive' : 'active';
    return this.answer(route, 200, found);
  }
}
