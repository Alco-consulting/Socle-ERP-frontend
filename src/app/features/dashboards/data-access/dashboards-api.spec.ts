import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { httpMock, provideHttpTesting } from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { TEST_COMPANY, openTestSession } from '../../../core/session/testing';
import { DashboardsApi } from './dashboards-api';

const OTHER = { ...TEST_COMPANY, id: 'c2', name: 'Autre société' };

describe('DashboardsApi (dashboards/, read only)', () => {
  let api: DashboardsApi;
  let session: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideHttpTesting() });
    session = TestBed.inject(SessionStore);
    openTestSession(session, { companies: [TEST_COMPANY, OTHER] });
    api = TestBed.inject(DashboardsApi);
  });

  afterEach(() => httpMock().verify());

  it('journals: one GET for every journal, with the day of the balances', async () => {
    const answer = firstValueFrom(api.journals('2026-10-04'));
    const request = httpMock().expectOne((req) => req.url === '/api/v1/dashboards/journals/');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('on')).toBe('2026-10-04');
    expect(request.request.params.has('fiscal_year')).toBe(false);
    request.flush({ journals: [] });
    expect(await answer).toEqual({ journals: [] });
  });

  it('follows the active company: another company, another X-Company-ID', () => {
    void firstValueFrom(api.journals('2026-10-04'));
    httpMock()
      .expectOne((req) => req.headers.get('X-Company-ID') === 'c1')
      .flush({});
    openTestSession(session, { companies: [TEST_COMPANY, OTHER], activeCompanyId: 'c2' });
    void firstValueFrom(api.journals('2026-10-04'));
    httpMock()
      .expectOne((req) => req.headers.get('X-Company-ID') === 'c2')
      .flush({});
  });
});
