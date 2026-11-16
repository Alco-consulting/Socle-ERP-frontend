import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { LOCALE_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { envelope, httpMock, provideHttpTesting } from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { TEST_COMPANY, openTestSession } from '../../../core/session/testing';
import { JournalSummary, JournalsDashboard } from '../../dashboards/data-access/dashboard-models';
import { AccountingDashboardPage } from './accounting-dashboard';

registerLocaleData(localeFr); // the app's locale (app.config.ts): « 5 oct. »

const page = (results: unknown[] = [], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});
const COMPANY = { public_id: 'c1', legal_name: 'ALCO GUINÉE SARL', reference_currency: 'GNF' };
const counts = (draft: number, submitted: number, validated = 0, locked = 0) => ({
  total: draft + submitted + validated + locked,
  draft,
  submitted,
  validated,
  locked,
});
const ACCOUNT = {
  public_id: 't-bq',
  code: 'BANK1',
  name: 'Compte courant',
  account_type: 'bank' as const,
  status: 'active' as const,
  currency: 'GNF',
  balance: '20000000.000000',
  unreconciled_statement_lines: 2,
  lines_to_reconcile: 1,
  history: [
    { date: '2026-09-04', balance: '0.000000' },
    { date: '2026-10-01', balance: '20000000.000000' },
    { date: '2026-10-04', balance: '20000000.000000' },
  ],
};
const BANK: JournalSummary = {
  public_id: 'j-bq',
  code: 'BQ1',
  name: 'Coris bank',
  journal_type: 'bank',
  default_currency: 'GNF',
  entries: counts(3, 2, 10, 1),
  treasury_accounts: [ACCOUNT],
  invoices: null,
  due_weeks: null,
};
const CASH: JournalSummary = {
  ...BANK,
  public_id: 'j-cai',
  code: 'CAI',
  name: 'Caisse Principale',
  journal_type: 'cash',
  treasury_accounts: [
    {
      ...ACCOUNT,
      public_id: 't-cai',
      code: 'CAISSE',
      unreconciled_statement_lines: 0,
      lines_to_reconcile: 0,
    },
  ],
};
const WEEKS = [
  { date_from: null, date_to: '2026-09-20', amount: '60331200.000000' },
  { date_from: '2026-09-21', date_to: '2026-09-27', amount: '0.000000' },
  { date_from: '2026-09-28', date_to: '2026-10-04', amount: '0.000000' },
  { date_from: '2026-10-05', date_to: '2026-10-11', amount: '0.000000' },
  { date_from: '2026-10-12', date_to: '2026-10-18', amount: '0.000000' },
  { date_from: '2026-10-19', date_to: null, amount: '0.000000' },
];
const SALES: JournalSummary = {
  public_id: 'j-vte',
  code: 'VTE',
  name: 'Ventes',
  journal_type: 'sales',
  default_currency: null,
  entries: counts(0, 0, 2),
  treasury_accounts: [],
  invoices: { drafts: 1, draft_amount: '0.000000', unpaid: 1, unpaid_amount: '60331200.000000' },
  due_weeks: WEEKS,
};
const PURCHASES: JournalSummary = {
  ...SALES,
  public_id: 'j-ach',
  code: 'ACH',
  name: 'Achats',
  journal_type: 'purchase',
  invoices: { drafts: 0, draft_amount: '0.000000', unpaid: 0, unpaid_amount: '0.000000' },
};
const GENERAL: JournalSummary = {
  ...SALES,
  public_id: 'j-od',
  code: 'OD',
  name: 'Opérations diverses',
  journal_type: 'general',
  entries: counts(1, 2),
  invoices: null,
  due_weeks: null,
};
const journals = (list: JournalSummary[], restricted: 'cash'[] = []): JournalsDashboard => ({
  company: COMPANY,
  fiscal_year: null,
  on: '2026-10-04',
  restricted,
  journals: list,
});
const READER = ['accounting.read', 'dashboards.read'];
const EVERYTHING = [
  ...READER,
  'accounting.create',
  'treasury.read',
  'dashboards.read_treasury',
  'invoicing.read',
  'invoicing.create',
];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const norm = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
const text = (element: Element | null | undefined) => norm(element?.textContent);

describe('AccountingDashboardPage (dashboards/journals/, as Odoo)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 4, 10, 30));
  });
  const YEAR = {
    public_id: 'fy-2026',
    code: '2026',
    label: 'Exercice 2026',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    status: 'open',
  };
  const amount = (code: string, value: string | null) => ({
    code,
    unit: 'amount',
    value,
    currency: 'GNF',
    comparison: null,
  });
  const OVERVIEW = {
    scope: {
      fiscal_year: { public_id: 'fy-2026', code: '2026' },
      date_from: '2026-01-01',
      date_to: '2026-12-31',
    },
    sections: [
      {
        section: 'financial',
        metrics: [
          amount('total_income', '1000.000000'),
          amount('total_expense', '1500.000000'),
          amount('result', '-500.000000'),
        ],
      },
      { section: 'cash', metrics: [amount('booked_balance', '26730000.000000')] },
    ],
    restricted: ['receivables', 'payables'],
  };

  afterEach(() => {
    httpMock().verify();
    vi.useRealTimers();
  });

  async function open(permissions: string[] = EVERYTHING) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        { provide: LOCALE_ID, useValue: 'fr-FR' },
        provideRouter([{ path: 'tableau-de-bord', component: AccountingDashboardPage }]),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), {
      permissions,
      companies: [{ ...TEST_COMPANY, name: 'ALCO GUINÉE' }],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/tableau-de-bord');
    const element = harness.routeNativeElement as HTMLElement;
    const stable = async () => {
      await settle();
      await harness.fixture.whenStable();
    };
    return { element, stable, harness };
  }

  /** Answers the page's requests: the journals, then the currencies' precisions. */
  async function answer(stable: () => Promise<void>, body: JournalsDashboard | 'error') {
    const mock = httpMock();
    const request = mock.expectOne((req) => req.url === '/api/v1/dashboards/journals/');
    if (body === 'error') {
      request.flush(envelope('server_error'), { status: 500, statusText: 'x' });
    } else {
      request.flush(body);
    }
    mock
      .expectOne((req) => req.url === '/api/v1/currencies/')
      .flush(page([{ code: 'GNF', name: 'Franc guinéen', decimal_places: 0, status: 'active' }]));
    // The headline figures: the fiscal years first, then the current one's overview.
    for (const years of mock.match((req) => req.url === '/api/v1/accounting/fiscal-years/')) {
      years.flush(page([YEAR]));
    }
    await stable();
    for (const overview of mock.match((req) => req.url === '/api/v1/dashboards/overview/')) {
      overview.flush(OVERVIEW);
    }
    await stable();
    return request;
  }

  const card = (element: HTMLElement, name: string) =>
    Array.from(element.querySelectorAll('.card')).find(
      (item) => text(item.querySelector('.card-title')) === name,
    );

  it('the six headline figures of the current fiscal year; a loss said in words', async () => {
    const { element, stable } = await open();
    await answer(stable, journals([CASH]));

    const figures = Array.from(element.querySelectorAll('.kpi')).map((kpi) => text(kpi));
    expect(figures).toEqual([
      'Trésorerie 26 730 000 GNF Banques et caisses',
      'Produits 1 000 GNF Ventes et autres produits',
      'Charges 1 500 GNF Achats et autres charges',
      'Résultat -500 GNF Perte',
      'Créances clients — Accès restreint',
      'Dettes fournisseurs — Accès restreint',
    ]);
    const period = element.querySelector<HTMLSelectElement>(
      'select[aria-label="Période des indicateurs"]',
    )!;
    expect(Array.from(period.options).map((option) => text(option))).toEqual([
      'Exercice 2026',
      'Ce trimestre',
      'Ce mois-ci',
    ]);
  });

  it('one request for every journal, with the day; cards in Odoo’s order; no alert', async () => {
    const { element, stable } = await open();
    const request = await answer(stable, journals([PURCHASES, BANK, GENERAL, SALES, CASH]));

    expect(request.request.params.get('on')).toBe('2026-10-04');
    httpMock().expectNone((req) => req.url.includes('/dashboards/alerts/'));
    httpMock().expectNone((req) => req.url.includes('/accounting/entries/'));
    expect(Array.from(element.querySelectorAll('.card-title')).map((title) => text(title))).toEqual(
      ['Caisse Principale', 'Coris bank', 'Ventes', 'Achats', 'Opérations diverses'],
    );
    expect(element.textContent).not.toContain('À surveiller');
    // The title opens the journal's entries.
    expect(card(element, 'Ventes')?.querySelector('.card-title a')?.getAttribute('href')).toBe(
      '/app/comptabilite/ecritures/pieces?journal=j-vte',
    );
  });

  it('bank and cash: « Transactions », the balance, its curve and what is to reconcile', async () => {
    const { element, stable } = await open();
    await answer(stable, journals([BANK, CASH]));

    const bank = card(element, 'Coris bank')!;
    const transactions = bank.querySelector<HTMLAnchorElement>('a[aria-label^="Transactions"]');
    expect(transactions?.getAttribute('href')).toBe(
      '/app/comptabilite/tresorerie/transactions?compte=BANK1',
    );
    expect(text(bank.querySelector('.figures'))).toMatch(/^Solde 20 000 000 GNF$/);
    const reconcile = Array.from(bank.querySelectorAll('a')).find((link) =>
      text(link).startsWith('Rapprocher'),
    );
    expect(text(reconcile)).toBe('Rapprocher 2 éléments');
    expect(reconcile?.getAttribute('href')).toBe('/app/comptabilite/tresorerie/rapprochements');
    // As Odoo's « 1 à réconcilier »: its lines waiting for their counterpart (note backend 0050).
    const waiting = Array.from(bank.querySelectorAll('a')).find((link) =>
      text(link).endsWith('à réconcilier'),
    );
    expect(text(waiting)).toBe('1 à réconcilier');
    expect(waiting?.getAttribute('href')).toBe(
      '/app/comptabilite/tresorerie/transactions?compte=BANK1',
    );
    const curve = bank.querySelector('alco-balance-curve [role="img"]');
    expect(norm(curve?.getAttribute('aria-label'))).toBe(
      'Solde sur 30 jours : 0 GNF le 4 sept., 20 000 000 GNF le 4 oct.',
    );
    expect(bank.querySelectorAll('.dot').length).toBe(3);
    expect(norm(bank.querySelector('.dot')?.getAttribute('title'))).toBe('4 sept. : Solde 0 GNF');
    // Nothing to reconcile in the cash box: no button.
    expect(text(card(element, 'Caisse Principale'))).not.toContain('Rapprocher');
    expect(text(card(element, 'Caisse Principale'))).not.toContain('à réconcilier');
  });

  it('treasury not readable (null): no balance, no curve, nothing said', async () => {
    const { element, stable } = await open(READER);
    await answer(stable, journals([{ ...BANK, treasury_accounts: null }], ['cash']));

    const bank = card(element, 'Coris bank')!;
    expect(bank.querySelector('.figures')).toBeNull();
    expect(bank.querySelector('alco-balance-curve')).toBeNull();
    expect(text(bank)).not.toContain('Aucun compte de trésorerie');
    // Without treasury.read, the operations cannot be opened.
    expect(text(bank)).not.toContain('Transactions');
  });

  it('a bank journal without its account (before the migration): no balance, nothing said', async () => {
    const { element, stable } = await open();
    await answer(stable, journals([{ ...BANK, treasury_accounts: [] }]));

    const bank = card(element, 'Coris bank')!;
    expect(bank.querySelector('.figures')).toBeNull();
    expect(text(bank)).not.toContain('Aucun compte de trésorerie');
  });

  it('sales: « Nouveau », drafts and unpaid with their lists, the six due bars', async () => {
    const { element, stable } = await open();
    await answer(stable, journals([SALES, PURCHASES]));

    const sales = card(element, 'Ventes')!;
    expect(sales.querySelector('a[aria-label="Nouveau — Ventes"]')?.getAttribute('href')).toBe(
      '/app/comptabilite/ventes/factures/nouvelle',
    );
    const figures = Array.from(sales.querySelectorAll('.figure')).map((item) => text(item));
    expect(figures).toEqual(['1 À valider 0 GNF', '1 Non payé 60 331 200 GNF']);
    expect(
      Array.from(sales.querySelectorAll<HTMLAnchorElement>('.figure a')).map((link) =>
        link.getAttribute('href'),
      ),
    ).toEqual([
      '/app/comptabilite/ventes/factures?etat=draft',
      '/app/comptabilite/ventes/factures?etat=posted',
    ]);
    const bars = Array.from(sales.querySelectorAll('.bar'));
    expect(bars.map((bar) => text(bar.querySelector('.bar-label')))).toEqual([
      'Dû',
      '21 - 27 sept.',
      'Cette semaine',
      '5 - 11 oct.',
      '12 - 18 oct.',
      'Pas dû',
    ]);
    expect(norm(bars[0].getAttribute('title'))).toBe('Dû : 60 331 200 GNF');
    expect(bars[0].querySelector<HTMLElement>('.fill')?.style.height).toBe('100%');
    expect(bars[0].querySelector('.fill--past')).not.toBeNull();
    expect(bars[3].querySelector<HTMLElement>('.fill')?.style.height).toBe('0%');
    // Purchases: nothing to count, nothing shown (as Odoo hides « 0 À valider »).
    expect(card(element, 'Achats')?.querySelector('.figures')).toBeNull();
    expect(card(element, 'Achats')?.querySelectorAll('.bar').length).toBe(6);
  });

  it('a draft amount the server cannot convert: the count only', async () => {
    const { element, stable } = await open();
    const unknown = { ...SALES.invoices!, draft_amount: null };
    await answer(stable, journals([{ ...SALES, invoices: unknown }]));

    expect(text(card(element, 'Ventes')?.querySelector('.figure'))).toBe('1 À valider');
  });

  it('without invoicing: no « Nouveau », no figure, no bar', async () => {
    const { element, stable } = await open(READER);
    await answer(stable, journals([{ ...SALES, invoices: null, due_weeks: null }]));

    const sales = card(element, 'Ventes')!;
    expect(text(sales)).not.toContain('Nouveau');
    expect(sales.querySelector('.figures')).toBeNull();
    expect(sales.querySelector('alco-due-bars')).toBeNull();
  });

  it('miscellaneous operations: « Nouveau » in the journal, drafts and entries to validate', async () => {
    const { element, stable } = await open();
    await answer(stable, journals([GENERAL]));

    const general = card(element, 'Opérations diverses')!;
    expect(
      general.querySelector('a[aria-label="Nouveau — Opérations diverses"]')?.getAttribute('href'),
    ).toBe('/app/comptabilite/ecritures/nouvelle?journal=j-od');
    expect(
      Array.from(general.querySelectorAll<HTMLAnchorElement>('.figure a')).map((link) => [
        text(link),
        link.getAttribute('href'),
      ]),
    ).toEqual([
      ['1 Brouillon', '/app/comptabilite/ecritures/pieces?journal=j-od&etat=draft'],
      ['2 À valider', '/app/comptabilite/ecritures/pieces?journal=j-od&etat=submitted'],
    ]);
  });

  it('the card menu: the journal’s entries and its configuration', async () => {
    const { element, stable, harness } = await open();
    await answer(stable, journals([SALES]));

    card(element, 'Ventes')!
      .querySelector<HTMLButtonElement>('button[aria-label="Actions du journal Ventes"]')!
      .click();
    harness.fixture.detectChanges();
    await stable();
    const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
    expect(items.map((item) => text(item))).toEqual([
      'Voir les écritures',
      'Configuration du journal',
    ]);
  });

  it('no « Trésorerie » tab: a bank card’s menu opens its statements and the transfers', async () => {
    const { element, stable, harness } = await open();
    await answer(stable, journals([BANK]));

    card(element, 'Coris bank')!
      .querySelector<HTMLButtonElement>('button[aria-label="Actions du journal Coris bank"]')!
      .click();
    harness.fixture.detectChanges();
    await stable();
    const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
    expect(items.map((item) => text(item))).toEqual([
      'Voir les écritures',
      'Relevés',
      'Virements',
      'Configuration du journal',
    ]);
  });

  it('aucun exercice sur la période : le dire, sans « Réessayer » inutile', async () => {
    const { element, stable } = await open();
    const mock = httpMock();
    mock.expectOne((req) => req.url === '/api/v1/dashboards/journals/').flush(journals([CASH]));
    mock
      .expectOne((req) => req.url === '/api/v1/currencies/')
      .flush(page([{ code: 'GNF', name: 'Franc guinéen', decimal_places: 0, status: 'active' }]));
    // Une société sans exercice : le serveur refuse la période (`fiscal_year: none`).
    mock.expectOne((req) => req.url === '/api/v1/accounting/fiscal-years/').flush(page([]));
    await stable();
    const body = envelope('reporting_scope_invalid');
    mock
      .expectOne((req) => req.url === '/api/v1/dashboards/overview/')
      .flush(
        { error: { ...body.error, details: { date: '2026-10-01', fiscal_year: 'none' } } },
        { status: 400, statusText: 'x' },
      );
    await stable();

    const failure = element.querySelector('alco-kpi-band alco-error-state')!;
    expect(text(failure)).toContain('Aucun exercice comptable ne couvre cette période.');
    expect(text(failure)).toContain('enregistrez une écriture');
    expect(failure.querySelector('button')).toBeNull();
  });

  it('a failing request says so and offers a retry', async () => {
    const { element, stable } = await open();
    await answer(stable, 'error');

    expect(element.querySelector('alco-error-state')).not.toBeNull();
    expect(element.querySelector('.cards')).toBeNull();
  });
});
