import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { httpMock, provideHttpTesting } from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { openTestSession } from '../../../core/session/testing';
import { FiscalYearsPage } from './fiscal-years';

const year = (code: string, status: 'open' | 'closed') => ({
  public_id: `fy-${code}`,
  code,
  label: `Exercice ${code}`,
  start_date: `${code}-01-01`,
  end_date: `${code}-12-31`,
  status,
  created_at: '',
  updated_at: '',
});
const page = (results: unknown[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('FiscalYearsPage (read only, the server’s states)', () => {
  async function open(url = '/exercices') {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([{ path: 'exercices', component: FiscalYearsPage }]),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), { permissions: ['accounting.read'] });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const element = harness.routeNativeElement as HTMLElement;
    const stable = async () => {
      await settle();
      await harness.fixture.whenStable();
    };
    return { element, stable };
  }

  afterEach(() => httpMock().verify());

  it('shows the fiscal years and the periods of the open one', async () => {
    const { element, stable } = await open();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/accounting/fiscal-years/')
      .flush(page([year('2026', 'open'), year('2025', 'closed')]));
    await stable();
    const periods = httpMock().expectOne((req) => req.url === '/api/v1/accounting/periods/');
    expect(periods.request.params.get('fiscal_year')).toBe('fy-2026');
    periods.flush(
      page([
        {
          public_id: 'p1',
          fiscal_year: 'fy-2026',
          code: '2026-01',
          label: 'Janvier 2026',
          start_date: '2026-01-01',
          end_date: '2026-01-31',
          status: 'closed',
          created_at: '',
          updated_at: '',
        },
      ]),
    );
    await stable();
    const text = element.textContent ?? '';
    expect(text).toContain('Exercice 2026');
    expect(text).toContain('Ouvert');
    expect(text).toContain('Exercice 2025');
    expect(text).toContain('Clôturé');
    expect(text).toContain('Janvier 2026');
    expect(text).toContain('Clôturée');
    expect(element.querySelector('[aria-pressed=true]')?.textContent).toContain('Exercice 2026');
  });

  it('choosing another fiscal year: its periods, kept in the URL', async () => {
    const { element, stable } = await open();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/accounting/fiscal-years/')
      .flush(page([year('2026', 'open'), year('2025', 'closed')]));
    await stable();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/accounting/periods/')
      .flush(page([]));
    await stable();
    element.querySelectorAll<HTMLButtonElement>('button.year')[1].click();
    await stable();
    const periods = httpMock().expectOne((req) => req.url === '/api/v1/accounting/periods/');
    expect(periods.request.params.get('fiscal_year')).toBe('fy-2025');
    periods.flush(page([]));
    await stable();
    expect(TestBed.inject(Router).url).toBe('/exercices?exercice=fy-2025');
    expect(element.textContent).toContain('Aucune période définie pour cet exercice.');
  });

  it('no fiscal year: said, no request for periods', async () => {
    const { element, stable } = await open();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/accounting/fiscal-years/')
      .flush(page([]));
    await stable();
    httpMock().expectNone((req) => req.url === '/api/v1/accounting/periods/');
    expect(element.textContent).toContain('Aucun exercice dans cette société.');
  });
});
