import { Route } from '@playwright/test';

import { FakeAccounting } from './fake-accounting';
import { FakeAccountingEntries } from './fake-accounting-entries';
import { FakePartners, PartnersContext } from './fake-partners';

/**
 * The invoicing part of the fake API (`invoicing/products/`, `invoicing/invoices/`, note
 * backend 0038): products, invoices and credit notes in memory, per company. The amounts are
 * the server's rule, for a currency without decimals (GNF): line = quantity x unit price,
 * tax by rate on its lines' total, rounded half up. Posting gives the number and an entry
 * in the fake ledger; a credit note settles its invoice; « Remettre en brouillon » keeps the
 * number (note backend 0040); sections and notes, the units and the amounts as typed (note
 * backend 0041); the units of measure, Odoo's default list per company, a line's price in
 * another unit of its category (note backend 0047). Only the rules the tests need.
 */

interface Reference {
  public_id: string;
  code: string;
  name: string;
}
interface TaxReference extends Reference {
  rate: string;
}
type UnitType = 'reference' | 'bigger' | 'smaller';
interface UnitJson {
  public_id: string;
  name: string;
  unit_type: UnitType;
  ratio: string;
  factor: string;
  status: 'active' | 'inactive';
}
interface CategoryJson {
  public_id: string;
  name: string;
  units: UnitJson[];
}
interface UnitReference {
  public_id: string;
  name: string;
  category: string;
  factor: string;
}
interface ProductJson {
  public_id: string;
  code: string;
  name: string;
  sale_price: string | null;
  sale_account: Reference | null;
  purchase_account: Reference | null;
  tax: TaxReference;
  sale_unit: UnitReference | null;
  purchase_unit: UnitReference | null;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}
type LineType = 'product' | 'section' | 'note';
interface LineJson {
  sequence: number;
  display_type: LineType;
  product: Reference | null;
  description: string;
  quantity: string;
  unit: UnitReference | null;
  unit_price: string;
  tax: TaxReference | null;
  amount_untaxed: string;
  account: Reference | null;
}
interface TaxLineJson {
  sequence: number;
  tax: TaxReference;
  rate: string;
  base: string;
  amount: string;
  account: Reference | null;
}
type Kind =
  'customer_invoice' | 'customer_credit_note' | 'supplier_invoice' | 'supplier_credit_note';
interface PartnerJson extends Reference {
  address: string;
  city: string;
  country: string;
  phone: string;
}
interface SettlementJson {
  lettering: string;
  date: string;
  amount: string;
  credit_note: { public_id: string; kind: Kind; number: string } | null;
}
interface InvoiceJson {
  public_id: string;
  kind: Kind;
  status: 'draft' | 'posted' | 'cancelled';
  number: string;
  partner: PartnerJson;
  invoice_date: string;
  journal: Reference;
  currency: string;
  reference: string;
  origin: string | null;
  amount_untaxed: string;
  amount_tax: string;
  amount_total: string;
  payment_state: 'not_paid' | 'partial' | 'paid' | null;
  amount_residual: string | null;
  lines: LineJson[];
  taxes: TaxLineJson[];
  entry: { public_id: string; entry_number: string } | null;
  cancellation_entry: { public_id: string; entry_number: string } | null;
  cancellation_reason: string;
  settlements: SettlementJson[];
  created_at: string;
  updated_at: string;
  posted_at: string | null;
  cancelled_at: string | null;
}

const STAMP = '2026-10-12T09:00:00Z';
const PREFIX: Record<Kind, string> = {
  customer_invoice: 'FV',
  customer_credit_note: 'AV',
  supplier_invoice: 'FA',
  supplier_credit_note: 'AF',
};
const CREDIT_NOTE: Partial<Record<Kind, Kind>> = {
  customer_invoice: 'customer_credit_note',
  supplier_invoice: 'supplier_credit_note',
};
let sequence = 0;
const uuid = () => `60000000-0000-4000-9000-${String(++sequence).padStart(12, '0')}`;
const error = (code: string, details: unknown = null) => ({
  error: { code, message: code, details, correlation_id: 'e2e' },
});
const customer = (kind: Kind) => kind.startsWith('customer');

/** Odoo's default list (note backend 0047): category, then name, type, ratio. */
const DEFAULT_UNITS: [string, [string, UnitType, number][]][] = [
  [
    'Unité',
    [
      ['Unités', 'reference', 1],
      ['Douzaines', 'bigger', 12],
    ],
  ],
  [
    'Poids',
    [
      ['kg', 'reference', 1],
      ['g', 'smaller', 1000],
      ['t', 'bigger', 1000],
    ],
  ],
  [
    'Volume',
    [
      ['L', 'reference', 1],
      ['mL', 'smaller', 1000],
      ['m³', 'bigger', 1000],
    ],
  ],
];
const factorOf = (type: UnitType, ratio: number) =>
  (type === 'bigger' ? ratio : type === 'smaller' ? 1 / ratio : 1).toFixed(12);
const unitJson = (name: string, type: UnitType, ratio: number): UnitJson => ({
  public_id: uuid(),
  name,
  unit_type: type,
  ratio: ratio.toFixed(6),
  factor: factorOf(type, ratio),
  status: 'active',
});

// ---- Exact amounts: 6 decimals as the API, rounded half up to units (GNF) -------------
const SCALE = 1_000_000n;
function units(value: string): bigint {
  const [integer, fraction = ''] = value.trim().split('.');
  return BigInt(integer || '0') * SCALE + BigInt(fraction.padEnd(6, '0').slice(0, 6) || '0');
}
const text = (value: bigint) => `${value / SCALE}.${String(value % SCALE).padStart(6, '0')}`;
/** Rounded half up to units (`scaled` has 12 decimals: 6 x 6). */
const roundUnits = (scaled: bigint, scale: bigint) => ((scaled + scale / 2n) / scale) * SCALE;

export class FakeInvoicing {
  private readonly products: Record<string, ProductJson[]> = {};
  private readonly invoices: Record<string, InvoiceJson[]> = {};
  private readonly numbers: Record<string, number> = {};
  private readonly categories: Record<string, CategoryJson[]> = {};

  constructor(
    private readonly context: PartnersContext,
    private readonly accounting: FakeAccounting,
    private readonly entries: FakeAccountingEntries,
    private readonly partners: FakePartners,
  ) {}

  async install(): Promise<void> {
    await this.context.page.route('**/api/v1/invoicing/**', (route) => this.handle(route));
  }

  private async answer(route: Route, status: number, json?: unknown): Promise<void> {
    this.context.calls.push(route.request());
    await route.fulfill({ status, json });
  }

  private account(company: string, id: string | null | undefined): Reference | null {
    const found = this.accounting.books(company).accounts.find((item) => item.public_id === id);
    return found ? { public_id: found.public_id, code: found.code, name: found.name } : null;
  }

  private tax(company: string, id: string | null | undefined): TaxReference | null {
    const found = this.entries.ledger(company).taxes.find((item) => item.public_id === id);
    return found
      ? { public_id: found.public_id, code: found.code, name: found.name, rate: found.rate }
      : null;
  }

  private page<T>(results: T[]) {
    return { count: results.length, next: null, previous: null, results };
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const permissions = await this.context.permissionsOf(request);
    const can = (permission: string) => permissions.includes(permission);
    if (!can('invoicing.read')) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    const method = request.method();
    if (method !== 'GET' && !(await this.context.csrfOk(request))) {
      return this.answer(route, 403, error('csrf_failed'));
    }
    const company = await this.context.companyOf(request);
    const url = new URL(request.url());
    const [resource, id, command] = url.pathname
      .replace('/api/v1/invoicing/', '')
      .split('/')
      .filter(Boolean);
    const body =
      method === 'GET' || method === 'DELETE'
        ? {}
        : ((request.postDataJSON() ?? {}) as Record<string, unknown>);
    if (resource === 'products') {
      return this.productRoute(route, company, method, id, command, body, url, can);
    }
    if (resource === 'unit-categories' || resource === 'units') {
      return this.unitRoute(route, company, method, resource, id, body, can);
    }
    return this.invoiceRoute(route, company, method, id, command, body, url, can);
  }

  // ---- Units of measure (note backend 0047) -----------------------------------------------
  private unitsOf(company: string): CategoryJson[] {
    return (this.categories[company] ??= DEFAULT_UNITS.map(([name, units]) => ({
      public_id: uuid(),
      name,
      units: units.map(([unit, type, ratio]) => unitJson(unit, type, ratio)),
    })));
  }

  private unitRef(company: string, id: unknown): UnitReference | null {
    for (const category of this.unitsOf(company)) {
      const unit = category.units.find((item) => item.public_id === id);
      if (unit) {
        return {
          public_id: unit.public_id,
          name: unit.name,
          category: category.public_id,
          factor: unit.factor,
        };
      }
    }
    return null;
  }

  private async unitRoute(
    route: Route,
    company: string,
    method: string,
    resource: string,
    id: string | undefined,
    body: Record<string, unknown>,
    can: (permission: string) => boolean,
  ): Promise<void> {
    const categories = this.unitsOf(company);
    if (method === 'GET') {
      return this.answer(route, 200, this.page(categories));
    }
    if (!can('invoicing.manage_products')) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    const names = categories.flatMap((item) => [item.name, ...item.units.map((unit) => unit.name)]);
    const taken = (name: unknown) =>
      names.some((known) => known.toLowerCase() === String(name).trim().toLowerCase());
    if (resource === 'unit-categories') {
      if (taken(body['name']) || taken(body['reference_unit'])) {
        return this.answer(route, 400, error('invoicing_unit_exists'));
      }
      const category: CategoryJson = {
        public_id: uuid(),
        name: String(body['name']).trim(),
        units: [unitJson(String(body['reference_unit']).trim(), 'reference', 1)],
      };
      categories.push(category);
      return this.answer(route, 201, category);
    }
    if (!id) {
      const category = categories.find((item) => item.public_id === body['category']);
      if (!category || taken(body['name'])) {
        return this.answer(route, 400, error('invoicing_unit_exists'));
      }
      const unit = unitJson(
        String(body['name']).trim(),
        body['unit_type'] as UnitType,
        Number(body['ratio']),
      );
      category.units.push(unit);
      return this.answer(route, 201, unit);
    }
    const unit = categories.flatMap((item) => item.units).find((item) => item.public_id === id);
    if (!unit) {
      return this.answer(route, 404, error('not_found'));
    }
    if (unit.unit_type === 'reference' && ('ratio' in body || 'status' in body)) {
      return this.answer(route, 400, error('invoicing_unit_reference'));
    }
    if ('name' in body) unit.name = String(body['name']).trim();
    if ('status' in body) unit.status = body['status'] as UnitJson['status'];
    if ('unit_type' in body || 'ratio' in body) {
      unit.unit_type = (body['unit_type'] as UnitType | undefined) ?? unit.unit_type;
      const ratio = 'ratio' in body ? Number(body['ratio']) : Number(unit.ratio);
      unit.ratio = ratio.toFixed(6);
      unit.factor = factorOf(unit.unit_type, ratio);
    }
    return this.answer(route, 200, unit);
  }

  /** A product's two units: « Unités » by default, the purchase following the sale. */
  private productUnits(
    company: string,
    product: ProductJson | null,
    body: Record<string, unknown>,
  ): [UnitReference | null, UnitReference | null] | null {
    const first = this.unitsOf(company)[0]?.units[0]?.public_id;
    const sale =
      'sale_unit' in body
        ? this.unitRef(company, body['sale_unit'])
        : (product?.sale_unit ?? this.unitRef(company, first));
    const purchase =
      'purchase_unit' in body
        ? this.unitRef(company, body['purchase_unit'])
        : product?.purchase_unit?.category === sale?.category
          ? (product?.purchase_unit ?? sale)
          : sale;
    return sale && purchase && sale.category !== purchase.category ? null : [sale, purchase];
  }

  // ---- Products ------------------------------------------------------------------------
  private async productRoute(
    route: Route,
    company: string,
    method: string,
    id: string | undefined,
    command: string | undefined,
    body: Record<string, unknown>,
    url: URL,
    can: (permission: string) => boolean,
  ): Promise<void> {
    const list = (this.products[company] ??= []);
    if (!id) {
      if (method === 'GET') {
        const search = (url.searchParams.get('search') ?? '').toLowerCase();
        const status = url.searchParams.get('status');
        const found = list
          .filter((item) => !status || item.status === status)
          .filter((item) => `${item.code} ${item.name}`.toLowerCase().includes(search))
          .sort((a, b) => a.name.localeCompare(b.name));
        return this.answer(route, 200, this.page(found));
      }
      if (!can('invoicing.manage_products')) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
      const tax = this.tax(company, body['tax'] as string);
      if (!String(body['name'] ?? '').trim() || !tax) {
        return this.answer(route, 400, error('validation_error', { name: ['Requis.'] }));
      }
      const measures = this.productUnits(company, null, body);
      if (!measures) {
        return this.answer(route, 400, error('invoicing_unit_category_mismatch'));
      }
      const product: ProductJson = {
        public_id: uuid(),
        code: String(body['code'] ?? '').trim(),
        name: String(body['name']).trim(),
        sale_price: body['sale_price'] ? text(units(String(body['sale_price']))) : null,
        sale_account: this.account(company, body['sale_account'] as string),
        purchase_account: this.account(company, body['purchase_account'] as string),
        tax,
        sale_unit: measures[0],
        purchase_unit: measures[1],
        status: 'active',
        created_at: STAMP,
        updated_at: STAMP,
      };
      list.push(product);
      return this.answer(route, 201, product);
    }
    const product = list.find((item) => item.public_id === id);
    if (!product) {
      return this.answer(route, 404, error('not_found'));
    }
    if (method === 'GET') {
      return this.answer(route, 200, product);
    }
    if (!can('invoicing.manage_products')) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    if (command) {
      product.status = command === 'reactivate' ? 'active' : 'inactive';
      return this.answer(route, 200, product);
    }
    if ('name' in body) product.name = String(body['name']).trim();
    if ('code' in body) product.code = String(body['code']).trim();
    if ('sale_price' in body) {
      product.sale_price = body['sale_price'] ? text(units(String(body['sale_price']))) : null;
    }
    if ('sale_account' in body) {
      product.sale_account = this.account(company, body['sale_account'] as string);
    }
    if ('purchase_account' in body) {
      product.purchase_account = this.account(company, body['purchase_account'] as string);
    }
    if ('tax' in body) product.tax = this.tax(company, body['tax'] as string) ?? product.tax;
    const measures = this.productUnits(company, product, body);
    if (!measures) {
      return this.answer(route, 400, error('invoicing_unit_category_mismatch'));
    }
    [product.sale_unit, product.purchase_unit] = measures;
    return this.answer(route, 200, product);
  }

  // ---- Invoices ------------------------------------------------------------------------
  private lines(
    company: string,
    kind: Kind,
    rows: Record<string, unknown>[],
    lenient = false,
  ): LineJson[] | null {
    const products = this.products[company] ?? [];
    const lines: LineJson[] = [];
    for (const [index, row] of rows.entries()) {
      const type = (row['display_type'] as LineType | undefined) ?? 'product';
      if (type !== 'product') {
        const description = String(row['description'] ?? '').trim();
        if (!description) {
          return null;
        }
        lines.push({
          sequence: index + 1,
          display_type: type,
          product: null,
          account: null,
          description,
          quantity: '0.000000',
          unit: null,
          unit_price: '0.000000',
          tax: null,
          amount_untaxed: '0.000000',
        });
        continue;
      }
      const product = products.find((item) => item.public_id === row['product']);
      if (!product) {
        return null;
      }
      const own = customer(kind) ? product.sale_unit : product.purchase_unit;
      const unit = this.unitRef(company, row['unit']) ?? own;
      if (unit && own && unit.category !== own.category) {
        return null;
      }
      // The sale price is per « Unité »: in the line's unit, converted (note backend 0047).
      const converted =
        customer(kind) && product.sale_price !== null
          ? (
              (Number(product.sale_price) * Number(unit?.factor ?? 1)) /
              Number(product.sale_unit?.factor ?? unit?.factor ?? 1)
            ).toFixed(6)
          : null;
      const price = (row['unit_price'] as string | null) ?? converted ?? (lenient ? '0' : null);
      if (price === null) {
        return null;
      }
      const amount = roundUnits(units(String(row['quantity'])) * units(price), SCALE * SCALE);
      lines.push({
        sequence: index + 1,
        display_type: 'product',
        product: { public_id: product.public_id, code: product.code, name: product.name },
        account: customer(kind) ? product.sale_account : product.purchase_account,
        description: String(row['description'] ?? '').trim() || product.name,
        quantity: text(units(String(row['quantity']))),
        unit,
        unit_price: text(units(price)),
        tax: this.tax(company, row['tax'] as string) ?? product.tax,
        amount_untaxed: text(amount),
      });
    }
    return lines;
  }

  private totals(invoice: InvoiceJson): void {
    const bases = new Map<string, { tax: TaxReference; base: bigint }>();
    for (const line of invoice.lines) {
      if (!line.tax) {
        continue;
      }
      const known = bases.get(line.tax.public_id) ?? { tax: line.tax, base: 0n };
      bases.set(line.tax.public_id, {
        tax: line.tax,
        base: known.base + units(line.amount_untaxed),
      });
    }
    invoice.taxes = [...bases.values()].map(({ tax, base }, index) => ({
      sequence: index + 1,
      tax,
      rate: tax.rate,
      base: text(base),
      amount: text(roundUnits(base * units(tax.rate), SCALE * 100n * SCALE)),
      account: null,
    }));
    const untaxed = invoice.lines.reduce((sum, line) => sum + units(line.amount_untaxed), 0n);
    const tax = invoice.taxes.reduce((sum, line) => sum + units(line.amount), 0n);
    invoice.amount_untaxed = text(untaxed);
    invoice.amount_tax = text(tax);
    invoice.amount_total = text(untaxed + tax);
  }

  private journal(company: string, kind: Kind): Reference | null {
    const type = customer(kind) ? 'sales' : 'purchase';
    const found = this.accounting
      .books(company)
      .journals.filter((item) => item.journal_type === type && item.status === 'active')
      .sort((a, b) => a.code.localeCompare(b.code))[0];
    return found ? { public_id: found.public_id, code: found.code, name: found.name } : null;
  }

  private async invoiceRoute(
    route: Route,
    company: string,
    method: string,
    id: string | undefined,
    command: string | undefined,
    body: Record<string, unknown>,
    url: URL,
    can: (permission: string) => boolean,
  ): Promise<void> {
    const list = (this.invoices[company] ??= []);
    if (!id) {
      if (method === 'GET') {
        const kinds = url.searchParams.getAll('kind');
        const status = url.searchParams.get('status');
        const found = list
          .filter((item) => kinds.length === 0 || kinds.includes(item.kind))
          .filter((item) => !status || item.status === status)
          .sort((a, b) => b.invoice_date.localeCompare(a.invoice_date));
        return this.answer(route, 200, this.page(found));
      }
      if (!can('invoicing.create')) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
      return this.create(route, company, list, body);
    }
    if (id === 'preview' && method === 'POST') {
      return this.preview(route, company, body);
    }
    const invoice = list.find((item) => item.public_id === id);
    if (!invoice) {
      return this.answer(route, 404, error('not_found'));
    }
    if (method === 'GET') {
      return this.answer(route, 200, invoice);
    }
    if (method === 'DELETE' || method === 'PATCH') {
      if (!can('invoicing.update')) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
      if (invoice.status !== 'draft') {
        return this.answer(route, 400, error('invoicing_invoice_not_draft'));
      }
      if (method === 'DELETE') {
        if (invoice.number) {
          return this.answer(route, 400, error('invoicing_invoice_numbered'));
        }
        list.splice(list.indexOf(invoice), 1);
        return this.answer(route, 204);
      }
      const date = body['invoice_date'];
      if (
        typeof date === 'string' &&
        invoice.number &&
        !invoice.number.includes(date.slice(0, 4))
      ) {
        return this.answer(route, 400, error('invoicing_invoice_number_year'));
      }
      if (typeof body['invoice_date'] === 'string') invoice.invoice_date = body['invoice_date'];
      if (typeof body['reference'] === 'string') invoice.reference = body['reference'].trim();
      if (Array.isArray(body['lines'])) {
        const lines = this.lines(company, invoice.kind, body['lines'] as Record<string, unknown>[]);
        if (!lines) {
          return this.answer(route, 400, error('invoicing_unit_price_required'));
        }
        invoice.lines = lines;
        this.totals(invoice);
      }
      return this.answer(route, 200, invoice);
    }
    if (command === 'post') {
      if (!can('invoicing.post')) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
      return this.post(route, company, invoice);
    }
    if (command === 'cancel' || command === 'reset-to-draft') {
      if (!can('invoicing.cancel')) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
      const draft = invoice.status === 'draft';
      if (invoice.status !== 'posted' && !(command === 'cancel' && draft)) {
        return this.answer(route, 400, error('invoicing_invoice_not_posted'));
      }
      const credited = list.some(
        (item) => item.origin === invoice.public_id && item.status === 'posted',
      );
      if (invoice.settlements.length > 0 || credited) {
        return this.answer(route, 400, error('invoicing_invoice_settled'));
      }
      if (command === 'reset-to-draft') {
        Object.assign(invoice, {
          status: 'draft',
          entry: null,
          payment_state: null,
          amount_residual: null,
          posted_at: null,
        });
        return this.answer(route, 200, invoice);
      }
      invoice.status = 'cancelled';
      invoice.cancellation_reason = String(body['reason'] ?? '');
      invoice.cancellation_entry = draft
        ? null
        : { public_id: uuid(), entry_number: this.entryNumber(invoice) };
      invoice.payment_state = null;
      invoice.amount_residual = null;
      invoice.cancelled_at = STAMP;
      return this.answer(route, 200, invoice);
    }
    if (command === 'credit-note') {
      const kind = CREDIT_NOTE[invoice.kind];
      if (!kind || invoice.status !== 'posted') {
        return this.answer(route, 400, error('invoicing_credit_note_origin'));
      }
      const note: InvoiceJson = {
        ...invoice,
        public_id: uuid(),
        kind,
        status: 'draft',
        number: '',
        origin: invoice.public_id,
        reference: '',
        payment_state: null,
        amount_residual: null,
        lines: invoice.lines.map((line) => ({ ...line })),
        entry: null,
        settlements: [],
        posted_at: null,
      };
      this.totals(note);
      list.push(note);
      return this.answer(route, 201, note);
    }
    return this.answer(route, 405, error('method_not_allowed'));
  }

  /** The amounts as typed and the entry to come; a missing price counts zero. */
  private async preview(
    route: Route,
    company: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    const kind = body['kind'] as Kind;
    const lines = this.lines(
      company,
      kind,
      (body['lines'] ?? []) as Record<string, unknown>[],
      true,
    );
    if (!lines) {
      return this.answer(route, 400, error('validation_error', { lines: ['Incomplète.'] }));
    }
    const draft = { lines, taxes: [] } as unknown as InvoiceJson;
    this.totals(draft);
    const found = this.partners.list(company).find((item) => item.public_id === body['partner']);
    const collective = this.accounting
      .books(company)
      .accounts.find((item) => item.code.startsWith(customer(kind) ? '411' : '401'));
    const debitPartner = kind === 'customer_invoice' || kind === 'supplier_credit_note';
    const side = (amount: string, debit: boolean) => ({
      debit: debit ? amount : '0.000000',
      credit: debit ? '0.000000' : amount,
    });
    const sold = lines.filter((line) => line.display_type === 'product');
    const complete = found && collective && sold.length > 0 && sold.every((line) => line.account);
    const entry = complete
      ? [
          {
            account: {
              public_id: collective.public_id,
              code: collective.code,
              name: collective.name,
            },
            partner: { public_id: found.public_id, code: found.code, name: found.name },
            label: found.name,
            ...side(draft.amount_total, debitPartner),
          },
          ...sold.map((line) => ({
            account: line.account!,
            partner: null,
            label: line.description,
            ...side(line.amount_untaxed, !debitPartner),
          })),
        ]
      : [];
    return this.answer(route, 200, {
      lines: lines.map((line) => ({
        amount_untaxed: line.display_type === 'product' ? line.amount_untaxed : null,
      })),
      taxes: draft.taxes.map((item) => ({ tax: item.tax, base: item.base, amount: item.amount })),
      amount_untaxed: draft.amount_untaxed,
      amount_tax: draft.amount_tax,
      amount_total: draft.amount_total,
      entry_lines: entry,
    });
  }

  private async create(
    route: Route,
    company: string,
    list: InvoiceJson[],
    body: Record<string, unknown>,
  ): Promise<void> {
    const kind = body['kind'] as Kind;
    const found = this.partners.list(company).find((item) => item.public_id === body['partner']);
    const partner = found
      ? {
          public_id: found.public_id,
          code: found.code,
          name: found.name,
          address: found.address,
          city: found.city,
          country: found.country,
          phone: found.phone,
        }
      : null;
    const journal = this.journal(company, kind);
    if (!partner) {
      return this.answer(route, 400, error('validation_error', { partner: ['Inconnu.'] }));
    }
    if (!journal) {
      return this.answer(route, 400, error('invoicing_journal_missing'));
    }
    const lines = this.lines(company, kind, (body['lines'] ?? []) as Record<string, unknown>[]);
    if (!lines || lines.length === 0) {
      return this.answer(route, 400, error('invoicing_invoice_empty'));
    }
    const invoice: InvoiceJson = {
      public_id: uuid(),
      kind,
      status: 'draft',
      number: '',
      partner,
      invoice_date: String(body['invoice_date']),
      journal,
      currency: 'GNF',
      reference: String(body['reference'] ?? '').trim(),
      origin: null,
      amount_untaxed: '0.000000',
      amount_tax: '0.000000',
      amount_total: '0.000000',
      payment_state: null,
      amount_residual: null,
      lines,
      taxes: [],
      entry: null,
      cancellation_entry: null,
      cancellation_reason: '',
      settlements: [],
      created_at: STAMP,
      updated_at: STAMP,
      posted_at: null,
      cancelled_at: null,
    };
    this.totals(invoice);
    list.push(invoice);
    return this.answer(route, 201, invoice);
  }

  private entryNumber(invoice: InvoiceJson): string {
    const key = `${invoice.journal.code}-${invoice.invoice_date.slice(0, 4)}`;
    this.numbers[key] = (this.numbers[key] ?? 0) + 1;
    return `${key}-${String(this.numbers[key]).padStart(6, '0')}`;
  }

  private async post(route: Route, company: string, invoice: InvoiceJson): Promise<void> {
    if (invoice.status !== 'draft') {
      return this.answer(route, 400, error('invoicing_invoice_not_draft'));
    }
    const products = this.products[company] ?? [];
    for (const line of invoice.lines.filter((item) => item.display_type === 'product')) {
      const product = products.find((item) => item.public_id === line.product?.public_id);
      const account = customer(invoice.kind) ? product?.sale_account : product?.purchase_account;
      if (!account) {
        return this.answer(
          route,
          400,
          error('invoicing_product_account_missing', {
            product: line.product?.code || line.product?.name,
            side: customer(invoice.kind) ? 'sale' : 'purchase',
          }),
        );
      }
      line.account = account;
    }
    if (!invoice.number) {
      // Reset to draft, it keeps its number.
      const key = `${PREFIX[invoice.kind]}-${invoice.invoice_date.slice(0, 4)}`;
      this.numbers[key] = (this.numbers[key] ?? 0) + 1;
      invoice.number = `${key}-${String(this.numbers[key]).padStart(4, '0')}`;
    }
    invoice.status = 'posted';
    invoice.entry = this.ledgerEntry(company, invoice);
    invoice.payment_state = 'not_paid';
    invoice.amount_residual = invoice.amount_total;
    invoice.posted_at = STAMP;
    const origin = (this.invoices[company] ?? []).find((item) => item.public_id === invoice.origin);
    if (origin?.amount_residual) {
      // The credit note settles what is open on its invoice, as the server's lettering.
      const settled =
        units(invoice.amount_total) < units(origin.amount_residual)
          ? units(invoice.amount_total)
          : units(origin.amount_residual);
      const left = units(origin.amount_residual) - settled;
      origin.settlements.push({
        lettering: `LET-${String(origin.settlements.length + 1).padStart(6, '0')}`,
        date: invoice.invoice_date,
        amount: text(settled),
        credit_note: { public_id: invoice.public_id, kind: invoice.kind, number: invoice.number },
      });
      origin.amount_residual = text(left);
      origin.payment_state = left === 0n ? 'paid' : 'partial';
      invoice.amount_residual = text(0n);
      invoice.payment_state = 'paid';
    }
    return this.answer(route, 200, invoice);
  }

  /** The posting's entry in the fake ledger: partner and product lines (no tax account here). */
  private ledgerEntry(
    company: string,
    invoice: InvoiceJson,
  ): { public_id: string; entry_number: string } {
    const ledger = this.entries.ledger(company);
    const template = ledger.entries[0];
    const reference = { public_id: uuid(), entry_number: this.entryNumber(invoice) };
    const accounts = this.accounting.books(company).accounts;
    const collective = accounts.find((item) =>
      item.code.startsWith(customer(invoice.kind) ? '411' : '401'),
    );
    const debitPartner =
      invoice.kind === 'customer_invoice' || invoice.kind === 'supplier_credit_note';
    const side = (amount: string, debit: boolean) => ({
      debit: debit ? amount : '0.000000',
      credit: debit ? '0.000000' : amount,
      reference_debit: debit ? amount : '0.000000',
      reference_credit: debit ? '0.000000' : amount,
    });
    const rows = [
      ...(collective
        ? [
            {
              account: { public_id: collective.public_id, code: collective.code },
              label: `${invoice.number} - ${invoice.partner.name}`,
              partner: { public_id: invoice.partner.public_id, code: invoice.partner.code },
              ...side(invoice.amount_total, debitPartner),
            },
          ]
        : []),
      ...invoice.lines
        .filter((line) => line.account)
        .map((line) => ({
          account: { public_id: line.account!.public_id, code: line.account!.code },
          label: line.description,
          partner: null,
          ...side(line.amount_untaxed, !debitPartner),
        })),
    ];
    if (template) {
      ledger.entries.push({
        ...template,
        public_id: reference.public_id,
        entry_number: reference.entry_number,
        status: 'validated',
        kind: 'standard',
        entry_date: invoice.invoice_date,
        description: `${invoice.number} - ${invoice.partner.name}`,
        document_reference: invoice.number,
        origin: 'system',
        source_type: 'invoicing.invoice',
        source_id: invoice.public_id,
        related_entry: null,
        lines: rows.map((row, index) => ({
          public_id: uuid(),
          sequence: index + 1,
          tax: null,
          tax_rule: null,
          tax_base_amount: null,
          analytic_allocation: null,
          ...row,
        })),
      });
    }
    return reference;
  }
}
