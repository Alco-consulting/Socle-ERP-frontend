import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { clearCookie, httpMock, provideHttpTesting, setCookie } from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { TEST_COMPANY, openTestSession } from '../../../core/session/testing';
import { BalancePage } from './balance-page';

const page = (results: unknown[] = [], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});
const YEARS = [
  {
    public_id: 'fy-2026',
    code: '2026',
    label: 'Exercice 2026',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    status: 'open',
    created_at: '',
    updated_at: '',
  },
];
const journal = (code: string, name: string) => ({
  public_id: `j-${code}`,
  code,
  name,
  journal_type: 'general',
  default_currency: null,
  default_account: null,
  sequence_prefix: '',
  sequence_padding: 6,
  status: 'active',
  created_at: '',
  updated_at: '',
});
const JOURNALS = [journal('VT', 'Ventes'), journal('AC', 'Achats')];
const ZERO = '0.000000';
const columns = (values: Partial<Record<string, string>> = {}) => ({
  opening_debit: ZERO,
  opening_credit: ZERO,
  debit: ZERO,
  credit: ZERO,
  closing_debit: ZERO,
  closing_credit: ZERO,
  ...values,
});
const row = (code: string, name: string, values: Partial<Record<string, string>>) => ({
  account: { public_id: `a-${code}`, code, name, account_type: 'other' },
  opening: ZERO,
  closing: ZERO,
  comparison: null,
  ...columns(values),
});
const ROWS = [
  row('401100', 'Fournisseurs', { credit: '300000.000000', closing_credit: '300000.000000' }),
  row('411100', 'Clients', {
    debit: '1200000.000000',
    credit: '500000.000000',
    closing_debit: '700000.000000',
  }),
  row('701100', 'Ventes de marchandises', {
    credit: '700000.000000',
    closing_credit: '700000.000000',
  }),
];
const GROUPS = [
  {
    code: '4',
    name: 'Comptes de tiers',
    level: 1,
    columns: columns({ closing_debit: '700000.000000' }),
  },
  { code: '40', name: 'Fournisseurs et comptes rattachés', level: 2, columns: columns() },
  { code: '41', name: 'Clients et comptes rattachés', level: 2, columns: columns() },
  { code: '7', name: 'Comptes de produits des activités ordinaires', level: 1, columns: columns() },
  { code: '70', name: 'Ventes', level: 2, columns: columns() },
];
const balance = (warnings: unknown[] = []) => ({
  scope: {
    fiscal_year: { public_id: 'fy-2026', code: '2026' },
    period: null,
    date_from: '2026-01-01',
    date_to: '2026-12-31',
  },
  comparative_scope: null,
  totals: { opening: ZERO, debit: '1200000.000000', credit: '1500000.000000', closing: ZERO },
  columns: columns({
    debit: '1200000.000000',
    credit: '1500000.000000',
    closing_debit: '700000.000000',
    closing_credit: '1000000.000000',
  }),
  groups: GROUPS,
  comparison: null,
  warnings,
  ...page(ROWS),
});
const ACCOUNTANT = [
  'accounting.read',
  'reporting.read',
  'imports_exports.read',
  'imports_exports.export',
];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('BalancePage (Analyse › Balance générale, as Odoo’s)', () => {
  beforeEach(() => {
    setCookie('XSRF-TOKEN', 'tok');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 22, 10));
  });
  afterEach(() => {
    httpMock().verify();
    vi.useRealTimers();
    clearCookie('XSRF-TOKEN');
  });

  async function open(url: string, permissions: string[] = ACCOUNTANT) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          { path: 'balance', component: BalancePage },
          { path: '**', children: [] },
        ]),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), {
      permissions,
      companies: [{ ...TEST_COMPANY, currency: 'GNF' }],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const element = harness.routeNativeElement as HTMLElement;
    const stable = async () => {
      await settle();
      await harness.fixture.whenStable();
    };
    /** Fiscal years, journals and currencies, read once; then the balance asked. */
    const references = async () => {
      httpMock()
        .expectOne((req) => req.url === '/api/v1/accounting/fiscal-years/')
        .flush(page(YEARS));
      httpMock()
        .expectOne((req) => req.url === '/api/v1/accounting/journals/')
        .flush(page(JOURNALS));
      httpMock()
        .expectOne((req) => req.url === '/api/v1/currencies/')
        .flush(page([{ code: 'GNF', name: 'Franc guinéen', decimal_places: 0, status: 'active' }]));
      await stable();
      return httpMock().expectOne((req) => req.url === '/api/v1/reporting/balance/');
    };
    return { element, stable, references, harness };
  }

  it('this year by default, in six columns under Odoo’s three headings, zeros left empty', async () => {
    const { element, stable, references } = await open('/balance');
    const request = await references();
    expect(request.request.params.get('date_from')).toBe('2026-01-01');
    expect(request.request.params.get('date_to')).toBe('2026-12-31');
    expect(request.request.params.get('page_size')).toBe('200');
    expect(request.request.params.has('journal')).toBe(false);
    expect(request.request.params.has('include_unposted')).toBe(false);
    request.flush(balance());
    await stable();

    expect(element.querySelector('h1')?.textContent).toContain('Balance générale');
    const heads = [...element.querySelectorAll('thead th')].map((cell) => text(cell));
    expect(heads).toEqual([
      'Compte',
      'Solde initial',
      'Exercice 2026',
      'Solde final',
      ...Array.from({ length: 3 }, () => ['Débit', 'Crédit']).flat(),
    ]);
    const clients = [...element.querySelectorAll('tbody tr')][1];
    expect([...clients.querySelectorAll('td')].map((cell) => text(cell))).toEqual([
      '',
      '',
      '1 200 000',
      '500 000',
      '700 000',
      '',
    ]);
    expect(text(clients.querySelector('th'))).toBe('411100 Clients');
    const total = [...element.querySelectorAll('tfoot td')].map((cell) => text(cell));
    expect(total).toEqual(['0', '0', '1 200 000', '1 500 000', '700 000', '1 000 000']);
    expect(
      text(element.querySelector('[aria-label="Exporter la balance au format Excel (XLSX)"]')),
    ).toBe('XLSX');
  });

  it('the URL’s filters: this month, a journal, the unposted entries, a search, a page', async () => {
    const { element, stable, references } = await open(
      '/balance?periode=mois&journal=VT&brouillons=oui&q=41&page=2',
    );
    const request = await references();
    const params = request.request.params;
    expect([params.get('date_from'), params.get('date_to')]).toEqual(['2026-10-01', '2026-10-31']);
    expect(params.getAll('journal')).toEqual(['j-VT']);
    expect(params.get('include_unposted')).toBe('true');
    expect(params.get('search')).toBe('41');
    expect(params.get('page')).toBe('2');
    request.flush(balance());
    await stable();

    expect(text(element.querySelector('.filters'))).toContain('octobre 2026');
    expect(text(element.querySelector('.filters'))).toContain('Journaux : VT');
    expect(text(element)).toContain('Écritures non comptabilisées comprises.');
  });

  it('« Hiérarchie et sous-totaux »: each class and group with its sums, folded on a click', async () => {
    const { element, stable, references } = await open('/balance?hierarchie=oui');
    (await references()).flush(balance());
    await stable();

    const names = () => [...element.querySelectorAll('tbody th')].map((cell) => text(cell));
    expect(names()).toEqual([
      '4 Comptes de tiers',
      '40 Fournisseurs et comptes rattachés',
      '401100 Fournisseurs',
      '41 Clients et comptes rattachés',
      '411100 Clients',
      '7 Comptes de produits des activités ordinaires',
      '70 Ventes',
      '701100 Ventes de marchandises',
    ]);
    const tiers = element.querySelector('tbody tr');
    expect([...(tiers?.querySelectorAll('td') ?? [])].map((cell) => text(cell))).toEqual([
      '',
      '',
      '',
      '',
      '700 000',
      '',
    ]);
    const fold = tiers?.querySelector<HTMLButtonElement>('button.fold');
    expect(fold?.getAttribute('aria-expanded')).toBe('true');
    fold?.click();
    await stable();
    expect(names()).toEqual([
      '4 Comptes de tiers',
      '7 Comptes de produits des activités ordinaires',
      '70 Ventes',
      '701100 Ventes de marchandises',
    ]);
  });

  it('unposted entries left out: said, as Odoo’s, and included in one click', async () => {
    const { element, stable, references } = await open('/balance');
    (await references()).flush(
      balance([{ code: 'unposted_entries', message: '', details: { count: 2 } }]),
    );
    await stable();

    const warning = element.querySelector('.warning');
    expect(text(warning)).toContain('Il y a 2 écritures non comptabilisées dans cette période.');
    warning?.querySelector<HTMLButtonElement>('button')?.click();
    await stable();
    const again = httpMock().expectOne((req) => req.url === '/api/v1/reporting/balance/');
    expect(again.request.params.get('include_unposted')).toBe('true');
    again.flush(balance());
    await stable();
    expect(TestBed.inject(Router).url).toContain('brouillons=oui');
  });

  it('an account opens its ledger on the same dates, as Odoo’s menu of a line', async () => {
    const { stable, references } = await open('/balance?periode=trimestre');
    const request = await references();
    expect(request.request.params.get('date_from')).toBe('2026-10-01');
    request.flush(balance());
    await stable();

    const trigger = document.querySelector<HTMLButtonElement>('tbody th button');
    trigger?.click();
    await stable();
    const items = [...document.querySelectorAll('[role="menuitem"]')];
    expect(items.map((item) => text(item))).toEqual(['Grand livre', 'Écritures comptables']);
    (items[0] as HTMLElement).click();
    await stable();
    expect(TestBed.inject(Router).url).toBe(
      '/app/comptabilite/analyse/grand-livre?compte=401100&du=2026-10-01&au=2026-12-31',
    );
  });

  it('the workbook: the same balance asked as an XLSX export, then saved', async () => {
    const createUrl = vi.fn(() => 'blob:balance');
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    const { element, stable, references } = await open('/balance?journal=AC');
    (await references()).flush(balance());
    await stable();

    element
      .querySelector<HTMLButtonElement>('[aria-label="Exporter la balance au format Excel (XLSX)"]')
      ?.click();
    await stable();
    const created = httpMock().expectOne('/api/v1/imports-exports/exports/');
    expect(created.request.body).toEqual({
      export_type: 'reporting.balance',
      file_format: 'xlsx',
      parameters: {
        date_from: '2026-01-01',
        date_to: '2026-12-31',
        journal: ['j-AC'],
        include_unposted: false,
        search: '',
      },
      asynchronous: false,
    });
    created.flush({ public_id: 'x1', status: 'completed', filename: 'balance.xlsx' });
    await stable();
    httpMock()
      .expectOne('/api/v1/imports-exports/exports/x1/download/')
      .flush(new Blob(['PK']), {
        headers: { 'Content-Disposition': 'attachment; filename="balance.xlsx"' },
      });
    await stable();
    expect(createUrl).toHaveBeenCalled();
  });

  it('without the export permission, no XLSX button', async () => {
    const { element, stable, references } = await open('/balance', [
      'accounting.read',
      'reporting.read',
    ]);
    (await references()).flush(balance());
    await stable();
    expect(
      element.querySelector('[aria-label="Exporter la balance au format Excel (XLSX)"]'),
    ).toBeNull();
  });
});
