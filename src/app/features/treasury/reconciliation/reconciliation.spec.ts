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
import { NavigationService } from '../../../core/navigation/navigation.service';
import { SessionStore } from '../../../core/session/session.store';
import { openTestSession } from '../../../core/session/testing';
import { AlcoConfirmService } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import {
  Reconciliation,
  ReconciliationProposal,
  Statement,
  StatementLine,
  TreasuryAccount,
  TreasuryOperation,
} from '../data-access/reconciliation-models';
import { DereconcileDialogService } from './dereconcile-dialog';
import { ReconciliationPage } from './reconciliation-page';

const BASE = '/app/comptabilite/tresorerie/rapprochements';
const READ = ['accounting.read', 'treasury.read'];
const RECONCILER = [...READ, 'treasury.reconcile'];
const ALL = [...RECONCILER, 'accounting.letter', 'audit.read'];
const GNF = { code: 'GNF', name: 'Franc guinéen', decimal_places: 0, status: 'active' };

const BANK: TreasuryAccount = {
  public_id: 't-bq',
  code: 'BQ-GNF',
  name: 'Banque test',
  account_type: 'bank',
  currency: 'GNF',
  status: 'active',
};
const CASH: TreasuryAccount = { ...BANK, public_id: 't-cash', code: 'CAISSE', name: 'Caisse' };
const STATEMENT: Statement = {
  public_id: 'st-9',
  treasury_account: { public_id: 't-bq', code: 'BQ-GNF' },
  reference: 'REL-09',
  statement_date: '2026-10-02',
  period_start: '2026-09-01',
  period_end: '2026-09-30',
  status: 'open',
};

function bankLine(id: string, extra: Partial<StatementLine> = {}): StatementLine {
  return {
    public_id: id,
    sequence: 1,
    line_date: '2026-09-10',
    value_date: '2026-09-11',
    direction: 'inflow',
    amount: '1200000.000000',
    description: 'VIR CLIENT CLI-001',
    bank_reference: 'VIR-101',
    external_id: 'TX-101',
    running_balance: '5200000.000000',
    status: 'unreconciled',
    exclusion_reason: '',
    ...extra,
  };
}

const OPEN_LINE = bankLine('l-1');
const RECONCILED_LINE = bankLine('l-2', { status: 'reconciled', description: 'VIR CLI-002' });

const OPERATION: TreasuryOperation = {
  public_id: 'op-1',
  treasury_account: { public_id: 't-bq', code: 'BQ-GNF' },
  operation_type: 'deposit',
  direction: 'inflow',
  status: 'accounted',
  operation_date: '2026-09-08',
  amount: '1200000.000000',
  currency: 'GNF',
  reference: 'VIR-101',
  description: 'Règlement CLI-001',
  counterparty: { public_id: 'p-1', code: 'CLI-001' },
  counterparty_name: '',
  accounting_entry: 'e-9',
};

function reconciliation(extra: Partial<Reconciliation> = {}): Reconciliation {
  return {
    public_id: 'r-1',
    statement_line: 'l-2',
    status: 'active',
    operations: ['op-1'],
    lettering: { public_id: 'let-1', reference: 'LET-000001', status: 'active' },
    reason: '',
    cancelled_at: null,
    created_at: '2026-10-04T10:00:00Z',
    ...extra,
  };
}

const PROPOSAL: ReconciliationProposal = {
  line: {
    public_id: 'l-1',
    statement: 'st-9',
    line_date: '2026-09-10',
    direction: 'inflow',
    amount: '1200000.000000',
    description: 'VIR CLIENT CLI-001',
    bank_reference: 'VIR-101',
  },
  operation: {
    public_id: 'op-1',
    operation_date: '2026-09-08',
    direction: 'inflow',
    amount: '1200000.000000',
    reference: 'VIR-101',
    description: 'Règlement CLI-001',
    counterparty: 'CLI-001',
  },
  amount: '1200000.000000',
  matched_amount: '1200000.000000',
  difference: '0.000000',
  criteria: ['same_account', 'same_direction', 'exact_amount', 'only_candidate', 'same_reference'],
  days_apart: 2,
  settlement: {
    payment_line: {
      public_id: 'jl-pay',
      entry: 'BQ1-000201',
      entry_date: '2026-09-08',
      account: '411',
      partner: 'CLI-001',
    },
    invoice_line: {
      public_id: 'jl-inv',
      entry: 'VTE-000101',
      entry_date: '2026-09-02',
      account: '411',
      partner: 'CLI-001',
    },
    amount: '1200000.000000',
  },
};

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

describe('Comptabilité › Trésorerie › Rapprochements (V2.1 A6)', () => {
  async function open(url: string, permissions: readonly string[] = ALL) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          { path: 'app/comptabilite/tresorerie/rapprochements', component: ReconciliationPage },
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

  /** The screen's first reads: currencies, accounts, then the statements of the account. */
  async function start(stable: () => Promise<void>, accounts = [BANK, CASH]) {
    httpMock()
      .expectOne(is('currencies/'))
      .flush(page([GNF]));
    httpMock().expectOne(is('treasury/accounts/')).flush(page(accounts));
    await stable();
    const statements = httpMock().expectOne(is('treasury/statements/'));
    expect(statements.request.params.get('account')).toBe('t-bq');
    statements.flush(page([STATEMENT]));
    await stable();
  }

  async function lines(stable: () => Promise<void>, results: readonly StatementLine[]) {
    const request = httpMock().expectOne(is('treasury/statement-lines/'));
    request.flush(page(results));
    await stable();
    return request;
  }

  it('the screen needs treasury.read within Comptabilité', () => {
    TestBed.configureTestingModule({ providers: [...provideHttpTesting()] });
    const session = TestBed.inject(SessionStore);
    openTestSession(session, { permissions: ['accounting.read'] });
    expect(TestBed.inject(NavigationService).canOpenUrl(BASE)).toBe(false);
    openTestSession(session, { permissions: READ });
    expect(TestBed.inject(NavigationService).canOpenUrl(BASE)).toBe(true);
  });

  it('several accounts: the account is asked for, nothing is listed before', async () => {
    const { element, stable } = await open(BASE);
    httpMock()
      .expectOne(is('currencies/'))
      .flush(page([GNF]));
    httpMock()
      .expectOne(is('treasury/accounts/'))
      .flush(page([BANK, CASH]));
    await stable();
    httpMock().expectNone(is('treasury/statement-lines/'));
    expect(text(element())).toContain('Choisissez le compte de trésorerie à rapprocher.');
  });

  it('a single account is the one shown (its code in the URL)', async () => {
    const { stable } = await open(BASE);
    httpMock()
      .expectOne(is('currencies/'))
      .flush(page([GNF]));
    httpMock()
      .expectOne(is('treasury/accounts/'))
      .flush(page([BANK]));
    await stable();
    expect(TestBed.inject(Router).url).toBe(`${BASE}?compte=BQ-GNF`);
    httpMock()
      .expectOne(is('treasury/statements/'))
      .flush(page([STATEMENT]));
    await stable();
    const request = await lines(stable, []);
    expect(request.request.params.get('account')).toBe('t-bq');
  });

  it('no treasury account: said, nothing else is asked', async () => {
    const { element, stable } = await open(BASE);
    httpMock()
      .expectOne(is('currencies/'))
      .flush(page([GNF]));
    httpMock().expectOne(is('treasury/accounts/')).flush(page([]));
    await stable();
    expect(text(element())).toContain('Aucun compte de trésorerie dans cette société.');
  });

  it('an unknown account code is said; nothing is listed', async () => {
    const { element, stable } = await open(`${BASE}?compte=INCONNU`);
    httpMock()
      .expectOne(is('currencies/'))
      .flush(page([GNF]));
    httpMock()
      .expectOne(is('treasury/accounts/'))
      .flush(page([BANK]));
    await stable();
    expect(text(element())).toContain(
      'Aucun compte de trésorerie de cette société n’a le code « INCONNU ».',
    );
    httpMock().expectNone(is('treasury/statement-lines/'));
  });

  it('the lines to reconcile, as the server lists them; the statement of the URL goes to it', async () => {
    const { element, stable } = await open(`${BASE}?compte=BQ-GNF&releve=st-9`);
    await start(stable);
    const request = await lines(stable, [
      OPEN_LINE,
      bankLine('l-3', { direction: 'outflow', amount: '5000.000000', description: 'FRAIS' }),
    ]);
    expect(request.request.params.get('account')).toBe('t-bq');
    expect(request.request.params.get('statement')).toBe('st-9');
    expect(request.request.params.get('status')).toBe('unreconciled');
    const rows = element().querySelectorAll('alco-table tbody tr');
    expect(rows).toHaveLength(2);
    expect(text(rows[0])).toContain('10/09/2026');
    expect(text(rows[0])).toContain('VIR CLIENT CLI-001');
    expect(text(rows[0])).toContain('Non rapprochée');
    expect(text(rows[1])).toContain('−5');
    expect(text(element())).toContain('2 lignes');
  });

  it('each view asks the server for its state; no line: said', async () => {
    const { element, stable } = await open(`${BASE}?compte=BQ-GNF&vue=exclues`);
    await start(stable);
    const request = await lines(stable, []);
    expect(request.request.params.get('status')).toBe('excluded');
    expect(text(element())).toContain('Aucune ligne exclue.');
  });

  it('a failure of the server is said with a retry', async () => {
    const { element, stable, button } = await open(`${BASE}?compte=BQ-GNF`);
    await start(stable);
    httpMock()
      .expectOne(is('treasury/statement-lines/'))
      .flush(envelope('server_error'), { status: 500, statusText: 'x' });
    await stable();
    expect(text(element())).toContain('Réessayer');
    button('Réessayer')!.click();
    await stable();
    await lines(stable, [OPEN_LINE]);
    expect(element().querySelectorAll('alco-table tbody tr')).toHaveLength(1);
  });

  it('a line opened: its fields, its reconciliations, and the way to the proposals', async () => {
    const { element, stable, button } = await open(`${BASE}?compte=BQ-GNF`);
    await start(stable);
    await lines(stable, [OPEN_LINE]);
    element().querySelector<HTMLButtonElement>('.row-link')!.click();
    await stable();
    const request = httpMock().expectOne(is('treasury/reconciliations/'));
    expect(request.request.params.get('statement_line')).toBe('l-1');
    request.flush(page([]));
    await stable();
    const panel = element().querySelector('alco-line-panel')!;
    expect(text(panel)).toContain('Ligne du 10/09/2026');
    expect(text(panel)).toContain('TX-101');
    expect(text(panel)).toContain('Aucun rapprochement pour cette ligne.');
    button('Voir les propositions')!.click();
    await stable();
    expect(TestBed.inject(Router).url).toContain('vue=propositions');
    httpMock().expectOne(is('treasury/reconciliation-proposals/')).flush(page([]));
    await stable();
  });

  it('a reconciled line: its operation, the lettering created at the confirmation and its link', async () => {
    const { element, stable, button } = await open(
      `${BASE}?compte=BQ-GNF&vue=rapprochees`,
      RECONCILER,
    );
    await start(stable);
    const request = await lines(stable, [RECONCILED_LINE]);
    expect(request.request.params.get('status')).toBe('reconciled');
    element().querySelector<HTMLButtonElement>('.row-link')!.click();
    await stable();
    httpMock()
      .expectOne(is('treasury/reconciliations/'))
      .flush(page([reconciliation()]));
    await stable();
    httpMock().expectOne(is('treasury/operations/op-1/')).flush(OPERATION);
    await stable();
    const panel = element().querySelector('alco-line-panel')!;
    expect(text(panel)).toContain('Rapprochement actif');
    expect(text(panel)).toContain('08/09/2026 · VIR-101 · CLI-001');
    const link = panel.querySelector<HTMLAnchorElement>(
      'a[href="/app/comptabilite/lettrage/let-1"]',
    )!;
    expect(link.textContent?.trim()).toBe('LET-000001');
    expect(text(panel)).toContain('Lettrage actif');
    expect(button('Dé-rapprocher')).toBeDefined();
    // No audit.read: no history asked.
    httpMock().expectNone((req) => req.url.startsWith('/api/v1/audit/'));
  });

  it('dé-rapprocher: confirmed with a reason; only the bank relation is cancelled, and said', async () => {
    const { element, stable, button, toasts } = await open(`${BASE}?compte=BQ-GNF&vue=rapprochees`);
    await start(stable);
    await lines(stable, [RECONCILED_LINE]);
    element().querySelector<HTMLButtonElement>('.row-link')!.click();
    await stable();
    httpMock()
      .expectOne(is('treasury/reconciliations/'))
      .flush(page([reconciliation()]));
    await stable();
    httpMock().expectOne(is('treasury/operations/op-1/')).flush(OPERATION);
    await stable();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/audit/objects/treasury.reconciliation/r-1/')
      .flush(page([]));
    await stable();
    const ask = vi
      .spyOn(TestBed.inject(DereconcileDialogService), 'ask')
      .mockResolvedValue('Mauvaise ligne');
    button('Dé-rapprocher')!.click();
    await stable();
    expect(ask).toHaveBeenCalledWith({ lineDate: '10/09/2026', lettering: 'LET-000001' });
    const cancel = httpMock().expectOne(is('treasury/reconciliations/r-1/cancel/', 'POST'));
    expect(cancel.request.body).toEqual({ reason: 'Mauvaise ligne' });
    cancel.flush(
      reconciliation({
        status: 'cancelled',
        reason: 'Mauvaise ligne',
        cancelled_at: '2026-10-04T11:00:00Z',
      }),
    );
    await stable();
    expect(toasts()).toContain('Rapprochement annulé.');
    const notice = element().querySelector('.notice')!;
    expect(text(notice)).toContain('la ligne du 10/09/2026 est de nouveau à rapprocher');
    expect(text(notice)).toContain('L’opération et son écriture sont inchangées.');
    expect(text(notice)).toContain('Le lettrage LET-000001 reste actif : la facture reste réglée.');
    // The list as the server now has it; no lettering command was sent.
    await lines(stable, []);
    httpMock().expectNone((req) => req.url.includes('unletter'));
  });

  it('a reconciliation already cancelled elsewhere: said, and read again', async () => {
    const { element, stable, button } = await open(
      `${BASE}?compte=BQ-GNF&vue=rapprochees`,
      RECONCILER,
    );
    await start(stable);
    await lines(stable, [RECONCILED_LINE]);
    element().querySelector<HTMLButtonElement>('.row-link')!.click();
    await stable();
    httpMock()
      .expectOne(is('treasury/reconciliations/'))
      .flush(page([reconciliation()]));
    await stable();
    httpMock().expectOne(is('treasury/operations/op-1/')).flush(OPERATION);
    await stable();
    vi.spyOn(TestBed.inject(DereconcileDialogService), 'ask').mockResolvedValue('Doublon');
    button('Dé-rapprocher')!.click();
    await stable();
    httpMock()
      .expectOne(is('treasury/reconciliations/r-1/cancel/', 'POST'))
      .flush(envelope('treasury_reconciliation_cancelled'), { status: 400, statusText: 'x' });
    await stable();
    expect(text(element())).toContain('Ce rapprochement est déjà annulé.');
    httpMock()
      .expectOne(is('treasury/reconciliations/'))
      .flush(
        page([
          reconciliation({
            status: 'cancelled',
            reason: 'Doublon',
            cancelled_at: '2026-10-04T11:00:00Z',
          }),
        ]),
      );
    await stable();
    httpMock().expectOne(is('treasury/operations/op-1/')).flush(OPERATION);
    await stable();
    const panel = element().querySelector('alco-line-panel')!;
    expect(text(panel)).toContain('Rapprochement annulé');
    expect(text(panel)).toContain('Doublon');
    expect(text(panel)).toContain('L’annulation n’a défait que le lien bancaire');
    expect(button('Dé-rapprocher')).toBeUndefined();
  });

  it('without treasury.reconcile: no Dé-rapprocher, no selection of proposals', async () => {
    const { element, stable, button } = await open(`${BASE}?compte=BQ-GNF&vue=rapprochees`, READ);
    await start(stable);
    await lines(stable, [RECONCILED_LINE]);
    element().querySelector<HTMLButtonElement>('.row-link')!.click();
    await stable();
    httpMock()
      .expectOne(is('treasury/reconciliations/'))
      .flush(page([reconciliation()]));
    await stable();
    httpMock().expectOne(is('treasury/operations/op-1/')).flush(OPERATION);
    await stable();
    expect(button('Dé-rapprocher')).toBeUndefined();
    button('Propositions')!.click();
    await stable();
    httpMock()
      .expectOne(is('treasury/reconciliation-proposals/'))
      .flush(page([PROPOSAL]));
    await stable();
    expect(element().querySelector('.proposal input[type="checkbox"]')).toBeNull();
    expect(text(element())).toContain('Proposée, non rapprochée');
  });

  // ---- Proposals ------------------------------------------------------------------------------

  async function proposals(stable: () => Promise<void>, results = [PROPOSAL]) {
    const request = httpMock().expectOne(is('treasury/reconciliation-proposals/'));
    request.flush(page(results));
    await stable();
    return request;
  }

  it('proposals: shown as the server gives them — amounts, difference, criteria, invoice', async () => {
    const { element, stable } = await open(`${BASE}?compte=BQ-GNF&releve=st-9&vue=propositions`);
    await start(stable);
    const request = await proposals(stable);
    expect(request.request.params.get('statement')).toBe('st-9');
    expect(request.request.params.has('account')).toBe(false);
    const card = element().querySelector('.proposal')!;
    expect(text(card)).toContain('Ligne de relevé');
    expect(text(card)).toContain('Opération proposée');
    expect(text(card)).toContain('1 200 000');
    expect(text(card)).toMatch(/Écart\s*0 GNF/);
    expect(text(card)).toContain('2 jours');
    expect(text(card)).toContain('Seule correspondance possible sur le compte');
    expect(text(card)).toContain('Même référence');
    expect(text(card)).toContain('VTE-000101');
    expect(text(card)).toContain('Proposée, non rapprochée');
    expect(text(card)).not.toMatch(/score|%/i);
  });

  it('no proposal from the server: none is made here', async () => {
    const { element, stable } = await open(`${BASE}?compte=BQ-GNF&vue=propositions`);
    await start(stable);
    const request = await proposals(stable, []);
    expect(request.request.params.get('account')).toBe('t-bq');
    expect(element().querySelectorAll('.proposal')).toHaveLength(0);
    expect(text(element())).toContain('Aucune proposition de rapprochement.');
  });

  it('confirmation with the invoice: one command, all or none, then the server’s state', async () => {
    const { element, stable, button, toasts } = await open(
      `${BASE}?compte=BQ-GNF&vue=propositions`,
    );
    await start(stable);
    await proposals(stable);
    const confirm = vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
    const checkboxes = element().querySelectorAll<HTMLInputElement>(
      '.proposal input[type="checkbox"]',
    );
    checkboxes[1].click(); // « Régler aussi cette facture » selects the proposal too
    await stable();
    expect(checkboxes[0].checked).toBe(true);
    expect(text(element())).toContain('1 proposition sélectionnée');
    button('Rapprocher la sélection')!.click();
    await stable();
    expect(confirm.mock.calls[0][0].message).toContain('La facture sera réglée par le lettrage');
    const request = httpMock().expectOne(is('treasury/reconciliation-proposals/confirm/', 'POST'));
    expect(request.request.body).toEqual({
      items: [{ line: 'l-1', operation: 'op-1', invoice_line: 'jl-inv' }],
    });
    request.flush([
      {
        reconciliation: reconciliation({ statement_line: 'l-1' }),
        lettering: { public_id: 'let-1', reference: 'LET-000001' },
      },
    ]);
    await stable();
    expect(toasts()).toContain('Ligne rapprochée.');
    const outcome = element().querySelector('.outcomes')!;
    expect(text(outcome)).toContain('Ligne du 10/09/2026');
    expect(outcome.querySelector('a')!.getAttribute('href')).toBe(
      '/app/comptabilite/lettrage/let-1',
    );
    await proposals(stable, []);
    expect(text(element())).toContain('Aucune proposition de rapprochement.');
  });

  it('confirmation without the invoice: no invoice_line, nothing lettered', async () => {
    const { element, stable, button } = await open(`${BASE}?compte=BQ-GNF&vue=propositions`);
    await start(stable);
    await proposals(stable);
    vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
    element().querySelector<HTMLInputElement>('.proposal input[type="checkbox"]')!.click();
    await stable();
    button('Rapprocher la sélection')!.click();
    await stable();
    const request = httpMock().expectOne(is('treasury/reconciliation-proposals/confirm/', 'POST'));
    expect(request.request.body).toEqual({ items: [{ line: 'l-1', operation: 'op-1' }] });
    request.flush([
      {
        reconciliation: reconciliation({ statement_line: 'l-1', lettering: null }),
        lettering: null,
      },
    ]);
    await stable();
    await proposals(stable, []);
  });

  it('a confirmation cancelled in the dialog sends nothing', async () => {
    const { element, stable, button } = await open(`${BASE}?compte=BQ-GNF&vue=propositions`);
    await start(stable);
    await proposals(stable);
    vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(false);
    element().querySelector<HTMLInputElement>('.proposal input[type="checkbox"]')!.click();
    await stable();
    button('Rapprocher la sélection')!.click();
    await stable();
    httpMock().expectNone(is('treasury/reconciliation-proposals/confirm/', 'POST'));
  });

  it('treasury_reconciliation_proposal_stale: said, selection dropped, proposals read again', async () => {
    const { element, stable, button } = await open(`${BASE}?compte=BQ-GNF&vue=propositions`);
    await start(stable);
    await proposals(stable);
    vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
    element().querySelector<HTMLInputElement>('.proposal input[type="checkbox"]')!.click();
    await stable();
    button('Rapprocher la sélection')!.click();
    await stable();
    httpMock()
      .expectOne(is('treasury/reconciliation-proposals/confirm/', 'POST'))
      .flush(envelope('treasury_reconciliation_proposal_stale'), { status: 400, statusText: 'x' });
    await stable();
    expect(text(element())).toContain('Cette proposition n’est plus valable.');
    await proposals(stable, []);
    expect(button('Rapprocher la sélection')).toBeUndefined();
  });

  it('a refused permission on confirmation is said by its code', async () => {
    const { element, stable, button } = await open(`${BASE}?compte=BQ-GNF&vue=propositions`);
    await start(stable);
    await proposals(stable);
    vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
    element().querySelectorAll<HTMLInputElement>('.proposal input[type="checkbox"]')[1].click();
    await stable();
    button('Rapprocher la sélection')!.click();
    await stable();
    httpMock()
      .expectOne(is('treasury/reconciliation-proposals/confirm/', 'POST'))
      .flush(envelope('company_permission_denied'), { status: 403, statusText: 'x' });
    await stable();
    expect(text(element())).toContain(
      'Vous n’avez pas le droit d’effectuer cette action dans cette société.',
    );
    httpMock().expectNone(is('treasury/reconciliation-proposals/'));
  });

  it('without accounting.letter the invoice cannot be settled from here', async () => {
    const { element, stable } = await open(`${BASE}?compte=BQ-GNF&vue=propositions`, RECONCILER);
    await start(stable);
    await proposals(stable);
    expect(element().querySelectorAll('.proposal input[type="checkbox"]')).toHaveLength(1);
    expect(text(element())).toContain('Le règlement de la facture demande le droit de lettrer.');
  });

  it('after a company change, the screen without the previous account', () => {
    TestBed.configureTestingModule({ providers: [...provideHttpTesting()] });
    openTestSession(TestBed.inject(SessionStore), { permissions: READ });
    const navigation = TestBed.inject(NavigationService);
    expect(navigation.landingUrl(`${BASE}?compte=BQ-GNF&vue=propositions`)).toBe(BASE);
  });
});
