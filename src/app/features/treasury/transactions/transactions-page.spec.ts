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
  /** « Partenaire » or « Compte », as Odoo's buttons on the line. */
  const press = async (element: HTMLElement, label: string, stable: () => Promise<void>) => {
    Array.from(row(element).querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => text(button) === label)!
      .click();
    await stable();
  };

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
    // The new row: every field in its cell, the balance after it; as Odoo's, « Partenaire »,
    // « Compte » and ⋮ until one is chosen.
    expect(row(element).querySelectorAll('td').length).toBe(7);
    expect(
      Array.from(row(element).querySelectorAll('.choices > button')).map((cell) => text(cell)),
    ).toEqual(['Partenaire', 'Compte']);
    // Plus de ⋮ : les modèles de rapprochement n'existent plus.
    expect(row(element).querySelector('alco-dropdown')).toBeNull();
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
    await press(element, 'Partenaire', stable);
    expect(
      row(element).querySelector('alco-autocomplete[formControlName="partner"]'),
    ).not.toBeNull();

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
    await press(element, 'Partenaire', stable);
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
    // A new line: the three buttons again.
    expect(row(element).querySelector('.choices')).not.toBeNull();
  });

  it('a partner without invoice: an advance on its account, nothing else to choose', async () => {
    const { component, element, stable } = await open();
    const form = component['form'];
    await press(element, 'Partenaire', stable);
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

  it('nothing sent without an amount, nor with a choice begun and left empty', async () => {
    const { component, element, stable } = await open();
    const error = () => text(element.querySelector('.entry-error'));
    enter(element);
    await stable();
    expect(error()).toBe('Saisissez la date et un montant en entrée ou en sortie.');
    component['form'].patchValue({ amountIn: '1000' });
    await press(element, 'Partenaire', stable);
    enter(element);
    await stable();
    expect(error()).toBe('Choisissez le partenaire.');
    component['choose']('account');
    await stable();
    enter(element);
    await stable();
    expect(error()).toBe('Choisissez le compte.');
    httpMock().expectNone((req) => req.method === 'POST');
  });

  it('nothing chosen: the line kept « à rapprocher », then reconciled (note backend 0050)', async () => {
    const { component, element, stable } = await open();
    component['form'].patchValue({ description: 'versement inconnu', amountIn: '7000' });
    enter(element);
    await stable();
    const kept = httpMock().expectOne('/api/v1/treasury/accounts/t-css/transactions/');
    expect(kept.request.body).toMatchObject({
      direction: 'inflow',
      amount: '7000',
      partner: null,
      settled_line: null,
      offset_account: null,
    });
    const pending = {
      ...ROWS[0],
      public_id: 'o-9',
      description: 'versement inconnu',
      direction: 'inflow',
      amount: '7000.000000',
      status: 'confirmed',
      offset_account: null,
      accounting_entry: null,
    };
    kept.flush(pending);
    await stable();
    httpMock().expectOne('/api/v1/treasury/accounts/t-css/balance/').flush({ balance: '0' });
    httpMock()
      .expectOne((req) => req.url === '/api/v1/treasury/accounts/t-css/transactions/')
      .flush(page([pending, ...ROWS]));
    await stable();
    const waiting = element.querySelector<HTMLElement>('tbody tr.waiting')!;
    expect(text(waiting)).toContain('versement inconnu');
    Array.from(waiting.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => text(button) === 'Compte')!
      .click();
    await stable();

    // Completed in its own place, as Odoo's: the same row, every field to change.
    expect(element.querySelectorAll('tbody tr.entry').length).toBe(1);
    expect(element.querySelector('tbody tr')?.classList.contains('entry')).toBe(true);
    expect(row(element).getAttribute('aria-label')).toBe('Ligne à rapprocher');
    expect(component['counterpart']()).toBe('account');
    component['form'].patchValue({ description: 'rentrée de caisse', amountIn: '7500' });
    component['form'].controls.account.setValue({ id: 'a-605', label: '605100' });
    enter(element);
    await stable();
    const reconciled = httpMock().expectOne('/api/v1/treasury/operations/o-9/reconcile/');
    expect(reconciled.request.body).toEqual({
      operation_date: '2026-10-10',
      description: 'rentrée de caisse',
      direction: 'inflow',
      amount: '7500',
      partner: null,
      settled_line: null,
      offset_account: 'a-605',
    });
    reconciled.flush({ ...pending, status: 'accounted' });
    await stable();
    httpMock().expectOne('/api/v1/treasury/accounts/t-css/balance/').flush({ balance: '0' });
    httpMock()
      .expectOne((req) => req.url === '/api/v1/treasury/accounts/t-css/transactions/')
      .flush(page(ROWS));
  });

  it('« Compte »: any account of the chart, without partner', async () => {
    const { component, element, stable } = await open();
    await press(element, 'Compte', stable);
    const found: unknown[] = [];
    component['searchAccounts']('605').subscribe((options) => found.push(...options));
    const search = httpMock().expectOne((req) => req.url === '/api/v1/accounting/accounts/');
    expect(search.request.params.get('postable')).toBe('true');
    search.flush(page([{ public_id: 'a-605', code: '605100', name: 'Fournitures' }]));
    expect(found).toEqual([{ id: 'a-605', label: '605100', detail: 'Fournitures' }]);
    component['form'].controls.account.setValue(found[0] as { id: string; label: string });
    component['form'].patchValue({ description: 'eau', amountOut: '25000' });
    enter(element);
    await stable();

    const post = httpMock().expectOne('/api/v1/treasury/accounts/t-css/transactions/');
    expect(post.request.body).toMatchObject({
      partner: null,
      settled_line: null,
      offset_account: 'a-605',
    });
    post.flush(ROWS[0]);
    await stable();
    httpMock().expectOne('/api/v1/treasury/accounts/t-css/balance/').flush({ balance: '0' });
    httpMock()
      .expectOne((req) => req.url === '/api/v1/treasury/accounts/t-css/transactions/')
      .flush(page(ROWS));
  });

  it('plus de modèle de rapprochement : « Partenaire » et « Compte » seulement, sans ⋮', async () => {
    const { element } = await open();
    // Aucun appel à treasury/reconcile-models/ (httpMock().verify() le refuserait).
    expect(
      Array.from(row(element).querySelectorAll<HTMLButtonElement>('button')).map((button) =>
        text(button),
      ),
    ).toEqual(['Partenaire', 'Compte']);
    expect(row(element).querySelector('alco-dropdown')).toBeNull();
    expect(element.querySelector('tbody tr.waiting alco-dropdown')).toBeNull();
  });

  it('un virement de Trésorerie › Virements : « Virement interne » et l’autre journal', async () => {
    const { component, element, stable } = await open();
    component['reload']();
    httpMock()
      .expectOne('/api/v1/treasury/accounts/t-css/balance/')
      .flush({ balance: '6608500.000000', currency: 'GNF' });
    httpMock()
      .expectOne((req) => req.url === '/api/v1/treasury/accounts/t-css/transactions/')
      .flush(
        page([
          {
            ...ROWS[0],
            public_id: 'o-3',
            direction: 'inflow',
            transfer_account: { public_id: 't-bq', code: 'BQ', name: 'Coris Bank' },
          },
        ]),
      );
    await stable();
    const line = element.querySelector('tbody tr:not(.entry)')!;
    expect(
      Array.from(line.querySelectorAll('td'))
        .slice(2, 4)
        .map((cell) => text(cell)),
    ).toEqual(['Virement interne', 'Coris Bank']);
  });

  it('read only: the lines, no line to type nor « Nouveau »', async () => {
    const { element } = await open(['treasury.read', 'accounting.read']);
    expect(element.querySelector('tr.entry')).toBeNull();
    expect(text(element.querySelector('alco-page-header'))).not.toContain('Nouveau');
    expect(element.querySelectorAll('tbody tr').length).toBe(2);
  });
});
