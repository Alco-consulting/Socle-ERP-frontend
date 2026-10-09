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
  detailed_type: '',
  currency: null,
  account_class: code.charAt(0),
  allow_entries: true,
  letterable: false,
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

/** Side requests of the screens (the prefix panel, the currencies of the form): answered. */
function answerSideRequests(): void {
  for (const request of httpMock().match((req) => req.url.endsWith('/accounts/prefixes/'))) {
    request.flush([]);
  }
  for (const request of httpMock().match((req) => req.url.endsWith('/currencies/'))) {
    request.flush({ count: 0, next: null, previous: null, results: [] });
  }
}

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
    return { element, stable, accounts, harness };
  }

  afterEach(() => {
    answerSideRequests();
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('list: the panel of code prefixes from the server, a prefix filters, never a parent', async () => {
    const { accounts, element, stable, harness } = await open('/plan-comptable');
    const prefixes = httpMock().expectOne((req) => req.url.endsWith('/accounts/prefixes/'));
    prefixes.flush([
      {
        prefix: '1',
        count: 3,
        children: [
          { prefix: '10', count: 2 },
          { prefix: '16', count: 1 },
        ],
      },
      { prefix: '6', count: 1, children: [{ prefix: '60', count: 1 }] },
    ]);
    accounts().flush(
      page([
        account('161100', 'Emissions d’obligations', {
          detailed_type: 'liability_current',
          currency: 'GNF',
        }),
      ]),
    );
    await stable();
    const panel = element.querySelector('nav.prefixes')!;
    const labels = () =>
      Array.from(panel.querySelectorAll('button.prefix')).map((button) =>
        Array.from(button.querySelectorAll('span'))
          .map((part) => part.textContent?.trim())
          .join(' '),
      );
    expect(labels()).toEqual(['Tous 4', '1 3', '6 1']);
    const row = element.querySelector('alco-table tbody tr')!.textContent ?? '';
    expect(row).toContain('Dettes à court terme');
    expect(row).toContain('GNF');

    // Unfold « 1 », then choose « 16 »: the list asks the server for the codes starting with it.
    panel.querySelector<HTMLButtonElement>('button.fold')!.click();
    await stable();
    expect(labels()).toEqual(['Tous 4', '1 3', '10 2', '16 1', '6 1']);
    Array.from(panel.querySelectorAll<HTMLButtonElement>('button.prefix'))
      .find((button) => button.textContent?.includes('16'))!
      .click();
    await stable();
    const filtered = accounts();
    expect(filtered.request.params.get('code_prefix')).toBe('16');
    filtered.flush(page([]));
    await stable();
    expect(harness.routeNativeElement?.textContent).toContain('Code commençant par');
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
      .expectOne((req) => req.url === '/api/v1/accounting/entries/')
      .flush(page([], 0));
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

  it('record: smart buttons — entries, ledger, sub-accounts, history, each with its link', async () => {
    const { element, stable } = await open('/plan-comptable/a-40', [
      'accounting.read',
      'reporting.read',
      'audit.read',
    ]);
    httpMock()
      .expectOne('/api/v1/accounting/accounts/a-40/')
      .flush(account('40', 'Fournisseurs', { has_children: true }));
    const entries = httpMock().expectOne((req) => req.url === '/api/v1/accounting/entries/');
    expect(entries.request.params.get('account')).toBe('a-40');
    expect(entries.request.params.get('page_size')).toBe('1');
    entries.flush(page([{}], 48));
    await stable();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/accounting/accounts/a-40/children/')
      .flush(page([account('401', 'Fournisseurs, dettes')], 2));
    httpMock()
      .expectOne((req) => req.url === '/api/v1/audit/objects/accounting.account/a-40/')
      .flush(page([{}, {}, {}], 3));
    await stable();
    // Bounded: the record, one count, the children page already shown, the history.
    httpMock().verify();

    const buttons = Array.from(element.querySelectorAll<HTMLAnchorElement>('a.smart'));
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Écritures : 48',
      'Grand livre',
      'Sous-comptes : 2',
      'Historique : 3',
    ]);
    expect(buttons.map((button) => button.getAttribute('href'))).toEqual([
      '/app/comptabilite/ecritures?compte=40',
      '/app/comptabilite/analyse/grand-livre?compte=40',
      '/plan-comptable/a-40#sous-comptes',
      '/plan-comptable/a-40#historique',
    ]);
    expect(element.querySelector('#historique')?.textContent).toContain('Historique');
  });

  it('record: no ledger without reporting.read, no history without audit.read', async () => {
    const { element, stable } = await open('/plan-comptable/a-401', ['accounting.read']);
    httpMock()
      .expectOne('/api/v1/accounting/accounts/a-401/')
      .flush(account('401', 'Fournisseurs'));
    httpMock()
      .expectOne((req) => req.url === '/api/v1/accounting/entries/')
      .flush(page([], 0));
    await stable();
    httpMock().expectNone((req) => req.url.includes('/audit/'));
    const labels = Array.from(element.querySelectorAll('a.smart')).map((button) =>
      button.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['Écritures : 0']);
    expect(element.querySelector('#historique')).toBeNull();
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
      detailed_type: '',
      currency: null,
      account_class: '4',
      allow_entries: true,
      letterable: false,
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
