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
import { AlcoConfirmService } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { Journal } from '../data-access/accounting-models';
import { JournalDetailPage } from './journal-detail';
import { JournalFormPage } from './journal-form';
import { JournalListPage } from './journal-list';

const JOURNAL: Journal = {
  public_id: 'j-ach',
  code: 'ACH',
  name: 'Achats',
  journal_type: 'purchase',
  default_currency: null,
  default_account: { public_id: 'a-601', code: '601100', name: 'Achats de marchandises' },
  sequence_prefix: 'ACH-',
  sequence_padding: 6,
  status: 'active',
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
};
const page = (results: unknown[] = [], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const READ = ['accounting.read'];
const MANAGE = ['accounting.read', 'accounting.manage_journals'];

describe('Journaux (accounting/journals/)', () => {
  async function open(url: string, permissions: string[]) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          {
            path: 'journaux',
            data: { breadcrumb: 'Journaux' },
            children: [
              { path: '', component: JournalListPage },
              { path: 'nouveau', component: JournalFormPage },
              {
                path: ':id',
                data: { breadcrumb: 'Journal' },
                children: [
                  { path: '', component: JournalDetailPage },
                  { path: 'modifier', component: JournalFormPage },
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
    const journals = () =>
      httpMock().expectOne((req) => req.url === '/api/v1/accounting/journals/');
    const currencies = () =>
      httpMock()
        .match((req) => req.url === '/api/v1/currencies/')
        .forEach((request) =>
          request.flush(page([{ code: 'GNF', name: 'Franc guinéen', status: 'active' }])),
        );
    return { harness, element, stable, journals, currencies };
  }

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  describe('list', () => {
    it('the URL is the query: type, state, exact code, page', async () => {
      const { journals } = await open('/journaux?type=bank&etat=active&code=BQ1&page=2', READ);
      const request = journals();
      const params = request.request.params;
      expect(params.get('journal_type')).toBe('bank');
      expect(params.get('status')).toBe('active');
      expect(params.get('code')).toBe('BQ1');
      expect(params.get('page')).toBe('2');
      request.flush(page([JOURNAL], 60));
    });

    it('as Odoo: name, type, short code, default account, currency, active', async () => {
      const reader = await open('/journaux', READ);
      reader.journals().flush(page([JOURNAL, { ...JOURNAL, public_id: 'j-od', code: 'OD' }]));
      await reader.stable();
      const headers = Array.from(reader.element.querySelectorAll('thead th')).map((cell) =>
        cell.textContent?.trim(),
      );
      expect(headers).toEqual([
        'Nom du journal',
        'Type',
        'Code court',
        'Compte',
        'Devise',
        'Actif',
      ]);
      const cells = Array.from(reader.element.querySelectorAll('tbody tr:first-child td')).map(
        (cell) => cell.textContent?.replace(/\s+/g, ' ').trim(),
      );
      expect(cells).toEqual(['Achats', 'Achats', 'ACH', '601100 Achats de marchandises', '', '']);
      // Read only: no creation, and « Actif » cannot change.
      expect(reader.element.textContent).not.toContain('Nouveau journal');
      expect(reader.element.textContent).not.toContain('Créer les journaux usuels');
      const switches = reader.element.querySelectorAll<HTMLInputElement>('input[role="switch"]');
      expect(Array.from(switches).every((item) => item.disabled)).toBe(true);

      TestBed.resetTestingModule();
      const manager = await open('/journaux', MANAGE);
      manager.journals().flush(page([JOURNAL]));
      await manager.stable();
      expect(manager.element.textContent).toContain('Nouveau journal');
      expect(manager.element.textContent).toContain('Créer les journaux usuels');
    });

    it('« Actif » switched from the row is a command; refused, it goes back', async () => {
      const { element, stable, journals } = await open('/journaux', MANAGE);
      journals().flush(page([JOURNAL]));
      await stable();
      const toggle = () => element.querySelector<HTMLInputElement>('input[role="switch"]')!;
      expect(toggle().getAttribute('aria-label')).toBe('Journal ACH actif');

      toggle().click();
      await stable();
      httpMock()
        .expectOne('/api/v1/accounting/journals/j-ach/deactivate/')
        .flush({ ...JOURNAL, status: 'inactive' });
      await stable();
      expect(toggle().checked).toBe(false);

      toggle().click();
      await stable();
      httpMock()
        .expectOne('/api/v1/accounting/journals/j-ach/reactivate/')
        .flush(envelope('company_permission_denied'), { status: 403, statusText: 'x' });
      await stable();
      expect(toggle().checked).toBe(false);
    });

    it('an empty list offers the usual journals in one click', async () => {
      const { element, stable, journals } = await open('/journaux', MANAGE);
      journals().flush(page([]));
      await stable();
      Array.from(element.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.trim() === 'Créer les journaux usuels')!
        .click();
      await stable();
      const create = httpMock().expectOne('/api/v1/accounting/default-journals/');
      expect(create.request.method).toBe('POST');
      create.flush({ created: [JOURNAL], existing: ['VTE', 'OD'] });
      await stable();
      // The list is read again, with the journals created.
      journals().flush(page([JOURNAL]));
      await stable();
      expect(element.querySelector('tbody')?.textContent).toContain('ACH');
    });

    it('no permission in this company: a clear refusal', async () => {
      const { journals, element, stable } = await open('/journaux', READ);
      journals().flush(envelope('company_permission_denied'), { status: 403, statusText: 'x' });
      await stable();
      expect(element.textContent).toContain(
        'Vous n’avez pas accès à la comptabilité de cette société.',
      );
    });
  });

  describe('record', () => {
    /** The smart buttons' counts: `count` of the entry list of the journal, by status. */
    function answerCounts(total = 48, draft = 3, submitted = 2) {
      const requests = httpMock().match((req) => req.url === '/api/v1/accounting/entries/');
      for (const request of requests) {
        const status = request.request.params.get('status');
        const count = status === 'draft' ? draft : status === 'submitted' ? submitted : total;
        request.flush({ count, next: null, previous: null, results: [] });
      }
      return requests;
    }

    it('smart buttons: the entries of the journal, by state, and its history', async () => {
      const { element, stable } = await open('/journaux/j-ach', [...READ, 'audit.read']);
      httpMock().expectOne('/api/v1/accounting/journals/j-ach/').flush(JOURNAL);
      const counts = answerCounts();
      await stable();
      httpMock()
        .expectOne('/api/v1/audit/objects/accounting.journal/j-ach/?page_size=50')
        .flush({ count: 4, next: null, previous: null, results: [] });
      await stable();

      expect(counts.map((request) => request.request.params.get('journal'))).toEqual([
        'j-ach',
        'j-ach',
        'j-ach',
      ]);
      expect(counts.every((request) => request.request.params.get('page_size') === '1')).toBe(true);
      const buttons = Array.from(element.querySelectorAll<HTMLAnchorElement>('.smart'));
      expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
        'Écritures : 48',
        'Brouillons : 3',
        'Soumises : 2',
        'Historique : 4',
      ]);
      expect(buttons.map((button) => button.getAttribute('href'))).toEqual([
        '/app/comptabilite/ecritures/pieces?journal=j-ach',
        '/app/comptabilite/ecritures/pieces?journal=j-ach&etat=draft',
        '/app/comptabilite/ecritures/pieces?journal=j-ach&etat=submitted',
        '/journaux/j-ach#historique',
      ]);
      expect(element.querySelector('#historique')?.textContent).toContain('Historique');
    });

    it('no audit.read: no history button nor section', async () => {
      const { element, stable } = await open('/journaux/j-ach', READ);
      httpMock().expectOne('/api/v1/accounting/journals/j-ach/').flush(JOURNAL);
      answerCounts();
      await stable();
      expect(element.querySelectorAll('.smart').length).toBe(3);
      expect(element.querySelector('#historique')).toBeNull();
      httpMock().expectNone((req) => req.url.includes('/audit/'));
    });

    it('shows the journal; deactivates after a confirmation (manage_journals)', async () => {
      const { element, stable } = await open('/journaux/j-ach', MANAGE);
      httpMock().expectOne('/api/v1/accounting/journals/j-ach/').flush(JOURNAL);
      answerCounts();
      await stable();
      expect(element.querySelector('h1')?.textContent).toContain('Achats');
      expect(element.textContent).toContain('ACH · Achats');
      const facts = element.querySelector('.facts')?.textContent?.replace(/\s+/g, ' ');
      for (const words of ['Compte', '601100 Achats de marchandises']) {
        expect(facts).toContain(words);
      }
      // Neither the numbering nor its digits are shown.
      expect(facts).not.toContain('Numéro des écritures');
      vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
      element.querySelector<HTMLButtonElement>('alco-dropdown button')!.click();
      await stable();
      document.querySelector<HTMLElement>('[role=menuitem]')!.click();
      await stable();
      httpMock()
        .expectOne('/api/v1/accounting/journals/j-ach/deactivate/')
        .flush({ ...JOURNAL, status: 'inactive' });
      await stable();
      expect(element.textContent).toContain('Inactif');
    });

    it('read only: no Modifier, no Actions', async () => {
      const { element, stable } = await open('/journaux/j-ach', READ);
      httpMock().expectOne('/api/v1/accounting/journals/j-ach/').flush(JOURNAL);
      answerCounts();
      await stable();
      expect(element.textContent).not.toContain('Modifier');
      expect(element.querySelector('alco-dropdown')).toBeNull();
    });
  });

  describe('form', () => {
    function fill(element: HTMLElement, name: string, value: string) {
      const field = element.querySelector<HTMLInputElement | HTMLSelectElement>(
        `[formControlName="${name}"]`,
      )!;
      field.value = value;
      field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input'));
    }
    const submit = (element: HTMLElement) =>
      element.querySelector('form')!.dispatchEvent(new Event('submit'));
    /** The accounts of the journal's type: one request (200 a page), answered. */
    const accounts = (results: readonly object[] = []) => {
      const request = httpMock().expectOne((req) => req.url === '/api/v1/accounting/accounts/');
      request.flush(page([...results]));
      return request.request.params;
    };
    const BANK_ACCOUNT = { public_id: 'a-521', code: '521100', name: 'Banque BICIGUI' };
    /** A bank journal: the only kind, with cash, that has an account (note backend 0038). */
    const BANK = {
      ...JOURNAL,
      public_id: 'j-bq',
      code: 'BQ',
      name: 'Banque BICIGUI',
      journal_type: 'bank',
      default_account: BANK_ACCOUNT,
    };
    const options = (element: HTMLElement) =>
      Array.from(
        element.querySelector<HTMLSelectElement>('[formControlName="default_account"]')?.options ??
          [],
      ).map((option) => option.textContent?.trim());

    it('creation as Odoo; a used code goes under the code', async () => {
      const { element, stable, currencies } = await open('/journaux/nouveau', MANAGE);
      currencies();
      await stable();
      const names = () =>
        Array.from(element.querySelectorAll('[formControlName]')).map((field) =>
          field.getAttribute('formControlName'),
        );
      // No type yet: no default account.
      expect(names()).toEqual([
        'name',
        'journal_type',
        'code',
        'default_currency',
        'sequence_prefix',
      ]);
      const types = element.querySelector<HTMLSelectElement>('[formControlName="journal_type"]')!;
      expect(Array.from(types.options).map((option) => option.textContent?.trim())).toEqual([
        'Choisir un type',
        'Ventes',
        'Achats',
        'Banque',
        'Caisse',
        'Opérations diverses',
      ]);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      fill(element, 'name', 'Ventes');
      fill(element, 'journal_type', 'sales');
      fill(element, 'code', 'VTE');
      await stable();
      // A sales journal has no account (note backend 0038): neither the field nor a request.
      httpMock().expectNone((req) => req.url === '/api/v1/accounting/accounts/');
      expect(element.querySelector('[formControlName="default_account"]')).toBeNull();
      expect(element.textContent).not.toContain('par défaut');
      expect(element.textContent).not.toContain('Numéro des écritures');
      expect(element.textContent).not.toContain('Nombre de chiffres');
      submit(element);
      await stable();
      const create = httpMock().expectOne('/api/v1/accounting/journals/');
      // The account is optional: « Aucun compte » sends none.
      expect(create.request.body).toEqual({
        code: 'VTE',
        name: 'Ventes',
        journal_type: 'sales',
        default_currency: null,
        default_account: null,
        sequence_prefix: '',
      });
      create.flush(envelope('accounting_journal_code_exists'), { status: 400, statusText: 'x' });
      await stable();
      expect(element.textContent).toContain('Ce code est déjà utilisé par un autre journal.');

      fill(element, 'code', 'VTE2'); // the server's error stays until the code changes
      submit(element);
      await stable();
      httpMock()
        .expectOne('/api/v1/accounting/journals/')
        .flush({ ...JOURNAL, public_id: 'j-vte', code: 'VTE' });
      await stable();
      expect(navigate).toHaveBeenCalledWith(['/app/comptabilite/journaux', 'j-vte']);
    });

    it('the default account is chosen in the list of the accounts of the type', async () => {
      const { element, stable, currencies } = await open('/journaux/nouveau', MANAGE);
      currencies();
      await stable();
      vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      fill(element, 'name', 'Banque BICIGUI');
      fill(element, 'journal_type', 'bank');
      fill(element, 'code', 'BQ1');
      await stable();
      const params = accounts([{ public_id: 'a-521', code: '521100', name: 'Banque BICIGUI' }]);
      expect(params.get('detailed_type')).toBe('asset_cash');
      expect([params.get('postable'), params.get('status'), params.get('page_size')]).toEqual([
        'true',
        'active',
        '200',
      ]);
      expect(params.has('search')).toBe(false);
      await stable();
      expect(element.textContent).toContain('Le compte de la banque dans le plan');
      expect(options(element)).toEqual(['Aucun compte', '521100 — Banque BICIGUI']);
      fill(element, 'default_account', 'a-521');
      submit(element);
      await stable();
      const create = httpMock().expectOne('/api/v1/accounting/journals/');
      expect(create.request.body).toEqual(
        expect.objectContaining({ journal_type: 'bank', default_account: 'a-521' }),
      );
      create.flush({ ...JOURNAL, public_id: 'j-bq1', code: 'BQ1', journal_type: 'bank' });
      await stable();
    });

    it('only bank and cash journals have an account: changing the type clears it', async () => {
      const { element, stable, currencies } = await open('/journaux/j-bq/modifier', MANAGE);
      currencies();
      httpMock().expectOne('/api/v1/accounting/journals/j-bq/').flush(BANK);
      await stable();
      expect(accounts([BANK_ACCOUNT]).get('detailed_type')).toBe('asset_cash');
      await stable();
      vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const account = () =>
        element.querySelector<HTMLSelectElement>('[formControlName="default_account"]');
      expect(account()?.value).toBe('a-521');
      expect(options(element)).toEqual(['Aucun compte', '521100 — Banque BICIGUI']);
      fill(element, 'journal_type', 'sales');
      await stable();
      expect(account()).toBeNull();
      submit(element);
      await stable();
      const patch = httpMock().expectOne('/api/v1/accounting/journals/j-bq/');
      expect(patch.request.body).toEqual({ journal_type: 'sales', default_account: null });
      patch.flush({ ...BANK, journal_type: 'sales', default_account: null });
      await stable();
    });

    it('the journal keeps its account when the chart no longer lists it', async () => {
      const { element, stable, currencies } = await open('/journaux/j-bq/modifier', MANAGE);
      currencies();
      httpMock().expectOne('/api/v1/accounting/journals/j-bq/').flush(BANK);
      await stable();
      accounts([]);
      await stable();
      expect(options(element)).toEqual(['Aucun compte', '521100 — Banque BICIGUI']);
      expect(
        element.querySelector<HTMLSelectElement>('[formControlName="default_account"]')?.value,
      ).toBe('a-521');
    });

    it('the short code changes; once entries are numbered, the server says no', async () => {
      const { element, stable, currencies } = await open('/journaux/j-ach/modifier', MANAGE);
      currencies();
      httpMock().expectOne('/api/v1/accounting/journals/j-ach/').flush(JOURNAL);
      await stable();
      const code = element.querySelector<HTMLInputElement>('[formControlName="code"]')!;
      expect(code.value).toBe('ACH');
      fill(element, 'code', 'ACHL');
      submit(element);
      await stable();
      const patch = httpMock().expectOne('/api/v1/accounting/journals/j-ach/');
      expect(patch.request.body).toEqual({ code: 'ACHL' });
      patch.flush(envelope('accounting_journal_code_in_use'), { status: 400, statusText: 'x' });
      await stable();
      expect(element.textContent).toContain(
        'Des écritures validées sont déjà numérotées avec ce code : il ne change plus.',
      );
    });

    it('modification: only the changes; a numbering in use is said', async () => {
      const { element, stable, currencies } = await open('/journaux/j-ach/modifier', MANAGE);
      currencies();
      httpMock().expectOne('/api/v1/accounting/journals/j-ach/').flush(JOURNAL);
      await stable();
      fill(element, 'sequence_prefix', 'AC-');
      submit(element);
      await stable();
      const patch = httpMock().expectOne('/api/v1/accounting/journals/j-ach/');
      expect(patch.request.method).toBe('PATCH');
      expect(patch.request.body).toEqual({ sequence_prefix: 'AC-' });
      patch.flush(envelope('accounting_journal_numbering_in_use'), {
        status: 400,
        statusText: 'x',
      });
      await stable();
      expect(element.textContent).toContain('sa numérotation ne change plus');
    });
  });
});
