import { TestBed } from '@angular/core/testing';

import { envelope, httpMock, provideHttpTesting } from '../http/testing';
import { SessionStore } from '../session/session.store';
import { CompanyContextService } from './company-context.service';

const A = {
  public_id: 'aaaaaaaa-0000-4000-8000-000000000001',
  legal_name: 'Société A SARL',
  trade_name: '',
  country: 'GN',
  reference_currency: 'GNF',
  status: 'active',
};
const B = {
  ...A,
  public_id: 'bbbbbbbb-0000-4000-8000-000000000002',
  legal_name: 'Société B SA',
  reference_currency: 'XOF',
};

const contextOf = (company: typeof A, permissions: string[]) => ({
  current: { company, permissions },
  default_company: A.public_id,
  companies: [A, B],
});

describe('CompanyContextService (X-Company-ID)', () => {
  let service: CompanyContextService;
  let store: SessionStore;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: provideHttpTesting() });
    service = TestBed.inject(CompanyContextService);
    store = TestBed.inject(SessionStore);
    store.load({
      user: { displayName: 'T', email: 't@example.org' },
      companies: [],
      activeCompanyId: '',
    });
  });

  afterEach(() => httpMock().verify());

  it('loads the default company and its permissions (only the current one has them)', async () => {
    const done = service.load();
    httpMock()
      .expectOne('/api/v1/company-context/')
      .flush(contextOf(A, ['accounting.read']));
    await done;
    expect(service.companyId()).toBe(A.public_id);
    expect(store.activeCompany()?.name).toBe('Société A SARL'); // legal name when no trade name
    expect(store.companies().find((c) => c.id === B.public_id)?.permissions).toEqual([]);
    expect(store.can('accounting.read')).toBe(true);
  });

  it('select(): asks the context of that company with X-Company-ID and remembers it', async () => {
    const done = service.select(B.public_id);
    const request = httpMock().expectOne('/api/v1/company-context/');
    expect(request.request.headers.get('X-Company-ID')).toBe(B.public_id);
    request.flush(contextOf(B, ['reporting.read']));
    await done;
    expect(service.companyId()).toBe(B.public_id);
    expect(store.can('reporting.read')).toBe(true);
    expect(store.can('accounting.read')).toBe(false);
    expect(localStorage.getItem('alco.company')).toBe(B.public_id);
  });

  it('a remembered company that is no longer accessible falls back to the default one', async () => {
    localStorage.setItem('alco.company', B.public_id);
    const done = service.load();
    const refused = httpMock().expectOne('/api/v1/company-context/');
    expect(refused.request.headers.get('X-Company-ID')).toBe(B.public_id);
    refused.flush(envelope('company_access_denied'), { status: 403, statusText: 'Forbidden' });
    await Promise.resolve();
    await Promise.resolve();
    const retry = httpMock().expectOne('/api/v1/company-context/');
    expect(retry.request.headers.has('X-Company-ID')).toBe(false);
    retry.flush(contextOf(A, []));
    await done;
    expect(service.companyId()).toBe(A.public_id);
    expect(localStorage.getItem('alco.company')).toBeNull();
  });

  it('a refused selection is an error, never a silent switch', async () => {
    const done = service.select(B.public_id);
    httpMock()
      .expectOne('/api/v1/company-context/')
      .flush(envelope('company_access_denied'), { status: 403, statusText: 'x' });
    await expect(done).rejects.toMatchObject({ code: 'company_access_denied' });
    expect(service.companyId()).toBeNull();
  });
});

describe('CompanyContextService (prototype)', () => {
  it('switches locally, without network', async () => {
    TestBed.configureTestingModule({
      providers: provideHttpTesting({ sessionSource: 'prototype' }),
    });
    const store = TestBed.inject(SessionStore);
    store.load({
      user: { displayName: 'T', email: 't@example.org' },
      companies: [
        {
          id: 'x',
          name: 'X',
          fiscalYearLabel: '',
          currency: 'GNF',
          permissions: [],
          features: null,
        },
        {
          id: 'y',
          name: 'Y',
          fiscalYearLabel: '',
          currency: 'GNF',
          permissions: [],
          features: null,
        },
      ],
      activeCompanyId: 'x',
    });
    await TestBed.inject(CompanyContextService).select('y');
    expect(store.activeCompany()?.id).toBe('y');
    httpMock().verify();
  });
});
