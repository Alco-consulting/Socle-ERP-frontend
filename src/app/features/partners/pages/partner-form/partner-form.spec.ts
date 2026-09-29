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
    type('country', 'Guinée');
    type('email', 'pas-une-adresse');
    type('phone', 'appeler Mariam');
    submit();
    await stable();
    httpMock().expectNone('/api/v1/partners/');
    expect(element.textContent).toContain('Certaines informations sont manquantes ou incorrectes.');
    expect(element.textContent).toContain('Saisissez le code pays à 2 lettres (ex. GN).');
    expect(element.textContent).toContain('Saisissez une adresse e-mail valide.');
    expect(element.textContent).toContain('Chiffres, espaces et + ( ) . - seulement.');
    expect(field('code').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field('code'));
  });

  it('creation: exactly the writable fields, trimmed; then the new record', async () => {
    const { stable, type, submit, element } = await open('/nouveau');
    type('code', ' cli-002 ');
    type('name', ' Diallo et Cie ');
    type('country', 'gn');
    element.querySelector<HTMLInputElement>('[formControlName="is_supplier"]')!.click();
    submit();
    await stable();
    const request = httpMock().expectOne('/api/v1/partners/');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      code: 'cli-002',
      name: 'Diallo et Cie',
      legal_name: '',
      is_customer: false,
      is_supplier: true,
      tax_identifier: '',
      registration_number: '',
      country: 'gn',
      address: '',
      city: '',
      phone: '',
      email: '',
      default_currency: null,
      customer_payment_term: null,
      supplier_payment_term: null,
      default_tax_code: '',
      customer_account_code: '',
      supplier_account_code: '',
    });
    request.flush({ ...PARTNER, public_id: 'p-2', code: 'CLI-002', name: 'Diallo et Cie' });
    await stable();
    expect(navigate).toHaveBeenCalledWith(['/app/tiers/liste', 'p-2']);
    expect(TestBed.inject(AlcoToastService).toasts()[0]?.message).toBe(
      'Tiers « Diallo et Cie » créé.',
    );
  });

  it('a double click sends one request; the button says it is saving', async () => {
    const { stable, type, submit, element } = await open('/nouveau');
    type('code', 'CLI-003');
    type('name', 'Test');
    type('country', 'GN');
    submit();
    submit();
    await stable();
    const request = httpMock().expectOne('/api/v1/partners/');
    expect(element.textContent).toContain('Enregistrement…');
    request.flush({ ...PARTNER, public_id: 'p-3' });
  });

  it('server field errors go under their field; a used code under the code', async () => {
    const { stable, type, submit, element, field } = await open('/nouveau');
    type('code', 'CLI-001');
    type('name', 'Test');
    type('country', 'GN');
    submit();
    await stable();
    httpMock()
      .expectOne('/api/v1/partners/')
      .flush(envelope('partner_code_exists'), { status: 400, statusText: 'x' });
    await stable();
    expect(element.textContent).toContain(
      'Ce code est déjà utilisé par un autre tiers de la société.',
    );
    expect(field('code').getAttribute('aria-invalid')).toBe('true');

    type('code', 'CLI-009');
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
