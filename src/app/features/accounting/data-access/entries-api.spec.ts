import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { clearCookie, httpMock, provideHttpTesting, setCookie } from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { TEST_COMPANY, openTestSession } from '../../../core/session/testing';
import { page, testEntry } from '../entries/entry-testing';
import { EntriesApi } from './entries-api';

const OTHER_COMPANY = { ...TEST_COMPANY, id: 'c2', name: 'Filiale' };

describe('EntriesApi (accounting/entries/, company scoped)', () => {
  let api: EntriesApi;
  let store: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideHttpTesting() });
    store = TestBed.inject(SessionStore);
    openTestSession(store, {
      permissions: ['accounting.read'],
      companies: [TEST_COMPANY, OTHER_COMPANY],
    });
    api = TestBed.inject(EntriesApi);
    setCookie('XSRF-TOKEN', 'tok');
  });

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  const one = (path: string, method = 'GET') =>
    httpMock().expectOne(
      (req) => req.url === `/api/v1/accounting/${path}` && req.method === method,
    );

  it('list: only the filters of the API (no text search), its pages', () => {
    void firstValueFrom(
      api.list({
        status: 'submitted',
        kind: 'reversal',
        journal: 'j-ach',
        fiscalYear: 'fy-2026',
        account: 'a-401',
        partner: 'pt-1',
        dateFrom: '2026-09-01',
        dateTo: '2026-09-30',
        page: 2,
      }),
    );
    const request = one('entries/');
    const params = request.request.params;
    expect(params.keys().sort()).toEqual([
      'account',
      'date_from',
      'date_to',
      'fiscal_year',
      'journal',
      'kind',
      'page',
      'page_size',
      'partner',
      'status',
    ]);
    expect(params.get('status')).toBe('submitted');
    expect(params.get('date_from')).toBe('2026-09-01');
    expect(params.get('page_size')).toBe('25');
    expect(request.request.headers.get('X-Company-ID')).toBe(TEST_COMPANY.id);
    request.flush(page());
  });

  it('no filter: no empty parameter sent', () => {
    void firstValueFrom(api.list());
    const request = one('entries/');
    expect(request.request.params.keys()).toEqual(['page_size']);
    request.flush(page());
  });

  it('the active company decides X-Company-ID: after a switch, the other company only', () => {
    void firstValueFrom(api.list());
    one('entries/').flush(page([testEntry('e-alpha')]));
    store.setCompanyContext({
      companies: [TEST_COMPANY, OTHER_COMPANY],
      defaultCompanyId: TEST_COMPANY.id,
      activeCompanyId: OTHER_COMPANY.id,
      permissions: ['accounting.read'],
      features: null,
    });
    firstValueFrom(api.get('e-alpha')).catch(() => undefined);
    const request = one('entries/e-alpha/');
    expect(request.request.headers.get('X-Company-ID')).toBe('c2');
    request.flush(
      { error: { code: 'not_found', message: 'x', details: null } },
      {
        status: 404,
        statusText: 'Not Found',
      },
    );
  });

  it('create, modify, delete a draft: the payload given, CSRF by the interceptor', async () => {
    const created = firstValueFrom(
      api.create({
        journal: 'j-ach',
        entry_date: '2026-09-28',
        description: 'Achat',
        lines: [
          { account: 'a-601', debit: '100' },
          { account: 'a-401', credit: '100' },
        ],
      }),
    );
    const post = one('entries/', 'POST');
    expect(post.request.headers.get('X-XSRF-TOKEN')).toBe('tok');
    expect(post.request.body.lines).toHaveLength(2);
    post.flush(testEntry('e-1'));
    expect((await created).public_id).toBe('e-1');

    void firstValueFrom(api.update('e-1', { description: 'Achat corrigé' }));
    const patch = one('entries/e-1/', 'PATCH');
    expect(patch.request.body).toEqual({ description: 'Achat corrigé' });
    patch.flush(testEntry('e-1'));

    void firstValueFrom(api.remove('e-1'));
    one('entries/e-1/', 'DELETE').flush(null, { status: 204, statusText: 'No Content' });
  });

  it('the workflow is the server’s commands, never a status written', () => {
    for (const command of ['submit', 'reject', 'validate', 'lock'] as const) {
      void firstValueFrom(api.run('e-1', command));
      const request = one(`entries/e-1/${command}/`, 'POST');
      expect(request.request.body).toBeNull();
      request.flush(testEntry('e-1'));
    }
    void firstValueFrom(api.reverse('e-1', { entry_date: '2026-10-01', reason: 'Erreur' }));
    const reverse = one('entries/e-1/reverse/', 'POST');
    expect(reverse.request.body).toEqual({ entry_date: '2026-10-01', reason: 'Erreur' });
    reverse.flush(testEntry('e-2', { kind: 'reversal' }));
    httpMock().expectNone((req) => req.method === 'PATCH');
  });

  it('settings and the references of the form: searched by the server', () => {
    void firstValueFrom(api.settings());
    one('settings/').flush({ submission_required: true, parent_accounts_postable: false });

    void firstValueFrom(api.postableAccounts('401'));
    const accounts = one('accounts/');
    expect(accounts.request.params.get('search')).toBe('401');
    expect(accounts.request.params.get('postable')).toBe('true');
    expect(accounts.request.params.get('status')).toBe('active');
    accounts.flush(page());

    void firstValueFrom(api.partners('frn'));
    const partners = httpMock().expectOne((req) => req.url === '/api/v1/partners/');
    expect(partners.request.params.get('search')).toBe('frn');
    expect(partners.request.params.get('status')).toBe('active');
    partners.flush(page());

    void firstValueFrom(api.partnerByCode('FRN-001'));
    const byCode = httpMock().expectOne((req) => req.url === '/api/v1/partners/');
    expect(byCode.request.params.get('code')).toBe('FRN-001');
    byCode.flush(page());

    void firstValueFrom(api.taxes());
    const taxes = httpMock().expectOne((req) => req.url === '/api/v1/taxes/');
    expect(taxes.request.params.get('status')).toBe('active');
    taxes.flush(page());
  });
});
