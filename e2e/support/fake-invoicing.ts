import { Route } from '@playwright/test';

import { FakeAccounting } from './fake-accounting';
import { FakeAccountingEntries } from './fake-accounting-entries';
import { FakePartners, PartnersContext } from './fake-partners';

/**
 * The invoicing part of the fake API (`invoicing/products/`, `invoicing/invoices/`, note
 * backend 0038): products, invoices and credit notes in memory, per company. The amounts are
 * the server's rule, for a currency without decimals (GNF): line = quantity x unit price,
 * tax by rate on its lines' total, rounded half up. Posting gives the number and an entry
 * reference; only the rules the tests need.
 */

interface Reference {
  public_id: string;
  code: string;
  name: string;
}
interface TaxReference extends Reference {
  rate: string;
}
interface ProductJson {
  public_id: string;
  code: string;
  name: string;
  sale_price: string | null;
  sale_account: Reference | null;
  purchase_account: Reference | null;
  tax: TaxReference;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}
interface LineJson {
  sequence: number;
  product: Reference;
  description: string;
  quantity: string;
  unit_price: string;
  tax: TaxReference;
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
interface InvoiceJson {
  public_id: string;
  kind: Kind;
  status: 'draft' | 'posted' | 'cancelled';
  number: string;
  partner: Reference;
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
    return this.invoiceRoute(route, company, method, id, command, body, url, can);
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
      const product: ProductJson = {
        public_id: uuid(),
        code: String(body['code'] ?? '').trim(),
        name: String(body['name']).trim(),
        sale_price: body['sale_price'] ? text(units(String(body['sale_price']))) : null,
        sale_account: this.account(company, body['sale_account'] as string),
        purchase_account: this.account(company, body['purchase_account'] as string),
        tax,
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
    return this.answer(route, 200, product);
  }

  // ---- Invoices ------------------------------------------------------------------------
  private lines(company: string, kind: Kind, rows: Record<string, unknown>[]): LineJson[] | null {
    const products = this.products[company] ?? [];
    const lines: LineJson[] = [];
    for (const [index, row] of rows.entries()) {
      const product = products.find((item) => item.public_id === row['product']);
      if (!product) {
        return null;
      }
      const price =
        (row['unit_price'] as string | null) ?? (customer(kind) ? product.sale_price : null);
      if (price === null) {
        return null;
      }
      const amount = roundUnits(units(String(row['quantity'])) * units(price), SCALE * SCALE);
      lines.push({
        sequence: index + 1,
        product: { public_id: product.public_id, code: product.code, name: product.name },
        description: String(row['description'] ?? '').trim() || product.name,
        quantity: text(units(String(row['quantity']))),
        unit_price: text(units(price)),
        tax: this.tax(company, row['tax'] as string) ?? product.tax,
        amount_untaxed: text(amount),
        account: null,
      });
    }
    return lines;
  }

  private totals(invoice: InvoiceJson): void {
    const bases = new Map<string, { tax: TaxReference; base: bigint }>();
    for (const line of invoice.lines) {
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
        list.splice(list.indexOf(invoice), 1);
        return this.answer(route, 204);
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
    if (command === 'cancel') {
      if (invoice.status !== 'posted') {
        return this.answer(route, 400, error('invoicing_invoice_not_posted'));
      }
      invoice.status = 'cancelled';
      invoice.cancellation_reason = String(body['reason'] ?? '');
      invoice.cancellation_entry = { public_id: uuid(), entry_number: this.entryNumber(invoice) };
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
        lines: invoice.lines.map((line) => ({ ...line, account: null })),
        entry: null,
        posted_at: null,
      };
      this.totals(note);
      list.push(note);
      return this.answer(route, 201, note);
    }
    return this.answer(route, 405, error('method_not_allowed'));
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
      ? { public_id: found.public_id, code: found.code, name: found.name }
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
    for (const line of invoice.lines) {
      const product = products.find((item) => item.public_id === line.product.public_id);
      const account = customer(invoice.kind) ? product?.sale_account : product?.purchase_account;
      if (!account) {
        return this.answer(
          route,
          400,
          error('invoicing_product_account_missing', {
            product: line.product.code || line.product.name,
            side: customer(invoice.kind) ? 'sale' : 'purchase',
          }),
        );
      }
      line.account = account;
    }
    const year = invoice.invoice_date.slice(0, 4);
    const key = `${PREFIX[invoice.kind]}-${year}`;
    this.numbers[key] = (this.numbers[key] ?? 0) + 1;
    invoice.number = `${key}-${String(this.numbers[key]).padStart(4, '0')}`;
    invoice.status = 'posted';
    invoice.entry = { public_id: uuid(), entry_number: this.entryNumber(invoice) };
    invoice.payment_state = 'not_paid';
    invoice.amount_residual = invoice.amount_total;
    invoice.posted_at = STAMP;
    return this.answer(route, 200, invoice);
  }
}
