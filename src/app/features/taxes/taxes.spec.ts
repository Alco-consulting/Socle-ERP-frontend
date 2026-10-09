import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import {
  clearCookie,
  envelope,
  httpMock,
  provideHttpTesting,
  setCookie,
} from '../../core/http/testing';
import { SessionStore } from '../../core/session/session.store';
import { openTestSession } from '../../core/session/testing';
import { Tax } from './data-access/taxes-models';
import { TaxFormPage } from './tax-form';
import { TaxListPage } from './tax-list';

const tax = (name: string, extra: Partial<Tax> = {}): Tax => ({
  public_id: `t-${name.replace(/\W/g, '')}`,
  code: name.toUpperCase(),
  name,
  rate: '18.0000',
  type_tax_use: 'both',
  sale_account_code: '443100',
  purchase_account_code: '445200',
  withholding: false,
  category: 'vat',
  country: 'GN',
  status: 'active',
  created_at: '2026-10-09T10:00:00Z',
  updated_at: '2026-10-09T10:00:00Z',
  ...extra,
});
const page = (results: unknown[] = [], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const MANAGE = ['accounting.read', 'taxes.read', 'taxes.create', 'taxes.update'];

/** Side requests (the history of a tax): answered empty. */
function answerSideRequests(): void {
  for (const request of httpMock().match((req) => req.url.includes('/audit/'))) {
    request.flush(page());
  }
}

function fill(element: HTMLElement, name: string, value: string): void {
  const field = element.querySelector<HTMLInputElement | HTMLSelectElement>(
    `[formControlName="${name}"]`,
  )!;
  field.value = value;
  field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input'));
}

describe('Taxes (taxes/): one simple screen', () => {
  async function open(url: string, permissions = MANAGE) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          {
            path: 'taxes',
            data: { breadcrumb: 'Taxes' },
            children: [
              { path: '', component: TaxListPage },
              { path: 'nouveau', component: TaxFormPage },
              { path: ':id', data: { breadcrumb: 'Taxe' }, component: TaxFormPage },
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
    const list = () => httpMock().expectOne((req) => req.url === '/api/v1/taxes/');
    return { element, stable, list, harness };
  }

  afterEach(() => {
    answerSideRequests();
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('list: name, rate, where it applies, the account of each side, active', async () => {
    const { element, stable, list } = await open('/taxes');
    const request = list();
    expect(request.request.params.has('type_tax_use')).toBe(false);
    request.flush(
      page([
        tax('Retenue 10 %', {
          rate: '10.0000',
          type_tax_use: 'purchase',
          sale_account_code: '',
          purchase_account_code: '444131',
          withholding: true,
        }),
        tax('TVA 18 %'),
      ]),
    );
    await stable();
    const headers = Array.from(element.querySelectorAll('thead th')).map((cell) =>
      cell.textContent?.trim(),
    );
    expect(headers).toEqual([
      'Nom',
      'Taux',
      'S’applique à',
      'Compte des ventes',
      'Compte des achats',
      'Actif',
    ]);
    const rows = Array.from(element.querySelectorAll('tbody tr')).map((row) =>
      Array.from(row.querySelectorAll('td'))
        .slice(0, 5)
        .map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim()),
    );
    expect(rows).toEqual([
      ['Retenue 10 %', '10 % retenue', 'Achats', '', '444131'],
      ['TVA 18 %', '18 %', 'Ventes et achats', '443100', '445200'],
    ]);
  });

  it('list: « S’applique à : Ventes » asks for the taxes of sales and of both sides', async () => {
    const { list } = await open('/taxes?usage=ventes');
    const request = list();
    expect(request.request.params.getAll('type_tax_use')).toEqual(['sale', 'both']);
    request.flush(page([tax('TVA 18 %')]));
  });

  it('list: « Actif » switched from the row is a command, refused it goes back', async () => {
    const { element, stable, list } = await open('/taxes');
    list().flush(page([tax('TVA 18 %')]));
    await stable();
    const toggle = () => element.querySelector<HTMLInputElement>('input[role="switch"]')!;
    expect(toggle().getAttribute('aria-label')).toBe('Taxe TVA 18 % active');

    toggle().click();
    await stable();
    httpMock()
      .expectOne('/api/v1/taxes/t-TVA18/deactivate/')
      .flush(tax('TVA 18 %', { status: 'inactive' }));
    await stable();
    expect(toggle().checked).toBe(false);

    toggle().click();
    await stable();
    httpMock()
      .expectOne('/api/v1/taxes/t-TVA18/activate/')
      .flush(envelope('tax_inactive'), { status: 400, statusText: 'x' });
    await stable();
    expect(toggle().checked).toBe(false);
  });

  it('list: an empty list offers to create the taxes of Guinea in one click', async () => {
    const { element, stable, list } = await open('/taxes');
    list().flush(page([]));
    await stable();
    const button = Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
      (item) => item.textContent?.trim() === 'Créer les taxes de Guinée',
    )!;
    button.click();
    await stable();
    const create = httpMock().expectOne('/api/v1/accounting/default-taxes/');
    expect(create.request.method).toBe('POST');
    create.flush({ created: [tax('TVA 18 %')], existing: [] });
    await stable();
    // The list is read again, with the taxes created.
    list().flush(page([tax('TVA 18 %')]));
    await stable();
    expect(element.textContent).toContain('TVA 18 %');
  });

  it('form: a new tax — name, rate, use, the accounts of its sides, withholding', async () => {
    const { element, stable } = await open('/taxes/nouveau');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    await stable();
    const names = () =>
      Array.from(element.querySelectorAll('[formControlName]')).map((field) =>
        field.getAttribute('formControlName'),
      );
    expect(names()).toEqual([
      'name',
      'rate',
      'type_tax_use',
      'sale_account',
      'purchase_account',
      'withholding',
      'active',
    ]);
    const uses = element.querySelector<HTMLSelectElement>('[formControlName="type_tax_use"]')!;
    expect(Array.from(uses.options).map((option) => option.textContent?.trim())).toEqual([
      'Ventes et achats',
      'Ventes',
      'Achats',
    ]);

    fill(element, 'name', 'Retenue 10 %');
    fill(element, 'rate', '10');
    fill(element, 'type_tax_use', 'purchase');
    await stable();
    // A purchase tax has no account of sales.
    expect(names()).not.toContain('sale_account');
    element.querySelector<HTMLInputElement>('[formControlName="withholding"]')!.click();
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await stable();
    const create = httpMock().expectOne((req) => req.method === 'POST');
    expect(create.request.body).toEqual({
      name: 'Retenue 10 %',
      rate: '10',
      type_tax_use: 'purchase',
      sale_account_code: '',
      purchase_account_code: '',
      withholding: true,
    });
    create.flush(tax('Retenue 10 %', { type_tax_use: 'purchase', withholding: true }));
    await stable();
    expect(navigate).toHaveBeenCalledWith('/app/comptabilite/taxes/liste');
  });

  it('form: a tax changed on its page; « Actif » goes through its command', async () => {
    const { element, stable } = await open('/taxes/t-TVA18');
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    httpMock().expectOne('/api/v1/taxes/t-TVA18/').flush(tax('TVA 18 %'));
    await stable();
    expect(element.querySelector('h1')?.textContent).toContain('TVA 18 % · 18 %');
    expect(element.querySelector<HTMLInputElement>('[formControlName="rate"]')!.value).toBe('18');

    fill(element, 'rate', '20');
    element.querySelector<HTMLInputElement>('[formControlName="active"]')!.click();
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await stable();
    const patch = httpMock().expectOne('/api/v1/taxes/t-TVA18/');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({
      name: 'TVA 18 %',
      rate: '20',
      type_tax_use: 'both',
      sale_account_code: '443100',
      purchase_account_code: '445200',
      withholding: false,
    });
    patch.flush(tax('TVA 18 %', { rate: '20.0000' }));
    await stable();
    httpMock()
      .expectOne('/api/v1/taxes/t-TVA18/deactivate/')
      .flush(tax('TVA 18 %', { status: 'inactive' }));
    await stable();
  });

  it('form: without taxes.update the page is read only', async () => {
    const { element, stable } = await open('/taxes/t-TVA18', ['taxes.read']);
    httpMock().expectOne('/api/v1/taxes/t-TVA18/').flush(tax('TVA 18 %'));
    await stable();
    expect(element.querySelector<HTMLInputElement>('[formControlName="name"]')!.disabled).toBe(
      true,
    );
    const words = Array.from(element.querySelectorAll('button')).map((button) =>
      button.textContent?.trim(),
    );
    expect(words).not.toContain('Enregistrer');
    expect(words).toContain('Retour aux taxes');
  });
});
