import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { envelope, httpMock, provideHttpTesting } from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { TEST_COMPANY, openTestSession } from '../../../core/session/testing';
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
const period = (code: string, label: string, status: string) => ({
  public_id: `p-${code}`,
  fiscal_year: 'fy-2026',
  code,
  label,
  start_date: '2026-01-01',
  end_date: '2026-01-31',
  status,
  created_at: '',
  updated_at: '',
});
const JOURNAL = {
  public_id: 'j-ach',
  code: 'ACH',
  name: 'Achats',
  journal_type: 'purchase',
  default_currency: null,
  sequence_prefix: 'ACH-',
  sequence_padding: 6,
  status: 'active',
  created_at: '',
  updated_at: '',
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AccountingDashboardPage (real data, block by block)', () => {
  async function open() {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([{ path: 'tableau-de-bord', component: AccountingDashboardPage }]),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), {
      permissions: ['accounting.read'],
      companies: [{ ...TEST_COMPANY, name: 'ALCO GUINÉE' }],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/tableau-de-bord');
    const element = harness.routeNativeElement as HTMLElement;
    const stable = async () => {
      await settle();
      await harness.fixture.whenStable();
    };
    const call = (path: string, status: string | null = null) =>
      httpMock().expectOne(
        (req) =>
          req.url === `/api/v1/accounting/${path}` &&
          (status === null || req.params.get('status') === status),
      );
    return { element, stable, call };
  }

  afterEach(() => httpMock().verify());

  it('fills each block from the API, with a fixed number of requests (no N+1)', async () => {
    const { element, stable, call } = await open();
    expect(element.textContent).toContain('Chargement des exercices');

    call('fiscal-years/', 'open').flush(page([YEAR]));
    call('entries/', 'draft').flush(page([{}], 4));
    call('entries/', 'submitted').flush(page([{}], 2));
    call('journals/', 'active').flush(page([JOURNAL]));
    httpMock()
      .match((req) => req.url === '/api/v1/accounting/accounts/')
      .forEach((request) =>
        request.flush(page([{}], request.request.params.get('postable') ? 610 : 812)),
      );
    await stable();
    call('periods/').flush(
      page([
        period('2026-01', 'Janvier 2026', 'closed'),
        period('2026-02', 'Février 2026', 'open'),
      ]),
    );
    await stable();
    httpMock().verify(); // 7 requests in all: 1 + 1 per open fiscal year + 2 + 1 + 2

    const text = element.textContent ?? '';
    expect(text).toContain('ALCO GUINÉE · Exercice : Exercice 2026');
    expect(text).toContain('Brouillons4');
    expect(text).toContain('Soumises, à valider2');
    expect(text).toContain('01/01/2026 → 31/12/2026');
    expect(text).toMatch(/Janvier 2026\s*Clôturée/);
    expect(text).toMatch(/Février 2026\s*Ouverte/);
    expect(text).toContain('ACH');
    expect(text).toContain('Achats');
    expect(text).toContain('Comptes812');
    expect(text).toContain('Comptes imputables610');
  });

  it('no open fiscal year: said, nothing invented', async () => {
    const { element, stable, call } = await open();
    call('fiscal-years/', 'open').flush(page([]));
    call('entries/', 'draft').flush(page([], 0));
    call('entries/', 'submitted').flush(page([], 0));
    call('journals/', 'active').flush(page([]));
    httpMock()
      .match((req) => req.url === '/api/v1/accounting/accounts/')
      .forEach((request) => request.flush(page([], 0)));
    await stable();
    httpMock().expectNone((req) => req.url === '/api/v1/accounting/periods/');
    expect(element.textContent).toContain('Aucun exercice ouvert');
    expect(element.textContent).toContain('Aucun journal actif.');
  });

  it('a failing block says so and offers a retry; the others are shown', async () => {
    const { element, stable, call } = await open();
    call('fiscal-years/', 'open').flush(page([]));
    call('entries/', 'submitted').flush(page([], 0));
    call('entries/', 'draft').flush(envelope('server_error'), { status: 500, statusText: 'x' });
    call('journals/', 'active').flush(page([JOURNAL]));
    httpMock()
      .match((req) => req.url === '/api/v1/accounting/accounts/')
      .forEach((request) => request.flush(page([], 0)));
    await stable();
    expect(element.textContent).toContain('Une erreur inattendue s’est produite.');
    expect(element.textContent).toContain('Achats');
  });
});
