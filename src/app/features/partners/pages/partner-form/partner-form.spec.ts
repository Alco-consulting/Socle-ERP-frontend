import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import {
  clearCookie,
  envelope,
  httpMock,
  provideHttpTesting,
  setCookie,
} from '../../../../core/http/testing';
import { SessionStore } from '../../../../core/session/session.store';
import { openTestSession } from '../../../../core/session/testing';
import { AlcoToastService } from '../../../../shared/ui/toast/toast.service';
import { Partner } from '../../data-access/partner-models';
import { PartnerFormPage } from './partner-form';

const PARTNER: Partner = {
  public_id: 'p-1',
  code: 'CLI-001',
  name: 'Dupont SARL',
  legal_name: '',
  is_customer: true,
  is_supplier: false,
  country: 'GN',
  tax_identifier: '',
  status: 'active',
  registration_number: '',
  address: '',
  city: 'Conakry',
  phone: '',
  email: '',
  default_currency: null,
  customer_payment_term: null,
  supplier_payment_term: null,
  default_tax_code: '',
  customer_account_code: '411100',
  supplier_account_code: '',
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
};

const EMPTY = { count: 0, next: null, previous: null, results: [] };

describe('PartnerFormPage (creation and modification)', () => {
  let navigate: ReturnType<typeof vi.spyOn>;

  async function open(url: string) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          { path: 'nouveau', component: PartnerFormPage },
          { path: 'liste/:id/modifier', component: PartnerFormPage },
        ]),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), {
      permissions: ['partners.read', 'partners.create', 'partners.update'],
    });
    setCookie('XSRF-TOKEN', 'tok');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    httpMock()
      .expectOne((req) => req.url === '/api/v1/currencies/')
      .flush({
        ...EMPTY,
        results: [
          { code: 'GNF', name: 'Franc guinéen', status: 'active' },
          { code: 'XXX', name: 'Retirée', status: 'inactive' },
        ],
      });
    httpMock()
      .expectOne((req) => req.url === '/api/v1/partners/payment-terms/')
      .flush(EMPTY);
    // The collective accounts offered: receivable for a customer, payable for a supplier.
    for (const request of httpMock().match((req) => req.url === '/api/v1/accounting/accounts/')) {
      const receivable = request.request.params.get('detailed_type') === 'asset_receivable';
      request.flush({
        ...EMPTY,
        count: 1,
        results: [
          receivable
            ? { public_id: 'a-411', code: '411100', name: 'Clients' }
            : { public_id: 'a-401', code: '401100', name: 'Fournisseurs' },
        ],
      });
    }
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const element = harness.routeNativeElement as HTMLElement;
    // The save is an async method: its promises settle first, then the view.
    const stable = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await harness.fixture.whenStable();
    };
    const field = (name: string) =>
      element.querySelector<HTMLInputElement>(`[formControlName="${name}"]`)!;
    const type = (name: string, value: string) => {
      const input = field(name);
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const submit = () =>
      element.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await stable();
    return { harness, element, stable, field, type, submit };
  }

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('checks the obvious before sending: required fields, formats', async () => {
    const { element, stable, type, submit, field } = await open('/nouveau');
    type('email', 'pas-une-adresse');
    type('phone', 'appeler Mariam');
    submit();
    await stable();
    httpMock().expectNone('/api/v1/partners/');
    expect(element.textContent).toContain('Certaines informations sont manquantes ou incorrectes.');
    expect(element.textContent).toContain('Saisissez une adresse e-mail valide.');
    expect(element.textContent).toContain('Chiffres, espaces et + ( ) . - seulement.');
    expect(field('name').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field('name'));
  });

  it('creation: no code, country nor default tax; each role asks its account', async () => {
    const { element, stable, submit } = await open('/nouveau');
    for (const name of ['code', 'country', 'default_tax_code']) {
      expect(element.querySelector(`[formControlName="${name}"]`)).toBeNull();
    }
    expect(element.textContent).toContain('Le code du tiers est attribué à l’enregistrement.');
    const select = (name: string) =>
      element.querySelector<HTMLSelectElement>(`select[formControlName="${name}"]`);
    const options = (name: string) =>
      Array.from(select(name)?.options ?? []).map((option) => option.textContent?.trim());
    expect(select('customer_account_code')).toBeNull();
    expect(select('supplier_account_code')).toBeNull();

    element.querySelector<HTMLInputElement>('[formControlName="is_customer"]')!.click();
    element.querySelector<HTMLInputElement>('[formControlName="is_supplier"]')!.click();
    await stable();
    expect(options('customer_account_code')).toEqual(['Choisir un compte', '411100 — Clients']);
    expect(options('supplier_account_code')).toEqual([
      'Choisir un compte',
      '401100 — Fournisseurs',
    ]);
    // Required: nothing is sent without them.
    const name = element.querySelector<HTMLInputElement>('[formControlName="name"]')!;
    name.value = 'Mixte';
    name.dispatchEvent(new Event('input'));
    submit();
    await stable();
    httpMock().expectNone('/api/v1/partners/');
    expect(select('customer_account_code')!.getAttribute('aria-invalid')).toBe('true');
    expect(select('supplier_account_code')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('creation: exactly the writable fields, trimmed; then the new record', async () => {
    const { stable, type, submit, element } = await open('/nouveau');
    type('name', ' Diallo et Cie ');
    element.querySelector<HTMLInputElement>('[formControlName="is_supplier"]')!.click();
    await stable();
    const payable = element.querySelector<HTMLSelectElement>(
      '[formControlName="supplier_account_code"]',
    )!;
    payable.value = '401100';
    payable.dispatchEvent(new Event('change'));
    submit();
    await stable();
    const request = httpMock().expectOne('/api/v1/partners/');
    expect(request.request.method).toBe('POST');
    // No code (the server numbers it) and no country (the company's).
    expect(request.request.body).toEqual({
      name: 'Diallo et Cie',
      legal_name: '',
      is_customer: false,
      is_supplier: true,
      tax_identifier: '',
      registration_number: '',
      address: '',
      city: '',
      phone: '',
      email: '',
      default_currency: null,
      customer_payment_term: null,
      supplier_payment_term: null,
      customer_account_code: '',
      supplier_account_code: '401100',
    });
    request.flush({ ...PARTNER, public_id: 'p-2', code: 'FRN-00001', name: 'Diallo et Cie' });
    await stable();
    expect(navigate).toHaveBeenCalledWith(['/app/tiers/liste', 'p-2']);
    expect(TestBed.inject(AlcoToastService).toasts()[0]?.message).toBe(
      'Tiers « Diallo et Cie » créé.',
    );
  });

  it('a double click sends one request; the button says it is saving', async () => {
    const { stable, type, submit, element } = await open('/nouveau');
    type('name', 'Test');
    submit();
    submit();
    await stable();
    const request = httpMock().expectOne('/api/v1/partners/');
    expect(element.textContent).toContain('Enregistrement…');
    request.flush({ ...PARTNER, public_id: 'p-3' });
  });

  it('server field errors go under their field; a used code is said above', async () => {
    const { stable, type, submit, element, field } = await open('/nouveau');
    type('name', 'Test');
    submit();
    await stable();
    httpMock()
      .expectOne('/api/v1/partners/')
      .flush(envelope('partner_code_exists'), { status: 400, statusText: 'x' });
    await stable();
    expect(element.textContent).toContain('Ce code est déjà utilisé');

    type('email', 'a@b.co');
    submit();
    await stable();
    httpMock()
      .expectOne('/api/v1/partners/')
      .flush(
        {
          error: {
            code: 'validation_error',
            message: 'Invalid input.',
            details: { email: [{ message: 'Enter a valid email address.', code: 'invalid' }] },
            correlation_id: 'c',
          },
        },
        { status: 400, statusText: 'x' },
      );
    await stable();
    expect(element.textContent).toContain('Saisissez une adresse e-mail valide.');
    expect(element.textContent).not.toContain('Enter a valid email address.');
    expect(document.activeElement).toBe(field('email'));
  });

  it('modification: the code is fixed, only the changed fields are sent', async () => {
    const { stable, type, submit, element } = await open('/liste/p-1/modifier');
    httpMock().expectOne('/api/v1/partners/p-1/').flush(PARTNER);
    await stable();
    expect(element.querySelector('[formControlName="code"]')).toBeNull();
    expect(element.textContent).toContain('CLI-001');
    type('phone', '+224 622 00 00 00');
    submit();
    await stable();
    const request = httpMock().expectOne('/api/v1/partners/p-1/');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ phone: '+224 622 00 00 00' });
    request.flush(PARTNER);
    await stable();
    expect(navigate).toHaveBeenCalledWith(['..'], expect.anything());
  });

  it('modification without change: nothing sent', async () => {
    const { stable, submit } = await open('/liste/p-1/modifier');
    httpMock().expectOne('/api/v1/partners/p-1/').flush(PARTNER);
    await stable();
    submit();
    await stable();
    httpMock().expectNone('/api/v1/partners/p-1/');
    expect(TestBed.inject(AlcoToastService).toasts()[0]?.message).toBe(
      'Aucune modification à enregistrer.',
    );
  });

  it('only active currencies are offered', async () => {
    const { element } = await open('/nouveau');
    const options = Array.from(
      element.querySelectorAll('[formControlName="default_currency"] option'),
    ).map((option) => option.textContent?.trim());
    expect(options).toEqual(['Devise de la société', 'GNF — Franc guinéen']);
  });
});
