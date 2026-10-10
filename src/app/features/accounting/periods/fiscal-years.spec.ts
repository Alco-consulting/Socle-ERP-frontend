import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import {
  clearCookie,
  envelope,
  httpMock,
  provideHttpTesting,
  setCookie,
} from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { openTestSession } from '../../../core/session/testing';
import { AlcoConfirmService } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { localToday } from '../../../shared/utils/dates';
import { FiscalYearFormPage } from './fiscal-year-form';
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
const period = (month: string, status: 'open' | 'closed' = 'open', label = month) => ({
  public_id: `p-${month}`,
  fiscal_year: 'fy-2026',
  code: `2026-${month}`,
  label,
  start_date: `2026-${month}-01`,
  end_date: `2026-${month}-28`,
  status,
  created_at: '',
  updated_at: '',
});
const page = (results: unknown[], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const READ = ['accounting.read'];
const MANAGE = ['accounting.read', 'accounting.manage_periods'];

describe('FiscalYearsPage: fiscal years, their monthly periods, closing a period', () => {
  async function open(url = '/exercices', permissions = READ) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          {
            path: 'exercices',
            children: [
              { path: '', component: FiscalYearsPage },
              { path: 'nouveau', component: FiscalYearFormPage },
            ],
          },
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
    const years = () =>
      httpMock().expectOne((req) => req.url === '/api/v1/accounting/fiscal-years/');
    const periods = () => httpMock().expectOne((req) => req.url === '/api/v1/accounting/periods/');
    const button = (label: string) =>
      Array.from(element.querySelectorAll<HTMLButtonElement>('button, a')).find(
        (item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label,
      );
    return { element, stable, years, periods, button };
  }

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('shows the fiscal years and the periods of the open one', async () => {
    const { element, stable, years, periods, button } = await open();
    years().flush(page([year('2026', 'open'), year('2025', 'closed')]));
    await stable();
    const request = periods();
    expect(request.request.params.get('fiscal_year')).toBe('fy-2026');
    request.flush(page([period('01', 'closed', 'Janvier 2026')]));
    await stable();
    const text = element.textContent ?? '';
    for (const words of ['Exercice 2026', 'Ouvert', 'Exercice 2025', 'Clôturé', 'Janvier 2026']) {
      expect(text).toContain(words);
    }
    expect(element.querySelector('[aria-pressed=true]')?.textContent).toContain('Exercice 2026');
    // Read only: no new fiscal year, no command on a period.
    expect(button('Nouvel exercice')).toBeUndefined();
    expect(button('Rouvrir Janvier 2026')).toBeUndefined();
  });

  it('choosing another fiscal year: its periods, kept in the URL', async () => {
    const { element, stable, years, periods } = await open();
    years().flush(page([year('2026', 'open'), year('2025', 'closed')]));
    await stable();
    periods().flush(page([]));
    await stable();
    element.querySelectorAll<HTMLButtonElement>('button.year')[1].click();
    await stable();
    const request = periods();
    expect(request.request.params.get('fiscal_year')).toBe('fy-2025');
    request.flush(page([]));
    await stable();
    expect(TestBed.inject(Router).url).toBe('/exercices?exercice=fy-2025');
    expect(element.textContent).toContain('Cet exercice n’a pas de période');
  });

  it('no fiscal year: said, with « Nouvel exercice » for the holder of manage_periods', async () => {
    const { element, stable, years, button } = await open('/exercices', MANAGE);
    years().flush(page([]));
    await stable();
    httpMock().expectNone((req) => req.url === '/api/v1/accounting/periods/');
    expect(element.textContent).toContain('Aucun exercice dans cette société.');
    expect(element.textContent).toContain('aucune écriture ne peut être saisie');
    expect(button('Nouvel exercice')?.getAttribute('href')).toBe('/exercices/nouveau');
  });

  it('a year without periods gets its monthly periods in one click', async () => {
    const { element, stable, years, periods, button } = await open('/exercices', MANAGE);
    years().flush(page([year('2026', 'open')]));
    await stable();
    periods().flush(page([]));
    await stable();
    button('Créer les périodes mensuelles')!.click();
    await stable();
    const create = httpMock().expectOne('/api/v1/accounting/fiscal-years/fy-2026/monthly-periods/');
    expect(create.request.method).toBe('POST');
    create.flush([period('01'), period('02')]);
    await stable();
    periods().flush(page([period('01'), period('02')]));
    await stable();
    expect(element.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('« Clôturer » says how many drafts wait, then runs the command; « Rouvrir » too', async () => {
    const { stable, years, periods, button } = await open('/exercices', MANAGE);
    const confirm = vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
    years().flush(page([year('2026', 'open')]));
    await stable();
    periods().flush(
      page([period('01', 'open', 'Janvier 2026'), period('02', 'closed', 'Février 2026')]),
    );
    await stable();

    button('Clôturer Janvier 2026')!.click();
    await stable();
    const drafts = httpMock().expectOne((req) => req.url === '/api/v1/accounting/entries/');
    expect([drafts.request.params.get('period'), drafts.request.params.get('status')]).toEqual([
      'p-01',
      'draft',
    ]);
    drafts.flush(page([], 3));
    await stable();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Clôturer Janvier 2026 ?',
        message: expect.stringContaining('3 brouillons de cette période attendront sa réouverture'),
      }),
    );
    httpMock()
      .expectOne('/api/v1/accounting/periods/p-01/close/')
      .flush(period('01', 'closed', 'Janvier 2026'));
    await stable();
    periods().flush(
      page([period('01', 'closed', 'Janvier 2026'), period('02', 'closed', 'Février 2026')]),
    );
    await stable();

    button('Rouvrir Février 2026')!.click();
    await stable();
    httpMock()
      .expectOne('/api/v1/accounting/periods/p-02/reopen/')
      .flush(envelope('company_permission_denied'), { status: 403, statusText: 'x' });
    await stable();
  });

  it('a closed fiscal year: its periods are not reopened one by one', async () => {
    const { element, stable, years, periods, button } = await open('/exercices', MANAGE);
    years().flush(page([year('2025', 'closed')]));
    await stable();
    periods().flush(page([period('01', 'closed', 'Janvier 2025')]));
    await stable();
    expect(button('Rouvrir Janvier 2025')).toBeUndefined();
    expect(element.textContent).toContain('Exercice clôturé');
  });
});

describe('FiscalYearFormPage: a fiscal year and its monthly periods', () => {
  async function open() {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          {
            path: 'exercices',
            children: [
              { path: '', component: FiscalYearsPage },
              { path: 'nouveau', component: FiscalYearFormPage },
            ],
          },
        ]),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), { permissions: MANAGE });
    setCookie('XSRF-TOKEN', 'tok');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/exercices/nouveau');
    const element = harness.routeNativeElement as HTMLElement;
    const stable = async () => {
      await settle();
      await harness.fixture.whenStable();
    };
    const value = (name: string) =>
      element.querySelector<HTMLInputElement>(`[formControlName="${name}"]`)!.value;
    const fill = (name: string, text: string) => {
      const field = element.querySelector<HTMLInputElement>(`[formControlName="${name}"]`)!;
      field.value = text;
      field.dispatchEvent(new Event('input'));
    };
    return { element, stable, value, fill };
  }

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('proposes the twelve months after the last fiscal year', async () => {
    const { stable, value } = await open();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/accounting/fiscal-years/')
      .flush(page([year('2026', 'open'), year('2025', 'closed')]));
    await stable();
    expect([value('code'), value('label'), value('start_date'), value('end_date')]).toEqual([
      '2027',
      'Exercice 2027',
      '2027-01-01',
      '2027-12-31',
    ]);
  });

  it('without a fiscal year: the current calendar year; created with its periods', async () => {
    const { element, stable, value, fill } = await open();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    httpMock()
      .expectOne((req) => req.url === '/api/v1/accounting/fiscal-years/')
      .flush(page([]));
    await stable();
    const current = localToday().slice(0, 4);
    expect([value('start_date'), value('end_date')]).toEqual([
      `${current}-01-01`,
      `${current}-12-31`,
    ]);
    // Another start: the end, code and label follow, until typed.
    fill('start_date', '2026-07-01');
    await stable();
    expect([value('end_date'), value('code'), value('label')]).toEqual([
      '2027-06-30',
      '2026-2027',
      'Exercice 2026-2027',
    ]);
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await stable();
    const create = httpMock().expectOne('/api/v1/accounting/fiscal-years/');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({
      code: '2026-2027',
      label: 'Exercice 2026-2027',
      start_date: '2026-07-01',
      end_date: '2027-06-30',
      monthly_periods: true,
    });
    create.flush({ ...year('2026', 'open'), public_id: 'fy-new', label: 'Exercice 2026-2027' });
    await stable();
    expect(navigate).toHaveBeenCalledWith(['/app/comptabilite/configuration/exercices'], {
      queryParams: { exercice: 'fy-new' },
    });
  });

  it('dates over another fiscal year are said under the start', async () => {
    const { element, stable } = await open();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/accounting/fiscal-years/')
      .flush(page([]));
    await stable();
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await stable();
    httpMock()
      .expectOne('/api/v1/accounting/fiscal-years/')
      .flush(envelope('accounting_fiscal_year_overlap'), { status: 400, statusText: 'x' });
    await stable();
    expect(element.textContent).toContain('Ces dates chevauchent un autre exercice de la société.');
  });

  it('an end before the start is refused before any request', async () => {
    const { element, stable, fill } = await open();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/accounting/fiscal-years/')
      .flush(page([]));
    await stable();
    fill('end_date', '2020-01-01');
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await stable();
    httpMock().expectNone('/api/v1/accounting/fiscal-years/');
    expect(element.textContent).toContain('La fin vient après le début.');
  });
});
