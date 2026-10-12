import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { envelope, httpMock, provideHttpTesting } from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { TEST_COMPANY, openTestSession } from '../../../core/session/testing';
import { JournalSummary, JournalsDashboard } from '../../dashboards/data-access/dashboard-models';
import { AccountingDashboardPage } from './accounting-dashboard';

const page = (results: unknown[] = [], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});
const YEAR = {
  public_id: 'fy-2026',
  code: 'FY2026',
  label: 'Exercice 2026',
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  status: 'open',
  created_at: '',
  updated_at: '',
};
const COMPANY = { public_id: 'c1', legal_name: 'ALCO GUINÉE SARL', reference_currency: 'GNF' };
const counts = (draft: number, submitted: number, validated = 0, locked = 0) => ({
  total: draft + submitted + validated + locked,
  draft,
  submitted,
  validated,
  locked,
});
const BANK: JournalSummary = {
  public_id: 'j-bq',
  code: 'BQ1',
  name: 'Banque principale',
  journal_type: 'bank',
  default_currency: 'GNF',
  entries: counts(3, 2, 10, 1),
  treasury_accounts: [
    {
      public_id: 't-bq',
      code: 'BANK1',
      name: 'Compte courant',
      account_type: 'bank',
      status: 'active',
      currency: 'GNF',
      balance: '1380000.000000',
      unreconciled_statement_lines: 2,
    },
  ],
};
const PURCHASES: JournalSummary = {
  public_id: 'j-ach',
  code: 'ACH',
  name: 'Achats',
  journal_type: 'purchase',
  default_currency: null,
  entries: counts(0, 0),
  treasury_accounts: [],
};
const journals = (list: JournalSummary[], restricted: 'cash'[] = []): JournalsDashboard => ({
  company: COMPANY,
  fiscal_year: null,
  on: '2026-10-04',
  restricted,
  journals: list,
});
const ALERTS = {
  company: COMPANY,
  scope: {
    fiscal_year: { public_id: 'fy-2026', code: 'FY2026' },
    period: null,
    date_from: '2026-01-01',
    date_to: '2026-10-04',
  },
  alerts: [
    {
      source: 'closing',
      code: 'pending_entries',
      level: 'blocking',
      message: 'Some entries are not validated.',
      details: { run: 'run-1', target: '2026-09' },
    },
  ],
  indicators: [
    { source: 'treasury', code: 'statement_lines_unreconciled', count: 3, level: null },
    { source: 'imports_exports', code: 'imports_failed', count: 1, level: null },
    { source: 'loans', code: 'installments_overdue', count: 0, level: null },
  ],
  sources: ['closing', 'treasury', 'imports_exports', 'loans'],
};
const READER = ['accounting.read', 'dashboards.read'];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AccountingDashboardPage (dashboards/journals/ and dashboards/alerts/)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 4, 10, 30));
  });
  afterEach(() => {
    httpMock().verify();
    vi.useRealTimers();
  });

  async function open(permissions: string[] = READER) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
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

  /** Answers every request of the page; `journalsBody` for dashboards/journals/. */
  async function answer(
    stable: () => Promise<void>,
    journalsBody: JournalsDashboard | 'error',
    years: unknown[] = [YEAR],
    alerts: unknown = ALERTS,
  ) {
    const mock = httpMock();
    mock.expectOne('/api/v1/accounting/fiscal-years/?status=open&page_size=100').flush(page(years));
    const request = mock.expectOne((req) => req.url === '/api/v1/dashboards/journals/');
    if (journalsBody === 'error') {
      request.flush(envelope('server_error'), { status: 500, statusText: 'x' });
    } else {
      request.flush(journalsBody);
    }
    mock
      .expectOne((req) => req.url === '/api/v1/currencies/')
      .flush(page([{ code: 'GNF', name: 'Franc guinéen', decimal_places: 0, status: 'active' }]));
    await stable();
    // The fiscal years are the alerts' scope only: no period, no chart of accounts is read.
    mock.expectNone((req) => req.url === '/api/v1/accounting/periods/');
    mock.expectNone((req) => req.url === '/api/v1/accounting/accounts/');
    const alertCalls = mock.match((req) => req.url === '/api/v1/dashboards/alerts/');
    alertCalls.forEach((req) => req.flush(alerts as object));
    await stable();
    return { request, alertCalls };
  }

  it('reads every journal in one request, with the day of the balances, and no other figure', async () => {
    const { element, stable } = await open();
    const { request, alertCalls } = await answer(stable, journals([BANK, PURCHASES]));

    expect(request.request.params.get('on')).toBe('2026-10-04');
    expect(request.request.params.has('fiscal_year')).toBe(false);
    // Never rebuilt from the entry list nor read per journal.
    httpMock().expectNone((req) => req.url.includes('/accounting/entries/'));
    httpMock().expectNone((req) => req.url.includes('/treasury/'));
    expect(alertCalls.length).toBe(1);
    const cards = Array.from(element.querySelectorAll('.journal'));
    expect(cards.map((card) => card.querySelector('.journal-code')?.textContent)).toEqual([
      'BQ1',
      'ACH',
    ]);
    const text = cards[0].textContent ?? '';
    expect(text).toContain('Banque principale');
    expect(text).toMatch(/16\s*Écritures/);
    expect(text).toMatch(/3\s*Brouillons/);
    expect(text).toMatch(/2\s*Soumises/);
    expect(text).toMatch(/10\s*Validées/);
    expect(text).toMatch(/1\s*Verrouillées/);
    expect(element.textContent).toContain('Soldes de trésorerie au 04/10/2026.');
  });

  it('each counter opens the entry list of the journal in that state', async () => {
    const { element, stable } = await open();
    await answer(stable, journals([BANK]));

    const links = Array.from(element.querySelectorAll<HTMLAnchorElement>('.counter'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/app/comptabilite/ecritures?journal=j-bq',
      '/app/comptabilite/ecritures?journal=j-bq&etat=draft',
      '/app/comptabilite/ecritures?journal=j-bq&etat=submitted',
      '/app/comptabilite/ecritures?journal=j-bq&etat=validated',
      '/app/comptabilite/ecritures?journal=j-bq&etat=locked',
    ]);
    expect(links[1].getAttribute('aria-label')).toBe('Brouillons : 3');
  });

  it('shows the treasury the API gives: balance of the day and lines to reconcile', async () => {
    const { element, stable } = await open();
    await answer(stable, journals([BANK, PURCHASES]));

    const treasury = element.querySelector('.treasury')?.textContent ?? '';
    expect(treasury).toContain('Compte courant');
    expect(treasury).toMatch(/1\s380\s000\s+GNF/); // the API's amount, GNF precision
    expect(treasury).toContain('2 à rapprocher');
    // Purchases: an empty list, and not a bank or cash journal: nothing said.
    expect(element.querySelectorAll('.treasury').length).toBe(1);
  });

  it('treasury_accounts null (no cash permission): no treasury information at all', async () => {
    const { element, stable } = await open();
    const hidden = { ...BANK, treasury_accounts: null };
    await answer(stable, journals([hidden], ['cash']));

    const cards = element.querySelector('.journals')?.textContent ?? '';
    expect(element.querySelector('.treasury')).toBeNull();
    expect(cards).not.toContain('Compte courant');
    expect(cards).not.toContain('Aucun compte de trésorerie');
    expect(cards).not.toContain('à rapprocher');
    expect(cards).not.toMatch(/1\s380/);
    expect(cards).not.toContain('Soldes de trésorerie');
  });

  it('treasury_accounts empty for a bank journal: said, nothing invented', async () => {
    const { element, stable } = await open();
    await answer(stable, journals([{ ...BANK, treasury_accounts: [] }]));

    expect(element.querySelector('.treasury')).toBeNull();
    expect(element.textContent).toContain('Aucun compte de trésorerie n’utilise ce journal.');
  });

  it('a new entry from a card of miscellaneous operations, the journal preselected', async () => {
    const { element, stable } = await open([...READER, 'accounting.create']);
    const general = { ...BANK, public_id: 'j-od', code: 'OD', journal_type: 'general' as const };
    await answer(stable, journals([BANK, { ...general, treasury_accounts: null }]));

    // Entered by hand in miscellaneous operations only (note backend 0038).
    expect(
      element.querySelector('a[aria-label="Nouvelle écriture dans le journal BQ1"]'),
    ).toBeNull();
    const create = element.querySelector<HTMLAnchorElement>(
      'a[aria-label="Nouvelle écriture dans le journal OD"]',
    );
    expect(create?.getAttribute('href')).toBe('/app/comptabilite/ecritures/nouvelle?journal=j-od');
  });

  it('the card menu offers only what exists: no new entry without accounting.create', async () => {
    const { element, stable, harness } = await open();
    await answer(stable, journals([BANK]));
    expect(element.querySelector('a[aria-label^="Nouvelle écriture"]')).toBeNull();

    (element.querySelector('.journal-menu button') as HTMLButtonElement).click();
    await harness.fixture.whenStable();
    const items = Array.from(document.querySelectorAll('.menu [role="menuitem"]')).map((item) =>
      item.textContent?.trim(),
    );
    expect(items).toEqual(['Voir les écritures', 'Configuration du journal']);
    document.querySelectorAll('.cdk-overlay-container').forEach((container) => container.remove());
  });

  it('alerts: the closing checks and the counted facts, by code, never the server text', async () => {
    const { element, stable } = await open([...READER, 'treasury.read', 'closing.read']);
    const { alertCalls } = await answer(stable, journals([BANK]));

    expect(alertCalls[0].request.params.get('date_from')).toBe('2026-01-01');
    expect(alertCalls[0].request.params.get('date_to')).toBe('2026-10-04');
    const watches = Array.from(element.querySelectorAll('.watch'));
    const parts = (item: Element) =>
      Array.from(item.children).map((part) => part.textContent?.trim());
    expect(watches.map(parts)).toEqual([
      ['Écritures non validées', 'Clôture 2026-09', 'Bloquant'],
      ['Lignes de relevé à rapprocher', '3'],
      ['Imports en échec', '1'],
    ]);
    expect(element.textContent).not.toContain('Some entries are not validated.');
    // A target only when the screen opens for the user; none for imports.
    const links = Array.from(element.querySelectorAll<HTMLAnchorElement>('.watch a'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/app/comptabilite/cloture',
      '/app/comptabilite/tresorerie/rapprochements',
    ]);
    expect(element.textContent).toContain('Du 01/01/2026 au 04/10/2026');
    expect(element.textContent).not.toContain('FY2026');
  });

  it('no open fiscal year holding today: the alerts are not asked, and it is said', async () => {
    const { element, stable } = await open();
    const closedYear = { ...YEAR, start_date: '2025-01-01', end_date: '2025-12-31' };
    const { alertCalls } = await answer(stable, journals([BANK]), [closedYear]);

    expect(alertCalls.length).toBe(0);
    expect(element.textContent).toContain(
      'Les alertes commencent avec la première écriture de l’année.',
    );
  });

  it('a failing journals block says so and offers a retry; the others are shown', async () => {
    const { element, stable } = await open();
    await answer(stable, 'error', [YEAR], { ...ALERTS, alerts: [], indicators: [] });

    expect(element.textContent).toContain('Une erreur inattendue s’est produite.');
    expect(element.textContent).toContain('Rien à signaler.');
  });
});
