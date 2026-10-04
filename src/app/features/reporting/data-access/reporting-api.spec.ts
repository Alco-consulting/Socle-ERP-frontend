import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { httpMock, provideHttpTesting } from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { openTestSession } from '../../../core/session/testing';
import { ReportingApi } from './reporting-api';

describe('ReportingApi (one ledger experience, on Reporting’s paginated reports)', () => {
  let api: ReportingApi;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideHttpTesting() });
    openTestSession(TestBed.inject(SessionStore));
    api = TestBed.inject(ReportingApi);
  });

  afterEach(() => httpMock().verify());

  it('an account’s ledger: the fiscal year given, never implied; pages of the server', () => {
    void firstValueFrom(
      api.accountLedger('a-401', { fiscalYear: 'fy-1', page: 2, includeDescendants: true }),
    );
    const request = httpMock().expectOne((req) => req.url === '/api/v1/reporting/ledger/a-401/');
    expect(request.request.params.get('fiscal_year')).toBe('fy-1');
    expect(request.request.params.get('page')).toBe('2');
    expect(request.request.params.get('page_size')).toBe('50');
    expect(request.request.params.get('include_descendants')).toBe('true');
    expect(request.request.headers.get('X-Company-ID')).toBe('c1');
    request.flush({});
  });

  it('a partner’s ledger (reporting.read_auxiliary)', () => {
    void firstValueFrom(api.partnerLedger('p-1', { fiscalYear: 'fy-1' }));
    const request = httpMock().expectOne(
      (req) => req.url === '/api/v1/reporting/partners/p-1/ledger/',
    );
    expect(request.request.params.get('fiscal_year')).toBe('fy-1');
    expect(request.request.params.has('page')).toBe(false);
    expect(request.request.params.has('include_descendants')).toBe(false);
    request.flush({});
  });
});
