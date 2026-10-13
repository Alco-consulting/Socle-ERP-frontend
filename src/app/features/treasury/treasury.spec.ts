import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import {
  clearCookie,
  envelope,
  httpMock,
  provideHttpTesting,
  setCookie,
} from '../../core/http/testing';
import { NavigationService } from '../../core/navigation/navigation.service';
import { SessionStore } from '../../core/session/session.store';
import { openTestSession } from '../../core/session/testing';
import { AlcoConfirmService } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import {
  Statement,
  StatementLine,
  StatementState,
  Transfer,
  TreasuryAccount,
  TreasuryOperation,
} from './data-access/reconciliation-models';
import { TreasuryPostingDialogService } from './posting-dialog';
import { TreasuryReasonDialogService } from './reason-dialog';
import { STATEMENT_TRANSFER } from './statement-transfer';
import { TREASURY_ROUTES } from './treasury.routes';

const ROOT = '/app/comptabilite/tresorerie';
const READ = ['accounting.read', 'treasury.read'];
const ALL = [
  ...READ,
  'treasury.create',
  'treasury.update',
  'treasury.confirm',
  'treasury.account',
  'treasury.reconcile',
  'treasury.manage_accounts',
  'treasury.manage_statements',
  'audit.read',
  'documents.read',
];
const GNF = { code: 'GNF', name: 'Franc guinéen', decimal_places: 0, status: 'active' };

const BANK: TreasuryAccount = {
  public_id: 't-bq',
  code: 'BQ-GNF',
  name: 'Banque test',
  account_type: 'bank',
  currency: 'GNF',
  ledger_account: { public_id: 'a-521', code: '521100' },
  journal: { public_id: 'j-bq', code: 'BQ1' },
  bank_name: 'Banque de test',
  bank_branch: '',
  account_number: '••••5678',
  iban: '',
  bic: '',
  opening_balance: '1000000.000000',
  status: 'active',
  created_at: '2026-09-01T10:00:00Z',
};
const CASH: TreasuryAccount = {
  ...BANK,
  public_id: 't-cash',
  code: 'CAISSE',
  name: 'Caisse',
  account_type: 'cash',
  ledger_account: null,
  journal: null,
};

function operation(extra: Partial<TreasuryOperation> = {}): TreasuryOperation {
  return {
    public_id: 'op-1',
    treasury_account: { public_id: 't-bq', code: 'BQ-GNF' },
    operation_type: 'deposit',
    direction: 'inflow',
    status: 'confirmed',
    operation_date: '2026-09-08',
    value_date: null,
    amount: '1200000.000000',
    currency: 'GNF',
    reference: 'VIR-101',
    description: 'Règlement CLI-001',
    counterparty: { public_id: 'p-1', code: 'CLI-001' },
    counterparty_name: '',
    offset_account: { public_id: 'a-411', code: '411100' },
    transfer: null,
    related_operation: null,
    reason: '',
    accounting_entry: null,
    reconciled: false,
    confirmed_at: '2026-09-08T10:00:00Z',
    accounted_at: null,
    cancelled_at: null,
    ...extra,
  };
}

const STATEMENT: Statement = {
  public_id: 'st-9',
  treasury_account: { public_id: 't-bq', code: 'BQ-GNF' },
  reference: 'REL-09',
  statement_date: '2026-10-02',
  period_start: '2026-09-01',
  period_end: '2026-09-30',
  opening_balance: '3000000.000000',
  closing_balance: '4175000.000000',
  status: 'open',
};

function state(extra: Partial<StatementState> = {}): StatementState {
  return {
    statement: 'st-9',
    statement_balance: '4175000.000000',
    lines_total: '1175000.000000',
    treasury_balance: '4175000.000000',
    accounting_balance: '4175000.000000',
    accounting_currency: 'GNF',
    statement_vs_treasury: '0.000000',
    statement_vs_accounting: '0.000000',
    opening_balance: '3000000.000000',
    computed_closing_balance: '4175000.000000',
    closing_difference: '0.000000',
    balanced: true,
    reconciled_total: '0',
    unreconciled_total: '1175000.000000',
    excluded_total: '0',
    reconciled_count: 0,
    unreconciled_count: 2,
    excluded_count: 0,
    ...extra,
  };
}

function bankLine(id: string, extra: Partial<StatementLine> = {}): StatementLine {
  return {
    public_id: id,
    sequence: 1,
    line_date: '2026-09-10',
    value_date: null,
    direction: 'inflow',
    amount: '1200000.000000',
    description: 'VIR CLIENT CLI-001',
    bank_reference: 'VIR-101',
    external_id: 'TX-101',
    running_balance: null,
    status: 'unreconciled',
    exclusion_reason: '',
    ...extra,
  };
}

const page = <T>(results: readonly T[] = [], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const is =
  (path: string, method = 'GET') =>
  (req: { url: string; method: string }) =>
    req.url === `/api/v1/${path}` && req.method === method;
const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ');

describe('Comptabilité › Trésorerie (Module 6)', () => {
  async function open(url: string, permissions: readonly string[] = ALL) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([{ path: 'app/comptabilite', children: TREASURY_ROUTES }]),
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
      await settle();
    };
    const toasts = () =>
      TestBed.inject(AlcoToastService)
        .toasts()
        .map((toast) => toast.message);
    const button = (label: string) =>
      Array.from(element().querySelectorAll<HTMLButtonElement>('button')).find((item) =>
        text(item).includes(label),
      );
    return { harness, element, stable, toasts, button };
  }

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  const currencies = () =>
    httpMock()
      .match(is('currencies/'))
      .forEach((request) => request.flush(page([GNF])));

  // ---- Access ---------------------------------------------------------------------------------

  it('every treasury screen needs treasury.read within Comptabilité', () => {
    TestBed.configureTestingModule({ providers: [...provideHttpTesting()] });
    const session = TestBed.inject(SessionStore);
    const navigation = TestBed.inject(NavigationService);
    openTestSession(session, { permissions: ['accounting.read'] });
    for (const screen of ['operations', 'virements', 'releves', 'rapprochements']) {
      expect(navigation.canOpenUrl(`${ROOT}/${screen}`)).toBe(false);
    }
    openTestSession(session, { permissions: READ });
    for (const screen of ['operations', 'virements', 'releves', 'rapprochements']) {
      expect(navigation.canOpenUrl(`${ROOT}/${screen}`)).toBe(true);
    }
  });

  it('after a company change, the same treasury screen without its record nor filters', () => {
    TestBed.configureTestingModule({ providers: [...provideHttpTesting()] });
    openTestSession(TestBed.inject(SessionStore), { permissions: READ });
    const navigation = TestBed.inject(NavigationService);
    expect(navigation.landingUrl(`${ROOT}/operations?compte=BQ-GNF&etat=draft`)).toBe(
      `${ROOT}/operations`,
    );
    expect(navigation.landingUrl(`${ROOT}/releves/st-9`)).toBe(`${ROOT}/releves`);
  });

  // ---- Operations ---------------------------------------------------------------------------------

  it('operations: the API’s filters from the URL; the account found by its code', async () => {
    const { element, stable } = await open(
      `${ROOT}/operations?compte=BQ-GNF&type=deposit&sens=inflow&etat=confirmed&du=2026-09-01&au=2026-09-30&reference=VIR-101&rapprochee=non`,
    );
    currencies();
    httpMock()
      .expectOne(is('treasury/accounts/'))
      .flush(page([BANK, CASH]));
    await stable();
    const request = httpMock().expectOne(is('treasury/operations/'));
    const params = request.request.params;
    expect(params.get('account')).toBe('t-bq');
    expect(params.get('operation_type')).toBe('deposit');
    expect(params.get('direction')).toBe('inflow');
    expect(params.get('status')).toBe('confirmed');
    expect(params.get('date_from')).toBe('2026-09-01');
    expect(params.get('date_to')).toBe('2026-09-30');
    expect(params.get('reference')).toBe('VIR-101');
    expect(params.get('reconciled')).toBe('false');
    request.flush(
      page([
        operation(),
        operation({
          public_id: 'op-2',
          direction: 'outflow',
          amount: '25000.000000',
          status: 'draft',
          reference: 'FRAIS',
        }),
      ]),
    );
    await stable();
    const rows = element().querySelectorAll('alco-table tbody tr');
    expect(text(rows[0])).toContain('VIR-101');
    expect(text(rows[0])).toContain('1 200 000 GNF');
    expect(text(rows[0])).toContain('Confirmée');
    expect(text(rows[1])).toContain('−25 000 GNF');
    expect(text(rows[1])).toContain('Brouillon');
  });

  it('operations: an unknown account code is said; nothing is listed', async () => {
    const { element, stable } = await open(`${ROOT}/operations?compte=INCONNU`);
    currencies();
    httpMock()
      .expectOne(is('treasury/accounts/'))
      .flush(page([BANK]));
    await stable();
    httpMock().expectNone(is('treasury/operations/'));
    expect(text(element())).toContain(
      'Aucun compte de trésorerie de cette société n’a le code « INCONNU ».',
    );
  });

  async function openOperation(view: Awaited<ReturnType<typeof open>>, record: TreasuryOperation) {
    currencies();
    httpMock()
      .expectOne(is(`treasury/operations/${record.public_id}/`))
      .flush(record);
    await view.stable();
    httpMock()
      .match((req) => req.url.startsWith('/api/v1/documents/'))
      .forEach((r) => r.flush(page([])));
    httpMock()
      .match((req) => req.url.startsWith('/api/v1/audit/'))
      .forEach((r) => r.flush(page([])));
    await view.stable();
  }

  const menuItems = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).map((node) =>
      text(node).trim(),
    );

  it('operation record: its fields and real relations, the commands of its state', async () => {
    const view = await open(`${ROOT}/operations/op-1`);
    await openOperation(view, operation({ accounting_entry: 'e-9' }));
    const sheet = text(view.element());
    expect(sheet).toContain('Encaissement du 08/09/2026');
    expect(sheet).toContain('1 200 000 GNF');
    expect(sheet).toContain('CLI-001');
    expect(sheet).toContain('411100');
    const smart = Array.from(view.element().querySelectorAll<HTMLAnchorElement>('a.smart')).map(
      (item) => item.getAttribute('href'),
    );
    expect(smart).toContain('/app/comptabilite/ecritures/e-9');
    view.element().querySelector<HTMLButtonElement>('alco-dropdown button')!.click();
    await view.stable();
    expect(menuItems()).toEqual(['Comptabiliser', 'Annuler l’opération']);
  });

  it('a draft: Modifier, Confirmer, Annuler; a transfer leg: nothing here', async () => {
    const view = await open(`${ROOT}/operations/op-1`);
    await openOperation(view, operation({ status: 'draft' }));
    expect(view.element().querySelector('a[href$="/modifier"]')).not.toBeNull();
    view.element().querySelector<HTMLButtonElement>('alco-dropdown button')!.click();
    await view.stable();
    expect(menuItems()).toEqual(['Confirmer', 'Annuler l’opération']);
  });

  it('a transfer leg changes only through its transfer', async () => {
    const view = await open(`${ROOT}/operations/op-1`);
    await openOperation(view, operation({ status: 'draft', transfer: 'tr-1' }));
    expect(view.element().querySelector('alco-dropdown')).toBeNull();
    expect(view.element().querySelector('a[href$="/modifier"]')).toBeNull();
    expect(text(view.element())).toContain('jambe d’un virement');
  });

  it('cancelling: a reason, the command, then the record read again', async () => {
    const view = await open(`${ROOT}/operations/op-1`);
    await openOperation(view, operation());
    const ask = vi
      .spyOn(TestBed.inject(TreasuryReasonDialogService), 'ask')
      .mockResolvedValue({ reason: 'Doublon', date: null });
    view.element().querySelector<HTMLButtonElement>('alco-dropdown button')!.click();
    await view.stable();
    Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .find((node) => text(node).includes('Annuler l’opération'))!
      .click();
    await view.stable();
    expect(ask).toHaveBeenCalled();
    const request = httpMock().expectOne(is('treasury/operations/op-1/cancel/', 'POST'));
    expect(request.request.body).toEqual({ reason: 'Doublon' });
    request.flush(operation({ status: 'cancelled', reason: 'Doublon' }));
    await view.stable();
    expect(view.toasts()).toContain('Opération annulée.');
    await openOperation(view, operation({ status: 'cancelled', reason: 'Doublon' }));
    expect(text(view.element())).toContain('Cette opération est annulée');
  });

  it('posting: the journal chosen goes to the server; its refusal is said by its code', async () => {
    const view = await open(`${ROOT}/operations/op-1`);
    await openOperation(view, operation());
    vi.spyOn(TestBed.inject(TreasuryPostingDialogService), 'ask').mockResolvedValue({
      journal: 'j-bq',
    });
    view.element().querySelector<HTMLButtonElement>('alco-dropdown button')!.click();
    await view.stable();
    Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .find((node) => text(node).includes('Comptabiliser'))!
      .click();
    await view.stable();
    httpMock().expectOne(is('treasury/accounts/t-bq/')).flush(BANK);
    await view.stable();
    const request = httpMock().expectOne(is('treasury/operations/op-1/account/', 'POST'));
    expect(request.request.body).toEqual({ journal: 'j-bq' });
    request.flush(envelope('treasury_offset_account_missing'), { status: 400, statusText: 'x' });
    await view.stable();
    expect(text(view.element())).toContain('Le compte de contrepartie manque.');
  });

  it('a stale transition is said and the record read again', async () => {
    const view = await open(`${ROOT}/operations/op-1`);
    await openOperation(view, operation({ status: 'draft' }));
    vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
    view.element().querySelector<HTMLButtonElement>('alco-dropdown button')!.click();
    await view.stable();
    Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .find((node) => text(node).includes('Confirmer'))!
      .click();
    await view.stable();
    httpMock()
      .expectOne(is('treasury/operations/op-1/confirm/', 'POST'))
      .flush(envelope('treasury_invalid_transition'), { status: 400, statusText: 'x' });
    await view.stable();
    expect(text(view.element())).toContain('Cette étape n’est pas possible depuis l’état actuel.');
    await openOperation(view, operation());
  });

  it('read only: no command, no modification', async () => {
    const view = await open(`${ROOT}/operations/op-1`, READ);
    currencies();
    httpMock()
      .expectOne(is('treasury/operations/op-1/'))
      .flush(operation({ status: 'draft' }));
    await view.stable();
    expect(view.element().querySelector('alco-dropdown')).toBeNull();
    expect(view.element().querySelector('a[href$="/modifier"]')).toBeNull();
  });

  it('creation: the contract’s fields, codes found by the server, one idempotency key', async () => {
    const view = await open(`${ROOT}/operations/nouvelle?compte=BQ-GNF`);
    httpMock()
      .expectOne(is('treasury/accounts/'))
      .flush(page([BANK]));
    await view.stable();
    const set = (name: string, value: string) => {
      const control = view
        .element()
        .querySelector<HTMLInputElement | HTMLSelectElement>(`[formControlName="${name}"]`)!;
      control.value = value;
      control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input'));
    };
    set('operation_type', 'deposit');
    set('direction', 'inflow');
    set('amount', '1 200 000');
    set('operation_date', '2026-09-08');
    set('counterparty', 'CLI-001');
    view.element().querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await view.stable();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/partners/' && req.params.get('code') === 'CLI-001')
      .flush(page([{ public_id: 'p-1', code: 'CLI-001', name: 'Client' }]));
    await view.stable();
    const request = httpMock().expectOne(is('treasury/operations/', 'POST'));
    expect(request.request.body).toMatchObject({
      treasury_account: 't-bq',
      operation_type: 'deposit',
      direction: 'inflow',
      operation_date: '2026-09-08',
      amount: '1200000',
      counterparty: 'p-1',
      offset_account: null,
    });
    expect(request.request.body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    request.flush(operation({ status: 'draft' }));
    await view.stable();
    expect(TestBed.inject(Router).url).toBe(`${ROOT}/operations/op-1`);
    currencies();
    httpMock()
      .match(is('treasury/operations/op-1/'))
      .forEach((r) => r.flush(operation({ status: 'draft' })));
    await view.stable();
    httpMock()
      .match((req) => req.url.startsWith('/api/v1/documents/'))
      .forEach((r) => r.flush(page([])));
    httpMock()
      .match((req) => req.url.startsWith('/api/v1/audit/'))
      .forEach((r) => r.flush(page([])));
  });

  // ---- Transfers ---------------------------------------------------------------------------------

  it('transfers: their legs and the commands of the legs’ state', async () => {
    const transfer: Transfer = {
      public_id: 'tr-1',
      source_account: { public_id: 't-bq', code: 'BQ-GNF' },
      destination_account: { public_id: 't-cash', code: 'CAISSE' },
      transfer_date: '2026-09-15',
      amount: '500000.000000',
      destination_amount: '500000.000000',
      exchange_rate: '1',
      rounding: '',
      reference: 'VIR-INT-1',
      description: '',
      operations: [
        operation({
          public_id: 'op-out',
          direction: 'outflow',
          status: 'draft',
          transfer: 'tr-1',
          amount: '500000.000000',
        }),
        operation({
          public_id: 'op-in',
          direction: 'inflow',
          status: 'draft',
          transfer: 'tr-1',
          amount: '500000.000000',
          treasury_account: { public_id: 't-cash', code: 'CAISSE' },
        }),
      ],
      created_at: '2026-09-15T10:00:00Z',
    };
    const view = await open(`${ROOT}/virements/tr-1`);
    currencies();
    httpMock().expectOne(is('treasury/transfers/tr-1/')).flush(transfer);
    await view.stable();
    httpMock()
      .match((req) => req.url.startsWith('/api/v1/audit/'))
      .forEach((r) => r.flush(page([])));
    await view.stable();
    expect(text(view.element())).toContain('BQ-GNF → CAISSE');
    expect(view.element().querySelectorAll('#legs-title ~ alco-table tbody tr')).toHaveLength(2);
    view.element().querySelector<HTMLButtonElement>('alco-dropdown button')!.click();
    await view.stable();
    expect(menuItems()).toEqual(['Confirmer le virement', 'Annuler le virement']);
  });

  // ---- Statements ---------------------------------------------------------------------------------

  it('statements: of one account by its code and state, server pages; the import offered', async () => {
    const { element, stable } = await open(`${ROOT}/releves?compte=BQ-GNF&etat=open`, [
      ...ALL,
      'imports_exports.create',
    ]);
    currencies();
    httpMock()
      .expectOne(is('treasury/accounts/'))
      .flush(page([BANK]));
    await stable();
    const request = httpMock().expectOne(is('treasury/statements/'));
    expect(request.request.params.get('account')).toBe('t-bq');
    expect(request.request.params.get('status')).toBe('open');
    request.flush(page([STATEMENT]));
    await stable();
    const row = element().querySelector('alco-table tbody tr')!;
    expect(text(row)).toContain('REL-09');
    expect(text(row)).toContain('4 175 000 GNF');
    expect(text(row)).toContain('Ouvert');
    expect(element().querySelector('alco-domain-transfers alco-dropdown')).not.toBeNull();
  });

  async function openStatement(
    view: Awaited<ReturnType<typeof open>>,
    check: StatementState,
    lines: readonly StatementLine[],
    first = true,
  ) {
    currencies();
    httpMock().expectOne(is('treasury/statements/st-9/')).flush(STATEMENT);
    httpMock().expectOne(is('treasury/statements/st-9/reconciliation/')).flush(check);
    const linesRequest = httpMock().expectOne(is('treasury/statement-lines/'));
    expect(linesRequest.request.params.get('statement')).toBe('st-9');
    linesRequest.flush(page(lines));
    await view.stable();
    if (first) {
      // The account (its currency) is read once.
      httpMock().expectOne(is('treasury/accounts/t-bq/')).flush(BANK);
      await view.stable();
    }
    httpMock()
      .match((req) => req.url.startsWith('/api/v1/audit/'))
      .forEach((r) => r.flush(page([])));
    await view.stable();
  }

  it('statement: the server’s check, balanced; its steps; its lines and their way to the reconciliation', async () => {
    const view = await open(`${ROOT}/releves/st-9`);
    await openStatement(view, state(), [
      bankLine('l-1'),
      bankLine('l-2', { status: 'reconciled', description: 'VIR CLI-003' }),
    ]);
    const sheet = text(view.element());
    expect(sheet).toContain('Relevé équilibré');
    expect(sheet).toMatch(/Solde calculé par le serveur\s*4 175 000 GNF/);
    expect(view.element().querySelector('[aria-current="step"]')!.textContent).toContain(
      'Rapproché',
    );
    const rows = view.element().querySelectorAll('#lignes alco-table tbody tr');
    // An unreconciled line: to the reconciliation, or set aside.
    expect(rows[0].querySelector('a')!.getAttribute('href')).toBe(
      `${ROOT}/rapprochements?compte=BQ-GNF&releve=st-9`,
    );
    expect(text(rows[0])).toContain('Exclure');
    // A reconciled line is protected: only its reconciliation.
    expect(text(rows[1])).toContain('Voir le rapprochement');
    expect(rows[1].querySelector('button')).toBeNull();
    expect(rows[1].querySelector('a')!.getAttribute('href')).toBe(
      `${ROOT}/rapprochements?compte=BQ-GNF&releve=st-9&vue=rapprochees`,
    );
  });

  it('statement: a difference is said to be checked, never corrected', async () => {
    const view = await open(`${ROOT}/releves/st-9`);
    await openStatement(
      view,
      state({
        balanced: false,
        closing_difference: '5000.000000',
        computed_closing_balance: '4170000.000000',
      }),
      [],
    );
    const alert = view.element().querySelector('.check--warning')!;
    expect(text(alert)).toContain('Vérification nécessaire');
    expect(text(alert)).toContain('5 000 GNF');
    expect(view.element().querySelector('[aria-current="step"]')!.textContent).toContain('Vérifié');
  });

  it('statement: excluding a line takes a reason; closing a refused statement is said', async () => {
    const view = await open(`${ROOT}/releves/st-9`);
    await openStatement(view, state(), [bankLine('l-1')]);
    vi.spyOn(TestBed.inject(TreasuryReasonDialogService), 'ask').mockResolvedValue({
      reason: 'Frais contestés',
      date: null,
    });
    view.button('Exclure')!.click();
    await view.stable();
    const exclude = httpMock().expectOne(is('treasury/statement-lines/l-1/exclude/', 'POST'));
    expect(exclude.request.body).toEqual({ reason: 'Frais contestés' });
    exclude.flush(bankLine('l-1', { status: 'excluded', exclusion_reason: 'Frais contestés' }));
    await view.stable();
    expect(view.toasts()).toContain('Ligne exclue du rapprochement.');
    await openStatement(
      view,
      state(),
      [bankLine('l-1', { status: 'excluded', exclusion_reason: 'Frais contestés' })],
      false,
    );
    vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
    view.button('Clôturer')!.click();
    await view.stable();
    httpMock()
      .expectOne(is('treasury/statements/st-9/close/', 'POST'))
      .flush(envelope('treasury_statement_unbalanced'), { status: 400, statusText: 'x' });
    await view.stable();
    expect(text(view.element())).toContain('Le relevé n’est pas équilibré.');
  });

  it('statement: without treasury.reconcile nor manage_statements, no exclusion nor closing', async () => {
    const view = await open(`${ROOT}/releves/st-9`, READ);
    currencies();
    httpMock().expectOne(is('treasury/statements/st-9/')).flush(STATEMENT);
    httpMock().expectOne(is('treasury/statements/st-9/reconciliation/')).flush(state());
    httpMock()
      .expectOne(is('treasury/statement-lines/'))
      .flush(page([bankLine('l-1')]));
    await view.stable();
    httpMock().expectOne(is('treasury/accounts/t-bq/')).flush(BANK);
    await view.stable();
    expect(view.button('Exclure')).toBeUndefined();
    expect(view.button('Clôturer')).toBeUndefined();
  });

  // ---- Import -----------------------------------------------------------------------------------

  it('the statements import is the generic pipeline’s, with the treasury’s permission', () => {
    TestBed.configureTestingModule({ providers: [...provideHttpTesting()] });
    expect(STATEMENT_TRANSFER.importType).toBe('treasury.statements');
    expect(STATEMENT_TRANSFER.exportType).toBeNull();
    expect(STATEMENT_TRANSFER.importPermission).toBe('treasury.manage_statements');
    expect(STATEMENT_TRANSFER.creationKey).toBe('statements');
  });

  it('the import screen needs imports_exports.create and treasury.manage_statements', async () => {
    const { stable } = await open(`${ROOT}/releves/import`, ALL);
    await stable();
    // Refused by its guard: back to the statements.
    expect(TestBed.inject(Router).url).toBe(`${ROOT}/releves`);
    httpMock()
      .match(() => true)
      .forEach((request) => request.flush(page([])));
  });
});
