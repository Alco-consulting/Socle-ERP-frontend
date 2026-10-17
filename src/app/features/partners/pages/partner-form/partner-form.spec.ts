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
  customer_account_code: '',
  supplier_account_code: '',
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
};

const EMPTY = { count: 0, next: null, previous: null, results: [] };

const NO_ACCOUNTS: Record<string, object[]> = { asset_receivable: [], liability_payable: [] };
const ACCOUNTS: Record<string, object[]> = {
  asset_receivable: [
    { public_id: 'a-411', code: '411100', name: 'Clients' },
    { public_id: 'a-416', code: '416000', name: 'Clients douteux' },
  ],
  liability_payable: [{ public_id: 'a-401', code: '401100', name: 'Fournisseurs' }],
};

describe('PartnerFormPage (creation and modification)', () => {
  let navigate: ReturnType<typeof vi.spyOn>;

  async function open(url: string, accounts: Record<string, object[]> = NO_ACCOUNTS) {
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
    // The chart's customer and supplier accounts (note backend 0045).
    for (const [type, results] of Object.entries(accounts)) {
      httpMock()
        .expectOne(
          (req) =>
            req.url === '/api/v1/accounting/accounts/' && req.params.get('detailed_type') === type,
        )
        .flush({ ...EMPTY, results });
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

  it('creation: no code, country, default tax nor collective account to enter', async () => {
    const { element } = await open('/nouveau');
    for (const name of [
      'code',
      'country',
      'default_tax_code',
      'customer_account_code',
      'supplier_account_code',
    ]) {
      expect(element.querySelector(`[formControlName="${name}"]`)).toBeNull();
    }
    expect(element.textContent).toContain('Le code du contact est attribué à l’enregistrement.');
  });

  it('creation: exactly the writable fields, trimmed; then the new record', async () => {
    const { stable, type, submit, element } = await open('/nouveau');
    type('name', ' Diallo et Cie ');
    element.querySelector<HTMLInputElement>('[formControlName="is_supplier"]')!.click();
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
    });
    request.flush({ ...PARTNER, public_id: 'p-2', code: 'FRN-00001', name: 'Diallo et Cie' });
    await stable();
    expect(navigate).toHaveBeenCalledWith(['/app/contacts/liste', 'p-2']);
    expect(TestBed.inject(AlcoToastService).toasts()[0]?.message).toBe(
      'Contact « Diallo et Cie » créé.',
    );
  });

  it('as Odoo: the collective accounts to choose, the chart’s first ones by default', async () => {
    const { element, stable, type, submit } = await open('/nouveau', ACCOUNTS);
    const select = (name: string) =>
      element.querySelector<HTMLSelectElement>(`select[formControlName="${name}"]`)!;
    expect(select('customer_account_code').value).toBe('411100');
    expect(select('supplier_account_code').value).toBe('401100');
    expect(Array.from(select('customer_account_code').options).map((item) => item.text)).toEqual([
      '411100 Clients',
      '416000 Clients douteux',
    ]);
    select('customer_account_code').value = '416000';
    select('customer_account_code').dispatchEvent(new Event('change'));
    type('name', 'Client douteux');
    submit();
    await stable();
    const request = httpMock().expectOne('/api/v1/partners/');
    expect(request.request.body).toMatchObject({
      customer_account_code: '416000',
      supplier_account_code: '401100',
    });
    request.flush({ ...PARTNER, public_id: 'p-9' });
    await stable();
  });

  it('tags as Odoo: searched, created on the fly, sent by their ids', async () => {
    const { element, stable, type, submit } = await open('/nouveau');
    const tags = element.querySelector<HTMLInputElement>('alco-tags-field input')!;
    tags.value = 'Gross';
    tags.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 250));
    httpMock()
      .expectOne((req) => req.url === '/api/v1/partners/tags/')
      .flush({ ...EMPTY, results: [] });
    await stable();
    const create = Array.from(element.querySelectorAll('alco-tags-field [role="option"]')).find(
      (option) => option.textContent?.includes('Créer « Gross »'),
    ) as HTMLElement;
    create.click();
    await stable();
    const created = httpMock().expectOne(
      (req) => req.url === '/api/v1/partners/tags/' && req.method === 'POST',
    );
    expect(created.request.body).toEqual({ name: 'Gross' });
    created.flush({ public_id: 't-1', name: 'Gross' });
    await stable();
    httpMock()
      .match((req) => req.url === '/api/v1/partners/tags/')
      .forEach((request) => request.flush({ ...EMPTY, results: [] }));
    expect(element.querySelector('alco-tags-field .chip')?.textContent).toContain('Gross');
    type('name', 'Grossiste Madina');
    submit();
    await stable();
    const request = httpMock().expectOne('/api/v1/partners/');
    expect(request.request.body).toMatchObject({ tags: ['t-1'] });
    request.flush({ ...PARTNER, public_id: 'p-10' });
    await stable();
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
