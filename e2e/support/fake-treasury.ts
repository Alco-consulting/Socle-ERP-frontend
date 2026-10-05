import { Route } from '@playwright/test';

import { FakeLettering } from './fake-lettering';
import { PartnersContext } from './fake-partners';

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

interface OperationJson {
  public_id: string;
  treasury_account: { public_id: string; code: string };
  operation_type: string;
  direction: Direction;
  status: 'accounted';
  operation_date: string;
  amount: string;
  currency: string;
  reference: string;
  description: string;
  counterparty: { public_id: string; code: string } | null;
  counterparty_name: string;
  accounting_entry: string | null;
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

interface Desk {
  company: string;
  accounts: {
    public_id: string;
    code: string;
    name: string;
    account_type: string;
    currency: string;
    status: string;
  }[];
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
}

export class FakeTreasury {
  private readonly desks: Record<string, Desk> = {};
  private expireNext = false;

  constructor(
    private readonly context: PartnersContext,
    private readonly lettering: FakeLettering,
  ) {}

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
    await page.route('**/api/v1/audit/objects/treasury.reconciliation/**', (route) =>
      this.audit(route),
    );
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
    };
    this.desks[company] = desk;
    const currency = company === 'A' ? 'GNF' : 'XOF';
    const bank = {
      public_id: uuid(),
      code: `BQ-${currency}`,
      name: `Banque principale ${company} (test)`,
      account_type: 'bank',
      currency,
      status: 'active',
    };
    desk.accounts.push(bank, {
      public_id: uuid(),
      code: 'CAISSE',
      name: `Caisse ${company} (test)`,
      account_type: 'cash',
      currency,
      status: 'active',
    });
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
      closing_balance: D('5365000'),
      status: 'open',
      lines: [],
      created_at: NOW,
      updated_at: NOW,
    };
    desk.statements.push(statement);
    LINES.forEach(({ key, ...line }, index) => {
      desk.lines.set(key, {
        ...line,
        public_id: uuid(),
        sequence: index + 1,
        value_date: line.line_date,
        running_balance: null,
      });
    });
    for (const item of OPERATIONS) {
      desk.operations.set(item.key, {
        public_id: uuid(),
        treasury_account: { public_id: bank.public_id, code: bank.code },
        operation_type: 'deposit',
        direction: 'inflow',
        status: 'accounted',
        operation_date: item.date,
        amount: D(item.amount),
        currency: 'GNF',
        reference: item.reference,
        description: item.description,
        counterparty: { public_id: uuid(), code: item.partner },
        counterparty_name: '',
        accounting_entry: uuid(),
      });
      desk.invoices.set(item.key, uuid());
    }
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

  private event(desk: Desk, objectId: string, action: string, at = NOW): void {
    desk.events.push({
      public_id: uuid(),
      object_type: 'treasury.reconciliation',
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

    if (method === 'GET' && path === 'accounts/') {
      return this.paged(route, desk.accounts);
    }
    if (method === 'GET' && path === 'statements/') {
      return this.paged(
        route,
        desk.statements.filter((item) => item.treasury_account.public_id === params.get('account')),
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
      const lines =
        account && account.account_type === 'bank'
          ? [...desk.lines.values()].filter((line) => line.status === params.get('status'))
          : [];
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
    const operation = /^operations\/([^/]+)\/$/.exec(path);
    if (method === 'GET' && operation) {
      const found = [...desk.operations.values()].find((item) => item.public_id === operation[1]);
      return found ? this.answer(route, 200, found) : this.answer(route, 404, error('not_found'));
    }
    return this.answer(route, 404, error('not_found'));
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
