import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { envelope, httpMock, provideHttpTesting } from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { TEST_COMPANY, openTestSession } from '../../../core/session/testing';
import { LedgerPage } from './ledger-page';

const page = (results: unknown[] = [], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});
const year = (code: string, start: string, end: string, status = 'open') => ({
  public_id: `fy-${code}`,
  code,
  label: `Exercice ${code}`,
  start_date: start,
  end_date: end,
  status,
  created_at: '',
  updated_at: '',
});
const YEARS = [
  year('2026', '2026-01-01', '2026-12-31'),
  year('2025', '2025-01-01', '2025-12-31', 'closed'),
];
const ACCOUNT = {
  public_id: 'a-401',
  code: '401',
  name: 'Fournisseurs',
  description: '',
  parent: null,
  account_type: 'liability',
  detailed_type: '',
  currency: null,
  account_class: '4',
  allow_entries: true,
  status: 'active',
  has_children: true,
  created_at: '',
  updated_at: '',
};
const ROW = {
  line: 'l-1',
  entry: 'e-1',
  entry_date: '2026-03-10',
  entry_number: 'ACH-000012',
  journal: 'ACH',
  account: 'a-401',
  account_code: '401',
  label: 'Facture FAF-12',
  document_reference: 'FAF-12',
  partner: { public_id: 'p-1', code: 'FOU-001', name: 'Diallo et Cie' },
  debit: '0.000000',
  credit: '1150000.000000',
  balance: '-1150000.000000',
};
const SCOPE = {
  fiscal_year: { public_id: 'fy-2026', code: '2026' },
  period: null,
  date_from: '2026-01-01',
  date_to: '2026-12-31',
};
const ledger = (rows: unknown[], count = rows.length) => ({
  scope: SCOPE,
  comparative_scope: null,
  opening_balance: '-500000.000000',
  total_debit: '0.000000',
  total_credit: '1150000.000000',
  closing_balance: '-1650000.000000',
  account: { public_id: 'a-401', code: '401', name: 'Fournisseurs', account_type: 'liability' },
  partner: { public_id: 'p-1', code: 'FOU-001', name: 'Diallo et Cie' },
  warnings: [],
  count,
  next: null,
  previous: null,
  results: rows,
});
const ACCOUNTANT = [
  'accounting.read',
  'reporting.read',
  'reporting.read_auxiliary',
  'partners.read',
  'imports_exports.read',
  'imports_exports.export',
];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('LedgerPage (Analyse › Grand livre, Grand livre auxiliaire)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 4, 10));
  });
  afterEach(() => {
    httpMock().verify();
    vi.useRealTimers();
  });

  async function open(url: string, permissions: string[] = ACCOUNTANT) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          { path: 'grand-livre', component: LedgerPage, data: { ledger: 'account' } },
          { path: 'auxiliaire', component: LedgerPage, data: { ledger: 'partner' } },
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
    /** The references every ledger reads once: fiscal years, currencies. */
    const references = async (years: unknown[] = YEARS) => {
      httpMock()
        .expectOne((req) => req.url === '/api/v1/accounting/fiscal-years/')
        .flush(page(years));
      httpMock()
        .expectOne((req) => req.url === '/api/v1/currencies/')
        .flush(page([{ code: 'GNF', name: 'Franc guinéen', decimal_places: 0, status: 'active' }]));
      await stable();
    };
    return { element, stable, references, harness };
  }

  it('an account’s ledger: found by its code, read on the open year that holds today', async () => {
    const { element, stable, references } = await open('/grand-livre?compte=401');
    await references();
    const byCode = httpMock().expectOne((req) => req.url === '/api/v1/accounting/accounts/');
    expect(byCode.request.params.get('code')).toBe('401');
    byCode.flush(page([ACCOUNT]));
    await stable();
    const report = httpMock().expectOne((req) => req.url === '/api/v1/reporting/ledger/a-401/');
    expect(report.request.params.get('fiscal_year')).toBe('fy-2026');
    expect(report.request.params.has('include_descendants')).toBe(false);
    report.flush(ledger([ROW]));
    await stable();

    const text = (element.textContent ?? '').replace(/\s+/g, ' ');
    expect(element.querySelector('h1')?.textContent).toContain('Grand livre');
    expect(text).toContain('401 — Fournisseurs');
    expect(text).toContain('Du 01/01/2026 au 31/12/2026 · 2026');
    expect(text).toMatch(/Solde d’ouverture\s*-500 000/);
    expect(text).toMatch(/Solde de clôture\s*-1 650 000/);
    // The drill-down: the entry, and the partner's record when Comptabilité › Tiers opens.
    expect(
      element.querySelector('a[href="/app/comptabilite/ecritures/e-1"]')?.textContent,
    ).toContain('ACH-000012');
    expect(element.querySelector('a[href="/app/comptabilite/tiers/p-1"]')?.textContent).toContain(
      'FOU-001',
    );
    // The export of this account's ledger is offered (Actions ▾).
    expect(text).toContain('Actions');
  });

  it('the URL’s year and sub-accounts are applied; no export with sub-accounts', async () => {
    const { element, stable, references } = await open(
      '/grand-livre?compte=401&exercice=fy-2025&sous-comptes=oui&page=2',
    );
    await references();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/accounting/accounts/')
      .flush(page([ACCOUNT]));
    await stable();
    const report = httpMock().expectOne((req) => req.url === '/api/v1/reporting/ledger/a-401/');
    expect(report.request.params.get('fiscal_year')).toBe('fy-2025');
    expect(report.request.params.get('include_descendants')).toBe('true');
    expect(report.request.params.get('page')).toBe('2');
    report.flush(ledger([ROW], 120));
    await stable();
    expect(element.textContent).not.toContain('Actions');
    expect(element.querySelector('alco-pagination')).not.toBeNull();
  });

  it('no account chosen: said, no ledger asked', async () => {
    const { element, references } = await open('/grand-livre');
    await references();
    httpMock().expectNone((req) => req.url.includes('/reporting/'));
    expect(element.textContent).toContain('Choisissez un compte.');
  });

  it('an unknown code: said, no ledger asked', async () => {
    const { element, stable, references } = await open('/grand-livre?compte=999');
    await references();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/accounting/accounts/')
      .flush(page([]));
    await stable();
    httpMock().expectNone((req) => req.url.includes('/reporting/'));
    expect(element.textContent).toContain('Aucun compte de cette société n’a le code « 999 ».');
  });

  it('a partner’s ledger: found by its code, the account of each line linked', async () => {
    const { element, stable, references } = await open('/auxiliaire?tiers=FOU-001');
    await references();
    const byCode = httpMock().expectOne((req) => req.url === '/api/v1/partners/');
    expect(byCode.request.params.get('code')).toBe('FOU-001');
    byCode.flush(page([{ public_id: 'p-1', code: 'FOU-001', name: 'Diallo et Cie' }]));
    await stable();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/reporting/partners/p-1/ledger/')
      .flush(ledger([ROW]));
    await stable();
    expect(element.querySelector('h1')?.textContent).toContain('Grand livre auxiliaire');
    expect(element.textContent).toContain('FOU-001 — Diallo et Cie');
    expect(
      element.querySelector('a[href="/app/comptabilite/plan-comptable/a-401"]'),
    ).not.toBeNull();
    // The export is the account ledger's: not offered here.
    expect(element.textContent).not.toContain('Actions');
  });

  it('a refusal of the server is said by its code', async () => {
    const { element, stable, references } = await open('/grand-livre?compte=401');
    await references();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/accounting/accounts/')
      .flush(page([ACCOUNT]));
    await stable();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/reporting/ledger/a-401/')
      .flush(envelope('reporting_scope_invalid'), { status: 400, statusText: 'x' });
    await stable();
    expect(element.textContent).toContain('Cet exercice ne convient pas à ce rapport.');
  });
});
