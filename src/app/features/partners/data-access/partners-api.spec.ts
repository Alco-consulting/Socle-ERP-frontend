import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { ApiError } from '../../../core/http/api-error';
import {
  clearCookie,
  envelope,
  httpMock,
  provideHttpTesting,
  setCookie,
} from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { TEST_COMPANY, openTestSession } from '../../../core/session/testing';
import { PartnerWrite } from './partner-models';
import { PartnersApi } from './partners-api';

const WRITE: PartnerWrite = {
  code: 'CLI-001',
  name: 'Société Test',
  legal_name: '',
  is_customer: true,
  is_supplier: false,
  tax_identifier: '',
  registration_number: '',
  country: 'GN',
  address: '',
  city: 'Conakry',
  phone: '',
  email: '',
  default_currency: null,
  customer_payment_days: 0,
  supplier_payment_days: 0,
  default_tax_code: '',
  customer_account_code: '',
  supplier_account_code: '',
};

describe('PartnersApi (partners/, company scoped)', () => {
  let api: PartnersApi;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideHttpTesting() });
    openTestSession(TestBed.inject(SessionStore), { permissions: ['partners.read'] });
    api = TestBed.inject(PartnersApi);
    setCookie('XSRF-TOKEN', 'tok');
  });

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('list: server-side search, filters and page; X-Company-ID from the core', async () => {
    const done = firstValueFrom(
      api.list({ search: 'dupont', role: 'customer', status: 'active', country: 'GN', page: 3 }),
    );
    const request = httpMock().expectOne((req) => req.url === '/api/v1/partners/');
    expect(request.request.params.keys().sort()).toEqual([
      'country',
      'page',
      'page_size',
      'role',
      'search',
      'status',
    ]);
    expect(request.request.params.get('search')).toBe('dupont');
    expect(request.request.params.get('role')).toBe('customer');
    expect(request.request.params.get('page')).toBe('3');
    expect(request.request.params.get('page_size')).toBe('20');
    expect(request.request.headers.get('X-Company-ID')).toBe(TEST_COMPANY.id);
    request.flush({ count: 0, next: null, previous: null, results: [] });
    expect((await done).count).toBe(0);
  });

  it('list: no empty criterion is sent, page 1 is implicit', () => {
    void firstValueFrom(api.list({ search: '', country: '', page: 1 }));
    const request = httpMock().expectOne((req) => req.url === '/api/v1/partners/');
    expect(request.request.params.keys()).toEqual(['page_size']);
    request.flush({ count: 0, next: null, previous: null, results: [] });
  });

  it('create: exactly the writable fields, with the CSRF token', () => {
    void firstValueFrom(api.create(WRITE));
    const request = httpMock().expectOne('/api/v1/partners/');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(WRITE);
    expect(Object.keys(request.request.body as object)).not.toContain('public_id');
    expect(request.request.headers.get('X-XSRF-TOKEN')).toBe('tok');
    request.flush({});
  });

  it('update: PATCH of the changed fields only', () => {
    void firstValueFrom(api.update('p-1', { phone: '622 00 00 00' }));
    const request = httpMock().expectOne('/api/v1/partners/p-1/');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ phone: '622 00 00 00' });
    request.flush({});
  });

  it('deactivate and reactivate: the commands of the API', () => {
    void firstValueFrom(api.deactivate('p-1'));
    const off = httpMock().expectOne('/api/v1/partners/p-1/deactivate/');
    expect(off.request.method).toBe('POST');
    off.flush({});
    void firstValueFrom(api.reactivate('p-1'));
    httpMock().expectOne('/api/v1/partners/p-1/reactivate/').flush({});
  });

  it('a partner of another company is a 404 of the server (never shown)', async () => {
    const done = firstValueFrom(api.get('other-company'));
    httpMock()
      .expectOne('/api/v1/partners/other-company/')
      .flush(envelope('not_found'), { status: 404, statusText: 'Not Found' });
    await expect(done).rejects.toBeInstanceOf(ApiError);
    await expect(done).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('currencies: the shared catalogue, without X-Company-ID', () => {
    void firstValueFrom(api.currencies());
    const request = httpMock().expectOne((req) => req.url === '/api/v1/currencies/');
    expect(request.request.headers.has('X-Company-ID')).toBe(false);
    request.flush({ count: 0, next: null, previous: null, results: [] });
  });
});
