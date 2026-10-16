import { Route } from '@playwright/test';

import { ACCOUNT_IMPORT_FIELDS } from './fake-account-import';
import { FakeAccounting } from './fake-accounting';
import { FakeLettering } from './fake-lettering';
import { IMPORT_FIELDS, PartnersContext } from './fake-partners';
import {
  BALANCES,
  IMPORT_SCENARIOS,
  ImportRunJson,
  STATEMENT_IMPORT_FIELDS,
  StateJson,
  runJson,
  state,
  uploadedName,
} from './fake-treasury-module';

/**
 * Bank reconciliation (V2.1, lots A6, A6.1, A6.2) in the fake API, shaped like the OpenAPI
 * schemas (`TreasuryTreasuryAccount`, `TreasuryStatement`, `TreasuryStatementLine`,
 * `TreasuryOperation`, `TreasuryProposal`, `TreasuryReconciliation`, `TreasuryConfirmed`),
 * company scoped, with the contract's permissions, statuses and errors. It does NOT play the
 * server's matching: the proposals are explicit fixtures (`PROPOSALS`), listed while their
 * line is unreconciled; a confirmation is accepted only for a listed proposal (else
 * `treasury_reconciliation_proposal_stale`), and a cancellation only cancels the bank
 * relation — the lettering is never touched (A6.1).
 */

type Direction = 'inflow' | 'outflow';
type LineStatus = 'unreconciled' | 'reconciled' | 'excluded';

interface LineJson {
  public_id: string;
  sequence: number;
  line_date: string;
  value_date: string | null;
  direction: Direction;
  amount: string;
  description: string;
  bank_reference: string;
  external_id: string;
  running_balance: string | null;
  status: LineStatus;
  exclusion_reason: string;
}

type OperationStatus = 'draft' | 'confirmed' | 'accounted' | 'cancelled';

interface OperationJson {
  public_id: string;
  treasury_account: { public_id: string; code: string };
  operation_type: string;
  direction: Direction;
  status: OperationStatus;
  operation_date: string;
  value_date: string | null;
  amount: string;
  currency: string;
  reference: string;
  description: string;
  counterparty: { public_id: string; code: string } | null;
  counterparty_name: string;
  offset_account: { public_id: string; code: string } | null;
  transfer: string | null;
  related_operation: string | null;
  reason: string;
  accounting_entry: string | null;
  reconciled?: boolean;
  confirmed_at: string | null;
  accounted_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

interface AccountJson {
  public_id: string;
  code: string;
  name: string;
  account_type: string;
  currency: string;
  ledger_account: { public_id: string; code: string } | null;
  journal: { public_id: string; code: string } | null;
  bank_name: string;
  bank_branch: string;
  account_number: string;
  iban: string;
  bic: string;
  opening_balance: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ReconciliationJson {
  public_id: string;
  statement_line: string;
  status: 'active' | 'cancelled';
  operations: string[];
  lettering: { public_id: string; reference: string; status: string } | null;
  reason: string;
  cancelled_at: string | null;
  created_at: string;
}

interface EventJson {
  public_id: string;
  object_type: string;
  object_id: string;
  action: string;
  occurred_at: string;
  user: { email: string } | null;
}

const D = (units: string) => `${units}.000000`;
const NOW = '2026-10-04T10:00:00Z';
let sequence = 0;
const uuid = () => `80000000-0000-4000-9000-${String(++sequence).padStart(12, '0')}`;
const error = (code: string, details: unknown = null) => ({
  error: { code, message: code, details, correlation_id: 'e2e' },
});

/** Bank lines of company A's bank account (`B<n>` keys), statement REL-2026-09. */
const LINES: readonly (Omit<
  LineJson,
  'public_id' | 'sequence' | 'value_date' | 'running_balance'
> & {
  key: string;
})[] = [
  {
    key: 'B1',
    line_date: '2026-09-10',
    direction: 'inflow',
    amount: D('1200000'),
    description: 'VIR CLIENT CLI-001 FAC-101',
    bank_reference: 'VIR-101',
    external_id: 'TX-101',
    status: 'unreconciled',
    exclusion_reason: '',
  },
  {
    key: 'B2',
    line_date: '2026-09-12',
    direction: 'inflow',
    amount: D('750000'),
    description: 'VIR CLI-002',
    bank_reference: 'VIR-102',
    external_id: 'TX-102',
    status: 'unreconciled',
    exclusion_reason: '',
  },
  {
    key: 'B3',
    line_date: '2026-09-15',
    direction: 'outflow',
    amount: D('25000'),
    description: 'FRAIS BANCAIRES SEPTEMBRE',
    bank_reference: '',
    external_id: 'TX-103',
    status: 'unreconciled',
    exclusion_reason: '',
  },
  {
    key: 'B4',
    line_date: '2026-09-05',
    direction: 'inflow',
    amount: D('500000'),
    description: 'VIR CLI-003 FAC-099',
    bank_reference: 'VIR-099',
    external_id: 'TX-099',
    status: 'reconciled',
    exclusion_reason: '',
  },
  {
    key: 'B5',
    line_date: '2026-09-03',
    direction: 'outflow',
    amount: D('10000'),
    description: 'COMMISSION CONTESTÉE',
    bank_reference: '',
    external_id: 'TX-098',
    status: 'excluded',
    exclusion_reason: 'Commission contestée auprès de la banque',
  },
];

/** Booked operations of the bank account (`O<n>` keys). */
const OPERATIONS: readonly {
  key: string;
  date: string;
  amount: string;
  reference: string;
  description: string;
  partner: string;
}[] = [
  {
    key: 'O1',
    date: '2026-09-08',
    amount: '1200000',
    reference: 'VIR-101',
    description: 'Règlement FAC-101',
    partner: 'CLI-001',
  },
  {
    key: 'O2',
    date: '2026-09-12',
    amount: '750000',
    reference: 'VIR-102',
    description: 'Règlement CLI-002',
    partner: 'CLI-002',
  },
  {
    key: 'O4',
    date: '2026-09-04',
    amount: '500000',
    reference: 'VIR-099',
    description: 'Règlement FAC-099',
    partner: 'CLI-003',
  },
];

/** The server's proposals (fixtures): a line, its operation, the facts and the invoice. */
const PROPOSALS: readonly {
  line: string;
  operation: string;
  criteria: readonly string[];
  days: number;
  invoice: { entry: string; date: string } | null;
}[] = [
  {
    line: 'B1',
    operation: 'O1',
    criteria: [
      'same_account',
      'same_direction',
      'exact_amount',
      'only_candidate',
      'same_reference',
    ],
    days: 2,
    invoice: { entry: 'VTE-000101', date: '2026-09-02' },
  },
  {
    line: 'B2',
    operation: 'O2',
    criteria: ['same_account', 'same_direction', 'exact_amount', 'only_candidate'],
    days: 0,
    invoice: null,
  },
];

interface TransferJson {
  public_id: string;
  source_account: { public_id: string; code: string };
  destination_account: { public_id: string; code: string };
  transfer_date: string;
  amount: string;
  destination_amount: string;
  exchange_rate: string;
  rate_details: Record<string, string>;
  rounding: string;
  reference: string;
  description: string;
  operations: OperationJson[];
  created_at: string;
}

interface Desk {
  company: string;
  accounts: AccountJson[];
  statements: {
    public_id: string;
    treasury_account: { public_id: string; code: string };
    reference: string;
    statement_date: string;
    period_start: string;
    period_end: string;
    opening_balance: string;
    closing_balance: string;
    status: string;
    lines: LineJson[];
    created_at: string;
    updated_at: string;
  }[];
  lines: Map<string, LineJson>;
  operations: Map<string, OperationJson>;
  invoices: Map<string, string>;
  reconciliations: ReconciliationJson[];
  events: EventJson[];
  letterings: number;
  /** The server's check of each statement (fixtures). */
  states: Map<string, StateJson>;
  /** The statement of each line (public ids). */
  lineStatement: Map<string, string>;
  transfers: TransferJson[];
  entries: number;
}

export class FakeTreasury {
  private readonly desks: Record<string, Desk> = {};
  /** What each transaction settled (note backend 0044). */
  private readonly settled = new Map<string, string[]>();
  private expireNext = false;

  constructor(
    private readonly context: PartnersContext,
    private readonly lettering: FakeLettering,
    private readonly accounting?: FakeAccounting,
  ) {}

  /** A bank or cash journal is its treasury account (note backend 0043): BQ1 and CAI. */
  private journalOf(company: string, code: string): { public_id: string; code: string } | null {
    const journal = this.accounting?.books(company).journals.find((item) => item.code === code);
    return journal ? { public_id: journal.public_id, code: journal.code } : null;
  }

  /** The fixture line of a key (`B1`), for the tests. */
  line(company: string, key: string): LineJson {
    const found = this.desk(company).lines.get(key);
    if (!found) {
      throw new Error(`No fixture line ${key}`);
    }
    return found;
  }

  reconciliations(company: string): readonly ReconciliationJson[] {
    return this.desk(company).reconciliations;
  }

  /** Another user reconciles this line first: its proposal no longer stands. */
  reconcileBehind(company: string, key: string): void {
    const desk = this.desk(company);
    const proposal = PROPOSALS.find((item) => item.line === key)!;
    this.reconcile(desk, key, proposal.operation, null);
  }

  /** The session ends: the next treasury request answers 403 `not_authenticated`. */
  expireSession(): void {
    this.expireNext = true;
  }

  async install(): Promise<void> {
    const page = this.context.page;
    // Registered after the other fakes: tried first for these paths.
    await page.route('**/api/v1/treasury/**', (route) => this.handle(route));
    await page.route(
      (url) => url.pathname.startsWith('/api/v1/audit/objects/treasury.'),
      (route) => this.audit(route),
    );
    await page.route('**/api/v1/imports-exports/**', (route) => this.imports(route));
  }

  private desk(company: string): Desk {
    const existing = this.desks[company];
    if (existing) {
      return existing;
    }
    const desk: Desk = {
      company,
      accounts: [],
      statements: [],
      lines: new Map(),
      operations: new Map(),
      invoices: new Map(),
      reconciliations: [],
      events: [],
      letterings: 1,
      states: new Map(),
      lineStatement: new Map(),
      transfers: [],
      entries: 0,
    };
    this.desks[company] = desk;
    const currency = company === 'A' ? 'GNF' : 'XOF';
    const account = (code: string, name: string, type: string, bankName: string): AccountJson => ({
      public_id: uuid(),
      code,
      name,
      account_type: type,
      currency,
      ledger_account: type === 'bank' ? { public_id: uuid(), code: '521100' } : null,
      journal: this.journalOf(company, type === 'bank' ? 'BQ1' : 'CAI'),
      bank_name: bankName,
      bank_branch: bankName ? 'Kaloum' : '',
      account_number: bankName ? '00012345678' : '',
      iban: bankName ? 'GN00TEST00012345678' : '',
      bic: bankName ? 'TESTGNGN' : '',
      opening_balance: D(code === 'CAISSE' ? '250000' : '1000000'),
      status: 'active',
      created_at: NOW,
      updated_at: NOW,
    });
    const bank = account(
      `BQ-${currency}`,
      `Banque principale ${company} (test)`,
      'bank',
      'Banque test',
    );
    desk.accounts.push(bank, account('CAISSE', `Caisse ${company} (test)`, 'cash', ''));
    if (company !== 'A') {
      return desk; // Another company: its own accounts, no line (and nothing of A).
    }
    const statement = {
      public_id: uuid(),
      treasury_account: { public_id: bank.public_id, code: bank.code },
      reference: 'REL-2026-09',
      statement_date: '2026-10-02',
      period_start: '2026-09-01',
      period_end: '2026-09-30',
      opening_balance: D('3000000'),
      closing_balance: D('5415000'),
      status: 'open',
      lines: [],
      created_at: NOW,
      updated_at: NOW,
    };
    desk.statements.push(statement);
    LINES.forEach(({ key, ...line }, index) => {
      const created = {
        ...line,
        public_id: uuid(),
        sequence: index + 1,
        value_date: line.line_date,
        running_balance: null,
      };
      desk.lines.set(key, created);
      desk.lineStatement.set(created.public_id, statement.public_id);
    });
    // The server's check of the September statement (fixture: opening + lines = closing).
    desk.states.set(
      statement.public_id,
      state(statement.public_id, {
        statement_balance: D('5415000'),
        lines_total: D('2415000'),
        opening_balance: D('3000000'),
        computed_closing_balance: D('5415000'),
        closing_difference: D('0'),
        balanced: true,
        treasury_balance: D('4115000'),
        statement_vs_treasury: D('1300000'),
        accounting_balance: D('4115000'),
        statement_vs_accounting: D('1300000'),
        reconciled_total: D('500000'),
        unreconciled_total: D('1925000'),
        excluded_total: D('-10000'),
        reconciled_count: 1,
        unreconciled_count: 3,
        excluded_count: 1,
      }),
    );
    const operation = (values: Partial<OperationJson> & { amount: string }): OperationJson => ({
      public_id: uuid(),
      treasury_account: { public_id: bank.public_id, code: bank.code },
      operation_type: 'deposit',
      direction: 'inflow',
      status: 'accounted',
      operation_date: '2026-09-01',
      value_date: null,
      currency: 'GNF',
      reference: '',
      description: '',
      counterparty: null,
      counterparty_name: '',
      offset_account: { public_id: uuid(), code: '411100' },
      transfer: null,
      related_operation: null,
      reason: '',
      accounting_entry: null,
      confirmed_at: null,
      accounted_at: null,
      cancelled_at: null,
      created_at: NOW,
      ...values,
    });
    for (const item of OPERATIONS) {
      desk.operations.set(
        item.key,
        operation({
          operation_date: item.date,
          amount: D(item.amount),
          reference: item.reference,
          description: item.description,
          counterparty: { public_id: uuid(), code: item.partner },
          accounting_entry: uuid(),
          confirmed_at: NOW,
          accounted_at: NOW,
        }),
      );
      desk.invoices.set(item.key, uuid());
    }
    // A bank fee still a draft, and a collection confirmed but not posted yet.
    desk.operations.set(
      'O5',
      operation({
        operation_type: 'bank_fee',
        direction: 'outflow',
        status: 'draft',
        operation_date: '2026-09-15',
        amount: D('25000'),
        reference: 'FRAIS-09',
        description: 'Frais bancaires septembre',
        offset_account: { public_id: uuid(), code: '627100' },
      }),
    );
    desk.operations.set(
      'O6',
      operation({
        status: 'confirmed',
        operation_date: '2026-09-20',
        amount: D('300000'),
        reference: 'VIR-201',
        description: 'Règlement CLI-004',
        counterparty: { public_id: uuid(), code: 'CLI-004' },
        confirmed_at: NOW,
      }),
    );
    // A transfer from the bank to the cash desk, a draft: its two legs.
    const cash = desk.accounts[1];
    const transferId = uuid();
    const legs = [
      operation({
        operation_type: 'transfer',
        direction: 'outflow',
        status: 'draft',
        operation_date: '2026-09-25',
        amount: D('200000'),
        reference: 'VIR-INT-1',
        transfer: transferId,
        offset_account: null,
      }),
      operation({
        treasury_account: { public_id: cash.public_id, code: cash.code },
        operation_type: 'transfer',
        direction: 'inflow',
        status: 'draft',
        operation_date: '2026-09-25',
        amount: D('200000'),
        reference: 'VIR-INT-1',
        transfer: transferId,
        offset_account: null,
      }),
    ];
    desk.operations.set('O7', legs[0]);
    desk.operations.set('O8', legs[1]);
    desk.transfers.push({
      public_id: transferId,
      source_account: { public_id: bank.public_id, code: bank.code },
      destination_account: { public_id: cash.public_id, code: cash.code },
      transfer_date: '2026-09-25',
      amount: D('200000'),
      destination_amount: D('200000'),
      exchange_rate: '1',
      rate_details: {},
      rounding: '',
      reference: 'VIR-INT-1',
      description: 'Approvisionnement caisse',
      operations: legs,
      created_at: NOW,
    });
    // B4 already reconciled with O4 at a confirmation that settled its invoice: the lettering
    // is the lettering fake's LET-000001 (its record opens).
    const made = this.lettering.letterings('A')[0];
    const reconciliation: ReconciliationJson = {
      public_id: uuid(),
      statement_line: desk.lines.get('B4')!.public_id,
      status: 'active',
      operations: [desk.operations.get('O4')!.public_id],
      lettering: { public_id: made.public_id, reference: made.reference, status: made.status },
      reason: '',
      cancelled_at: null,
      created_at: '2026-09-20T09:00:00Z',
    };
    desk.reconciliations.push(reconciliation);
    this.event(desk, reconciliation.public_id, 'reconcile', reconciliation.created_at);
    return desk;
  }

  private async answer(route: Route, status: number, json: unknown): Promise<void> {
    this.context.calls.push(route.request());
    await route.fulfill({ status, json });
  }

  /** Note backend 0044: the journal's lines, and one recorded, posted and lettered at once. */
  private async transactions(
    desk: Desk,
    account: AccountJson,
    method: string,
    body: () => Record<string, unknown>,
    reply: (status: number, json: unknown) => Promise<void>,
    can: (permission: string) => boolean,
  ): Promise<true> {
    // Odoo's « Solde courant »: the balance after each line, in date order (drafts aside).
    const units = (value: string) => BigInt(value.split('.')[0]);
    const running = new Map<string, string>();
    let total = units(account.opening_balance);
    for (const item of [...desk.operations.values()]
      .filter(
        (row) => row.treasury_account.public_id === account.public_id && row.status !== 'cancelled',
      )
      .sort((a, b) => a.operation_date.localeCompare(b.operation_date))) {
      if (item.status === 'confirmed' || item.status === 'accounted') {
        total += item.direction === 'inflow' ? units(item.amount) : -units(item.amount);
      }
      running.set(item.public_id, D(String(total)));
    }
    // An internal transfer's other journal (note backend 0046).
    const otherOf = (operation: OperationJson) => {
      const leg = [...desk.operations.values()].find(
        (item) => item.transfer === operation.transfer && item !== operation,
      );
      const other = desk.accounts.find(
        (item) => item.public_id === leg?.treasury_account.public_id,
      );
      return operation.transfer && other
        ? { public_id: other.public_id, code: other.code, name: other.name }
        : null;
    };
    const json = (operation: OperationJson) => ({
      public_id: operation.public_id,
      operation_date: operation.operation_date,
      description: operation.description,
      reference: operation.reference,
      direction: operation.direction,
      amount: operation.amount,
      currency: operation.currency,
      status: operation.status,
      counterparty: operation.counterparty
        ? (this.lettering.partnerOf(desk.company, operation.counterparty.public_id) ?? {
            ...operation.counterparty,
            name: operation.counterparty.code,
          })
        : null,
      counterparty_name: operation.counterparty_name,
      offset_account: operation.offset_account ? { ...operation.offset_account, name: '' } : null,
      accounting_entry: operation.accounting_entry,
      settled: this.settled.get(operation.public_id) ?? [],
      running_balance: running.get(operation.public_id) ?? null,
      transfer_account: otherOf(operation),
    });
    if (method === 'GET') {
      const rows = [...desk.operations.values()]
        .filter(
          (item) =>
            item.treasury_account.public_id === account.public_id && item.status !== 'cancelled',
        )
        .sort((a, b) => b.operation_date.localeCompare(a.operation_date));
      await reply(200, { count: rows.length, next: null, previous: null, results: rows.map(json) });
      return true;
    }
    if (!can('treasury.account')) {
      await reply(403, error('company_permission_denied'));
      return true;
    }
    const data = body();
    if (data['internal_account']) {
      return this.internalTransfer(desk, account, data, json, reply);
    }
    const lineId = data['settled_line'] as string | null;
    const partnerId = data['partner'] as string | null;
    const partner = partnerId ? this.lettering.partnerOf(desk.company, partnerId) : null;
    const created: OperationJson = {
      public_id: uuid(),
      treasury_account: { public_id: account.public_id, code: account.code },
      operation_type: data['direction'] === 'inflow' ? 'deposit' : 'withdrawal',
      direction: data['direction'] as Direction,
      status: 'accounted',
      operation_date: String(data['operation_date']),
      value_date: null,
      amount: D(String(data['amount'])),
      currency: account.currency,
      reference: '',
      description: String(data['description'] ?? ''),
      counterparty: partner ? { public_id: partner.public_id, code: partner.code } : null,
      counterparty_name: '',
      offset_account: data['offset_account']
        ? { public_id: String(data['offset_account']), code: 'compte' }
        : null,
      transfer: null,
      related_operation: null,
      reason: '',
      accounting_entry: uuid(),
      confirmed_at: NOW,
      accounted_at: NOW,
      cancelled_at: null,
      created_at: NOW,
    };
    if (lineId) {
      const settled = this.lettering.settle(desk.company, lineId, String(data['amount']));
      if (!settled) {
        await reply(400, error('validation_error', { settled_line: [{ code: 'unknown' }] }));
        return true;
      }
      created.offset_account = settled.line.account;
      created.counterparty ??= settled.line.partner;
      this.settled.set(created.public_id, [settled.reference]);
    }
    desk.operations.set(`T${desk.operations.size + 1}`, created);
    await reply(201, { ...json(created), running_balance: null });
    return true;
  }

  /** « Virement interne » (note backend 0046): out here, in there, both accounted at once. */
  private async internalTransfer(
    desk: Desk,
    account: AccountJson,
    data: Record<string, unknown>,
    json: (operation: OperationJson) => unknown,
    reply: (status: number, json: unknown) => Promise<void>,
  ): Promise<true> {
    const other = desk.accounts.find((item) => item.public_id === data['internal_account']);
    if (!other || other.public_id === account.public_id) {
      await reply(400, error('validation_error', { internal_account: [{ code: 'unknown' }] }));
      return true;
    }
    const out = data['direction'] === 'outflow';
    const [source, destination] = out ? [account, other] : [other, account];
    const transfer = uuid();
    const entry = uuid();
    const description =
      String(data['description'] ?? '') || `Virement interne ${source.name} → ${destination.name}`;
    const leg = (owner: AccountJson, direction: Direction): OperationJson => ({
      public_id: uuid(),
      treasury_account: { public_id: owner.public_id, code: owner.code },
      operation_type: 'transfer',
      direction,
      status: 'accounted',
      operation_date: String(data['operation_date']),
      value_date: null,
      amount: D(String(data['amount'])),
      currency: owner.currency,
      reference: '',
      description,
      counterparty: null,
      counterparty_name: '',
      offset_account: null,
      transfer,
      related_operation: null,
      reason: '',
      accounting_entry: entry,
      confirmed_at: NOW,
      accounted_at: NOW,
      cancelled_at: null,
      created_at: NOW,
    });
    const legs = [leg(source, 'outflow'), leg(destination, 'inflow')];
    for (const item of legs) {
      desk.operations.set(`T${desk.operations.size + 1}`, item);
    }
    const mine = legs.find((item) => item.treasury_account.public_id === account.public_id)!;
    await reply(201, { ...(json(mine) as object), running_balance: null });
    return true;
  }

  private paged<T>(route: Route, items: readonly T[]): Promise<void> {
    const url = new URL(route.request().url());
    const size = Number(url.searchParams.get('page_size')) || 50;
    const number = Number(url.searchParams.get('page')) || 1;
    const results = items.slice((number - 1) * size, number * size);
    if (number > 1 && results.length === 0) {
      return this.answer(route, 404, error('not_found'));
    }
    return this.answer(route, 200, { count: items.length, next: null, previous: null, results });
  }

  private event(
    desk: Desk,
    objectId: string,
    action: string,
    at = NOW,
    objectType = 'treasury.reconciliation',
  ): void {
    desk.events.push({
      public_id: uuid(),
      object_type: objectType,
      object_id: objectId,
      action,
      occurred_at: at,
      user: { email: 'mariam.test@example.org' },
    });
  }

  private async audit(route: Route): Promise<void> {
    const request = route.request();
    const permissions = await this.context.permissionsOf(request);
    if (!permissions.includes('audit.read')) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    const desk = this.desk(await this.context.companyOf(request));
    const objectId = new URL(request.url()).pathname.split('/').filter(Boolean).at(-1);
    return this.paged(
      route,
      desk.events.filter((item) => item.object_id === objectId),
    );
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1/treasury/', '');
    // The operations of an entry (`?accounting_entry=`) stay the dashboards fake's.
    if (path === 'operations/' && url.searchParams.has('accounting_entry')) {
      return route.fallback();
    }
    if (this.expireNext) {
      this.expireNext = false;
      return this.answer(route, 403, error('not_authenticated'));
    }
    const permissions = await this.context.permissionsOf(request);
    if (!permissions.includes('treasury.read')) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    const desk = this.desk(await this.context.companyOf(request));
    const method = request.method();
    const can = (permission: string) => permissions.includes(permission);
    const params = url.searchParams;

    const handled = await this.module(route, desk, path, method, params, can);
    if (handled) {
      return;
    }
    if (method === 'GET' && path === 'statements/') {
      return this.paged(
        route,
        desk.statements.filter(
          (item) =>
            (!params.get('account') || item.treasury_account.public_id === params.get('account')) &&
            (!params.get('status') || item.status === params.get('status')),
        ),
      );
    }
    if (method === 'GET' && path === 'statement-lines/') {
      const account = desk.accounts.find((item) => item.public_id === params.get('account'));
      const statement = params.get('statement');
      if (statement && !desk.statements.some((item) => item.public_id === statement)) {
        return this.answer(
          route,
          400,
          error('validation_error', { statement: ['Unknown reference.'] }),
        );
      }
      const status = params.get('status');
      const lines = [...desk.lines.values()].filter(
        (line) =>
          (!status || line.status === status) &&
          (statement
            ? desk.lineStatement.get(line.public_id) === statement
            : !params.get('account') || account?.account_type === 'bank'),
      );
      return this.paged(route, lines);
    }
    if (method === 'GET' && path === 'reconciliation-proposals/') {
      const bank = desk.accounts[0];
      const scoped = params.get('statement') !== null || params.get('account') === bank.public_id;
      return this.paged(route, scoped ? this.proposals(desk) : []);
    }
    if (method === 'POST' && path === 'reconciliation-proposals/confirm/') {
      if (!can('treasury.reconcile')) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
      return this.confirm(route, desk, can('accounting.letter'));
    }
    if (method === 'GET' && path === 'reconciliations/') {
      const line = params.get('statement_line');
      if (line && ![...desk.lines.values()].some((item) => item.public_id === line)) {
        return this.answer(
          route,
          400,
          error('validation_error', { statement_line: ['Unknown reference.'] }),
        );
      }
      const status = params.get('status');
      return this.paged(
        route,
        [...desk.reconciliations]
          .reverse()
          .filter(
            (item) =>
              (!line || item.statement_line === line) && (!status || item.status === status),
          ),
      );
    }
    const cancel = /^reconciliations\/([^/]+)\/cancel\/$/.exec(path);
    if (method === 'POST' && cancel) {
      if (!can('treasury.reconcile')) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
      const found = desk.reconciliations.find((item) => item.public_id === cancel[1]);
      if (!found) {
        return this.answer(route, 404, error('not_found'));
      }
      const reason = String((request.postDataJSON() as { reason?: string }).reason ?? '').trim();
      if (!reason) {
        return this.answer(
          route,
          400,
          error('validation_error', { reason: ['This field may not be blank.'] }),
        );
      }
      if (found.status === 'cancelled') {
        return this.answer(route, 400, error('treasury_reconciliation_cancelled'));
      }
      // The bank relation only (A6.1): the lettering stays as it is.
      found.status = 'cancelled';
      found.reason = reason;
      found.cancelled_at = NOW;
      const line = [...desk.lines.values()].find(
        (item) => item.public_id === found.statement_line,
      )!;
      line.status = 'unreconciled';
      this.event(desk, found.public_id, 'dereconcile');
      return this.answer(route, 200, found);
    }
    return this.answer(route, 404, error('not_found'));
  }

  // ---- Module 6: accounts, operations, transfers, statements, imports ------------------------

  private readonly runs = new Map<string, ImportRunJson>();

  /** An account as the server shows it: bank identifiers masked unless managed. */
  private shown(account: AccountJson, full: boolean): AccountJson {
    if (full) {
      return account;
    }
    const mask = (value: string) => (value ? `••••${value.slice(-4)}` : '');
    return {
      ...account,
      account_number: mask(account.account_number),
      iban: mask(account.iban),
      bic: mask(account.bic),
    };
  }

  /** An operation as the server shows it: `reconciled` from its active reconciliations. */
  private operationJson(desk: Desk, operation: OperationJson): OperationJson {
    return {
      ...operation,
      reconciled: desk.reconciliations.some(
        (item) => item.status === 'active' && item.operations.includes(operation.public_id),
      ),
    };
  }

  private async module(
    route: Route,
    desk: Desk,
    path: string,
    method: string,
    params: URLSearchParams,
    can: (permission: string) => boolean,
  ): Promise<boolean> {
    const request = route.request();
    const body = () => (request.postDataJSON() ?? {}) as Record<string, unknown>;
    const forbidden = async () => {
      await this.answer(route, 403, error('company_permission_denied'));
      return true;
    };
    const reply = async (status: number, json: unknown) => {
      await this.answer(route, status, json);
      return true;
    };
    const parts = path.split('/').filter(Boolean);

    // Accounts.
    if (parts[0] === 'accounts') {
      const full = can('treasury.manage_accounts');
      if (parts.length === 1 && method === 'GET') {
        const search = params.get('search')?.toLowerCase() ?? '';
        await this.paged(
          route,
          desk.accounts
            .filter(
              (item) =>
                (!params.get('account_type') || item.account_type === params.get('account_type')) &&
                (!params.get('status') || item.status === params.get('status')) &&
                (!params.get('journal') || item.journal?.public_id === params.get('journal')) &&
                (!search ||
                  item.code.toLowerCase().includes(search) ||
                  item.name.toLowerCase().includes(search)),
            )
            .map((item) => this.shown(item, full)),
        );
        return true;
      }
      if (parts.length === 1 && method === 'POST') {
        if (!full) {
          return forbidden();
        }
        const data = body();
        const code = String(data['code'] ?? '')
          .trim()
          .toUpperCase();
        if (desk.accounts.some((item) => item.code === code)) {
          return reply(400, error('treasury_account_code_exists'));
        }
        const created: AccountJson = {
          public_id: uuid(),
          code,
          name: String(data['name'] ?? ''),
          account_type: String(data['account_type'] ?? 'bank'),
          currency: String(data['currency'] ?? 'GNF'),
          ledger_account: null,
          journal: null,
          bank_name: String(data['bank_name'] ?? ''),
          bank_branch: String(data['bank_branch'] ?? ''),
          account_number: String(data['account_number'] ?? ''),
          iban: String(data['iban'] ?? ''),
          bic: String(data['bic'] ?? ''),
          opening_balance: D(String(data['opening_balance'] ?? '0')),
          status: 'active',
          created_at: NOW,
          updated_at: NOW,
        };
        desk.accounts.push(created);
        this.event(desk, created.public_id, 'create', NOW, 'treasury.treasuryaccount');
        return reply(201, created);
      }
      const account = desk.accounts.find((item) => item.public_id === parts[1]);
      if (!account) {
        return reply(404, error('not_found'));
      }
      if (parts.length === 2 && method === 'GET') {
        return reply(200, this.shown(account, full));
      }
      if (parts.length === 2 && method === 'PATCH') {
        if (!full) {
          return forbidden();
        }
        const data = body();
        for (const name of ['name', 'bank_name', 'bank_branch', 'account_number', 'iban', 'bic']) {
          if (name in data) {
            (account as unknown as Record<string, unknown>)[name] = data[name];
          }
        }
        if ('opening_balance' in data) {
          account.opening_balance = D(String(data['opening_balance']));
        }
        this.event(desk, account.public_id, 'update', NOW, 'treasury.treasuryaccount');
        return reply(200, account);
      }
      if (parts[2] === 'balance') {
        const [opening, inflows, outflows, balance] = BALANCES[account.code] ?? [
          '0',
          '0',
          '0',
          '0',
        ];
        return reply(200, {
          account: { public_id: account.public_id, code: account.code },
          on: null,
          currency: account.currency,
          opening_balance: D(opening),
          inflows: D(inflows),
          outflows: D(outflows),
          balance: D(balance),
        });
      }
      if (parts[2] === 'transactions') {
        return this.transactions(desk, account, method, body, reply, can);
      }
      if (parts[2] === 'deactivate' || parts[2] === 'reactivate') {
        if (!full) {
          return forbidden();
        }
        account.status = parts[2] === 'deactivate' ? 'inactive' : 'active';
        this.event(desk, account.public_id, parts[2], NOW, 'treasury.treasuryaccount');
        return reply(200, account);
      }
      return reply(404, error('not_found'));
    }

    // Operations.
    if (parts[0] === 'operations') {
      if (parts.length === 1 && method === 'GET') {
        const reconciled = params.get('reconciled');
        await this.paged(
          route,
          [...desk.operations.values()]
            .map((item) => this.operationJson(desk, item))
            .filter(
              (item) =>
                (!params.get('account') ||
                  item.treasury_account.public_id === params.get('account')) &&
                (!params.get('operation_type') ||
                  item.operation_type === params.get('operation_type')) &&
                (!params.get('direction') || item.direction === params.get('direction')) &&
                (!params.get('status') || item.status === params.get('status')) &&
                (!params.get('reference') || item.reference === params.get('reference')) &&
                (!params.get('date_from') || item.operation_date >= params.get('date_from')!) &&
                (!params.get('date_to') || item.operation_date <= params.get('date_to')!) &&
                (reconciled === null || String(item.reconciled) === reconciled),
            ),
        );
        return true;
      }
      if (parts.length === 1 && method === 'POST') {
        if (!can('treasury.create')) {
          return forbidden();
        }
        const data = body();
        const account = desk.accounts.find((item) => item.public_id === data['treasury_account']);
        if (!account) {
          return reply(400, error('validation_error', { treasury_account: [{ code: 'unknown' }] }));
        }
        const created: OperationJson = {
          public_id: uuid(),
          treasury_account: { public_id: account.public_id, code: account.code },
          operation_type: String(data['operation_type']),
          direction: data['direction'] as Direction,
          status: 'draft',
          operation_date: String(data['operation_date']),
          value_date: (data['value_date'] as string | null) ?? null,
          amount: D(String(data['amount'])),
          currency: account.currency,
          reference: String(data['reference'] ?? ''),
          description: String(data['description'] ?? ''),
          counterparty: data['counterparty']
            ? { public_id: String(data['counterparty']), code: 'CLI-001' }
            : null,
          counterparty_name: String(data['counterparty_name'] ?? ''),
          offset_account: null,
          transfer: null,
          related_operation: null,
          reason: '',
          accounting_entry: null,
          confirmed_at: null,
          accounted_at: null,
          cancelled_at: null,
          created_at: NOW,
        };
        desk.operations.set(`N${desk.operations.size + 1}`, created);
        this.event(desk, created.public_id, 'create', NOW, 'treasury.treasuryoperation');
        return reply(201, this.operationJson(desk, created));
      }
      const operation = [...desk.operations.values()].find((item) => item.public_id === parts[1]);
      if (!operation) {
        return reply(404, error('not_found'));
      }
      if (parts.length === 2 && method === 'GET') {
        return reply(200, this.operationJson(desk, operation));
      }
      if (parts.length === 2 && method === 'PATCH') {
        if (!can('treasury.update')) {
          return forbidden();
        }
        if (operation.status !== 'draft' || operation.transfer) {
          return reply(400, error('treasury_operation_not_editable'));
        }
        const data = body();
        for (const name of ['reference', 'description', 'operation_date', 'counterparty_name']) {
          if (name in data) {
            (operation as unknown as Record<string, unknown>)[name] = data[name];
          }
        }
        if ('amount' in data) {
          operation.amount = D(String(data['amount']));
        }
        this.event(desk, operation.public_id, 'update', NOW, 'treasury.treasuryoperation');
        return reply(200, this.operationJson(desk, operation));
      }
      return this.operationCommand(route, desk, operation, parts[2], can, body);
    }

    // Transfers.
    if (parts[0] === 'transfers') {
      if (parts.length === 1 && method === 'GET') {
        await this.paged(route, desk.transfers);
        return true;
      }
      if (parts.length === 1 && method === 'POST') {
        if (!can('treasury.create')) {
          return forbidden();
        }
        const data = body();
        if (data['source_account'] === data['destination_account']) {
          return reply(400, error('treasury_transfer_same_account'));
        }
        return reply(400, error('validation_error', { amount: [{ code: 'invalid' }] }));
      }
      const transfer = desk.transfers.find((item) => item.public_id === parts[1]);
      if (!transfer) {
        return reply(404, error('not_found'));
      }
      if (parts.length === 2 && method === 'GET') {
        return reply(200, transfer);
      }
      const command = parts[2];
      const permission = command === 'account' ? 'treasury.account' : 'treasury.confirm';
      if (!can(permission)) {
        return forbidden();
      }
      const legs = transfer.operations;
      const next: Record<string, [OperationStatus[], OperationStatus]> = {
        confirm: [['draft'], 'confirmed'],
        cancel: [['draft', 'confirmed'], 'cancelled'],
        account: [['confirmed'], 'accounted'],
      };
      const [from, to] = next[command] ?? [[], 'draft'];
      if (!from.includes(legs[0].status)) {
        return reply(400, error('treasury_invalid_transition'));
      }
      for (const leg of legs) {
        leg.status = to;
      }
      this.event(desk, transfer.public_id, command, NOW, 'treasury.treasurytransfer');
      return reply(200, transfer);
    }

    // Statements: record, the server's check, closing.
    if (parts[0] === 'statements' && parts.length >= 2) {
      const statement = desk.statements.find((item) => item.public_id === parts[1]);
      if (!statement) {
        return reply(404, error('not_found'));
      }
      if (parts.length === 2 && method === 'GET') {
        return reply(200, statement);
      }
      if (parts[2] === 'reconciliation') {
        return reply(200, desk.states.get(statement.public_id) ?? state(statement.public_id, {}));
      }
      if (parts[2] === 'close' && method === 'POST') {
        if (!can('treasury.manage_statements')) {
          return forbidden();
        }
        if (statement.status === 'closed') {
          return reply(400, error('treasury_statement_closed'));
        }
        if (!(desk.states.get(statement.public_id)?.balanced ?? true)) {
          return reply(400, error('treasury_statement_unbalanced'));
        }
        statement.status = 'closed';
        this.event(desk, statement.public_id, 'update', NOW, 'treasury.bankstatement');
        return reply(200, statement);
      }
      return reply(404, error('not_found'));
    }

    // A line set aside, or brought back.
    const lineCommand = /^statement-lines\/([^/]+)\/(exclude|include)\/$/.exec(path);
    if (lineCommand && method === 'POST') {
      if (!can('treasury.reconcile')) {
        return forbidden();
      }
      const line = [...desk.lines.values()].find((item) => item.public_id === lineCommand[1]);
      if (!line) {
        return reply(404, error('not_found'));
      }
      if (lineCommand[2] === 'exclude') {
        const reason = String(body()['reason'] ?? '').trim();
        if (!reason) {
          return reply(400, error('validation_error', { reason: [{ code: 'blank' }] }));
        }
        if (line.status !== 'unreconciled') {
          return reply(400, error('treasury_line_not_reconcilable'));
        }
        line.status = 'excluded';
        line.exclusion_reason = reason;
      } else {
        if (line.status !== 'excluded') {
          return reply(400, error('treasury_line_not_reconcilable'));
        }
        line.status = 'unreconciled';
        line.exclusion_reason = '';
      }
      return reply(200, line);
    }
    return false;
  }

  private async operationCommand(
    route: Route,
    desk: Desk,
    operation: OperationJson,
    command: string | undefined,
    can: (permission: string) => boolean,
    body: () => Record<string, unknown>,
  ): Promise<boolean> {
    const reply = async (status: number, json: unknown) => {
      await this.answer(route, status, json);
      return true;
    };
    const permission =
      command === 'confirm' || command === 'cancel' ? 'treasury.confirm' : 'treasury.account';
    if (!can(permission)) {
      return reply(403, error('company_permission_denied'));
    }
    if (operation.transfer) {
      return reply(400, error('treasury_operation_is_transfer'));
    }
    const shown = () => this.operationJson(desk, operation);
    switch (command) {
      case 'confirm':
        if (operation.status !== 'draft') {
          return reply(400, error('treasury_invalid_transition'));
        }
        operation.status = 'confirmed';
        operation.confirmed_at = NOW;
        break;
      case 'cancel': {
        if (!String(body()['reason'] ?? '').trim()) {
          return reply(400, error('validation_error', { reason: [{ code: 'blank' }] }));
        }
        if (shown().reconciled) {
          return reply(400, error('treasury_operation_reconciled'));
        }
        if (operation.status !== 'draft' && operation.status !== 'confirmed') {
          return reply(400, error('treasury_invalid_transition'));
        }
        operation.status = 'cancelled';
        operation.reason = String(body()['reason']).trim();
        operation.cancelled_at = NOW;
        break;
      }
      case 'account':
        if (operation.status !== 'confirmed') {
          return reply(400, error('treasury_invalid_transition'));
        }
        if (!operation.offset_account) {
          return reply(400, error('treasury_offset_account_missing'));
        }
        operation.status = 'accounted';
        operation.accounted_at = NOW;
        operation.accounting_entry = uuid();
        break;
      case 'unpost':
        if (operation.status !== 'accounted') {
          return reply(400, error('treasury_invalid_transition'));
        }
        operation.status = 'confirmed';
        operation.accounted_at = null;
        operation.accounting_entry = null;
        break;
      default:
        return reply(404, error('not_found'));
    }
    this.event(desk, operation.public_id, command, NOW, 'treasury.treasuryoperation');
    return reply(200, shown());
  }

  /** Imports of statements (`treasury.statements`); the other types stay the partners fake's. */
  private async imports(route: Route): Promise<void> {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1/imports-exports/', '');
    const company = await this.context.companyOf(request);
    if (path === 'import-types/') {
      this.context.calls.push(request);
      return route.fulfill({
        status: 200,
        json: [
          { import_type: 'partners', fields: IMPORT_FIELDS },
          { import_type: 'treasury.statements', fields: STATEMENT_IMPORT_FIELDS },
          { import_type: 'accounting.accounts', fields: ACCOUNT_IMPORT_FIELDS },
        ],
      });
    }
    if (path === 'imports/' && request.method() === 'POST') {
      const body = request.postDataJSON() as { import_type?: string };
      if (body.import_type !== 'treasury.statements') {
        return route.fallback();
      }
      const permissions = await this.context.permissionsOf(request);
      if (!permissions.includes('treasury.manage_statements')) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
      const run: ImportRunJson = {
        public_id: `ts-run-${this.runs.size + 1}`,
        company,
        status: 'created',
        filename: '',
        scenario: null,
        columns: {},
        options: {},
        summary: {},
      };
      this.runs.set(run.public_id, run);
      return this.answer(route, 201, runJson(run));
    }
    const [, id, command] = path.split('/');
    const run = this.runs.get(id);
    if (!run) {
      return route.fallback();
    }
    if (run.company !== company) {
      return this.answer(route, 404, error('not_found'));
    }
    const scenario = () => run.scenario ?? IMPORT_SCENARIOS['releve-errone.csv'];
    switch (command) {
      case 'upload':
        run.filename = uploadedName(request);
        run.scenario = IMPORT_SCENARIOS[run.filename] ?? null;
        run.status = 'uploaded';
        break;
      case 'parse':
        // The reading the server gives (fixture: the statement files are UTF-8, « ; »).
        run.options = { encoding: 'utf-8', delimiter: ';' };
        run.status = 'parsed';
        run.summary = { total: scenario().summary['total'] };
        break;
      case 'map': {
        const body = request.postDataJSON() as {
          columns: Record<string, string>;
          options?: Record<string, string>;
        };
        run.columns = body.columns;
        run.options = body.options ?? {};
        run.status = 'mapped';
        break;
      }
      case 'validate':
        run.summary = { ...scenario().summary };
        run.status = 'validated';
        break;
      case 'rows': {
        const status = new URL(request.url()).searchParams.get('status');
        if (!status) {
          // The first rows read (fixture: one line of the statement file).
          return this.answer(route, 200, {
            count: 1,
            next: null,
            previous: null,
            results: [
              {
                line_number: 2,
                status: 'pending',
                raw: { account: 'BQ-GNF', amount: '300000' },
                messages: [],
              },
            ],
          });
        }
        const rows = scenario()
          .rows.filter((row) => row.status === status)
          .map((row) => ({
            line_number: row.line,
            status: row.status,
            raw: {},
            messages: [
              {
                level: row.status,
                field: row.field,
                code: row.code,
                message: row.code,
                details: row.details ?? {},
              },
            ],
          }));
        return this.answer(route, 200, {
          count: rows.length,
          next: null,
          previous: null,
          results: rows,
        });
      }
      case 'preview':
        run.summary = {
          ...run.summary,
          preview: {
            creations: {
              statements: scenario().creations,
              lines: scenario().statement?.lines.length ?? 0,
            },
            updates: 0,
            skipped_duplicates: scenario().skipped,
          },
        };
        run.status = 'previewed';
        break;
      case 'execute': {
        const created = scenario().statement;
        if (created) {
          this.createStatement(this.desk(company), created);
        }
        run.summary = { created: scenario().creations, imported: created?.lines.length ?? 0 };
        run.status = 'completed';
        break;
      }
      case 'cancel':
        run.status = 'cancelled';
        break;
    }
    return this.answer(route, 200, runJson(run));
  }

  /** The statement an import creates, with its lines and the server's check (fixtures). */
  private createStatement(
    desk: Desk,
    created: NonNullable<(typeof IMPORT_SCENARIOS)[string]['statement']>,
  ): void {
    const bank = desk.accounts[0];
    const statement = {
      public_id: uuid(),
      treasury_account: { public_id: bank.public_id, code: bank.code },
      reference: created.reference,
      statement_date: created.period[1],
      period_start: created.period[0],
      period_end: created.period[1],
      opening_balance: D(created.balances[0]),
      closing_balance: D(created.balances[1]),
      status: 'open',
      lines: [] as LineJson[],
      created_at: NOW,
      updated_at: NOW,
    };
    desk.statements.push(statement);
    desk.states.set(statement.public_id, state(statement.public_id, created.check));
    created.lines.forEach((line, index) => {
      const json: LineJson = {
        public_id: uuid(),
        sequence: index + 1,
        line_date: line.date,
        value_date: line.date,
        direction: line.direction,
        amount: D(line.amount),
        description: line.description,
        bank_reference: '',
        external_id: line.external_id,
        running_balance: null,
        status: 'unreconciled',
        exclusion_reason: '',
      };
      desk.lines.set(`I${desk.lines.size + 1}`, json);
      desk.lineStatement.set(json.public_id, statement.public_id);
    });
    this.event(desk, statement.public_id, 'create', NOW, 'treasury.bankstatement');
  }

  /** The fixture proposals whose line is still unreconciled and operation still free. */
  private proposals(desk: Desk) {
    const taken = new Set(
      desk.reconciliations
        .filter((item) => item.status === 'active')
        .flatMap((item) => item.operations),
    );
    return PROPOSALS.filter((item) => {
      const line = desk.lines.get(item.line)!;
      const operation = desk.operations.get(item.operation)!;
      return line.status === 'unreconciled' && !taken.has(operation.public_id);
    }).map((item) => {
      const line = desk.lines.get(item.line)!;
      const operation = desk.operations.get(item.operation)!;
      const lettered = desk.reconciliations.some(
        (reconciliation) =>
          reconciliation.lettering && reconciliation.operations.includes(operation.public_id),
      );
      return {
        line: {
          public_id: line.public_id,
          statement: desk.statements[0].public_id,
          line_date: line.line_date,
          direction: line.direction,
          amount: line.amount,
          description: line.description,
          bank_reference: line.bank_reference,
        },
        operation: {
          public_id: operation.public_id,
          operation_date: operation.operation_date,
          direction: operation.direction,
          amount: operation.amount,
          reference: operation.reference,
          description: operation.description,
          counterparty: operation.counterparty?.code ?? null,
        },
        amount: line.amount,
        matched_amount: operation.amount,
        difference: D('0'),
        criteria: item.criteria,
        days_apart: item.days,
        settlement:
          item.invoice && !lettered
            ? {
                payment_line: {
                  public_id: uuid(),
                  entry: 'BQ1-000201',
                  entry_date: operation.operation_date,
                  account: '411',
                  partner: operation.counterparty?.code ?? '',
                },
                invoice_line: {
                  public_id: desk.invoices.get(item.operation)!,
                  entry: item.invoice.entry,
                  entry_date: item.invoice.date,
                  account: '411',
                  partner: operation.counterparty?.code ?? '',
                },
                amount: operation.amount,
              }
            : null,
      };
    });
  }

  private async confirm(route: Route, desk: Desk, canLetter: boolean): Promise<void> {
    const body = route.request().postDataJSON() as {
      items?: { line: string; operation: string; invoice_line?: string }[];
    };
    const items = body.items ?? [];
    if (items.length === 0 || items.length > 100) {
      return this.answer(route, 400, error('validation_error', { items: ['1 to 100 items.'] }));
    }
    if (items.some((item) => item.invoice_line) && !canLetter) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    const current = this.proposals(desk);
    const keys: { line: string; operation: string; invoice: boolean }[] = [];
    for (const item of items) {
      const proposal = current.find(
        (candidate) =>
          candidate.line.public_id === item.line &&
          candidate.operation.public_id === item.operation,
      );
      const invoiceOk =
        !item.invoice_line || proposal?.settlement?.invoice_line.public_id === item.invoice_line;
      if (!proposal || !invoiceOk) {
        return this.answer(
          route,
          400,
          error('treasury_reconciliation_proposal_stale', { line: item.line }),
        );
      }
      const lineKey = [...desk.lines.entries()].find(
        ([, line]) => line.public_id === item.line,
      )![0];
      const operationKey = [...desk.operations.entries()].find(
        ([, operation]) => operation.public_id === item.operation,
      )![0];
      keys.push({ line: lineKey, operation: operationKey, invoice: Boolean(item.invoice_line) });
    }
    // All or none: every choice stands, now all are reconciled.
    const done = keys.map((key) => {
      const reconciliation = this.reconcile(
        desk,
        key.line,
        key.operation,
        key.invoice ? 'active' : null,
      );
      return {
        reconciliation,
        lettering: reconciliation.lettering
          ? {
              public_id: reconciliation.lettering.public_id,
              reference: reconciliation.lettering.reference,
            }
          : null,
      };
    });
    return this.answer(route, 201, done);
  }

  private reconcile(
    desk: Desk,
    lineKey: string,
    operationKey: string,
    lettering: 'active' | null,
  ): ReconciliationJson {
    const line = desk.lines.get(lineKey)!;
    line.status = 'reconciled';
    const reconciliation: ReconciliationJson = {
      public_id: uuid(),
      statement_line: line.public_id,
      status: 'active',
      operations: [desk.operations.get(operationKey)!.public_id],
      lettering: lettering
        ? {
            public_id: uuid(),
            reference: `LET-${String(++desk.letterings + 10).padStart(6, '0')}`,
            status: 'active',
          }
        : null,
      reason: '',
      cancelled_at: null,
      created_at: NOW,
    };
    desk.reconciliations.push(reconciliation);
    this.event(desk, reconciliation.public_id, 'reconcile');
    return reconciliation;
  }
}
