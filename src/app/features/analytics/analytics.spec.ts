import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { clearCookie, httpMock, provideHttpTesting, setCookie } from '../../core/http/testing';
import { SessionStore } from '../../core/session/session.store';
import { openTestSession } from '../../core/session/testing';
import { AnalyticReportPage } from './analytic-report';
import { distributionText, percentText, planTotals } from './analytics-presentation';
import { AnalyticAxis, AnalyticValue } from './data-access/analytics-models';
import { AlcoDistributionDialog } from './distribution-dialog';
import { AnalyticPlanDetailPage } from './plan-detail';
import { AnalyticPlanListPage } from './plan-list';
import { AnalyticRuleFormPage } from './rule-form';

const BASE = '/api/v1/analytics/';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const page = (results: unknown[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});
const ALL = [
  'analytics.read',
  'analytics.create',
  'analytics.update',
  'analytics.disable',
  'analytics.manage_rules',
  'reporting.read_analytics',
];

const SITES: AnalyticAxis = {
  public_id: 'ax-1',
  code: 'SITE',
  name: 'Chantiers',
  description: '',
  status: 'active',
};

function account(code: string, axis = SITES): AnalyticValue {
  return {
    public_id: `v-${code}`,
    axis: { public_id: axis.public_id, code: axis.code, name: axis.name },
    code,
    label: `Chantier ${code}`,
    description: '',
    status: 'active',
  };
}

async function open(url: string, permissions = ALL) {
  TestBed.configureTestingModule({
    providers: [
      ...provideHttpTesting(),
      provideRouter([
        {
          path: 'plans',
          children: [
            { path: '', component: AnalyticPlanListPage },
            { path: ':id', component: AnalyticPlanDetailPage },
          ],
        },
        { path: 'regles/nouveau', component: AnalyticRuleFormPage },
        { path: 'rapports', component: AnalyticReportPage },
      ]),
    ],
  });
  openTestSession(TestBed.inject(SessionStore), { permissions });
  setCookie('XSRF-TOKEN', 'tok');
  const harness = await RouterTestingHarness.create();
  const component = await harness.navigateByUrl(url);
  const element = harness.routeNativeElement as HTMLElement;
  const stable = async () => {
    await settle();
    await harness.fixture.whenStable();
  };
  const button = (label: string) =>
    Array.from(element.querySelectorAll<HTMLElement>('button, a')).find(
      (item) => item.textContent?.trim() === label,
    );
  const type = (name: string, value: string) => {
    const field = element.querySelector<HTMLInputElement>(`[formcontrolname=${name}]`)!;
    field.value = value;
    field.dispatchEvent(new Event('input'));
  };
  httpMock()
    .match((req) => req.url === '/api/v1/currencies/')
    .forEach((req) => req.flush(page([{ code: 'GNF', decimal_places: 0 }])));
  return { element, stable, button, type, component };
}

describe('Analytique: words', () => {
  it('a distribution in a few words, each plan at 100 %', () => {
    expect(percentText('33.3333')).toBe('33,3333 %');
    expect(percentText('70.0000')).toBe('70 %');
    expect(
      distributionText([
        { value: 'a', percentage: '70', code: 'KIPE', axis: 'SITE' },
        { value: 'b', percentage: '30', code: 'RATOMA', axis: 'SITE' },
      ]),
    ).toBe('KIPE 70 %, RATOMA 30 %');
    const totals = planTotals([
      { axis: 'SITE', percentage: '33.3333' },
      { axis: 'SITE', percentage: '66.6667' },
      { axis: 'DEPT', percentage: '60' },
    ]);
    expect([totals.get('SITE'), totals.get('DEPT')]).toEqual([1_000_000, 600_000]);
  });
});

describe('Analytique', () => {
  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('a new plan, then its page', async () => {
    const { element, stable, button, type } = await open('/plans');
    httpMock()
      .expectOne((req) => req.url === `${BASE}axes/`)
      .flush(page([]));
    await stable();
    expect(element.textContent).toContain('Aucun plan analytique pour l’instant.');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    type('name', 'Chantiers');
    button('Créer')!.click();
    await stable();
    const created = httpMock().expectOne({ method: 'POST', url: `${BASE}axes/` });
    expect(created.request.body).toEqual({ name: 'Chantiers' });
    created.flush(SITES);
    await stable();

    expect(navigate.mock.calls[0][0]).toEqual(['ax-1']);
  });

  it('a plan: its accounts, one added on a line', async () => {
    const { element, stable, button, type } = await open('/plans/ax-1');
    httpMock().expectOne(`${BASE}axes/ax-1/`).flush(SITES);
    httpMock()
      .expectOne((req) => req.url === `${BASE}values/`)
      .flush(page([account('KIPE')]));
    await stable();
    expect(element.textContent).toContain('Chantier KIPE');

    type('label', 'Chantier Ratoma');
    button('Ajouter')!.click();
    await stable();
    const created = httpMock().expectOne({ method: 'POST', url: `${BASE}values/` });
    expect(created.request.body).toEqual({ axis: 'ax-1', label: 'Chantier Ratoma' });
    created.flush(account('RATOMA'));
    await stable();
    httpMock()
      .expectOne((req) => req.url === `${BASE}values/`)
      .flush(page([account('KIPE'), account('RATOMA')]));
    await stable();

    expect(element.textContent).toContain('Chantier RATOMA');
  });

  it('a distribution model, its plan chosen from the plan: its accounts by their prefix', async () => {
    const { element, stable, component } = await open('/regles/nouveau?plan=ax-1');
    httpMock()
      .expectOne((req) => req.url === `${BASE}axes/`)
      .flush(page([SITES]));
    await stable();
    const form = (component as unknown as { form: FormGroup }).form;
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    expect(form.controls['axis'].value).toBe('ax-1');
    httpMock()
      .expectOne((req) => req.url === `${BASE}values/`)
      .flush(page([account('KIPE'), account('RATOMA')]));
    form.patchValue({ name: 'Frais généraux', account_prefix: '62' });
    form.patchValue({ lines: [{ value: 'v-KIPE', percentage: '60' }] });
    (component as unknown as { addLine(p: string): void }).addLine('40');
    form.patchValue({ lines: [{}, { value: 'v-RATOMA' }] });
    element.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await stable();

    const created = httpMock().expectOne({ method: 'POST', url: `${BASE}rules/` });
    expect(created.request.body).toEqual({
      name: 'Frais généraux',
      axis: 'ax-1',
      account_prefix: '62',
      lines: [
        { value: 'v-KIPE', percentage: '60' },
        { value: 'v-RATOMA', percentage: '40' },
      ],
    });
    created.flush({ public_id: 'r-1' });
    await stable();
    expect(navigate).toHaveBeenCalled();
  });

  it('the report: each account of the first plan over the year, what nobody distributed', async () => {
    const { element, stable } = await open('/rapports?date=2026-03-15');
    httpMock()
      .expectOne((req) => req.url === `${BASE}axes/`)
      .flush(page([SITES]));
    await stable();
    const report = httpMock().expectOne(
      (req) => req.url === '/api/v1/reporting/analytics/axes/ax-1/',
    );
    expect(report.request.params.get('date_from')).toBe('2026-01-01');
    expect(report.request.params.get('date_to')).toBe('2026-12-31');
    report.flush({
      count: 1,
      next: null,
      previous: null,
      axis: SITES,
      allocated: { debit: '700000', credit: '0' },
      unallocated: { debit: '300000', credit: '0' },
      results: [
        {
          value: { public_id: 'v-KIPE', code: 'KIPE', label: 'Chantier Kipé' },
          debit: '700000',
          credit: '0',
          balance: '700000',
        },
      ],
    });
    await stable();

    const text = element.textContent ?? '';
    expect(text).toContain('Chantier Kipé');
    expect(text).toMatch(/700\s000/);
    expect(text).toContain('Non réparti');
    expect(text).toMatch(/300\s000/);
  });
});

describe('Analytique: the distribution of a line', () => {
  afterEach(() => httpMock().verify());

  function dialog(given: readonly { value: string; percentage: string }[] = []) {
    const close = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        {
          provide: DIALOG_DATA,
          useValue: given.map((share) => ({ ...share, code: '', axis: 'SITE' })),
        },
        { provide: DialogRef, useValue: { close } },
      ],
    });
    openTestSession(TestBed.inject(SessionStore), { permissions: ALL });
    const fixture = TestBed.createComponent(AlcoDistributionDialog);
    fixture.detectChanges();
    httpMock()
      .expectOne((req) => req.url === `${BASE}values/`)
      .flush(
        page([
          account('KIPE'),
          account('RATOMA'),
          account('ADM', { ...SITES, code: 'DEPT', public_id: 'ax-2', name: 'Départements' }),
        ]),
      );
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const submit = () => {
      element.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      fixture.detectChanges();
    };
    return { fixture, element, close, submit };
  }

  it('a plan short of 100 % is said, the others pass', () => {
    const { element, close, submit } = dialog([
      { value: 'v-KIPE', percentage: '60' },
      { value: 'v-ADM', percentage: '100' },
    ]);

    submit();

    expect(close).not.toHaveBeenCalled();
    expect(element.textContent).toContain('Le plan SITE ne fait pas 100 %.');
  });

  it('each plan at 100 %: the shares, with their codes', () => {
    const { close, submit } = dialog([
      { value: 'v-KIPE', percentage: '60' },
      { value: 'v-RATOMA', percentage: '40' },
      { value: 'v-ADM', percentage: '100' },
    ]);

    submit();

    expect(close).toHaveBeenCalledWith([
      { value: 'v-KIPE', percentage: '60', code: 'KIPE', axis: 'SITE' },
      { value: 'v-RATOMA', percentage: '40', code: 'RATOMA', axis: 'SITE' },
      { value: 'v-ADM', percentage: '100', code: 'ADM', axis: 'DEPT' },
    ]);
  });
});
