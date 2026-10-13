import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { LOCALE_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { clearCookie, httpMock, provideHttpTesting, setCookie } from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { openTestSession } from '../../../core/session/testing';
import { TransactionsPage } from './transactions-page';

registerLocaleData(localeFr); // the app's locale (app.config.ts): « 10 oct. »

const page = (results: unknown[] = []) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});
const CASH = {
  public_id: 't-css',
  code: 'CSS',
  name: 'Caisse Principale',
  account_type: 'cash',
  currency: 'GNF',
  status: 'active',
};
const BANK = { ...CASH, public_id: 't-bq', code: 'BQ', name: 'Coris bank', account_type: 'bank' };
const ROWS = [
  {
    public_id: 'o-2',
    operation_date: '2026-10-10',
    description: 'frais achat d’eau',
    reference: '',
    direction: 'outflow',
    amount: '25000.000000',
    currency: 'GNF',
    status: 'accounted',
    counterparty: null,
    counterparty_name: '',
    offset_account: { public_id: 'a-605', code: '605100', name: 'Fournitures non stockables' },
    accounting_entry: 'e-2',
    settled: [],
    running_balance: '6108500.000000',
  },
  {
    public_id: 'o-1',
    operation_date: '2026-10-05',
    description: 'Règlement FV-2026-0001',
    reference: '',
    direction: 'inflow',
    amount: '5900000.000000',
    currency: 'GNF',
    status: 'accounted',
    counterparty: { public_id: 'p-1', code: 'CLI-00002', name: 'Société Kaloum SARL' },
    counterparty_name: '',
    offset_account: { public_id: 'a-411', code: '411100', name: 'Clients' },
    accounting_entry: 'e-1',
    settled: ['FV-2026-0001'],
    running_balance: '6133500.000000',
  },
];
const INVOICE = {
  public_id: 'l-fv1',
  entry: { public_id: 'e-fv1', entry_number: 'VTE-000001' },
  entry_date: '2026-10-01',
  journal: 'VTE',
  document_reference: 'FV-2026-0002',
  account: { public_id: 'a-411', code: '411100' },
  partner: { public_id: 'p-1', code: 'CLI-00002' },
  label: 'Facture FV-2026-0002',
  side: 'debit',
  currency: 'GNF',
  amount: '6490000.000000',
  lettered_amount: '590000.000000',
  open_amount: '5900000.000000',
  status: 'partial',
};
const ALL = [
  'treasury.read',
  'treasury.create',
  'treasury.confirm',
  'treasury.account',
  'accounting.read',
  'accounting.validate',
];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('Réconciliation bancaire (treasury/accounts/{id}/transactions/, note backend 0044)', () => {
  beforeEach(() => setCookie('XSRF-TOKEN', 'tok'));
  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  async function open(permissions: string[] = ALL) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        { provide: LOCALE_ID, useValue: 'fr-FR' },
        provideRouter([{ path: 'transactions', component: TransactionsPage }]),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), { permissions });
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/transactions?compte=CSS', TransactionsPage);
    const element = harness.routeNativeElement as HTMLElement;
    const stable = async () => {
      await settle();
      await harness.fixture.whenStable();
    };
    const mock = httpMock();
    mock.expectOne((req) => req.url === '/api/v1/treasury/accounts/').flush(page([BANK, CASH]));
    mock
      .expectOne((req) => req.url === '/api/v1/currencies/')
      .flush(page([{ code: 'GNF', name: 'Franc guinéen', decimal_places: 0, status: 'active' }]));
    await stable();
    mock
      .expectOne('/api/v1/treasury/accounts/t-css/balance/')
      .flush({ balance: '6108500.000000', currency: 'GNF' });
    mock
      .expectOne((req) => req.url === '/api/v1/treasury/accounts/t-css/transactions/')
      .flush(page(ROWS));
    await stable();
    return { component, element, stable, harness };
  }

  const row = (element: HTMLElement) => element.querySelector<HTMLTableRowElement>('tr.entry')!;
  const enter = (element: HTMLElement) =>
    row(element).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

  it('as Odoo’s list: the header, the line typed on one row, the lines and their running balance', async () => {
    const { element } = await open();

    expect(Array.from(element.querySelectorAll('thead th')).map((cell) => text(cell))).toEqual([
      'Date',
      'Libellé',
      'Partenaire',
      'Facture',
      'Entrée',
      'Sortie',
      'Solde courant',
      'Détails',
    ]);
    // The new row: every field in its cell, the balance after it.
    expect(row(element).querySelectorAll('td').length).toBe(8);
    expect(text(row(element).querySelector('.running'))).toBe('6 108 500 GNF');
    const lines = Array.from(element.querySelectorAll('tbody tr:not(.entry)')).map((line) =>
      Array.from(line.querySelectorAll('td'))
        .slice(0, 7)
        .map((cell) => text(cell)),
    );
    expect(lines).toEqual([
      [
        '10 oct.',
        'frais achat d’eau',
        '',
        '605100 Fournitures non stockables',
        '',
        '25 000 GNF',
        '6 108 500 GNF',
      ],
      [
        '5 oct.',
        'Règlement FV-2026-0001',
        'Société Kaloum SARL',
        'FV-2026-0001',
        '5 900 000 GNF',
        '',
        '6 133 500 GNF',
      ],
    ]);
    expect(element.querySelectorAll('.check').length).toBe(2);
  });

  it('a partner chosen: its unpaid invoices in the same cell; one chosen, what remains comes in', async () => {
    const { component, element, stable } = await open();
    const form = component['form'];

    form.controls.partner.setValue({ id: 'p-1', label: 'Société Kaloum SARL' });
    const request = httpMock().expectOne(
      (req) => req.url === '/api/v1/accounting/letterable-lines/',
    );
    expect(request.request.params.get('partner')).toBe('p-1');
    expect(request.request.params.get('status')).toBe('open');
    request.flush(page([INVOICE]));
    await stable();
    const options = Array.from(
      row(element).querySelectorAll<HTMLOptionElement>('select[formControlName="line"] option'),
    ).map((option) => text(option));
    expect(options).toEqual([
      'Aucune facture (avance)',
      'FV-2026-0002 · 01/10/2026 · 5 900 000 GNF',
    ]);

    form.controls.line.setValue('l-fv1');
    await stable();
    expect(form.getRawValue()).toMatchObject({
      description: 'Règlement FV-2026-0002',
      amountIn: '5900000',
      amountOut: '',
    });
    expect(text(row(element).querySelector('.running'))).toBe('12 008 500 GNF');
  });

  it('Entrée in the row: one request, the lines read again, a new line to type', async () => {
    const { component, element, stable } = await open();
    const form = component['form'];
    form.controls.partner.setValue({ id: 'p-9', label: 'Fournisseurs Divers' });
    httpMock()
      .expectOne((req) => req.url === '/api/v1/accounting/letterable-lines/')
      .flush(page([]));
    form.patchValue({
      date: '2026-10-13',
      description: 'frais de transport',
      amountOut: '100 000',
    });
    await stable();
    enter(element);
    await stable();

    const post = httpMock().expectOne('/api/v1/treasury/accounts/t-css/transactions/');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({
      operation_date: '2026-10-13',
      description: 'frais de transport',
      direction: 'outflow',
      amount: '100000',
      partner: 'p-9',
      settled_line: null,
      offset_account: null,
      idempotency_key: expect.any(String),
    });
    post.flush(ROWS[0]);
    await stable();
    httpMock()
      .expectOne('/api/v1/treasury/accounts/t-css/balance/')
      .flush({ balance: '6008500.000000', currency: 'GNF' });
    httpMock()
      .expectOne((req) => req.url === '/api/v1/treasury/accounts/t-css/transactions/')
      .flush(page(ROWS));
    await stable();
    expect(form.getRawValue()).toMatchObject({
      date: '2026-10-13',
      description: '',
      amountOut: '',
    });
    expect(row(element)).not.toBeNull();
  });

  it('a partner without invoice: an advance on its account, nothing else to choose', async () => {
    const { component, element, stable } = await open();
    const form = component['form'];
    form.controls.partner.setValue({ id: 'p-1', label: 'Société Kaloum SARL' });
    httpMock()
      .expectOne((req) => req.url === '/api/v1/accounting/letterable-lines/')
      .flush(page([]));
    form.patchValue({ amountIn: '300000' });
    await stable();
    // « Enregistrer »: saved, then the line closes.
    Array.from(element.querySelectorAll<HTMLButtonElement>('alco-page-header button'))
      .find((button) => text(button) === 'Enregistrer')!
      .click();
    await stable();

    const post = httpMock().expectOne('/api/v1/treasury/accounts/t-css/transactions/');
    expect(post.request.body).toMatchObject({
      direction: 'inflow',
      amount: '300000',
      partner: 'p-1',
      settled_line: null,
      offset_account: null,
    });
    post.flush(ROWS[1]);
    await stable();
    httpMock()
      .expectOne('/api/v1/treasury/accounts/t-css/balance/')
      .flush({ balance: '0', currency: 'GNF' });
    httpMock()
      .expectOne((req) => req.url === '/api/v1/treasury/accounts/t-css/transactions/')
      .flush(page(ROWS));
    await stable();
    expect(element.querySelector('tr.entry')).toBeNull();
  });

  it('nothing sent without an amount, nor without a partner', async () => {
    const { component, element, stable } = await open();
    enter(element);
    await stable();
    expect(text(element.querySelector('.entry-error'))).toBe(
      'Saisissez la date et un montant en entrée ou en sortie.',
    );
    component['form'].patchValue({ amountIn: '1000' });
    enter(element);
    await stable();
    expect(text(element.querySelector('.entry-error'))).toBe('Choisissez le partenaire.');
    httpMock().expectNone((req) => req.method === 'POST');
  });

  it('read only: the lines, no line to type nor « Nouveau »', async () => {
    const { element } = await open(['treasury.read', 'accounting.read']);
    expect(element.querySelector('tr.entry')).toBeNull();
    expect(text(element.querySelector('alco-page-header'))).not.toContain('Nouveau');
    expect(element.querySelectorAll('tbody tr').length).toBe(2);
  });
});
