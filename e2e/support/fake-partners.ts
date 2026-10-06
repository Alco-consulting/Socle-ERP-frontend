import { Page, Request, Route } from '@playwright/test';

/**
 * The partners part of the fake API (`partners/`, `currencies/`, `imports-exports/` for
 * partners), company scoped by `X-Company-ID` like the server: a partner of another company
 * is a 404. Only the rules the tests need are played: required fields, unique code,
 * permissions, search / filters / pages, all-or-nothing import.
 */

export interface PartnerJson {
  public_id: string;
  code: string;
  name: string;
  legal_name: string;
  is_customer: boolean;
  is_supplier: boolean;
  country: string;
  tax_identifier: string;
  status: 'active' | 'inactive';
  registration_number: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  default_currency: string | null;
  customer_payment_term: null;
  supplier_payment_term: null;
  default_tax_code: string;
  customer_account_code: string;
  supplier_account_code: string;
  created_at: string;
  updated_at: string;
}

type Seed = Pick<PartnerJson, 'code' | 'name'> & Partial<PartnerJson>;

let sequence = 0;

export function partner(seed: Seed): PartnerJson {
  sequence += 1;
  return {
    public_id: `00000000-0000-4000-9000-${String(sequence).padStart(12, '0')}`,
    legal_name: '',
    is_customer: false,
    is_supplier: false,
    country: 'GN',
    tax_identifier: '',
    status: 'active',
    registration_number: '',
    address: '',
    city: '',
    phone: '',
    email: '',
    default_currency: null,
    customer_payment_term: null,
    supplier_payment_term: null,
    default_tax_code: '',
    customer_account_code: '',
    supplier_account_code: '',
    created_at: '2026-09-01T09:00:00Z',
    updated_at: '2026-09-01T09:00:00Z',
    ...seed,
  };
}

/** Partners of company A (7) and of company B (2): none in common. */
export function seedPartners(): Record<string, PartnerJson[]> {
  return {
    A: [
      partner({ code: 'CLI-001', name: 'Dupont SARL', is_customer: true, city: 'Conakry' }),
      partner({
        code: 'CLI-002',
        name: 'Bah Commerce',
        is_customer: true,
        tax_identifier: 'NIF-2',
      }),
      partner({ code: 'CLI-003', name: 'Ancien Client', is_customer: true, status: 'inactive' }),
      partner({
        code: 'FOU-001',
        name: 'Diallo et Cie',
        is_supplier: true,
        phone: '622 11 22 33',
        supplier_account_code: '401',
      }),
      partner({ code: 'FOU-002', name: 'Sow Import-Export', is_supplier: true, country: 'SN' }),
      partner({ code: 'MIX-001', name: 'Camara Services', is_customer: true, is_supplier: true }),
      partner({ code: 'OTH-001', name: 'Barry Conseil' }),
    ],
    B: [
      partner({ code: 'SN-CLI-01', name: 'Client Dakar', is_customer: true, country: 'SN' }),
      partner({ code: 'SN-FOU-01', name: 'Fournisseur Thiès', is_supplier: true, country: 'SN' }),
    ],
  };
}

const WRITABLE = [
  'name',
  'legal_name',
  'is_customer',
  'is_supplier',
  'tax_identifier',
  'registration_number',
  'country',
  'address',
  'city',
  'phone',
  'email',
  'default_currency',
  'default_tax_code',
  'customer_account_code',
  'supplier_account_code',
] as const;

export const IMPORT_FIELDS = [
  { name: 'code', kind: 'code', required: true },
  { name: 'name', kind: 'text', required: true },
  { name: 'country', kind: 'code', required: true },
  { name: 'legal_name', kind: 'text', required: false },
  { name: 'is_customer', kind: 'boolean', required: false },
  { name: 'is_supplier', kind: 'boolean', required: false },
  { name: 'email', kind: 'text', required: false },
];

const error = (code: string, details: unknown = null) => ({
  error: { code, message: code, details, correlation_id: 'e2e' },
});

const page = <T>(items: T[], request: Request) => {
  const url = new URL(request.url());
  const size = Number(url.searchParams.get('page_size')) || 50;
  const number = Number(url.searchParams.get('page')) || 1;
  const results = items.slice((number - 1) * size, number * size);
  return number > 1 && results.length === 0
    ? null
    : { count: items.length, next: null, previous: null, results };
};

export interface PartnersContext {
  readonly page: Page;
  readonly calls: Request[];
  /** Company key (`A`, `B`…) of the request, from `X-Company-ID`. */
  companyOf(request: Request): Promise<string>;
  /** Permissions of the user in the company of the request. */
  permissionsOf(request: Request): Promise<readonly string[]>;
  csrfOk(request: Request): Promise<boolean>;
}

interface ImportRun {
  public_id: string;
  company: string;
  status: string;
  filename: string;
  headers: string[];
  rows: string[][];
  columns: Record<string, string>;
  summary: Record<string, unknown>;
}

export class FakePartners {
  readonly byCompany: Record<string, PartnerJson[]> = seedPartners();
  private readonly runs = new Map<string, ImportRun>();

  constructor(private readonly context: PartnersContext) {}

  list(company: string): PartnerJson[] {
    return (this.byCompany[company] ??= []);
  }

  async install(): Promise<void> {
    const { page } = this.context;
    await page.route('**/api/v1/currencies/**', (route) =>
      this.answer(route, 200, {
        count: 3,
        next: null,
        previous: null,
        results: [
          { code: 'GNF', name: 'Franc guinéen', decimal_places: 0, status: 'active' },
          { code: 'XOF', name: 'Franc CFA (BCEAO)', decimal_places: 0, status: 'active' },
          { code: 'EUR', name: 'Euro', decimal_places: 2, status: 'active' },
        ],
      }),
    );
    await page.route('**/api/v1/partners/**', (route) => this.partners(route));
    await page.route('**/api/v1/imports-exports/**', (route) => this.transfers(route));
  }

  private async answer(route: Route, status: number, json?: unknown): Promise<void> {
    this.context.calls.push(route.request());
    await route.fulfill({ status, json });
  }

  private async partners(route: Route): Promise<void> {
    const request = route.request();
    const permissions = await this.context.permissionsOf(request);
    if (!permissions.includes('partners.read')) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    const path = new URL(request.url()).pathname.replace('/api/v1/partners/', '');
    const list = this.list(await this.context.companyOf(request));
    const method = request.method();
    if (method !== 'GET' && !(await this.context.csrfOk(request))) {
      return this.answer(route, 403, error('csrf_failed'));
    }
    if (path === 'payment-terms/') {
      return this.answer(route, 200, { count: 0, next: null, previous: null, results: [] });
    }
    if (path === '') {
      if (method === 'POST') {
        return permissions.includes('partners.create')
          ? this.create(route, list)
          : this.answer(route, 403, error('company_permission_denied'));
      }
      const url = new URL(request.url());
      const search = url.searchParams.get('search')?.toLowerCase();
      const role = url.searchParams.get('role');
      const status = url.searchParams.get('status');
      const country = url.searchParams.get('country')?.toUpperCase();
      const code = url.searchParams.get('code')?.toUpperCase();
      const found = list
        .filter(
          (item) =>
            (!code || item.code === code) &&
            (!search ||
              [item.code, item.name, item.legal_name, item.tax_identifier].some((text) =>
                text.toLowerCase().includes(search),
              )) &&
            (!role ||
              (role === 'customer'
                ? item.is_customer
                : role === 'supplier'
                  ? item.is_supplier
                  : !item.is_customer && !item.is_supplier)) &&
            (!status || item.status === status) &&
            (!country || item.country === country),
        )
        .sort((a, b) => a.code.localeCompare(b.code));
      const result = page(found, request);
      return result ? this.answer(route, 200, result) : this.answer(route, 404, error('not_found'));
    }
    const [id, command] = path.split('/');
    const found = list.find((item) => item.public_id === id);
    if (!found) {
      return this.answer(route, 404, error('not_found'));
    }
    if (method === 'GET') {
      return this.answer(route, 200, found);
    }
    if (method === 'PATCH') {
      if (!permissions.includes('partners.update')) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
      const body = request.postDataJSON() as Record<string, unknown>;
      for (const name of WRITABLE) {
        if (name in body) {
          (found as unknown as Record<string, unknown>)[name] = body[name];
        }
      }
      return this.answer(route, 200, found);
    }
    if (!permissions.includes('partners.disable')) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    found.status = command === 'deactivate' ? 'inactive' : 'active';
    return this.answer(route, 200, found);
  }

  private async create(route: Route, list: PartnerJson[]): Promise<void> {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const missing = ['code', 'name', 'country'].filter((name) => !String(body[name] ?? '').trim());
    if (missing.length) {
      const details = Object.fromEntries(
        missing.map((name) => [name, [{ message: 'This field may not be blank.', code: 'blank' }]]),
      );
      return this.answer(route, 400, error('validation_error', details));
    }
    const code = String(body['code']).trim().toUpperCase();
    if (list.some((item) => item.code === code)) {
      return this.answer(route, 400, error('partner_code_exists'));
    }
    const created = partner({
      code,
      name: String(body['name']).trim(),
      ...Object.fromEntries(
        WRITABLE.filter((name) => name in body).map((name) => [name, body[name]]),
      ),
      country: String(body['country']).trim().toUpperCase(),
    });
    list.push(created);
    return this.answer(route, 201, created);
  }

  // ---- Imports and exports of partners -------------------------------------------------

  private async transfers(route: Route): Promise<void> {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1/imports-exports/', '');
    const company = await this.context.companyOf(request);
    if (request.method() !== 'GET' && !(await this.context.csrfOk(request))) {
      return this.answer(route, 403, error('csrf_failed'));
    }
    if (path === 'import-types/') {
      return this.answer(route, 200, [{ import_type: 'partners', fields: IMPORT_FIELDS }]);
    }
    if (path === 'exports/') {
      const body = request.postDataJSON() as { parameters: Record<string, string> };
      const rows = this.list(company).filter(
        (item) =>
          (!body.parameters['status'] || item.status === body.parameters['status']) &&
          (!body.parameters['role'] ||
            (body.parameters['role'] === 'customer' ? item.is_customer : item.is_supplier)),
      );
      return this.answer(route, 201, {
        public_id: `export-${company}`,
        export_type: 'partners',
        status: 'completed',
        filename: 'partners.csv',
        row_count: rows.length,
        error: {},
      });
    }
    if (path.startsWith('exports/')) {
      this.context.calls.push(request);
      const csv = ['code,name', ...this.list(company).map((item) => `${item.code},${item.name}`)];
      return route.fulfill({
        status: 200,
        body: csv.join('\n'),
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="tiers.csv"',
        },
      });
    }
    if (path === 'imports/') {
      const run: ImportRun = {
        public_id: `run-${this.runs.size + 1}`,
        company,
        status: 'created',
        filename: '',
        headers: [],
        rows: [],
        columns: {},
        summary: {},
      };
      this.runs.set(run.public_id, run);
      return this.answer(route, 201, this.json(run));
    }
    const [, id, command] = path.split('/');
    const run = this.runs.get(id);
    if (!run || run.company !== company) {
      return this.answer(route, 404, error('not_found'));
    }
    switch (command) {
      case 'upload': {
        const text = (request.postDataBuffer() ?? Buffer.from('')).toString('utf-8');
        const content = /filename="([^"]+)"[\s\S]*?\r\n\r\n([\s\S]*?)\r\n--/.exec(text);
        run.filename = content?.[1] ?? 'import.csv';
        const lines = (content?.[2] ?? '').split(/\r?\n/).filter(Boolean);
        run.headers = lines[0]?.split(',') ?? [];
        run.rows = lines.slice(1).map((line) => line.split(','));
        run.status = 'uploaded';
        break;
      }
      case 'parse':
        run.status = 'parsed';
        run.summary = { total: run.rows.length };
        break;
      case 'map':
        run.columns = (request.postDataJSON() as { columns: Record<string, string> }).columns;
        run.status = 'mapped';
        break;
      case 'validate': {
        const checks = this.check(run);
        run.summary = {
          total: run.rows.length,
          valid: checks.filter((item) => item === 'valid').length,
          warnings: 0,
          errors: checks.filter((item) => item === 'error').length,
          duplicates: checks.filter((item) => item === 'duplicate').length,
        };
        run.status = 'validated';
        break;
      }
      case 'rows':
        return this.answer(route, 200, {
          count: 0,
          next: null,
          previous: null,
          results: this.check(run).flatMap((item, index) =>
            item === 'error'
              ? [
                  {
                    line_number: index + 2,
                    status: 'error',
                    raw: {},
                    messages: [
                      {
                        level: 'error',
                        field: 'name',
                        code: 'required',
                        message: 'x',
                        details: {},
                      },
                    ],
                  },
                ]
              : [],
          ),
        });
      case 'preview': {
        const valid = this.check(run).filter((item) => item === 'valid').length;
        run.summary = {
          ...run.summary,
          preview: { creations: { partners: valid }, updates: 0, skipped_duplicates: 0 },
        };
        run.status = 'previewed';
        break;
      }
      case 'execute': {
        let created = 0;
        this.check(run).forEach((item, index) => {
          if (item === 'valid') {
            const value = (field: string) =>
              run.rows[index][run.headers.indexOf(run.columns[field] ?? '')] ?? '';
            this.list(company).push(
              partner({
                code: value('code').toUpperCase(),
                name: value('name'),
                country: value('country').toUpperCase(),
                is_customer: ['oui', 'true', '1'].includes(value('is_customer').toLowerCase()),
              }),
            );
            created += 1;
          }
        });
        run.summary = { created, imported: created };
        run.status = 'completed';
        break;
      }
      case 'cancel':
        run.status = 'cancelled';
        break;
    }
    return this.answer(route, 200, this.json(run));
  }

  private check(run: ImportRun): ('valid' | 'error' | 'duplicate')[] {
    const index = (field: string) => run.headers.indexOf(run.columns[field] ?? '');
    return run.rows.map((row) => {
      if (!row[index('name')]?.trim() || !row[index('code')]?.trim()) {
        return 'error';
      }
      const code = row[index('code')].trim().toUpperCase();
      return this.list(run.company).some((item) => item.code === code) ? 'duplicate' : 'valid';
    });
  }

  private json(run: ImportRun) {
    return {
      public_id: run.public_id,
      import_type: 'partners',
      status: run.status,
      filename: run.filename,
      headers: run.headers,
      columns: run.columns,
      options: {},
      summary: run.summary,
      error: {},
    };
  }
}
