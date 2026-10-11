import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { clearCookie, httpMock, provideHttpTesting, setCookie } from '../../core/http/testing';
import { SessionStore } from '../../core/session/session.store';
import { openTestSession } from '../../core/session/testing';
import { AlcoConfirmService } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { ClosingListPage } from './closing-list';
import { ClosingRunPage } from './closing-run';
import {
  ClosingRun,
  ClosingStep,
  RunPeriod,
  RunStatus,
  StepCode,
  StepStatus,
} from './data-access/closing-models';
import { ClosingReasonDialogService } from './reason-dialog';

const CODES: readonly StepCode[] = [
  'pre_close_checks',
  'inventory',
  'depreciation',
  'provisions',
  'fx',
  'tax_check',
  'validation',
  'result',
  'close',
  'opening',
];
const BASE = '/api/v1/closing/runs/';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const page = (results: unknown[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});

function run(
  status: RunStatus,
  current: StepCode | '',
  extra: Partial<ClosingRun> = {},
): ClosingRun {
  return {
    public_id: 'run-1',
    scope: 'fiscal_year',
    fiscal_year: { public_id: 'fy-2026', code: '2026' },
    period: null,
    status,
    current_step: current,
    result: null,
    next_fiscal_year: null,
    failed_step: '',
    reason: '',
    created_at: '2026-12-31T10:00:00Z',
    closed_at: null,
    completed_at: null,
    cancelled_at: null,
    steps: [],
    reopenings: [],
    ...extra,
  };
}

/** The ten steps: those before `current` succeeded, `current` in `state`, the rest pending. */
function steps(
  current: StepCode,
  state: StepStatus = 'pending',
  checks: ClosingStep['checks'] = [],
) {
  const index = CODES.indexOf(current);
  return CODES.map((code, position): ClosingStep => ({
    public_id: `step-${code}`,
    code,
    sequence: position + 1,
    status: position < index ? 'succeeded' : position === index ? state : 'pending',
    attempts: position <= index ? 1 : 0,
    finished_at: null,
    result: {},
    checks: position === index ? checks : [],
  }));
}

const MONTHS = ['Janvier', 'Février', 'Mars'];
function periods(status: 'open' | 'closed', open: string[] = []): RunPeriod[] {
  return MONTHS.map((month, index) => {
    const code = `2026-0${index + 1}`;
    return {
      public_id: `p-0${index + 1}`,
      code,
      label: `${month} 2026`,
      start_date: `${code}-01`,
      end_date: `${code}-28`,
      status: open.includes(code) ? 'open' : status,
    };
  });
}

const ALL = [
  'accounting.read',
  'closing.read',
  'closing.start',
  'closing.execute',
  'closing.validate',
  'closing.close',
  'closing.reopen',
];

async function open(url: string, permissions = ALL) {
  TestBed.configureTestingModule({
    providers: [
      ...provideHttpTesting(),
      provideRouter([
        {
          path: 'cloture',
          children: [
            { path: '', component: ClosingListPage },
            { path: ':id', component: ClosingRunPage },
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
  const button = (label: string) =>
    Array.from(element.querySelectorAll<HTMLButtonElement>('button, a')).find(
      (item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label,
    );
  return { element, stable, button };
}

/** Answers the run page's three reads. */
async function answer(
  stable: () => Promise<void>,
  current: ClosingRun,
  list: ClosingStep[],
  rows: RunPeriod[],
) {
  httpMock().expectOne(`${BASE}run-1/`).flush(current);
  httpMock().expectOne(`${BASE}run-1/steps/`).flush(list);
  httpMock().expectOne(`${BASE}run-1/periods/`).flush(rows);
  await stable();
}

describe('Clôture: the list, the open fiscal years and their closing', () => {
  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('« Démarrer la clôture » of an open fiscal year starts it and opens it', async () => {
    const { element, stable, button } = await open('/cloture');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    httpMock()
      .expectOne((req) => req.url === BASE)
      .flush(page([]));
    httpMock()
      .expectOne((req) => req.url === '/api/v1/accounting/fiscal-years/')
      .flush(
        page([
          {
            public_id: 'fy-2026',
            code: '2026',
            label: 'Exercice 2026',
            start_date: '2026-01-01',
            end_date: '2026-12-31',
            status: 'open',
          },
        ]),
      );
    await stable();
    expect(element.textContent).toContain('Aucune clôture pour l’instant.');
    expect(element.textContent).toContain('01/01/2026 → 31/12/2026');

    button('Démarrer la clôture de Exercice 2026')!.click();
    await stable();
    const start = httpMock().expectOne(BASE);
    expect([start.request.method, start.request.body]).toEqual([
      'POST',
      { fiscal_year: 'fy-2026' },
    ]);
    start.flush(run('in_progress', 'pre_close_checks'));
    await stable();
    expect(navigate).toHaveBeenCalledWith(['/app/comptabilite/cloture', 'run-1']);
  });

  it('a closing in progress is listed and linked; without closing.start, nothing starts', async () => {
    const { element, stable, button } = await open('/cloture', ['accounting.read', 'closing.read']);
    httpMock()
      .expectOne((req) => req.url === BASE)
      .flush(page([run('in_progress', 'validation')]));
    httpMock()
      .expectOne((req) => req.url === '/api/v1/accounting/fiscal-years/')
      .flush(
        page([
          {
            public_id: 'fy-2026',
            label: 'Exercice 2026',
            start_date: '2026-01-01',
            end_date: '2026-12-31',
          },
        ]),
      );
    await stable();
    const row = element.querySelector('tbody tr')!.textContent ?? '';
    for (const words of ['Exercice 2026', 'En cours', 'Validation']) {
      expect(row).toContain(words);
    }
    expect(button('Voir la clôture en cours')?.getAttribute('href')).toBe('/cloture/run-1');
    expect(button('Démarrer la clôture de Exercice 2026')).toBeUndefined();
  });
});

describe('Clôture: one closing, its steps, its periods, its reopenings', () => {
  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('runs the current step only; a blocking point is shown and retried', async () => {
    const { element, stable, button } = await open('/cloture/run-1');
    await answer(
      stable,
      run('in_progress', 'pre_close_checks'),
      steps('pre_close_checks'),
      periods('open'),
    );
    expect(element.querySelectorAll('.step').length).toBe(10);
    expect(element.querySelectorAll('.step-action').length).toBe(1);

    button('Exécuter')!.click();
    await stable();
    const executed = httpMock().expectOne(`${BASE}run-1/steps/pre_close_checks/execute/`);
    expect(executed.request.method).toBe('POST');
    const blocking = {
      step: 'pre_close_checks' as const,
      attempt: 1,
      code: 'pending_entries',
      level: 'blocking' as const,
      message: 'Draft or submitted entries could no longer be validated once closed.',
      details: {},
      source: 'accounting',
    };
    executed.flush({ ...steps('pre_close_checks', 'failed', [blocking])[0] });
    await stable();
    await answer(
      stable,
      run('in_progress', 'pre_close_checks', { failed_step: 'pre_close_checks' }),
      steps('pre_close_checks', 'failed', [blocking]),
      periods('open'),
    );
    expect(element.textContent).toContain('Écritures non validées');
    expect(element.textContent).not.toContain('could no longer');
    button('Réessayer')!.click();
    await stable();
    httpMock().expectOne(`${BASE}run-1/steps/pre_close_checks/retry/`).flush(steps('inventory')[0]);
    await stable();
    await answer(stable, run('in_progress', 'inventory'), steps('inventory'), periods('open'));
  });

  it('the close asks first, saying the year and all its periods close', async () => {
    const { stable, button } = await open('/cloture/run-1');
    const confirm = vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
    await answer(stable, run('in_progress', 'close'), steps('close'), periods('open'));

    button('Clôturer l’exercice')!.click();
    await stable();

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Clôturer l’exercice 2026 ?',
        message: expect.stringContaining('L’exercice et toutes ses périodes seront clôturés'),
      }),
    );
    httpMock().expectOne(`${BASE}run-1/steps/close/execute/`).flush(steps('opening')[8]);
    await stable();
    await answer(stable, run('closed', 'opening'), steps('opening'), periods('closed'));
  });

  it('the year reopens alone; then a period reopens with its reason', async () => {
    const { element, stable, button } = await open('/cloture/run-1');
    const ask = vi.spyOn(TestBed.inject(ClosingReasonDialogService), 'ask');
    await answer(stable, run('completed', ''), steps('opening', 'succeeded'), periods('closed'));
    expect(button('Rouvrir Mars 2026')).toBeUndefined();

    ask.mockResolvedValueOnce('Audit');
    button('Rouvrir l’exercice')!.click();
    await stable();
    expect(ask.mock.calls[0][0].message).toContain('ses périodes resteront clôturées');
    const reopened = httpMock().expectOne(`${BASE}run-1/reopen/`);
    expect(reopened.request.body).toEqual({ reason: 'Audit' });
    const reopening = {
      public_id: 'r-1',
      reason: 'Audit',
      reopened_by: 'u-1',
      periods: [],
      fiscal_year_reopened: true,
      created_at: '2027-01-10T09:00:00Z',
    };
    reopened.flush(run('reopened', '', { reopenings: [reopening] }));
    await stable();
    await answer(
      stable,
      run('reopened', '', { reopenings: [reopening] }),
      steps('opening', 'succeeded'),
      periods('closed'),
    );
    expect(element.textContent).toContain('ses périodes restent clôturées');
    expect(element.textContent).toContain('Exercice rouvert');

    ask.mockResolvedValueOnce('Facture tardive');
    button('Rouvrir Mars 2026')!.click();
    await stable();
    const period = httpMock().expectOne(`${BASE}run-1/periods/p-03/reopen/`);
    expect(period.request.body).toEqual({ reason: 'Facture tardive' });
    period.flush(run('reopened', ''));
    await stable();
    await answer(
      stable,
      run('reopened', ''),
      steps('opening', 'succeeded'),
      periods('closed', ['2026-03']),
    );
    expect(button('Rouvrir Mars 2026')).toBeUndefined();
    expect(button('Rouvrir Février 2026')).toBeDefined();
  });

  it('read only: no command at all', async () => {
    const { element, stable, button } = await open('/cloture/run-1', ['closing.read']);
    await answer(
      stable,
      run('in_progress', 'pre_close_checks'),
      steps('pre_close_checks'),
      periods('open'),
    );

    expect(element.querySelectorAll('.step-action').length).toBe(0);
    expect(button('Abandonner')).toBeUndefined();
    expect(button('Rouvrir l’exercice')).toBeUndefined();
  });
});
