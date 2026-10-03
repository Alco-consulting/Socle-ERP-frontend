import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import {
  clearCookie,
  envelope,
  httpMock,
  provideHttpTesting,
  setCookie,
} from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { openTestSession } from '../../../core/session/testing';
import { Account } from '../data-access/accounting-models';
import { AccountDetailPage } from './account-detail';
import { AccountFormPage } from './account-form';
import { AccountListPage } from './account-list';

const account = (code: string, name: string, extra: Partial<Account> = {}): Account => ({
  public_id: `a-${code}`,
  code,
  name,
  description: '',
  parent: null,
  account_type: 'liability',
  account_class: code.charAt(0),
  allow_entries: true,
  status: 'active',
  has_children: false,
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
  ...extra,
});
const page = (results: unknown[] = [], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const MANAGE = ['accounting.read', 'accounting.manage_accounts'];

describe('Plan comptable (accounting/accounts/)', () => {
  async function open(url: string, permissions = MANAGE) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          {
            path: 'plan-comptable',
            data: { breadcrumb: 'Plan comptable' },
            children: [
              { path: '', component: AccountListPage },
              { path: 'nouveau', component: AccountFormPage },
              {
                path: ':id',
                data: { breadcrumb: 'Compte' },
                children: [
                  { path: '', component: AccountDetailPage },
                  { path: 'modifier', component: AccountFormPage },
                ],
              },
            ],
          },
        ]),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), { permissions });
    setCookie('XSRF-TOKEN', 'tok');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const element = harness.routeNativeElement as HTMLElement;
    const stable = async () => {
      await settle();
      await harness.fixture.whenStable();
    };
    const accounts = () =>
      httpMock().expectOne((req) => req.url === '/api/v1/accounting/accounts/');
    return { element, stable, accounts };
  }

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('list: search, state, type and « imputable » go to the server', async () => {
    const { accounts } = await open(
      '/plan-comptable?q=fourn&etat=active&type=liability&imputable=oui&page=3',
    );
    const request = accounts();
    const params = request.request.params;
    expect(params.get('search')).toBe('fourn');
    expect(params.get('status')).toBe('active');
    expect(params.get('account_type')).toBe('liability');
    expect(params.get('postable')).toBe('true');
    expect(params.get('page')).toBe('3');
    expect(params.get('page_size')).toBe('50');
    request.flush(page([], 0));
  });

  it('list: rows of the API, sub-accounts said, grouped by the class it gives', async () => {
    const { accounts, element, stable } = await open('/plan-comptable?groupe=classe');
    accounts().flush(
      page([
        account('40', 'Fournisseurs', { has_children: true, allow_entries: false }),
        account('401', 'Fournisseurs, dettes'),
        account('601', 'Achats', { account_type: 'expense', account_class: '6' }),
      ]),
    );
    await stable();
    const text = element.textContent ?? '';
    expect(text).toContain('sous-comptes');
    expect(text).toContain('Non autorisée');
    expect(text).toContain('Classe 4');
    expect(text).toContain('Classe 6');
  });

  it('record: its parent and its sub-accounts, as the server keeps them', async () => {
    const { element, stable } = await open('/plan-comptable/a-40');
    httpMock()
      .expectOne('/api/v1/accounting/accounts/a-40/')
      .flush(account('40', 'Fournisseurs', { parent: 'a-4', has_children: true }));
    await stable();
    httpMock().expectOne('/api/v1/accounting/accounts/a-4/').flush(account('4', 'Tiers'));
    httpMock()
      .expectOne((req) => req.url === '/api/v1/accounting/accounts/a-40/children/')
      .flush(
        page([
          account('401', 'Fournisseurs, dettes'),
          account('404', 'Fournisseurs d’immobilisations'),
        ]),
      );
    await stable();
    const text = element.textContent ?? '';
    expect(text).toContain('4 — Tiers');
    expect(text).toContain('401');
    expect(text).toContain('404');
    expect(element.querySelector('a[href="/plan-comptable/a-4"]')).not.toBeNull();
  });

  it('form: the parent code is found by the server; an unknown one is said under the field', async () => {
    const { element, stable } = await open('/plan-comptable/nouveau');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fill = (name: string, value: string) => {
      const field = element.querySelector<HTMLInputElement | HTMLSelectElement>(
        `[formControlName="${name}"]`,
      )!;
      field.value = value;
      field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input'));
    };
    const submit = () => element.querySelector('form')!.dispatchEvent(new Event('submit'));
    fill('code', '4011');
    fill('name', 'Fournisseurs locaux');
    fill('account_type', 'liability');
    fill('parent', '999');
    submit();
    await stable();
    const lookup = httpMock().expectOne((req) => req.url === '/api/v1/accounting/accounts/');
    expect(lookup.request.params.get('code')).toBe('999');
    lookup.flush(page([], 0));
    await stable();
    httpMock().expectNone((req) => req.method === 'POST');
    expect(element.textContent).toContain('Aucun compte de cette société n’a ce code.');

    fill('parent', '401');
    fill('account_class', '4');
    submit();
    await stable();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/accounting/accounts/' && req.method === 'GET')
      .flush(page([account('401', 'Fournisseurs, dettes')]));
    await stable();
    const create = httpMock().expectOne((req) => req.method === 'POST');
    expect(create.request.body).toEqual({
      code: '4011',
      name: 'Fournisseurs locaux',
      description: '',
      parent: 'a-401',
      account_type: 'liability',
      account_class: '4',
      allow_entries: true,
    });
    create.flush(account('4011', 'Fournisseurs locaux'));
    await stable();
    expect(navigate).toHaveBeenCalledWith(['/app/comptabilite/plan-comptable', 'a-4011']);
  });

  it('form: a cycle refused by the server is said under the parent', async () => {
    const { element, stable } = await open('/plan-comptable/a-40/modifier');
    httpMock().expectOne('/api/v1/accounting/accounts/a-40/').flush(account('40', 'Fournisseurs'));
    await stable();
    const parent = element.querySelector<HTMLInputElement>('[formControlName="parent"]')!;
    parent.value = '401';
    parent.dispatchEvent(new Event('input'));
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await stable();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/accounting/accounts/')
      .flush(page([account('401', 'Fournisseurs, dettes')]));
    await stable();
    const patch = httpMock().expectOne('/api/v1/accounting/accounts/a-40/');
    expect(patch.request.body).toEqual({ parent: 'a-401' });
    patch.flush(envelope('accounting_account_cycle'), { status: 400, statusText: 'x' });
    await stable();
    expect(element.textContent).toContain('l’un de ses propres sous-comptes');
  });
});
