import { Request, Route } from '@playwright/test';

import { AccountJson, FakeAccounting, JournalJson, PeriodJson } from './fake-accounting';
import { FakePartners, PartnersContext } from './fake-partners';

/**
 * Accounting entries of the fake API (`accounting/entries/`, `accounting/settings/`,
 * `taxes/`, `documents/`, `audit/objects/`), shaped like the OpenAPI schemas
 * (`AccountingEntry`, `AccountingLine`, `TaxesTax`, `DocumentsDocument`, `AuditEvent`) and
 * company scoped like the server (another company's entry is a 404). Only what the tests
 * need is played, with the server's codes: a draft is the only editable state, the commands
 * follow the transitions of the API, validation refuses an unbalanced entry and numbers the
 * entry, a reversal is a new draft (once per entry). Not a re-implementation of the backend.
 */

const SCALE = 6;
const STAMP = '2026-09-01T09:00:00Z';
let sequence = 0;
const uuid = () => `20000000-0000-4000-9000-${String(++sequence).padStart(12, '0')}`;

interface Reference {
  public_id: string;
  code: string;
}

export interface LineJson {
  public_id: string;
  sequence: number;
  account: Reference;
  label: string;
  debit: string;
  credit: string;
  reference_debit: string;
  reference_credit: string;
  partner: Reference | null;
  tax: Reference | null;
  tax_rule: string | null;
  tax_base_amount: string | null;
  analytic_allocation: string | null;
}

export interface EntryJson {
  public_id: string;
  entry_number: string;
  status: 'draft' | 'submitted' | 'validated' | 'locked';
  kind: 'standard' | 'reversal' | 'correction';
  journal: Reference;
  fiscal_year: Reference;
  period: Reference;
  entry_date: string;
  document_date: string | null;
  document_reference: string;
  description: string;
  currency: string;
  reference_currency: string;
  exchange_rate: string;
  rate_details: null;
  rounding: string;
  origin: 'manual' | 'system';
  source_type: string;
  source_id: string;
  related_entry: string | null;
  reason: string;
  created_by: string;
  created_at: string;
  submitted_by: string | null;
  submitted_at: string | null;
  validated_by: string | null;
  validated_at: string | null;
  locked_by: string | null;
  locked_at: string | null;
  updated_at: string;
  lines: LineJson[];
}

/** A tax in its simple form (`TaxesTax`). */
interface TaxJson {
  public_id: string;
  code: string;
  name: string;
  rate: string;
  type_tax_use: 'sale' | 'purchase' | 'both';
  sale_account_code: string;
  purchase_account_code: string;
  withholding: boolean;
  category: string;
  country: string;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

/** « 18 » → « 18.0000 »: the API's 4 decimals, exact (no floating point). */
function four(value: string): string {
  const [integer, fraction = ''] = String(value).trim().split('.');
  return `${integer || '0'}.${fraction.padEnd(4, '0').slice(0, 4)}`;
}

/** The usual taxes of Guinea, as `accounting/default-taxes/` creates them. */
const GUINEA: readonly [string, string, TaxJson['type_tax_use'], string, string][] = [
  ['TVA 18 %', '18', 'both', '443100', '445200'],
  ['TVA 0 % export', '0', 'sale', '', ''],
  ['TVA 0 % import', '0', 'purchase', '', ''],
  ['Exonéré de TVA', '0', 'both', '', ''],
];

interface DocumentJson {
  public_id: string;
  resource_type: string;
  resource_id: string;
  original_name: string;
  content_type: string;
  size: number;
  checksum: string;
  description: string;
  status: 'active';
  replaces: null;
  uploaded_by: string;
  created_at: string;
  deleted_by: null;
  deleted_at: null;
  deletion_reason: string;
}

interface EventJson {
  public_id: string;
  occurred_at: string;
  action: string;
  object_type: string;
  object_id: string;
  object_label: string;
  user: { public_id: string; email: string } | null;
  origin: string;
  source: string;
  correlation_id: string;
  metadata: Record<string, unknown>;
  changed_fields: string[];
}

interface Ledger {
  entries: EntryJson[];
  /** Entries already reversed (a reversal happens once). */
  reversed: Set<string>;
  numbers: Record<string, number>;
  settings: { submission_required: boolean; parent_accounts_postable: boolean };
  taxes: TaxJson[];
  documents: DocumentJson[];
  events: EventJson[];
}

// ---- Exact decimals (6 places, as the API) ------------------------------------------------

function toUnits(value: string | undefined | null): bigint {
  const text = (value ?? '').trim() || '0';
  const negative = text.startsWith('-');
  const [integer, fraction = ''] = text.replace('-', '').split('.');
  const units =
    BigInt(integer || '0') * 10n ** BigInt(SCALE) +
    BigInt(fraction.padEnd(SCALE, '0').slice(0, SCALE) || '0');
  return negative ? -units : units;
}

function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const integer = absolute / 10n ** BigInt(SCALE);
  const fraction = String(absolute % 10n ** BigInt(SCALE)).padStart(SCALE, '0');
  return `${negative ? '-' : ''}${integer}.${fraction}`;
}

const amount = (value: string | undefined | null) => fromUnits(toUnits(value));

const error = (code: string, details: unknown = null) => ({
  error: { code, message: code, details, correlation_id: 'e2e' },
});

const EMAIL = 'mariam.test@example.org';
const USER_ID = 'dddddddd-0000-4000-8000-000000000004';

export class FakeAccountingEntries {
  private readonly byCompany: Record<string, Ledger> = {};

  constructor(
    private readonly context: PartnersContext,
    private readonly accounting: FakeAccounting,
    private readonly partners: FakePartners,
  ) {}

  /** Entries of a company (seeded on first use from its journals, accounts and periods). */
  ledger(company: string): Ledger {
    return (this.byCompany[company] ??= this.seed(company));
  }

  entries(company: string): EntryJson[] {
    return this.ledger(company).entries;
  }

  /** The company's rule: a draft must be submitted before validation. */
  withSubmissionRequired(company: string, required: boolean): this {
    this.ledger(company).settings.submission_required = required;
    return this;
  }

  async install(): Promise<void> {
    const page = this.context.page;
    await page.route('**/api/v1/accounting/entries/**', (route) => this.handle(route));
    await page.route('**/api/v1/accounting/settings/', (route) => this.settings(route));
    await page.route('**/api/v1/taxes/**', (route) => this.taxes(route));
    await page.route('**/api/v1/accounting/default-taxes/', (route) => this.defaultTaxes(route));
    await page.route('**/api/v1/documents/**', (route) => this.documents(route));
    await page.route('**/api/v1/audit/**', (route) => this.audit(route));
  }

  // ---- Seed ----------------------------------------------------------------------------

  private seed(company: string): Ledger {
    const books = this.accounting.books(company);
    const ledger: Ledger = {
      entries: [],
      reversed: new Set(),
      numbers: {},
      settings: { submission_required: company === 'A', parent_accounts_postable: false },
      // Company A (Guinea): the VAT and a withholding; « Créer les taxes de Guinée » adds the
      // others. The other companies have none.
      taxes:
        company === 'A'
          ? [this.tax(...GUINEA[0]), this.tax('Retenue 10 %', '10', 'purchase', '', '444131', true)]
          : [],
      documents: [],
      events: [],
    };
    // The creation of the referential, as Audit records it (the history of a record).
    const created = (objectType: string, objectId: string, label: string): EventJson => ({
      public_id: uuid(),
      occurred_at: STAMP,
      action: 'create',
      object_type: objectType,
      object_id: objectId,
      object_label: label,
      user: { public_id: USER_ID, email: EMAIL },
      origin: 'http',
      source: '',
      correlation_id: 'e2e',
      metadata: {},
      changed_fields: [],
    });
    ledger.events.push(
      ...books.journals.map((item) => created('accounting.journal', item.public_id, item.code)),
      ...books.accounts.map((item) => created('accounting.account', item.public_id, item.code)),
      ...this.partners
        .list(company)
        .map((item) => created('partners.partner', item.public_id, item.code)),
    );
    const counts = books.entries;
    const open = books.periods.filter((item) => item.status === 'open');
    const postable = books.accounts.filter(
      (item) => item.status === 'active' && item.allow_entries && !item.has_children,
    );
    const journals = books.journals.filter((item) => item.status === 'active');
    const supplier = this.partners.list(company).find((item) => item.code.startsWith('FOU'));
    if (open.length === 0 || postable.length === 0 || journals.length === 0) {
      return ledger;
    }
    let day = 0;
    for (const status of ['locked', 'validated', 'submitted', 'draft'] as const) {
      for (let index = 0; index < (counts[status] ?? 0); index += 1) {
        day += 1;
        const period = open[day % open.length];
        const journal = journals[day % journals.length];
        const value = `${(day % 9) + 1}${'50000'.slice(0, (day % 3) + 3)}`;
        const entry = this.build(company, {
          journal,
          period,
          date: `${period.start_date.slice(0, 8)}${String((day % 27) + 1).padStart(2, '0')}`,
          description: `${journal.name} — pièce ${String(day).padStart(3, '0')}`,
          reference: `PC-${String(day).padStart(4, '0')}`,
          lines: [
            { account: postable[day % postable.length], debit: value, label: '' },
            {
              account: postable[(day + 1) % postable.length],
              credit: value,
              label: '',
              partner: supplier ? { public_id: supplier.public_id, code: supplier.code } : null,
            },
          ],
        });
        entry.status = status;
        if (status === 'validated' || status === 'locked') {
          entry.entry_number = this.nextNumber(ledger, journal);
          entry.validated_at = STAMP;
          entry.validated_by = USER_ID;
        }
        if (status === 'submitted') {
          entry.submitted_at = STAMP;
          entry.submitted_by = USER_ID;
        }
        if (status === 'locked') {
          entry.locked_at = STAMP;
          entry.locked_by = USER_ID;
        }
        ledger.entries.push(entry);
      }
    }
    return ledger;
  }

  private tax(
    name: string,
    rate: string,
    use: TaxJson['type_tax_use'],
    sale: string,
    purchase: string,
    withholding = false,
  ): TaxJson {
    return {
      public_id: uuid(),
      code: name.toUpperCase(),
      name,
      rate: four(rate),
      type_tax_use: use,
      sale_account_code: use === 'purchase' ? '' : sale,
      purchase_account_code: use === 'sale' ? '' : purchase,
      withholding,
      category: withholding ? 'withholding' : 'vat',
      country: 'GN',
      status: 'active',
      created_at: STAMP,
      updated_at: STAMP,
    };
  }

  private build(
    company: string,
    data: {
      journal: JournalJson;
      period: PeriodJson;
      date: string;
      description: string;
      reference: string;
      lines: {
        account: AccountJson | Reference;
        label: string;
        debit?: string;
        credit?: string;
        partner?: Reference | null;
        tax?: Reference | null;
        tax_base_amount?: string | null;
      }[];
    },
  ): EntryJson {
    const books = this.accounting.books(company);
    const year = books.years.find((item) => item.public_id === data.period.fiscal_year);
    const currency = company === 'B' ? 'XOF' : 'GNF';
    return {
      public_id: uuid(),
      entry_number: '',
      status: 'draft',
      kind: 'standard',
      journal: { public_id: data.journal.public_id, code: data.journal.code },
      fiscal_year: { public_id: year?.public_id ?? '', code: year?.code ?? '' },
      period: { public_id: data.period.public_id, code: data.period.code },
      entry_date: data.date,
      document_date: null,
      document_reference: data.reference,
      description: data.description,
      currency,
      reference_currency: currency,
      exchange_rate: '1.000000000000',
      rate_details: null,
      rounding: '',
      origin: 'manual',
      source_type: '',
      source_id: '',
      related_entry: null,
      reason: '',
      created_by: USER_ID,
      created_at: STAMP,
      submitted_by: null,
      submitted_at: null,
      validated_by: null,
      validated_at: null,
      locked_by: null,
      locked_at: null,
      updated_at: STAMP,
      lines: data.lines.map((line, index) => ({
        public_id: uuid(),
        sequence: index + 1,
        account: { public_id: line.account.public_id, code: line.account.code },
        label: line.label,
        debit: amount(line.debit),
        credit: amount(line.credit),
        reference_debit: amount(line.debit),
        reference_credit: amount(line.credit),
        partner: line.partner ?? null,
        tax: line.tax ?? null,
        tax_rule: null,
        tax_base_amount: line.tax_base_amount ? amount(line.tax_base_amount) : null,
        analytic_allocation: null,
      })),
    };
  }

  private nextNumber(ledger: Ledger, journal: JournalJson): string {
    const next = (ledger.numbers[journal.public_id] ?? 0) + 1;
    ledger.numbers[journal.public_id] = next;
    return `${journal.sequence_prefix}${String(next).padStart(journal.sequence_padding, '0')}`;
  }

  // ---- Answers -----------------------------------------------------------------------------

  private async answer(route: Route, status: number, json?: unknown): Promise<void> {
    this.context.calls.push(route.request());
    await route.fulfill({ status, json });
  }

  private paged<T>(route: Route, items: T[]): Promise<void> {
    const url = new URL(route.request().url());
    const size = Number(url.searchParams.get('page_size')) || 25;
    const number = Number(url.searchParams.get('page')) || 1;
    const results = items.slice((number - 1) * size, number * size);
    if (number > 1 && results.length === 0) {
      return this.answer(route, 404, error('not_found'));
    }
    return this.answer(route, 200, { count: items.length, next: null, previous: null, results });
  }

  /** An event of another object, as Audit records it (its history). */
  recordEvent(
    company: string,
    action: string,
    objectType: string,
    objectId: string,
    label: string,
  ): void {
    this.ledger(company).events.push({
      public_id: uuid(),
      occurred_at: new Date().toISOString(),
      action,
      object_type: objectType,
      object_id: objectId,
      object_label: label,
      user: { public_id: USER_ID, email: EMAIL },
      origin: 'http',
      source: '',
      correlation_id: 'e2e',
      metadata: {},
      changed_fields: [],
    });
  }

  private record(ledger: Ledger, action: string, entry: EntryJson): void {
    ledger.events.push({
      public_id: uuid(),
      occurred_at: new Date().toISOString(),
      action,
      object_type: 'accounting.journalentry',
      object_id: entry.public_id,
      object_label: entry.entry_number || entry.description,
      user: { public_id: USER_ID, email: EMAIL },
      origin: 'http',
      source: '',
      correlation_id: 'e2e',
      metadata: {},
      changed_fields: [],
    });
  }

  /** Permission and CSRF as the server checks them; the company of `X-Company-ID`. */
  private async gate(
    route: Route,
    permission: string,
  ): Promise<{ company: string; permissions: readonly string[] } | null> {
    const request = route.request();
    const permissions = await this.context.permissionsOf(request);
    if (!permissions.includes(permission)) {
      await this.answer(route, 403, error('company_permission_denied'));
      return null;
    }
    if (request.method() !== 'GET' && !(await this.context.csrfOk(request))) {
      await this.answer(route, 403, error('csrf_failed'));
      return null;
    }
    return { company: await this.context.companyOf(request), permissions };
  }

  private async settings(route: Route): Promise<void> {
    const gate = await this.gate(route, 'accounting.read');
    if (gate) {
      await this.answer(route, 200, this.ledger(gate.company).settings);
    }
  }

  /**
   * `taxes/` as the simple screens use it: the list (`status`, repeated `type_tax_use`,
   * `search` in the name, by name), a tax, its creation and modification (one name per
   * company; only the accounts of the sides it applies to are kept) and its commands.
   */
  private async taxes(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api\/v1\/taxes\//, '');
    const method = request.method();
    const write =
      method === 'GET'
        ? 'taxes.read'
        : method === 'POST' && !path
          ? 'taxes.create'
          : 'taxes.update';
    const gate = await this.gate(route, write);
    if (!gate) {
      return;
    }
    const taxes = this.ledger(gate.company).taxes;
    if (!path && method === 'GET') {
      const status = url.searchParams.get('status');
      const uses = url.searchParams.getAll('type_tax_use');
      const search = (url.searchParams.get('search') ?? '').toLowerCase();
      return this.paged(
        route,
        taxes
          .filter(
            (tax) =>
              (!status || tax.status === status) &&
              (uses.length === 0 || uses.includes(tax.type_tax_use)) &&
              (!search || tax.name.toLowerCase().includes(search)),
          )
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    }
    if (!path && method === 'POST') {
      const body = request.postDataJSON() as Partial<TaxJson>;
      const tax = this.tax(
        String(body.name ?? ''),
        String(body.rate ?? '0'),
        body.type_tax_use ?? 'both',
        String(body.sale_account_code ?? ''),
        String(body.purchase_account_code ?? ''),
        body.withholding === true,
      );
      return this.saveTax(route, taxes, tax, 201);
    }
    const [id, command] = path.split('/');
    const tax = taxes.find((item) => item.public_id === id);
    if (!tax) {
      return this.answer(route, 404, error('not_found'));
    }
    if (method === 'GET') {
      return this.answer(route, 200, tax);
    }
    if (command === 'activate' || command === 'deactivate') {
      tax.status = command === 'activate' ? 'active' : 'inactive';
      return this.answer(route, 200, tax);
    }
    const body = request.postDataJSON() as Partial<TaxJson>;
    const changed = { ...tax, ...body };
    return this.saveTax(
      route,
      taxes,
      {
        ...changed,
        sale_account_code: changed.type_tax_use === 'purchase' ? '' : changed.sale_account_code,
        purchase_account_code: changed.type_tax_use === 'sale' ? '' : changed.purchase_account_code,
      },
      200,
    );
  }

  private saveTax(route: Route, taxes: TaxJson[], tax: TaxJson, status: number): Promise<void> {
    if (!tax.name.trim()) {
      return this.answer(
        route,
        400,
        error('validation_error', { name: [{ message: 'x', code: 'blank' }] }),
      );
    }
    if (taxes.some((item) => item.public_id !== tax.public_id && item.name === tax.name)) {
      return this.answer(route, 400, error('tax_name_exists'));
    }
    const saved: TaxJson = { ...tax, rate: four(tax.rate), updated_at: new Date().toISOString() };
    const index = taxes.findIndex((item) => item.public_id === saved.public_id);
    if (index >= 0) {
      taxes[index] = saved;
    } else {
      taxes.push(saved);
    }
    return this.answer(route, status, saved);
  }

  /**
   * `accounting/default-taxes/`: Guinea's usual taxes not yet present (by name). Only Guinea
   * has a template (company A); elsewhere `tax_template_not_found`.
   */
  private async defaultTaxes(route: Route): Promise<void> {
    const gate = await this.gate(route, 'taxes.create');
    if (!gate) {
      return;
    }
    if (gate.company !== 'A') {
      return this.answer(route, 400, error('tax_template_not_found'));
    }
    const taxes = this.ledger(gate.company).taxes;
    const existing = GUINEA.map(([name]) => name).filter((name) =>
      taxes.some((tax) => tax.name === name),
    );
    const created = GUINEA.filter(([name]) => !existing.includes(name)).map((row) =>
      this.tax(...row),
    );
    taxes.push(...created);
    return this.answer(route, 200, { created, existing });
  }

  private async documents(route: Route): Promise<void> {
    const gate = await this.gate(route, 'documents.read');
    if (!gate) {
      return;
    }
    const request = route.request();
    const ledger = this.ledger(gate.company);
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1/documents/', '');
    if (path === '' && request.method() === 'POST') {
      if (!gate.permissions.includes('documents.upload')) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
      const body = request.postDataBuffer()?.toString('latin1') ?? '';
      const field = (name: string) =>
        new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(body)?.[1] ?? '';
      const filename = /filename="([^"]*)"/.exec(body)?.[1] ?? 'piece';
      const entry = ledger.entries.find((item) => item.public_id === field('resource_id'));
      if (!entry) {
        return this.answer(route, 404, error('not_found'));
      }
      if (entry.status !== 'draft') {
        return this.answer(route, 400, error('document_resource_frozen'));
      }
      const document: DocumentJson = {
        public_id: uuid(),
        resource_type: field('resource_type'),
        resource_id: entry.public_id,
        original_name: filename,
        content_type: 'application/pdf',
        size: 2048,
        checksum: 'e2e',
        description: '',
        status: 'active',
        replaces: null,
        uploaded_by: USER_ID,
        created_at: new Date().toISOString(),
        deleted_by: null,
        deleted_at: null,
        deletion_reason: '',
      };
      ledger.documents.push(document);
      return this.answer(route, 201, document);
    }
    return this.paged(
      route,
      ledger.documents.filter(
        (item) =>
          item.resource_type === url.searchParams.get('resource_type') &&
          item.resource_id === url.searchParams.get('resource_id'),
      ),
    );
  }

  private async audit(route: Route): Promise<void> {
    const gate = await this.gate(route, 'audit.read');
    if (!gate) {
      return;
    }
    const [, , objectType, objectId] = new URL(route.request().url()).pathname
      .replace('/api/v1/', '')
      .split('/');
    await this.paged(
      route,
      this.ledger(gate.company).events.filter(
        (item) => item.object_type === objectType && item.object_id === objectId,
      ),
    );
  }

  // ---- Entries -------------------------------------------------------------------------------

  private async handle(route: Route): Promise<void> {
    const gate = await this.gate(route, 'accounting.read');
    if (!gate) {
      return;
    }
    const request = route.request();
    const ledger = this.ledger(gate.company);
    const [id, command] = new URL(request.url()).pathname
      .replace('/api/v1/accounting/entries/', '')
      .split('/');
    const method = request.method();
    const can = (permission: string) => gate.permissions.includes(permission);
    const forbidden = () => this.answer(route, 403, error('company_permission_denied'));

    if (!id) {
      if (method === 'POST') {
        return can('accounting.create') ? this.create(route, request, gate.company) : forbidden();
      }
      return this.list(route, ledger);
    }
    const entry = ledger.entries.find((item) => item.public_id === id);
    if (!entry) {
      return this.answer(route, 404, error('not_found'));
    }
    if (!command) {
      if (method === 'GET') {
        return this.answer(route, 200, entry);
      }
      if (!can('accounting.update')) {
        return forbidden();
      }
      if (entry.status !== 'draft') {
        return this.answer(
          route,
          400,
          error('accounting_entry_not_editable', { status: entry.status }),
        );
      }
      if (method === 'DELETE') {
        ledger.entries.splice(ledger.entries.indexOf(entry), 1);
        this.record(ledger, 'delete', entry);
        return this.answer(route, 204);
      }
      return this.modify(route, request, gate.company, entry);
    }
    return this.command(route, request, gate, ledger, entry, command);
  }

  private list(route: Route, ledger: Ledger): Promise<void> {
    const url = new URL(route.request().url());
    const q = (name: string) => url.searchParams.get(name);
    const found = ledger.entries
      .filter(
        (item) =>
          (!q('status') || item.status === q('status')) &&
          (!q('kind') || item.kind === q('kind')) &&
          (!q('journal') || item.journal.public_id === q('journal')) &&
          (!q('fiscal_year') || item.fiscal_year.public_id === q('fiscal_year')) &&
          (!q('period') || item.period.public_id === q('period')) &&
          (!q('date_from') || item.entry_date >= (q('date_from') ?? '')) &&
          (!q('date_to') || item.entry_date <= (q('date_to') ?? '')) &&
          (!q('account') || item.lines.some((line) => line.account.public_id === q('account'))) &&
          (!q('partner') || item.lines.some((line) => line.partner?.public_id === q('partner'))),
      )
      .sort((a, b) => b.entry_date.localeCompare(a.entry_date));
    return this.paged(route, found);
  }

  /** Header and lines checked as the server does (references, period, postable accounts). */
  private prepare(
    company: string,
    body: Record<string, unknown>,
    current?: EntryJson,
  ): { status: number; json: unknown } | EntryJson {
    const books = this.accounting.books(company);
    const journalId = (body['journal'] as string | undefined) ?? current?.journal.public_id;
    const journal = books.journals.find((item) => item.public_id === journalId);
    if (!journal) {
      return {
        status: 400,
        json: error('validation_error', { journal: [{ message: 'x', code: 'unknown' }] }),
      };
    }
    if (journal.status !== 'active') {
      return { status: 400, json: error('accounting_journal_inactive', { journal: journal.code }) };
    }
    const date = (body['entry_date'] as string | undefined) ?? current?.entry_date ?? '';
    const period = books.periods.find((item) => item.start_date <= date && date <= item.end_date);
    if (!period) {
      return { status: 400, json: error('accounting_period_not_found') };
    }
    if (period.status !== 'open') {
      return { status: 400, json: error('accounting_period_closed', { period: period.code }) };
    }
    const rawLines = (body['lines'] as Record<string, string | null>[] | undefined) ?? null;
    const lineErrors = (rawLines ?? []).map((line) =>
      books.accounts.some((item) => item.public_id === line['account'])
        ? {}
        : { account: [{ message: 'x', code: 'unknown' }] },
    );
    if (lineErrors.some((item) => 'account' in item)) {
      return { status: 400, json: error('validation_error', { lines: lineErrors }) };
    }
    const partners = this.partners.list(company);
    const taxes = this.ledger(company).taxes;
    const lines = rawLines?.map((line) => {
      const account = books.accounts.find(
        (item) => item.public_id === line['account'],
      ) as AccountJson;
      const partner = partners.find((item) => item.public_id === line['partner']);
      const tax = taxes.find((item) => item.public_id === line['tax']);
      return {
        account,
        label: line['label'] ?? '',
        debit: line['debit'] ?? undefined,
        credit: line['credit'] ?? undefined,
        partner: partner ? { public_id: partner.public_id, code: partner.code } : null,
        tax: tax ? { public_id: tax.public_id, code: tax.code } : null,
        tax_base_amount: line['tax_base_amount'] ?? null,
      };
    });
    const notPostable = lines?.find(
      ({ account }) =>
        account.status !== 'active' || !account.allow_entries || account.has_children,
    );
    if (notPostable) {
      return {
        status: 400,
        json: error(
          notPostable.account.status !== 'active'
            ? 'accounting_account_inactive'
            : 'accounting_account_not_postable',
          { account: notPostable.account.code },
        ),
      };
    }
    const built = this.build(company, {
      journal,
      period,
      date,
      description: (body['description'] as string | undefined) ?? current?.description ?? '',
      reference:
        (body['document_reference'] as string | undefined) ?? current?.document_reference ?? '',
      lines: lines ?? [],
    });
    if (current && !lines) {
      built.lines = current.lines;
    }
    if ('document_date' in body) {
      built.document_date = (body['document_date'] as string | null) ?? null;
    } else if (current) {
      built.document_date = current.document_date;
    }
    return built;
  }

  private async create(route: Route, request: Request, company: string): Promise<void> {
    const body = request.postDataJSON() as Record<string, unknown>;
    if (!body['description'] || !body['entry_date'] || !Array.isArray(body['lines'])) {
      return this.answer(
        route,
        400,
        error('validation_error', { description: [{ message: 'x', code: 'required' }] }),
      );
    }
    const prepared = this.prepare(company, body);
    if (!('public_id' in prepared)) {
      return this.answer(route, prepared.status, prepared.json);
    }
    const ledger = this.ledger(company);
    ledger.entries.unshift(prepared);
    this.record(ledger, 'create', prepared);
    return this.answer(route, 201, prepared);
  }

  private async modify(
    route: Route,
    request: Request,
    company: string,
    entry: EntryJson,
  ): Promise<void> {
    if (entry.origin !== 'manual' || entry.kind === 'reversal') {
      return this.answer(route, 400, error('accounting_entry_not_editable', { kind: entry.kind }));
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    const needsLines = ['journal', 'entry_date', 'currency', 'rounding'].some(
      (name) => name in body,
    );
    if (needsLines && !('lines' in body)) {
      return this.answer(route, 400, error('accounting_entry_lines_required'));
    }
    const prepared = this.prepare(company, body, entry);
    if (!('public_id' in prepared)) {
      return this.answer(route, prepared.status, prepared.json);
    }
    const changes: Partial<EntryJson> = { ...prepared };
    delete changes.public_id;
    delete changes.created_at;
    delete changes.created_by;
    Object.assign(entry, changes, { updated_at: new Date().toISOString() });
    this.record(this.ledger(company), 'update', entry);
    return this.answer(route, 200, entry);
  }

  private async command(
    route: Route,
    request: Request,
    gate: { company: string; permissions: readonly string[] },
    ledger: Ledger,
    entry: EntryJson,
    command: string,
  ): Promise<void> {
    const can = (permission: string) => gate.permissions.includes(permission);
    const refuse = (to: string) =>
      this.answer(route, 400, error('accounting_invalid_transition', { from: entry.status, to }));
    const now = new Date().toISOString();
    switch (command) {
      case 'submit':
        if (!can('accounting.submit')) {
          return this.answer(route, 403, error('company_permission_denied'));
        }
        if (entry.status !== 'draft') {
          return refuse('submitted');
        }
        Object.assign(entry, { status: 'submitted', submitted_at: now, submitted_by: USER_ID });
        break;
      case 'reject':
        if (!can('accounting.validate')) {
          return this.answer(route, 403, error('company_permission_denied'));
        }
        if (entry.status !== 'submitted') {
          return refuse('draft');
        }
        Object.assign(entry, { status: 'draft', submitted_at: null, submitted_by: null });
        break;
      case 'validate': {
        if (!can('accounting.validate')) {
          return this.answer(route, 403, error('company_permission_denied'));
        }
        const fromDraft = entry.status === 'draft' && !ledger.settings.submission_required;
        if (entry.status !== 'submitted' && !fromDraft) {
          return refuse('validated');
        }
        const debit = entry.lines.reduce((sum, line) => sum + toUnits(line.debit), 0n);
        const credit = entry.lines.reduce((sum, line) => sum + toUnits(line.credit), 0n);
        if (debit === 0n && credit === 0n) {
          return this.answer(route, 400, error('accounting_entry_empty'));
        }
        if (debit !== credit) {
          return this.answer(
            route,
            400,
            error('accounting_entry_unbalanced', {
              debit: fromUnits(debit),
              credit: fromUnits(credit),
            }),
          );
        }
        const journal = this.accounting
          .books(gate.company)
          .journals.find((item) => item.public_id === entry.journal.public_id) as JournalJson;
        Object.assign(entry, {
          status: 'validated',
          entry_number: this.nextNumber(ledger, journal),
          validated_at: now,
          validated_by: USER_ID,
        });
        break;
      }
      case 'lock':
        if (!can('accounting.lock')) {
          return this.answer(route, 403, error('company_permission_denied'));
        }
        if (entry.status !== 'validated') {
          return refuse('locked');
        }
        Object.assign(entry, { status: 'locked', locked_at: now, locked_by: USER_ID });
        break;
      case 'reverse': {
        if (!can('accounting.reverse')) {
          return this.answer(route, 403, error('company_permission_denied'));
        }
        if (!['validated', 'locked'].includes(entry.status) || entry.kind === 'reversal') {
          return this.answer(
            route,
            400,
            error('accounting_entry_not_reversible', { status: entry.status, kind: entry.kind }),
          );
        }
        if (ledger.reversed.has(entry.public_id)) {
          return this.answer(route, 400, error('accounting_entry_already_reversed'));
        }
        const body = request.postDataJSON() as Record<string, string>;
        if (!body['reason']?.trim()) {
          return this.answer(
            route,
            400,
            error('validation_error', { reason: [{ message: 'x', code: 'blank' }] }),
          );
        }
        const books = this.accounting.books(gate.company);
        const date = body['entry_date'];
        const period = books.periods.find(
          (item) => item.start_date <= date && date <= item.end_date,
        );
        if (!period) {
          return this.answer(route, 400, error('accounting_period_not_found'));
        }
        if (period.status !== 'open') {
          return this.answer(
            route,
            400,
            error('accounting_period_closed', { period: period.code }),
          );
        }
        const year = books.years.find((item) => item.public_id === period.fiscal_year);
        const reversal: EntryJson = {
          ...entry,
          public_id: uuid(),
          entry_number: '',
          status: 'draft',
          kind: 'reversal',
          fiscal_year: { public_id: year?.public_id ?? '', code: year?.code ?? '' },
          period: { public_id: period.public_id, code: period.code },
          entry_date: date,
          document_reference: entry.entry_number,
          description: body['description']?.trim() || entry.description,
          related_entry: entry.public_id,
          reason: body['reason'].trim(),
          created_at: now,
          submitted_at: null,
          submitted_by: null,
          validated_at: null,
          validated_by: null,
          locked_at: null,
          locked_by: null,
          updated_at: now,
          lines: entry.lines.map((line) => ({
            ...line,
            public_id: uuid(),
            debit: line.credit,
            credit: line.debit,
            reference_debit: line.reference_credit,
            reference_credit: line.reference_debit,
          })),
        };
        ledger.reversed.add(entry.public_id);
        ledger.entries.unshift(reversal);
        this.record(ledger, 'create', reversal);
        this.record(ledger, 'reverse', entry);
        return this.answer(route, 201, reversal);
      }
      default:
        return this.answer(route, 404, error('not_found'));
    }
    entry.updated_at = now;
    this.record(ledger, command, entry);
    return this.answer(route, 200, entry);
  }
}
