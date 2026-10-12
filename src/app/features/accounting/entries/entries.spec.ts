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
import {
  UnsavedChangesService,
  unsavedChangesGuard,
} from '../../../core/navigation/unsaved-changes';
import { SessionStore } from '../../../core/session/session.store';
import { openTestSession } from '../../../core/session/testing';
import { AlcoConfirmService } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { Entry } from '../data-access/entry-models';
import { EntryDetailPage } from './entry-detail';
import { EntryFormPage } from './entry-form';
import { EntryListPage } from './entry-list';
import { page, testEntry, testLine } from './entry-testing';
import { ReverseDialogService } from './reverse-dialog';

const BASE = '/app/comptabilite/ecritures';
const PIECES = `${BASE}/pieces`;
const READ = ['accounting.read'];
const ACCOUNTANT = [
  'accounting.read',
  'accounting.create',
  'accounting.update',
  'accounting.submit',
  'accounting.validate',
  'accounting.lock',
  'accounting.reverse',
];
const GNF = { code: 'GNF', name: 'Franc guinéen', decimal_places: 0, status: 'active' };
const JOURNAL = {
  public_id: 'j-ach',
  code: 'ACH',
  name: 'Achats',
  journal_type: 'purchase',
  default_currency: null,
  sequence_prefix: 'ACH-',
  sequence_padding: 6,
  status: 'active',
  created_at: '',
  updated_at: '',
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const is =
  (path: string, method = 'GET') =>
  (req: { url: string; method: string }) =>
    req.url === `/api/v1/${path}` && req.method === method;
const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ');

describe('Comptabilité › Écritures (accounting/entries/)', () => {
  async function open(url: string, permissions: readonly string[] = ACCOUNTANT) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          {
            path: 'app/comptabilite/ecritures',
            children: [
              { path: 'pieces', component: EntryListPage },
              {
                path: 'nouvelle',
                component: EntryFormPage,
                canDeactivate: [unsavedChangesGuard],
              },
              {
                path: ':id',
                children: [
                  { path: '', component: EntryDetailPage },
                  {
                    path: 'modifier',
                    component: EntryFormPage,
                    canDeactivate: [unsavedChangesGuard],
                  },
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
    const element = () => harness.routeNativeElement as HTMLElement;
    const stable = async () => {
      await settle();
      await harness.fixture.whenStable();
    };
    const toasts = () =>
      TestBed.inject(AlcoToastService)
        .toasts()
        .map((toast) => toast.message);
    return { harness, element, stable, toasts };
  }

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  // ---- List --------------------------------------------------------------------------------

  function flushListOptions(): void {
    httpMock()
      .expectOne(is('accounting/journals/'))
      .flush(page([JOURNAL]));
    httpMock().expectOne(is('accounting/fiscal-years/')).flush(page([]));
    httpMock()
      .expectOne(is('currencies/'))
      .flush(page([GNF]));
  }

  describe('list', () => {
    it('the URL’s filters go to the server; account and partner codes are found first', async () => {
      const { stable } = await open(
        `${PIECES}?etat=submitted&type=standard&journal=j-ach&exercice=fy-2026&du=2026-09-01&au=2026-09-30&compte=401100&tiers=FRN-001&page=2`,
      );
      flushListOptions();
      const account = httpMock().expectOne(is('accounting/accounts/'));
      expect(account.request.params.get('code')).toBe('401100');
      account.flush(page([{ public_id: 'a-401100', code: '401100' }]));
      const partner = httpMock().expectOne(is('partners/'));
      expect(partner.request.params.get('code')).toBe('FRN-001');
      partner.flush(page([{ public_id: 'pt-1', code: 'FRN-001' }]));
      await stable();
      const list = httpMock().expectOne(is('accounting/entries/'));
      const params = list.request.params;
      expect(params.get('status')).toBe('submitted');
      expect(params.get('kind')).toBe('standard');
      expect(params.get('journal')).toBe('j-ach');
      expect(params.get('fiscal_year')).toBe('fy-2026');
      expect(params.get('date_from')).toBe('2026-09-01');
      expect(params.get('date_to')).toBe('2026-09-30');
      expect(params.get('account')).toBe('a-401100');
      expect(params.get('partner')).toBe('pt-1');
      expect(params.get('page')).toBe('2');
      expect(params.has('search')).toBe(false);
      list.flush(page([], 0));
      await stable();
    });

    it('rows of the API: number or « Sans numéro », reversal said, exact debit total, state', async () => {
      const { element, stable } = await open(PIECES);
      flushListOptions();
      httpMock()
        .expectOne(is('accounting/entries/'))
        .flush(
          page([
            testEntry('e-1'),
            testEntry('e-2', {
              entry_number: 'ACH-000145',
              status: 'validated',
              kind: 'reversal',
              description: 'Contrepassation achat',
            }),
          ]),
        );
      await stable();
      const rows = Array.from(element().querySelectorAll('tbody tr')).map(text);
      expect(rows[0]).toContain('Sans numéro');
      expect(rows[0]).toContain('28/09/2026');
      expect(rows[0]).toContain('ACH');
      expect(rows[0]).toContain('1 150 000');
      expect(rows[0]).toContain('Brouillon');
      expect(rows[1]).toContain('ACH-000145');
      expect(rows[1]).toContain('Contrepassation');
      expect(rows[1]).toContain('Validée');
      expect(element().querySelector(`a[href="${BASE}/e-2"]`)).not.toBeNull();
      // No search bar: the API has no text search for entries.
      expect(element().querySelector('[role=search], input[type=search]')).toBeNull();
    });

    it('an unknown account code: said, no list asked', async () => {
      const { element, stable } = await open(`${PIECES}?compte=999`);
      flushListOptions();
      httpMock().expectOne(is('accounting/accounts/')).flush(page([]));
      await stable();
      httpMock().expectNone(is('accounting/entries/'));
      expect(text(element())).toContain('Aucun compte de cette société n’a le code « 999 ».');
    });

    it('empty: with filters, reset them; without, create (accounting.create only)', async () => {
      const first = await open(`${PIECES}?etat=locked`);
      flushListOptions();
      httpMock().expectOne(is('accounting/entries/')).flush(page());
      await first.stable();
      expect(text(first.element())).toContain('Aucune écriture ne correspond à ces critères.');
      TestBed.resetTestingModule();

      const reader = await open(PIECES, READ);
      flushListOptions();
      httpMock().expectOne(is('accounting/entries/')).flush(page());
      await reader.stable();
      expect(text(reader.element())).toContain('Aucune écriture dans cette société.');
      expect(text(reader.element())).not.toContain('Saisir une écriture');
      expect(text(reader.element())).not.toContain('Nouvelle écriture');
    });

    it('forbidden: said, nothing else', async () => {
      const { element, stable } = await open(PIECES, READ);
      flushListOptions();
      httpMock()
        .expectOne(is('accounting/entries/'))
        .flush(envelope('permission_denied'), { status: 403, statusText: 'Forbidden' });
      await stable();
      expect(text(element())).toContain('Vous n’avez pas accès aux écritures de cette société.');
    });

    it('loading: a local skeleton while the server answers', async () => {
      const { element, stable } = await open(PIECES);
      flushListOptions();
      await stable();
      expect(element().querySelector('alco-loading')).not.toBeNull();
      httpMock().expectOne(is('accounting/entries/')).flush(page());
      await stable();
      expect(element().querySelector('alco-loading')).toBeNull();
    });
  });

  // ---- Record ------------------------------------------------------------------------------

  async function openRecord(
    entry: Entry,
    permissions: readonly string[] = ACCOUNTANT,
    submissionRequired = true,
  ) {
    const opened = await open(`${BASE}/${entry.public_id}`, permissions);
    httpMock()
      .expectOne(is('accounting/settings/'))
      .flush({ submission_required: submissionRequired, parent_accounts_postable: false });
    httpMock()
      .expectOne(is('currencies/'))
      .flush(page([GNF]));
    httpMock()
      .expectOne(is(`accounting/entries/${entry.public_id}/`))
      .flush(entry);
    await opened.stable();
    return opened;
  }

  async function menuItems(element: HTMLElement, stable: () => Promise<void>) {
    const trigger = Array.from(element.querySelectorAll('button')).find((button) =>
      text(button).includes('Actions'),
    );
    if (!trigger) {
      return [];
    }
    trigger.click();
    await stable();
    return Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]'));
  }

  const primaryButton = (element: HTMLElement) =>
    element.querySelector<HTMLButtonElement>('.alco-button--primary');

  describe('record', () => {
    it('its fields and lines as the server gives them; totals summed exactly', async () => {
      const { element } = await openRecord(
        testEntry('e-1', { status: 'validated', entry_number: 'ACH-000145' }),
      );
      const content = text(element());
      expect(content).toContain('ACH-000145');
      expect(content).toContain('Achat de fournitures');
      expect(content).toContain('2026 · 2026-09');
      expect(content).toContain('601100');
      expect(content).toContain('FRN-001');
      expect(content).toContain('Totaux');
      expect(content.match(/1 150 000/g)?.length).toBeGreaterThanOrEqual(4);
      expect(content).not.toContain('Écart');
      expect(content).toContain('Validée : elle ne se modifie plus.');
    });

    it('links its journal, accounts, partner, treasury and source by their public ids', async () => {
      const { element, stable } = await openRecord(
        testEntry('e-1', {
          status: 'validated',
          entry_number: 'BQ-000012',
          origin: 'system',
          source_type: 'treasury.operation',
          source_id: 'op-1',
        }),
        [...ACCOUNTANT, 'partners.read', 'treasury.read'],
      );
      const operations = httpMock().expectOne(is('treasury/operations/'));
      expect(operations.request.params.get('accounting_entry')).toBe('e-1');
      operations.flush(
        page([
          {
            public_id: 'op-1',
            treasury_account: { public_id: 't-1', code: 'BANK1' },
            operation_type: 'deposit',
            direction: 'inflow',
            status: 'accounted',
            operation_date: '2026-09-28',
            amount: '1150000.000000',
            currency: 'GNF',
            reference: 'VIR-01',
          },
        ]),
      );
      await stable();

      const href = (label: string) =>
        Array.from(element().querySelectorAll<HTMLAnchorElement>('a'))
          .find((link) => text(link).trim() === label)
          ?.getAttribute('href');
      expect(href('ACH')).toBe('/app/comptabilite/journaux/j-ach');
      expect(href('601100')).toBe('/app/comptabilite/plan-comptable/a-601100');
      expect(href('FRN-001')).toBe('/app/comptabilite/tiers/pt-1');
      expect(href('Voir les opérations de trésorerie')).toBe(
        '/app/comptabilite/tresorerie/operations',
      );
      const content = text(element());
      expect(content).toContain('Opération du 28/09/2026 · BANK1 · VIR-01');
      expect(content).toMatch(/Source\s*Trésorerie/);
    });

    it('without partners.read nor treasury.read: the codes only, no treasury asked', async () => {
      const { element } = await openRecord(testEntry('e-1'), READ);
      httpMock().expectNone(is('treasury/operations/'));
      const partner = Array.from(element().querySelectorAll('a')).find((link) =>
        text(link).includes('FRN-001'),
      );
      expect(partner).toBeUndefined();
      expect(text(element())).toContain('FRN-001');
      expect(text(element())).not.toContain('Trésorerie');
    });

    it('a draft, submission required: « Soumettre » is the main action, no validation', async () => {
      const { element, stable } = await openRecord(testEntry('e-1'));
      expect(text(primaryButton(element()) as Element)).toContain('Soumettre');
      const items = (await menuItems(element(), stable)).map(text);
      expect(items.some((item) => item.includes('Modifier'))).toBe(true);
      expect(items.some((item) => item.includes('Supprimer le brouillon'))).toBe(true);
      expect(items.some((item) => item.includes('Valider'))).toBe(false);
    });

    it('a draft, no submission required: « Valider » straight from the draft', async () => {
      const { element } = await openRecord(testEntry('e-1'), ACCOUNTANT, false);
      expect(text(primaryButton(element()) as Element)).toContain('Valider');
    });

    it('submit: confirmed, the server’s command, its new state shown', async () => {
      const { element, stable, toasts } = await openRecord(testEntry('e-1'));
      const confirm = vi
        .spyOn(TestBed.inject(AlcoConfirmService), 'confirm')
        .mockResolvedValue(true);
      primaryButton(element())?.click();
      await stable();
      expect(confirm.mock.calls[0][0].title).toBe('Soumettre l’écriture pour validation ?');
      const submit = httpMock().expectOne(is('accounting/entries/e-1/submit/', 'POST'));
      expect(submit.request.body).toBeNull();
      submit.flush(testEntry('e-1', { status: 'submitted' }));
      await stable();
      expect(text(element())).toContain('Soumise');
      expect(text(primaryButton(element()) as Element)).toContain('Valider');
      expect(toasts()).toContain('Écriture soumise pour validation.');
      httpMock().expectNone((req) => req.method === 'PATCH');
    });

    it('a transition refused by the server: said (code in the details), the record reloaded', async () => {
      const { element, stable } = await openRecord(testEntry('e-1', { status: 'submitted' }));
      vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
      primaryButton(element())?.click();
      await stable();
      httpMock()
        .expectOne(is('accounting/entries/e-1/validate/', 'POST'))
        .flush(envelope('accounting_invalid_transition'), { status: 400, statusText: 'x' });
      await stable();
      httpMock()
        .expectOne(is('accounting/entries/e-1/'))
        .flush(testEntry('e-1', { status: 'validated', entry_number: 'ACH-000146' }));
      await stable();
      const content = text(element());
      expect(content).toContain('Cette action n’est pas possible dans l’état actuel');
      expect(content).toContain('accounting_invalid_transition');
      expect(content).toContain('ACH-000146');
    });

    it('validation refused for an account: the account is named', async () => {
      const { element, stable } = await openRecord(testEntry('e-1', { status: 'submitted' }));
      vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
      primaryButton(element())?.click();
      await stable();
      httpMock()
        .expectOne(is('accounting/entries/e-1/validate/', 'POST'))
        .flush(
          {
            error: {
              code: 'accounting_account_not_postable',
              message: 'x',
              details: { account: '401100' },
            },
          },
          { status: 400, statusText: 'x' },
        );
      await stable();
      expect(text(element())).toContain('Compte concerné : 401100.');
    });

    it('reverse a validated entry: date and reason asked, the new draft opened', async () => {
      const { element, stable, toasts } = await openRecord(
        testEntry('e-1', { status: 'validated', entry_number: 'ACH-000145' }),
      );
      const ask = vi
        .spyOn(TestBed.inject(ReverseDialogService), 'ask')
        .mockResolvedValue({ entry_date: '2026-10-01', reason: 'Facture annulée' });
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      expect(text(primaryButton(element()) as Element)).toContain('Contrepasser');
      primaryButton(element())?.click();
      await stable();
      expect(ask).toHaveBeenCalledWith('ACH-000145', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
      const reverse = httpMock().expectOne(is('accounting/entries/e-1/reverse/', 'POST'));
      expect(reverse.request.body).toEqual({ entry_date: '2026-10-01', reason: 'Facture annulée' });
      reverse.flush(testEntry('e-2', { kind: 'reversal', related_entry: 'e-1' }));
      await stable();
      expect(navigate).toHaveBeenCalledWith(['..', 'e-2'], expect.anything());
      expect(toasts()).toContain('Contrepassation créée en brouillon : elle reste à valider.');
    });

    it('a reversal draft: no modification (the server refuses), its origin linked', async () => {
      const { element, stable } = await openRecord(
        testEntry('e-2', { kind: 'reversal', related_entry: 'e-1' }),
      );
      const items = (await menuItems(element(), stable)).map(text);
      expect(items.some((item) => item.includes('Modifier'))).toBe(false);
      expect(text(element())).toContain('Contrepassation : ses lignes viennent');
      expect(element().querySelector(`a[href="${BASE}/e-1"]`)).not.toBeNull();
    });

    it('read-only profile: no action at all', async () => {
      const { element } = await openRecord(testEntry('e-1'), READ);
      expect(primaryButton(element())).toBeNull();
      expect(text(element())).not.toContain('Actions');
    });

    it('delete a draft: confirmed (danger), DELETE, back to the list', async () => {
      const { element, stable, toasts } = await openRecord(testEntry('e-1'));
      const confirm = vi
        .spyOn(TestBed.inject(AlcoConfirmService), 'confirm')
        .mockResolvedValue(true);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const remove = (await menuItems(element(), stable)).find((item) =>
        text(item).includes('Supprimer'),
      );
      remove?.click();
      await stable();
      expect(confirm.mock.calls[0][0].tone).toBe('danger');
      httpMock()
        .expectOne(is('accounting/entries/e-1/', 'DELETE'))
        .flush(null, { status: 204, statusText: 'No Content' });
      await stable();
      expect(navigate).toHaveBeenCalledWith(['..'], expect.anything());
      expect(toasts()).toContain('Brouillon supprimé.');
    });

    it('documents and history, when the profile may see them', async () => {
      const permissions = [...ACCOUNTANT, 'documents.read', 'documents.upload', 'audit.read'];
      const { element, stable, toasts } = await openRecord(testEntry('e-1'), permissions);
      const documents = httpMock().expectOne(is('documents/'));
      expect(documents.request.params.get('resource_type')).toBe('accounting.entry');
      expect(documents.request.params.get('resource_id')).toBe('e-1');
      documents.flush(page([]));
      httpMock()
        .expectOne(is('audit/objects/accounting.journalentry/e-1/'))
        .flush(
          page([
            {
              public_id: 'ev-1',
              occurred_at: '2026-09-28T09:00:00Z',
              action: 'create',
              object_type: 'accounting.journalentry',
              object_id: 'e-1',
              object_label: '',
              user: { public_id: 'u-1', email: 'comptable@example.org' },
              origin: 'http',
              source: '',
              correlation_id: '',
              metadata: {},
              changed_fields: [],
            },
          ]),
        );
      await stable();
      expect(text(element())).toContain('Aucune pièce jointe.');
      expect(text(element())).toContain('Création');
      expect(text(element())).toContain('comptable@example.org');

      const input = element().querySelector<HTMLInputElement>('input[type=file]');
      const file = new File(['%PDF'], 'facture.pdf', { type: 'application/pdf' });
      Object.defineProperty(input, 'files', { value: [file] });
      input?.dispatchEvent(new Event('change'));
      await stable();
      httpMock().expectOne(is('documents/', 'POST')).flush({});
      await stable();
      httpMock().expectOne(is('documents/')).flush(page([]));
      expect(toasts()).toContain('Pièce « facture.pdf » jointe.');
    });

    it('a document opens through its short-lived link; only an https link is opened', async () => {
      const permissions = [...ACCOUNTANT, 'documents.read', 'documents.download'];
      const { element, stable } = await openRecord(testEntry('e-1'), permissions);
      const document = {
        public_id: 'd-1',
        resource_type: 'accounting.entry',
        resource_id: 'e-1',
        original_name: 'facture.pdf',
        content_type: 'application/pdf',
        size: 20480,
        checksum: '',
        description: '',
        status: 'active',
        replaces: null,
        uploaded_by: 'u-1',
        created_at: '2026-09-28T09:00:00Z',
        deleted_by: null,
        deleted_at: null,
        deletion_reason: '',
      };
      httpMock()
        .expectOne(is('documents/'))
        .flush(page([document]));
      await stable();
      expect(text(element())).toContain('facture.pdf');
      expect(text(element())).toContain('20 Ko');
      const tab = { opener: {} as unknown };
      const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
      const button = () =>
        Array.from(element().querySelectorAll('button')).find((item) =>
          text(item).includes('Ouvrir'),
        ) as HTMLButtonElement;

      button().click();
      await stable();
      httpMock()
        .expectOne(is('documents/d-1/download/'))
        .flush({ url: 'https://files.example.org/d-1?sig=x', expires_at: '', expires_in: 300 });
      await stable();
      expect(open).toHaveBeenCalledWith('https://files.example.org/d-1?sig=x', '_blank');
      expect(tab.opener).toBeNull();

      open.mockClear();
      button().click();
      await stable();
      httpMock()
        .expectOne(is('documents/d-1/download/'))
        .flush({ url: 'javascript:alert(1)', expires_at: '', expires_in: 300 });
      await stable();
      expect(open).not.toHaveBeenCalled();
      expect(text(element())).toContain('Le lien de cette pièce a été refusé.');
      open.mockRestore();
    });

    it('not found (another company’s, or deleted): said, back to the list', async () => {
      const { element, stable } = await open(`${BASE}/e-x`);
      httpMock()
        .expectOne(is('accounting/settings/'))
        .flush({ submission_required: true, parent_accounts_postable: false });
      httpMock()
        .expectOne(is('currencies/'))
        .flush(page([GNF]));
      httpMock()
        .expectOne(is('accounting/entries/e-x/'))
        .flush(envelope('not_found'), { status: 404, statusText: 'Not Found' });
      await stable();
      expect(text(element())).toContain('Cette écriture n’existe pas ou plus dans cette société.');
      expect(text(element())).toContain('Retour aux écritures');
    });
  });

  // ---- Form --------------------------------------------------------------------------------

  function flushFormOptions(): void {
    httpMock()
      .expectOne(is('accounting/journals/'))
      .flush(page([JOURNAL]));
    httpMock()
      .expectOne(is('currencies/'))
      .flush(page([GNF]));
  }

  async function openForm(url = `${BASE}/nouvelle`, entry?: Entry) {
    const opened = await open(url);
    flushFormOptions();
    if (entry) {
      httpMock()
        .expectOne(is(`accounting/entries/${entry.public_id}/`))
        .flush(entry);
    }
    await opened.stable();
    const field = (name: string, line?: number) => {
      const scope = line === undefined ? opened.element() : lineOf(line);
      return scope.querySelector<HTMLInputElement | HTMLSelectElement>(
        `[formControlName="${name}"]`,
      ) as HTMLInputElement;
    };
    const lineOf = (index: number) =>
      opened.element().querySelector(`[data-line="${index}"]`) as HTMLElement;
    const fill = (name: string, value: string, line?: number) => {
      const control = field(name, line);
      control.value = value;
      control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input'));
    };
    const chooseAccount = async (line: number, code: string) => {
      const input = lineOf(line).querySelector<HTMLInputElement>(
        '[formControlName="account"] input',
      ) as HTMLInputElement;
      input.value = code;
      input.dispatchEvent(new Event('input'));
      await wait(300);
      const search = httpMock().expectOne(is('accounting/accounts/'));
      expect(search.request.params.get('search')).toBe(code);
      expect(search.request.params.get('postable')).toBe('true');
      search.flush(page([{ public_id: `a-${code}`, code, name: `Compte ${code}` }]));
      await opened.stable();
      document.querySelector<HTMLElement>('[role=option]')?.click();
      await opened.stable();
    };
    const submit = () => opened.element().querySelector('form')?.dispatchEvent(new Event('submit'));
    return { ...opened, fill, field, chooseAccount, submit, lineOf };
  }

  describe('form', () => {
    it('create: exactly the contract’s fields, « Enregistrement… », sent once, then the record', async () => {
      const { element, stable, fill, chooseAccount, submit, toasts } = await openForm();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      fill('journal', 'j-ach');
      fill('entry_date', '2026-09-28');
      fill('description', 'Achat de fournitures');
      fill('document_reference', 'FAF-0123');
      await chooseAccount(0, '601100');
      fill('debit', '1 150 000', 0);
      await chooseAccount(1, '401100');
      fill('credit', '1150000', 1);
      await stable();
      expect(text(element())).toContain('Équilibrée');

      submit();
      submit(); // a second click while saving: nothing more
      await stable();
      expect(text(element())).toContain('Enregistrement…');
      const create = httpMock().expectOne(is('accounting/entries/', 'POST'));
      expect(create.request.body).toEqual({
        journal: 'j-ach',
        entry_date: '2026-09-28',
        description: 'Achat de fournitures',
        document_reference: 'FAF-0123',
        lines: [
          { account: 'a-601100', debit: '1150000' },
          { account: 'a-401100', credit: '1150000' },
        ],
      });
      create.flush(testEntry('e-9'));
      await stable();
      expect(toasts()).toContain('Écriture créée.');
      expect(navigate).toHaveBeenCalledWith([BASE, 'e-9']);
    });

    it('opened from a journal: that journal preselected, the form still untouched', async () => {
      const { field } = await openForm(`${BASE}/nouvelle?journal=j-ach`);
      expect(field('journal').value).toBe('j-ach');
      // Leaving asks nothing: the preselection is not a change of the user's.
      expect(await TestBed.inject(Router).navigateByUrl(BASE)).toBe(true);
      await settle();
      httpMock()
        .match(() => true)
        .forEach((request) => request.flush(page([])));
    });

    it('a journal that is not active (or unknown) is not preselected', async () => {
      const { field } = await openForm(`${BASE}/nouvelle?journal=j-old`);
      expect(field('journal').value).toBe('');
    });

    it('lines: added and removed; the gap shown exactly (a reading aid only)', async () => {
      const { element, stable, fill } = await openForm();
      expect(element().querySelectorAll('[data-line]')).toHaveLength(2);
      const add = Array.from(element().querySelectorAll('button')).find((button) =>
        text(button).includes('Ajouter une ligne'),
      );
      add?.click();
      await stable();
      expect(element().querySelectorAll('[data-line]')).toHaveLength(3);
      expect(document.activeElement).toBe(
        element().querySelector('[data-line="2"] [formControlName="account"] input'),
      );
      fill('debit', '100,50', 0);
      fill('credit', '100', 1);
      await stable();
      expect(text(element())).toContain('Écart');
      expect(text(element())).toContain('0,5');
      const remove = element().querySelector<HTMLButtonElement>('[data-line="2"] .remove');
      remove?.click();
      await stable();
      expect(element().querySelectorAll('[data-line]')).toHaveLength(2);
    });

    it('the server’s refusals go under their field or line; the code stays in the details', async () => {
      const { element, stable, fill, chooseAccount, submit } = await openForm();
      fill('journal', 'j-ach');
      fill('description', 'Achat');
      await chooseAccount(0, '601100');
      fill('debit', '100', 0);
      await chooseAccount(1, '401100');
      fill('credit', '100', 1);
      submit();
      await stable();
      httpMock()
        .expectOne(is('accounting/entries/', 'POST'))
        .flush(
          {
            error: {
              code: 'validation_error',
              message: 'x',
              details: { lines: [{}, { account: [{ message: 'x', code: 'unknown' }] }] },
            },
          },
          { status: 400, statusText: 'x' },
        );
      await stable();
      expect(text(element().querySelector('[data-line="1"]') as Element)).toContain(
        'Compte introuvable dans cette société.',
      );

      await chooseAccount(1, '401100');
      submit();
      await stable();
      httpMock()
        .expectOne(is('accounting/entries/', 'POST'))
        .flush(
          {
            error: {
              code: 'accounting_account_not_postable',
              message: 'x',
              details: { account: '401100' },
            },
          },
          { status: 400, statusText: 'x' },
        );
      await stable();
      expect(text(element().querySelector('[data-line="1"]') as Element)).toContain(
        'Un compte choisi n’accepte pas d’écritures.',
      );
      expect(text(element())).toContain('accounting_account_not_postable');

      await chooseAccount(1, '401100');
      submit();
      await stable();
      httpMock()
        .expectOne(is('accounting/entries/', 'POST'))
        .flush(
          {
            error: {
              code: 'accounting_period_closed',
              message: 'x',
              details: { period: '2026-09' },
            },
          },
          { status: 400, statusText: 'x' },
        );
      await stable();
      const date = element()
        .querySelector('[formControlName="entry_date"]')
        ?.closest('alco-form-field') as Element;
      expect(text(date)).toContain('La période de cette date est clôturée.');
    });

    it('a missing field is said before any request', async () => {
      const { element, stable, submit } = await openForm();
      submit();
      await stable();
      httpMock().expectNone((req) => req.method === 'POST');
      expect(text(element())).toContain('Certaines informations sont manquantes ou incorrectes.');
    });

    it('modify: only what changed; the lines with a new date; never id, state or number', async () => {
      const { stable, fill, submit, toasts } = await openForm(
        `${BASE}/e-1/modifier`,
        testEntry('e-1'),
      );
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      fill('description', 'Achat de fournitures de bureau');
      submit();
      await stable();
      const patch = httpMock().expectOne(is('accounting/entries/e-1/', 'PATCH'));
      expect(patch.request.body).toEqual({ description: 'Achat de fournitures de bureau' });
      patch.flush(testEntry('e-1'));
      await stable();
      expect(toasts()).toContain('Modifications enregistrées.');
      expect(navigate).toHaveBeenCalled();

      fill('entry_date', '2026-09-30');
      submit();
      await stable();
      const withLines = httpMock().expectOne(is('accounting/entries/e-1/', 'PATCH'));
      expect(withLines.request.body).toEqual({
        entry_date: '2026-09-30',
        lines: [
          { account: 'a-601100', label: 'Fournitures', debit: '1150000' },
          { account: 'a-401100', credit: '1150000', partner: 'pt-1' },
        ],
      });
      for (const forbidden of ['public_id', 'status', 'entry_number', 'company', 'created_by']) {
        expect(withLines.request.body).not.toHaveProperty(forbidden);
      }
      withLines.flush(testEntry('e-1'));
      await stable();
    });

    it('an entry the server will not modify (validated): said, no form', async () => {
      const { element } = await openForm(
        `${BASE}/e-1/modifier`,
        testEntry('e-1', { status: 'validated' }),
      );
      expect(element().querySelector('form')).toBeNull();
      expect(text(element())).toContain('Cette écriture ne peut pas être modifiée.');
    });

    it('lines with an analytic distribution: kept as they are', async () => {
      const entry = testEntry('e-1', {
        lines: [
          testLine(1, '601100', '100.000000', '0.000000', { analytic_allocation: 'al-1' }),
          testLine(2, '401100', '0.000000', '100.000000'),
        ],
      });
      const { element, field } = await openForm(`${BASE}/e-1/modifier`, entry);
      expect(text(element())).toContain('répartition analytique');
      expect(field('debit', 0).disabled).toBe(true);
      expect(field('journal').disabled).toBe(true);
      expect(field('description').disabled).toBe(false);
    });

    it('unsaved changes: leaving asks; « Continuer l’édition » keeps the form', async () => {
      const { harness, fill, stable } = await openForm();
      fill('description', 'Brouillon en cours');
      await stable();
      expect(TestBed.inject(UnsavedChangesService).hasChanges()).toBe(true);
      const ask = vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(false);
      await harness.navigateByUrl(BASE);
      expect(ask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Modifications non enregistrées',
          cancelLabel: 'Continuer l’édition',
          confirmLabel: 'Quitter',
        }),
      );
      expect(TestBed.inject(Router).url).toBe(`${BASE}/nouvelle`);
    });
  });
});
