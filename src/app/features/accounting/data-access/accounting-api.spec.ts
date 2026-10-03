import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { clearCookie, httpMock, provideHttpTesting, setCookie } from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { TEST_COMPANY, openTestSession } from '../../../core/session/testing';
import { AccountingApi } from './accounting-api';

const page = (results: unknown[] = [], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});

describe('AccountingApi (accounting/, company scoped)', () => {
  let api: AccountingApi;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideHttpTesting() });
    openTestSession(TestBed.inject(SessionStore), { permissions: ['accounting.read'] });
    api = TestBed.inject(AccountingApi);
    setCookie('XSRF-TOKEN', 'tok');
  });

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  const expect1 = (path: string) =>
    httpMock().expectOne((req) => req.url === `/api/v1/accounting/${path}`);

  it('accounts: the server’s search, filters and page; X-Company-ID from the core', () => {
    void firstValueFrom(
      api.accounts({
        search: '401',
        status: 'active',
        accountType: 'liability',
        postable: true,
        page: 2,
      }),
    );
    const request = expect1('accounts/');
    const params = request.request.params;
    expect(params.get('search')).toBe('401');
    expect(params.get('status')).toBe('active');
    expect(params.get('account_type')).toBe('liability');
    expect(params.get('postable')).toBe('true');
    expect(params.get('page')).toBe('2');
    expect(params.get('page_size')).toBe('50');
    expect(request.request.headers.get('X-Company-ID')).toBe(TEST_COMPANY.id);
    request.flush(page());
  });

  it('journals: type, state, exact code (no text search in the API)', () => {
    void firstValueFrom(api.journals({ journalType: 'bank', status: 'inactive', code: 'BQ1' }));
    const request = expect1('journals/');
    expect(request.request.params.keys().sort()).toEqual([
      'code',
      'journal_type',
      'page_size',
      'status',
    ]);
    request.flush(page());
  });

  it('periods of one fiscal year; open fiscal years', () => {
    void firstValueFrom(api.fiscalYears('open'));
    const years = expect1('fiscal-years/');
    expect(years.request.params.get('status')).toBe('open');
    years.flush(page());
    void firstValueFrom(api.periods('fy-1'));
    const periods = expect1('periods/');
    expect(periods.request.params.get('fiscal_year')).toBe('fy-1');
    periods.flush(page());
  });

  it('counts come from the server (`count` of a one-row page), nothing is counted here', async () => {
    const drafts = firstValueFrom(api.entryCount('draft'));
    const request = expect1('entries/');
    expect(request.request.params.get('status')).toBe('draft');
    expect(request.request.params.get('page_size')).toBe('1');
    request.flush(page([{}], 37));
    expect(await drafts).toBe(37);

    const postable = firstValueFrom(api.accountCount(true));
    const accounts = expect1('accounts/');
    expect(accounts.request.params.get('postable')).toBe('true');
    accounts.flush(page([{}], 812));
    expect(await postable).toBe(812);
  });

  it('a parent is found by its exact code, on the server', async () => {
    const found = firstValueFrom(api.accountByCode('401'));
    const request = expect1('accounts/');
    expect(request.request.params.get('code')).toBe('401');
    request.flush(page([{ public_id: 'a-401', code: '401' }]));
    expect((await found)?.public_id).toBe('a-401');
  });

  it('hierarchy: the direct children the server keeps', () => {
    void firstValueFrom(api.children('a-40', 2));
    const request = expect1('accounts/a-40/children/');
    expect(request.request.params.get('page')).toBe('2');
    request.flush(page());
  });

  it('writes: POST, PATCH of the changes, status commands, with CSRF', () => {
    void firstValueFrom(
      api.createJournal({
        code: 'ACH',
        name: 'Achats',
        journal_type: 'purchase',
        default_currency: null,
        sequence_prefix: 'ACH-',
        sequence_padding: 6,
      }),
    );
    const create = expect1('journals/');
    expect(create.request.method).toBe('POST');
    expect(create.request.headers.get('X-XSRF-TOKEN')).toBe('tok');
    create.flush({});

    void firstValueFrom(api.updateAccount('a-1', { name: 'Fournisseurs' }));
    const patch = expect1('accounts/a-1/');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ name: 'Fournisseurs' });
    patch.flush({});

    void firstValueFrom(api.setJournalActive('j-1', false));
    expect1('journals/j-1/deactivate/').flush({});
    void firstValueFrom(api.setAccountActive('a-1', true));
    expect1('accounts/a-1/reactivate/').flush({});
  });
});
