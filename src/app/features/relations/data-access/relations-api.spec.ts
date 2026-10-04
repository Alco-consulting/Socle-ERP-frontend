import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { httpMock, provideHttpTesting } from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { TEST_COMPANY, openTestSession } from '../../../core/session/testing';
import { RelationsApi } from './relations-api';

const OTHER = { ...TEST_COMPANY, id: 'c2', name: 'Autre société' };
const page = (count: number) => ({ count, next: null, previous: null, results: [{}] });

describe('RelationsApi (smart buttons: one request per relation)', () => {
  let api: RelationsApi;
  let session: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideHttpTesting() });
    session = TestBed.inject(SessionStore);
    openTestSession(session, { companies: [TEST_COMPANY, OTHER] });
    api = TestBed.inject(RelationsApi);
  });

  afterEach(() => httpMock().verify());

  it('counts the entries of a journal, an account or a partner: the server’s count', async () => {
    for (const filter of [{ journal: 'j-1' }, { account: 'a-1' }, { partner: 'p-1' }]) {
      const count = firstValueFrom(api.entryCount('draft', filter));
      const request = httpMock().expectOne((req) => req.url === '/api/v1/accounting/entries/');
      const [name, value] = Object.entries(filter)[0];
      expect(request.request.params.get(name)).toBe(value);
      expect(request.request.params.get('status')).toBe('draft');
      expect(request.request.params.get('page_size')).toBe('1');
      request.flush(page(37));
      expect(await count).toBe(37);
    }
  });

  it('without a status: every entry of the object', () => {
    void firstValueFrom(api.entryCount(null, { account: 'a-1' }));
    const request = httpMock().expectOne((req) => req.url === '/api/v1/accounting/entries/');
    expect(request.request.params.has('status')).toBe(false);
    request.flush(page(0));
  });

  it('the collective accounts of a partner, as the server checks them', async () => {
    const accounts = firstValueFrom(api.collectiveAccounts('p-1'));
    httpMock()
      .expectOne('/api/v1/accounting/partners/p-1/accounts/')
      .flush([{ role: 'customer', code: '411', account: null, postable: false }]);
    expect((await accounts)[0].code).toBe('411');
  });

  it('follows the active company (X-Company-ID), and only it', () => {
    void firstValueFrom(api.collectiveAccounts('p-1'));
    httpMock()
      .expectOne((req) => req.headers.get('X-Company-ID') === 'c1')
      .flush([]);
    openTestSession(session, { companies: [TEST_COMPANY, OTHER], activeCompanyId: 'c2' });
    void firstValueFrom(api.collectiveAccounts('p-1'));
    httpMock()
      .expectOne((req) => req.headers.get('X-Company-ID') === 'c2')
      .flush([]);
  });
});
