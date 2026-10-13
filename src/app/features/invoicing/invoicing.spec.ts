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
import { Invoice } from './data-access/invoicing-models';
import { InvoiceDetailPage } from './invoice-detail';
import { InvoiceListPage } from './invoice-list';
import { ProductFormPage } from './product-form';

registerLocaleData(localeFr); // the app's locale (app.config.ts): « 12 oct. »

const page = (results: unknown[] = [], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
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
      product: ref('MAR', 'Marchandise'),
      description: 'Marchandise',
      quantity: '1.0000',
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
  lines: [{ ...DRAFT.lines[0], account: ref('701100', 'Ventes de marchandises') }],
  taxes: [{ ...DRAFT.taxes[0], account: ref('443100', 'TVA facturée') }],
};

/** Side requests (history): answered empty. */
function answerSideRequests(): void {
  for (const request of httpMock().match((req) => req.url.includes('/audit/'))) {
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
/** The document's action buttons, as Odoo's (and « Nouveau »). */
const buttons = (element: HTMLElement) =>
  Array.from(element.querySelectorAll('.control a, .actions button')).map((item) => text(item));
const button = (element: HTMLElement, label: string) =>
  Array.from(element.querySelectorAll<HTMLButtonElement>('.actions button')).find(
    (item) => text(item) === label,
  )!;
const tab = (element: HTMLElement, label: string) =>
  Array.from(element.querySelectorAll<HTMLButtonElement>('[role=tab]')).find(
    (item) => text(item) === label,
  )!;

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
              { path: ':id', data: { breadcrumb: 'Facture' }, component: InvoiceDetailPage },
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

  afterEach(() => {
    answerSideRequests();
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
    ] as const) {
      void firstValueFrom(call());
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

  it('a draft: « Comptabiliser » after a confirmation, then its number and entry', async () => {
    const { element, stable } = await open('/ventes/factures/i-1');
    httpMock().expectOne('/api/v1/invoicing/invoices/i-1/').flush(DRAFT);
    await stable();
    // As in Odoo: the kind, then the number (« Brouillon » before), the partner's address.
    expect(text(element.querySelector('.kind'))).toBe('Facture client');
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Brouillon');
    expect(text(element.querySelector('.party'))).toContain(
      'Client Recette 01 +224 611 178 615 Soloprimo Conakry Guinée',
    );
    expect(text(element.querySelector('.dates'))).toContain('Date de facturation 12 oct.');
    expect(buttons(element)).toEqual(['Nouveau', 'Comptabiliser', 'Modifier', 'Supprimer']);
    expect(text(element.querySelector('[aria-current=step]'))).toBe('Brouillon');
    // On a draft, each line shows the product's account already.
    expect(text(element.querySelector('tbody'))).toContain('701100 Ventes de marchandises');
    expect(text(element.querySelector('.totals'))).toContain('Total : 1 180 000 GNF');
    expect(text(element.querySelector('.totals'))).not.toContain('Montant dû');
    const confirm = vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
    const button = Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
      (item) => item.textContent?.trim() === 'Comptabiliser',
    )!;
    button.click();
    await stable();
    expect(confirm).toHaveBeenCalled();
    const post = httpMock().expectOne('/api/v1/invoicing/invoices/i-1/post/');
    expect(post.request.method).toBe('POST');
    post.flush(POSTED);
    await stable();
    httpMock().expectOne('/api/v1/invoicing/invoices/i-1/').flush(POSTED);
    await stable();
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('FV-2026-0001');
    expect(text(element.querySelector('[aria-current=step]'))).toBe('Comptabilisé');
    expect(text(element.querySelector('.totals'))).toContain('Montant dû : 1 180 000 GNF');
    tab(element, 'Autres informations').click();
    await stable();
    const entry = element.querySelector<HTMLAnchorElement>('a.mono');
    expect(entry?.textContent?.trim()).toBe('VT-2026-000001');
    expect(entry?.getAttribute('href')).toBe('/app/comptabilite/ecritures/e-1');
  });

  it('the tab « Écritures comptables »: the lines of its entry, asked when opened', async () => {
    const { element, stable } = await open('/ventes/factures/i-1');
    httpMock().expectOne('/api/v1/invoicing/invoices/i-1/').flush(POSTED);
    await stable();
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
    expect(text(element.querySelector('tbody'))).toContain('411100 Clients');
    expect(text(element.querySelector('tbody'))).toContain('1 180 000 GNF');
    expect(element.textContent).toContain('Ouvrir l’écriture VT-2026-000001');
  });

  it('paid in part by a credit note: the ribbon, « Extourné le », what is still due', async () => {
    const { element, stable } = await open('/ventes/factures/i-1');
    httpMock()
      .expectOne('/api/v1/invoicing/invoices/i-1/')
      .flush({
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
    await stable();
    expect(text(element.querySelector('.ribbon'))).toBe('Partiel');
    const totals = text(element.querySelector('.totals'));
    expect(totals).toContain('Extourné le 12/10/2026 AV-2026-0001 300 000 GNF');
    expect(totals).toContain('Montant dû : 880 000 GNF');
    expect(buttons(element)).toEqual(['Nouveau', 'Avoir', 'Remettre en brouillon']);
  });

  it('« Remettre en brouillon »: confirmed, its number kept, then cancelled, not deleted', async () => {
    const { element, stable } = await open('/ventes/factures/i-1');
    httpMock().expectOne('/api/v1/invoicing/invoices/i-1/').flush(POSTED);
    await stable();
    expect(buttons(element)).toEqual(['Nouveau', 'Avoir', 'Remettre en brouillon']);
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
    await stable();
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('FV-2026-0001');
    expect(buttons(element)).toEqual(['Nouveau', 'Comptabiliser', 'Modifier', 'Annuler']);
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
    });
    create.flush({ public_id: 'p-1', name: 'Marchandise', status: 'active' });
    await stable();
    expect(navigate).toHaveBeenCalledWith('/app/comptabilite/produits');
  });
});
