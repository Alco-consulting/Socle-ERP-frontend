import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { LOCALE_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { firstValueFrom } from 'rxjs';

import { clearCookie, httpMock, provideHttpTesting, setCookie } from '../../core/http/testing';
import { SessionStore } from '../../core/session/session.store';
import { openTestSession } from '../../core/session/testing';
import { AlcoConfirmService } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { InvoicingApi } from './data-access/invoicing-api';
import { Invoice, Product } from './data-access/invoicing-models';
import { InvoiceListPage } from './invoice-list';
import { InvoiceSheetPage } from './invoice-sheet';
import { ProductCatalogService } from './product-catalog';
import { ProductFormPage } from './product-form';

registerLocaleData(localeFr); // the app's locale (app.config.ts): « 12 oct. »

const page = (results: unknown[] = [], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ALL = [
  'invoicing.read',
  'invoicing.create',
  'invoicing.update',
  'invoicing.post',
  'invoicing.cancel',
  'invoicing.manage_products',
  'accounting.read',
  'taxes.read',
];
const VAT = { public_id: 't-vat', code: 'TVA_18', name: 'TVA 18 %', rate: '18.0000' };
const ref = (code: string, name: string) => ({ public_id: `r-${code}`, code, name });

const PRODUCT: Product = {
  public_id: 'r-MAR',
  code: 'MAR',
  name: 'Marchandise',
  sale_price: '1000000.000000',
  sale_account: ref('701100', 'Ventes de marchandises'),
  purchase_account: null,
  tax: VAT,
  unit: 'Utilisateur',
  status: 'active',
  created_at: '2026-10-12T09:00:00Z',
  updated_at: '2026-10-12T09:00:00Z',
};
const DRAFT: Invoice = {
  public_id: 'i-1',
  kind: 'customer_invoice',
  status: 'draft',
  number: '',
  partner: {
    ...ref('CLI-00001', 'Client Recette 01'),
    address: 'Soloprimo',
    city: 'Conakry',
    country: 'GN',
    phone: '+224 611 178 615',
  },
  invoice_date: '2026-10-12',
  journal: ref('VT', 'Ventes'),
  currency: 'GNF',
  reference: '',
  origin: null,
  amount_untaxed: '1000000.000000',
  amount_tax: '180000.000000',
  amount_total: '1180000.000000',
  payment_state: null,
  amount_residual: null,
  lines: [
    {
      sequence: 1,
      display_type: 'product',
      product: ref('MAR', 'Marchandise'),
      description: 'Marchandise',
      quantity: '1.0000',
      unit: 'Utilisateur',
      unit_price: '1000000.000000',
      tax: VAT,
      amount_untaxed: '1000000.000000',
      account: ref('701100', 'Ventes de marchandises'),
    },
  ],
  taxes: [
    {
      sequence: 1,
      tax: VAT,
      rate: '18.0000',
      base: '1000000.000000',
      amount: '180000.000000',
      account: null,
    },
  ],
  entry: null,
  cancellation_entry: null,
  cancellation_reason: '',
  settlements: [],
  created_at: '2026-10-12T09:00:00Z',
  updated_at: '2026-10-12T09:00:00Z',
  posted_at: null,
  cancelled_at: null,
};
const POSTED: Invoice = {
  ...DRAFT,
  status: 'posted',
  number: 'FV-2026-0001',
  payment_state: 'not_paid',
  amount_residual: '1180000.000000',
  entry: { public_id: 'e-1', entry_number: 'VT-2026-000001' },
  taxes: [{ ...DRAFT.taxes[0], account: ref('443100', 'TVA facturée') }],
};

/** Side requests (history): answered empty. */
function answerSideRequests(): void {
  for (const request of httpMock().match((req) => req.url.includes('/audit/'))) {
    request.flush(page());
  }
}

/** What the sheet reads to edit a draft: the products, the taxes, the journals. */
function answerOptions(): void {
  for (const request of httpMock().match((req) => req.url === '/api/v1/invoicing/products/')) {
    request.flush(page([PRODUCT]));
  }
  for (const request of httpMock().match((req) => req.url === '/api/v1/taxes/')) {
    request.flush(page([{ ...VAT, withholding: false, type_tax_use: 'both', status: 'active' }]));
  }
  for (const request of httpMock().match((req) => req.url === '/api/v1/accounting/journals/')) {
    request.flush(page());
  }
}

/** The text of an element, its pieces separated by a space (as on screen). */
function text(element: Element | null): string {
  if (!element) {
    return '';
  }
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) {
    parts.push(walker.currentNode.textContent ?? '');
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
/** The document's buttons, as Odoo's (and « Nouveau »). */
const buttons = (element: HTMLElement) =>
  Array.from(element.querySelectorAll('.control a, .actions button')).map((item) => text(item));
const button = (element: HTMLElement, label: string) =>
  Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
    (item) => text(item) === label,
  )!;
const tab = (element: HTMLElement, label: string) =>
  Array.from(element.querySelectorAll<HTMLButtonElement>('[role=tab]')).find(
    (item) => text(item) === label,
  )!;
const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input'));
};

describe('Facturation (invoicing/)', () => {
  async function open(url: string, permissions = ALL) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        { provide: LOCALE_ID, useValue: 'fr-FR' },
        provideRouter([
          {
            path: 'ventes/factures',
            data: { breadcrumb: 'Factures clients', kind: 'customer_invoice' },
            children: [
              { path: '', component: InvoiceListPage },
              { path: 'nouvelle', component: InvoiceSheetPage },
              { path: ':id', data: { breadcrumb: 'Facture' }, component: InvoiceSheetPage },
            ],
          },
          { path: 'produits/nouveau', component: ProductFormPage },
        ]),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), { permissions });
    setCookie('XSRF-TOKEN', 'tok');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const element = harness.routeNativeElement as HTMLElement;
    const stable = async () => {
      await settle();
      await harness.fixture.whenStable();
    };
    return { element, stable };
  }

  async function openDraft(invoice: Invoice = DRAFT) {
    const opened = await open(`/ventes/factures/${invoice.public_id}`);
    httpMock().expectOne(`/api/v1/invoicing/invoices/${invoice.public_id}/`).flush(invoice);
    answerOptions();
    await opened.stable();
    return opened;
  }

  afterEach(() => {
    answerSideRequests();
    answerOptions();
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('the API: a kind per list, the commands of a document, CSRF', () => {
    TestBed.configureTestingModule({ providers: [...provideHttpTesting()] });
    setCookie('XSRF-TOKEN', 'tok');
    const api = TestBed.inject(InvoicingApi);
    void firstValueFrom(api.invoices({ kind: 'supplier_invoice', status: 'posted', page: 2 }));
    const list = httpMock().expectOne((req) => req.url === '/api/v1/invoicing/invoices/');
    expect(
      ['kind', 'status', 'page', 'page_size'].map((name) => list.request.params.get(name)),
    ).toEqual(['supplier_invoice', 'posted', '2', '25']);
    list.flush(page());
    for (const [call, url] of [
      [() => api.post('i-1'), '/api/v1/invoicing/invoices/i-1/post/'],
      [() => api.cancel('i-1', 'Doublon'), '/api/v1/invoicing/invoices/i-1/cancel/'],
      [() => api.resetToDraft('i-1'), '/api/v1/invoicing/invoices/i-1/reset-to-draft/'],
      [() => api.creditNote('i-1'), '/api/v1/invoicing/invoices/i-1/credit-note/'],
      [
        () => api.preview({ kind: 'customer_invoice', lines: [] }),
        '/api/v1/invoicing/invoices/preview/',
      ],
    ] as const) {
      void firstValueFrom<unknown>(call());
      const request = httpMock().expectOne(url);
      expect(request.request.method).toBe('POST');
      expect(request.request.headers.get('X-XSRF-TOKEN')).toBe('tok');
      request.flush(POSTED);
    }
  });

  it('list: the kind of the route, its columns and states', async () => {
    const { element, stable } = await open('/ventes/factures');
    const request = httpMock().expectOne((req) => req.url === '/api/v1/invoicing/invoices/');
    expect(request.request.params.get('kind')).toBe('customer_invoice');
    request.flush(page([DRAFT, POSTED]));
    await stable();
    const headers = Array.from(element.querySelectorAll('thead th')).map((cell) =>
      cell.textContent?.trim(),
    );
    expect(headers).toEqual([
      'Numéro',
      'Client',
      'Date',
      'Total HT',
      'Total TTC',
      'État',
      'Paiement',
    ]);
    const rows = Array.from(element.querySelectorAll('tbody tr')).map((row) =>
      row.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(rows[0]).toContain('Brouillon');
    expect(rows[1]).toContain('FV-2026-0001');
    expect(rows[1]).toContain('1 180 000');
    expect(rows[1]).toContain('Comptabilisée');
    expect(rows[1]).toContain('Non payée');
    expect(element.textContent).toContain('Nouvelle facture');
  });

  it('a draft is edited in place, as in Odoo: its fields, account, unit and buttons', async () => {
    const { element } = await openDraft();
    expect(text(element.querySelector('.kind'))).toBe('Facture client');
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Brouillon');
    expect(buttons(element)).toEqual(['Nouveau', 'Confirmer', 'Annuler']);
    expect(text(element.querySelector('[aria-current=step]'))).toBe('Brouillon');
    // ⚙: a draft without number is deleted from there.
    expect(element.querySelector('alco-dropdown')).not.toBeNull();
    expect(text(element.querySelector('.party'))).toContain(
      '+224 611 178 615 Soloprimo Conakry Guinée',
    );
    expect(element.querySelector<HTMLInputElement>('input[type=date]')?.value).toBe('2026-10-12');
    const row = element.querySelector('[data-line="0"]')!;
    expect(row.querySelector<HTMLSelectElement>('select[aria-label="Produit"]')?.value).toBe(
      'r-MAR',
    );
    expect(text(row)).toContain('701100 Ventes de marchandises');
    expect(text(row)).toContain('Utilisateur');
    expect(text(row)).toContain('1 000 000 GNF');
    expect(Array.from(element.querySelectorAll('.add-links button')).map(text)).toEqual([
      'Ajouter une ligne',
      'Ajouter une section',
      'Ajouter une note',
      'Catalogue',
    ]);
    const totals = text(element.querySelector('.totals'));
    expect(totals).toContain('Montant hors taxes : 1 000 000 GNF');
    expect(totals).toContain('TVA 18 % : 180 000 GNF');
    expect(totals).toContain('Total : 1 180 000 GNF');
    expect(totals).toContain('Montant dû : 1 180 000 GNF');
    // Nothing asked while nothing changes.
    await wait(350);
    httpMock().expectNone('/api/v1/invoicing/invoices/preview/');
  });

  it('as typed: the server computes the amounts, nothing stored; « Confirmer » saves then posts', async () => {
    const { element, stable } = await openDraft();
    const row = element.querySelector('[data-line="0"]')!;
    type(row.querySelector<HTMLInputElement>('input[aria-label="Quantité"]')!, '2');
    await wait(350);
    await stable();
    const preview = httpMock().expectOne('/api/v1/invoicing/invoices/preview/');
    expect(preview.request.body).toEqual({
      kind: 'customer_invoice',
      partner: 'r-CLI-00001',
      lines: [
        { product: 'r-MAR', quantity: '2', unit_price: '1000000', description: '', tax: 't-vat' },
      ],
    });
    preview.flush({
      lines: [{ amount_untaxed: '2000000.000000' }],
      taxes: [{ tax: VAT, base: '2000000.000000', amount: '360000.000000' }],
      amount_untaxed: '2000000.000000',
      amount_tax: '360000.000000',
      amount_total: '2360000.000000',
      entry_lines: [],
    });
    await stable();
    expect(text(row)).toContain('2 000 000 GNF');
    expect(text(element.querySelector('.totals'))).toContain('Total : 2 360 000 GNF');
    // ☁ and « Ignorer les modifications » while it is not saved.
    expect(button(element, 'Enregistrer')).toBeDefined();

    vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
    button(element, 'Confirmer').click();
    await stable();
    const saved = httpMock().expectOne(
      (req) => req.url === '/api/v1/invoicing/invoices/i-1/' && req.method === 'PATCH',
    );
    expect(saved.request.body.lines[0].quantity).toBe('2');
    saved.flush(DRAFT);
    await stable();
    httpMock().expectOne('/api/v1/invoicing/invoices/i-1/post/').flush(POSTED);
    await stable();
    httpMock().expectOne('/api/v1/invoicing/invoices/i-1/').flush(POSTED);
    answerOptions();
    await stable();
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('FV-2026-0001');
    expect(buttons(element)).toEqual(['Nouveau', 'Avoir', 'Remettre en brouillon']);
    expect(element.querySelector('input[aria-label="Quantité"]')).toBeNull();
    expect(text(element.querySelector('[aria-current=step]'))).toBe('Comptabilisé');
  });

  it('sections, notes and the catalogue, as in Odoo', async () => {
    const { element, stable } = await openDraft();
    button(element, 'Ajouter une section').click();
    await stable();
    const section = element.querySelector<HTMLInputElement>('[data-line="1"] input')!;
    expect(section.getAttribute('aria-label')).toBe('Section');
    type(section, 'Logiciels');
    button(element, 'Ajouter une note').click();
    await stable();
    expect(element.querySelector('[data-line="2"] input')?.getAttribute('aria-label')).toBe('Note');

    const open = vi
      .spyOn(TestBed.inject(ProductCatalogService), 'open')
      .mockResolvedValue(new Map([['r-MAR', 3]]));
    button(element, 'Catalogue').click();
    await stable();
    expect(open.mock.calls[0][0].quantities.get('r-MAR')).toBe(1);
    expect(
      element.querySelector<HTMLInputElement>('[data-line="0"] input[aria-label="Quantité"]')
        ?.value,
    ).toBe('3');
    await wait(350);
    const preview = httpMock().expectOne('/api/v1/invoicing/invoices/preview/');
    // The note has no text yet: it waits.
    expect(
      preview.request.body.lines.map((line: { display_type?: string }) => line.display_type),
    ).toEqual([undefined, 'section']);
    preview.flush({
      lines: [{ amount_untaxed: '3000000.000000' }, { amount_untaxed: null }],
      taxes: [],
      amount_untaxed: '3000000.000000',
      amount_tax: '0.000000',
      amount_total: '3000000.000000',
      entry_lines: [],
    });
    await stable();
  });

  it('a new invoice: the same sheet; « Annuler » leaves without saving', async () => {
    const { element, stable } = await open('/ventes/factures/nouvelle');
    answerOptions();
    await stable();
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Brouillon');
    expect(buttons(element)).toEqual(['Nouveau', 'Confirmer', 'Annuler']);
    // As in Odoo, no line yet.
    expect(element.querySelectorAll('tbody tr')).toHaveLength(0);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    button(element, 'Annuler').click();
    await stable();
    expect(navigate).toHaveBeenCalledWith('/app/comptabilite/ventes/factures');
  });

  it('the tab « Écritures comptables »: the lines of its entry, asked when opened', async () => {
    const { element, stable } = await openDraft(POSTED);
    httpMock().expectNone((req) => req.url.includes('entry-lines'));
    tab(element, 'Écritures comptables').click();
    await stable();
    const lines = httpMock().expectOne((req) => req.url === '/api/v1/accounting/entry-lines/');
    expect(lines.request.params.get('entry')).toBe('e-1');
    expect(lines.request.params.get('state')).toBe('all');
    lines.flush(
      page([
        {
          public_id: 'l-1',
          entry: { public_id: 'e-1', entry_number: 'VT-2026-000001' },
          account: ref('411100', 'Clients'),
          partner: ref('CLI-00001', 'Client Recette 01'),
          label: 'Facture FV-2026-0001',
          reference_debit: '1180000.000000',
          reference_credit: '0.000000',
          reference_currency: 'GNF',
        },
      ]),
    );
    await stable();
    expect(text(element.querySelector('alco-table tbody'))).toContain('411100 Clients');
    expect(element.textContent).toContain('Ouvrir l’écriture VT-2026-000001');
  });

  it('paid in part by a credit note: the ribbon, « Extourné le », what is still due', async () => {
    const { element } = await openDraft({
      ...POSTED,
      payment_state: 'partial',
      amount_residual: '880000.000000',
      settlements: [
        {
          lettering: 'LET-000001',
          date: '2026-10-12',
          amount: '300000.000000',
          credit_note: { public_id: 'n-1', kind: 'customer_credit_note', number: 'AV-2026-0001' },
        },
      ],
    });
    expect(text(element.querySelector('.ribbon'))).toBe('Partiel');
    const totals = text(element.querySelector('.totals'));
    expect(totals).toContain('Extourné le 12/10/2026 AV-2026-0001 300 000 GNF');
    expect(totals).toContain('Montant dû : 880 000 GNF');
  });

  it('« Remettre en brouillon »: confirmed, its number kept, editable again, cancelled not deleted', async () => {
    const { element, stable } = await openDraft(POSTED);
    const confirm = vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
    button(element, 'Remettre en brouillon').click();
    await stable();
    expect(confirm.mock.calls[0][0].message).toContain('VT-2026-000001 est extournée');
    const reset = httpMock().expectOne('/api/v1/invoicing/invoices/i-1/reset-to-draft/');
    expect(reset.request.method).toBe('POST');
    const numbered: Invoice = { ...DRAFT, number: 'FV-2026-0001' };
    reset.flush(numbered);
    await stable();
    httpMock().expectOne('/api/v1/invoicing/invoices/i-1/').flush(numbered);
    answerOptions();
    await stable();
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('FV-2026-0001');
    expect(buttons(element)).toEqual(['Nouveau', 'Confirmer', 'Annuler']);
    // A numbered draft is never deleted: no ⚙ « Supprimer ».
    expect(element.querySelector('alco-dropdown')).toBeNull();
    expect(element.querySelector('input[aria-label="Quantité"]')).not.toBeNull();
  });

  it('product: created with its accounts and tax by their ids', async () => {
    const navigate = vi.fn().mockResolvedValue(true);
    const { element, stable } = await open('/produits/nouveau');
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockImplementation(navigate);
    for (const request of httpMock().match((req) => req.url === '/api/v1/accounting/accounts/')) {
      const income = request.request.params.get('account_type') === 'income';
      request.flush(
        page([
          income
            ? { public_id: 'a-701', code: '701100', name: 'Ventes de marchandises' }
            : { public_id: 'a-601', code: '601100', name: 'Achats de marchandises' },
        ]),
      );
    }
    httpMock()
      .expectOne((req) => req.url === '/api/v1/taxes/')
      .flush(page([{ ...VAT, withholding: false, type_tax_use: 'both', status: 'active' }]));
    await stable();
    const fill = (name: string, value: string) => {
      const field = element.querySelector<HTMLInputElement | HTMLSelectElement>(
        `[formControlName="${name}"]`,
      )!;
      field.value = value;
      field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input'));
    };
    fill('name', ' Marchandise ');
    fill('sale_price', '1 000 000');
    fill('sale_account', 'a-701');
    fill('purchase_account', 'a-601');
    fill('tax', 't-vat');
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await stable();
    const create = httpMock().expectOne('/api/v1/invoicing/products/');
    expect(create.request.body).toEqual({
      code: '',
      name: 'Marchandise',
      sale_price: '1000000',
      sale_account: 'a-701',
      purchase_account: 'a-601',
      tax: 't-vat',
      unit: '',
    });
    create.flush({ public_id: 'p-1', name: 'Marchandise', status: 'active' });
    await stable();
    expect(navigate).toHaveBeenCalledWith('/app/comptabilite/produits');
  });
});
