import { TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { clearCookie, httpMock, provideHttpTesting, setCookie } from '../../core/http/testing';
import { SessionStore } from '../../core/session/session.store';
import { openTestSession } from '../../core/session/testing';
import { Loan, LoanType, ScheduleLine } from './data-access/loans-models';
import { LoanDetailPage } from './loan-detail';
import { LoanDialogService } from './loan-dialogs';
import { LoanFormPage } from './loan-form';
import { LoanListPage } from './loan-list';
import { addMonths } from './loans-presentation';
import { LoanTypeListPage } from './type-list';

const BASE = '/api/v1/loans/';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const page = (results: unknown[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});
const ALL = [
  'loans.read',
  'loans.create',
  'loans.update',
  'loans.activate',
  'loans.pay',
  'loans.prepay',
  'loans.account',
  'loans.manage_types',
];

const TYPE: LoanType = {
  public_id: 't-1',
  code: 'EMP',
  name: 'Emprunt bancaire',
  status: 'active',
  journal: { public_id: 'j-1', code: 'OD' },
  principal_account: { public_id: 'a-1', code: '162100' },
  interest_account: { public_id: 'a-2', code: '671200' },
  fee_account: { public_id: 'a-3', code: '631000' },
};

function loan(extra: Partial<Loan> = {}): Loan {
  return {
    public_id: 'l-1',
    code: '',
    name: 'Prêt véhicule',
    reference: '',
    loan_type: { public_id: 't-1', code: 'EMP' },
    partner: { public_id: 'p-1', code: 'BICIGUI' },
    status: 'draft',
    currency: 'GNF',
    principal_amount: '12000000.000000',
    start_date: '2026-01-15',
    first_payment_date: '2026-02-15',
    maturity_date: null,
    interest_rate: '12.000000',
    payment_frequency: 'monthly',
    repayment_method: 'annuity',
    installments: 12,
    day_count: 'periodic',
    rounding: 'half_up',
    fees: [],
    position: {
      drawn: '0',
      principal_repaid: '0',
      prepaid: '0',
      outstanding: '0',
      interest_paid: '0',
      fees_paid: '0',
      next_installment: null,
    },
    reason: '',
    ...extra,
  };
}

function line(sequence: number, status?: ScheduleLine['status']): ScheduleLine {
  return {
    ...(status ? { public_id: `s-${sequence}`, status } : {}),
    sequence,
    due_date: addMonths('2026-01-15', sequence),
    opening_balance: '12000000',
    principal: '946185',
    interest: '120000',
    fees: '0',
    total: '1066185',
    closing_balance: '11053815',
  };
}

async function open(url: string, permissions = ALL) {
  TestBed.configureTestingModule({
    providers: [
      ...provideHttpTesting(),
      provideRouter([
        {
          path: 'liste',
          children: [
            { path: '', component: LoanListPage },
            { path: 'nouveau', component: LoanFormPage },
            { path: ':id', component: LoanDetailPage },
          ],
        },
        { path: 'types', component: LoanTypeListPage },
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
  httpMock()
    .match((req) => req.url === '/api/v1/currencies/')
    .forEach((req) => req.flush(page([{ code: 'GNF', decimal_places: 0 }])));
  return { element, stable, button, component };
}

describe('Emprunts: words', () => {
  it('the first installment one period on, the day brought back to the month end', () => {
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
  });
});

describe('Emprunts', () => {
  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('the types, and the usual ones on demand', async () => {
    const { element, stable, button } = await open('/types');
    httpMock()
      .expectOne((req) => req.url === `${BASE}types/`)
      .flush(page([]));
    await stable();
    expect(element.textContent).toContain('Aucun type d’emprunt pour l’instant.');

    button('Créer les types usuels')!.click();
    await stable();
    httpMock()
      .expectOne({ method: 'POST', url: `${BASE}types/defaults/` })
      .flush({ created: [TYPE], existing: [] });
    await stable();
    httpMock()
      .expectOne((req) => req.url === `${BASE}types/`)
      .flush(page([TYPE]));
    await stable();

    expect(element.textContent).toContain('Emprunt bancaire');
    expect(element.textContent).toContain('162100');
  });

  it('the loans: what remains owed, the principal for a draft', async () => {
    const { element, stable } = await open('/liste');
    httpMock()
      .expectOne((req) => req.url === BASE)
      .flush(
        page([
          loan({
            public_id: 'l-2',
            status: 'active',
            code: 'EMP-000001',
            position: { ...loan().position, outstanding: '9000000' },
          }),
          loan(),
        ]),
      );
    await stable();

    const text = element.textContent ?? '';
    expect(text).toContain('EMP-000001');
    expect(text).toMatch(/9\s000\s000/);
    expect(text).toMatch(/12\s000\s000/);
    expect(text).toContain('En cours');
    expect(text).toContain('Brouillon');
  });

  it('a new loan: its first installment proposed, the draft created', async () => {
    const { element, stable, component } = await open('/liste/nouveau');
    httpMock()
      .expectOne((req) => req.url === `${BASE}types/`)
      .flush(page([TYPE]));
    await stable();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const form = (component as unknown as { form: FormGroup }).form;

    form.patchValue({
      name: 'Prêt véhicule',
      loan_type: 't-1',
      partner: { id: 'p-1', label: 'BICIGUI' },
      principal_amount: '12 000 000',
      interest_rate: '12,5',
      fee: '150000',
    });
    form.controls['start_date'].setValue('2026-01-31');
    await stable();
    expect(form.controls['first_payment_date'].value).toBe('2026-02-28');
    element.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await stable();

    const request = httpMock().expectOne({ method: 'POST', url: BASE });
    expect(request.request.body).toMatchObject({
      loan_type: 't-1',
      partner: 'p-1',
      currency: 'GNF',
      principal_amount: '12000000',
      interest_rate: '12.5',
      start_date: '2026-01-31',
      first_payment_date: '2026-02-28',
      rate_type: 'fixed',
      day_count: 'periodic',
      rounding: 'half_up',
      fees: [{ kind: 'initial', label: 'Frais de dossier', amount: '150000' }],
    });
    request.flush(loan());
    await stable();
    expect(navigate).toHaveBeenCalled();
  });

  it('a draft shows the schedule it would get, then « Activer » from the bank', async () => {
    const { element, stable, button } = await open('/liste/l-1');
    httpMock().expectOne(`${BASE}l-1/`).flush(loan());
    await stable();
    const simulation = httpMock().expectOne({ method: 'POST', url: `${BASE}simulate/` });
    expect(simulation.request.body).toMatchObject({ principal_amount: '12000000.000000' });
    simulation.flush({ lines: [line(1), line(2)], total_interest: '0', total: '0' });
    httpMock().expectOne('/api/v1/partners/p-1/').flush({ public_id: 'p-1', name: 'BICIGUI SA' });
    await stable();
    expect(element.textContent).toContain('BICIGUI SA');
    expect(element.textContent).toMatch(/1\s066\s185/);
    const pay = vi
      .spyOn(TestBed.inject(LoanDialogService), 'pay')
      .mockResolvedValue({ journal: 'bank-1', date: '2026-01-15' });

    button('Activer')!.click();
    await stable();
    const activation = httpMock().expectOne({ method: 'POST', url: `${BASE}l-1/activate/` });
    expect(activation.request.body).toEqual({ journal: 'bank-1' });
    expect(pay.mock.calls[0][0].date).toBeNull();
    activation.flush(loan({ status: 'active', code: 'EMP-000001' }));
    await stable();
    httpMock()
      .expectOne(`${BASE}l-1/`)
      .flush(loan({ status: 'active', code: 'EMP-000001' }));
    await stable();
    httpMock()
      .expectOne(`${BASE}l-1/schedule/`)
      .flush({ public_id: 'v-1', version: 1, lines: [line(1, 'planned')] });
    httpMock().expectOne('/api/v1/partners/p-1/').flush({ public_id: 'p-1', name: 'BICIGUI SA' });
    await stable();

    expect(button('Activer')).toBeUndefined();
    expect(button('Payer l’échéance n°1')).toBeDefined();
  });

  it('the next installment paid from the bank, on its due date by default', async () => {
    const { stable, button } = await open('/liste/l-1');
    httpMock()
      .expectOne(`${BASE}l-1/`)
      .flush(loan({ status: 'active', code: 'EMP-000001' }));
    await stable();
    httpMock()
      .expectOne(`${BASE}l-1/schedule/`)
      .flush({ public_id: 'v-1', version: 1, lines: [line(1, 'paid'), line(2, 'planned')] });
    httpMock().expectOne('/api/v1/partners/p-1/').flush({ public_id: 'p-1', name: 'BICIGUI SA' });
    await stable();
    const pay = vi
      .spyOn(TestBed.inject(LoanDialogService), 'pay')
      .mockResolvedValue({ journal: 'bank-1', date: '2026-03-15' });

    button('Payer l’échéance n°2')!.click();
    await stable();
    expect(pay.mock.calls[0][0].date).toBe('2026-03-15');
    const payment = httpMock().expectOne({ method: 'POST', url: `${BASE}installments/s-2/pay/` });
    expect(payment.request.body).toEqual({ payment_date: '2026-03-15', journal: 'bank-1' });
    payment.flush({});
    await stable();
    httpMock()
      .expectOne(`${BASE}l-1/`)
      .flush(loan({ status: 'active', code: 'EMP-000001' }));
    await stable();
    httpMock()
      .expectOne(`${BASE}l-1/schedule/`)
      .flush({ public_id: 'v-1', version: 1, lines: [line(1, 'paid'), line(2, 'paid')] });
    httpMock().expectOne('/api/v1/partners/p-1/').flush({ public_id: 'p-1', name: 'BICIGUI SA' });
    await stable();
  });
});
