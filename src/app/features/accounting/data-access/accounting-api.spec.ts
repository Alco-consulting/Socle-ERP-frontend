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

  it('open fiscal years', () => {
    void firstValueFrom(api.fiscalYears('open'));
    const years = expect1('fiscal-years/');
    expect(years.request.params.get('status')).toBe('open');
    years.flush(page());
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

  it('journals: the usual ones in one call; the default accounts of a type', async () => {
    void firstValueFrom(api.createUsualJournals());
    const usual = expect1('default-journals/');
    expect(usual.request.method).toBe('POST');
    usual.flush({ created: [], existing: [] });

    // A selection list: every page of the type's accounts (200 at a time), joined.
    let banks: readonly { code: string }[] = [];
    void firstValueFrom(api.journalAccounts('bank')).then((list) => (banks = list));
    const first = expect1('accounts/');
    const params = first.request.params;
    expect([params.get('account_type'), params.get('detailed_type')]).toEqual([null, 'asset_cash']);
    expect([params.get('postable'), params.get('status'), params.get('page_size')]).toEqual([
      'true',
      'active',
      '200',
    ]);
    expect(params.has('page')).toBe(false);
    first.flush(page([{ code: '521101' }], 201));
    const second = expect1('accounts/');
    expect(second.request.params.get('page')).toBe('2');
    second.flush(page([{ code: '521102' }], 201));
    await Promise.resolve();
    expect(banks.map((account) => account.code)).toEqual(['521101', '521102']);

    void firstValueFrom(api.journalAccounts('cash'));
    const cash = expect1('accounts/');
    expect([
      cash.request.params.get('account_type'),
      cash.request.params.get('detailed_type'),
    ]).toEqual([null, 'asset_cash']);
    cash.flush(page());

    // Sales, purchases, miscellaneous operations: no account (note backend 0038), no request.
    for (const type of ['sales', 'purchase', 'general'] as const) {
      expect(await firstValueFrom(api.journalAccounts(type))).toEqual([]);
    }
  });

  it('writes: POST, PATCH of the changes, status commands, with CSRF', () => {
    void firstValueFrom(
      api.createJournal({
        code: 'ACH',
        name: 'Achats',
        journal_type: 'purchase',
        default_currency: null,
        default_account: null,
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
