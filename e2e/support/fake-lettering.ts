import { Route } from '@playwright/test';

import { FakeAccounting } from './fake-accounting';
import { FakeAccountingEntries } from './fake-accounting-entries';
import { FakePartners, PartnersContext } from './fake-partners';

/**
 * Lettering (V2.1, lot A4) in the fake API, shaped like the OpenAPI schemas
 * (`AccountingLetterableLine`, `AccountingLettering`, `AccountingPreview`,
 * `AccountingProposal`), company scoped, with the contract's permissions, statuses, errors
 * and idempotency. It does NOT play the server's matching: every answer comes from an
 * explicit fixture — the lines and their states, the selections (`SCENARIOS`: exact sets of
 * lines → the server's preview, its effect on the lines, or its error) and the proposals.
 * A selection without a scenario is refused as the server would refuse an invalid one.
 */

type Side = 'debit' | 'credit';
type LineStatus = 'open' | 'partial' | 'lettered';

interface LineJson {
  public_id: string;
  entry: { public_id: string; entry_number: string };
  entry_date: string;
  journal: string;
  document_reference: string;
  account: { public_id: string; code: string };
  partner: { public_id: string; code: string } | null;
  label: string;
  side: Side;
  currency: string;
  amount: string;
  lettered_amount: string;
  open_amount: string;
  status: LineStatus;
}

interface LetteringJson {
  public_id: string;
  reference: string;
  kind: 'manual' | 'automatic';
  status: 'active' | 'cancelled';
  account: { public_id: string; code: string };
  partner: { public_id: string; code: string } | null;
  currency: string;
  amount: string;
  partial: boolean;
  created_by: string;
  created_at: string;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancellation_reason: string;
  items: {
    line: string;
    entry: LineJson['entry'];
    entry_date: string;
    side: Side;
    amount: string;
  }[];
}

/** The state a scenario leaves on a line: lettered and open amounts (fixture figures). */
type LineEffect = Readonly<Record<string, readonly [lettered: string, open: string]>>;

interface Scenario {
  /** Keys of the fixture lines (`L1`…), as one selection. */
  readonly lines: readonly string[];
  readonly allowPartial: boolean;
  /** The server's answer: a result (preview, amounts per line) or an error. */
  readonly outcome:
    | {
        readonly amount: string;
        readonly partial: boolean;
        /** Amount lettered and residual per line. */
        readonly rows: Readonly<Record<string, readonly [amount: string, residual: string]>>;
        readonly effect: LineEffect;
      }
    | { readonly error: string; readonly details?: unknown };
}

const D = (units: string) => `${units}.000000`;

/** Lines of company A (`L<n>` keys), on the letterable accounts 411 and 401. */
const LINES: readonly {
  key: string;
  account: string;
  partner: string;
  side: Side;
  amount: string;
  number: string;
  date: string;
  label: string;
}[] = [
  {
    key: 'L1',
    account: '411',
    partner: 'CLI-001',
    side: 'debit',
    amount: '1200000',
    number: 'VTE-000101',
    date: '2026-09-02',
    label: 'Facture FAC-101',
  },
  {
    key: 'L2',
    account: '411',
    partner: 'CLI-001',
    side: 'credit',
    amount: '1200000',
    number: 'BQ1-000201',
    date: '2026-09-10',
    label: 'Règlement FAC-101',
  },
  {
    key: 'L3',
    account: '411',
    partner: 'CLI-001',
    side: 'debit',
    amount: '500000',
    number: 'VTE-000102',
    date: '2026-09-05',
    label: 'Facture FAC-102',
  },
  {
    key: 'L4',
    account: '411',
    partner: 'CLI-001',
    side: 'credit',
    amount: '300000',
    number: 'BQ1-000202',
    date: '2026-09-12',
    label: 'Acompte FAC-102',
  },
  {
    key: 'L5',
    account: '411',
    partner: 'CLI-002',
    side: 'debit',
    amount: '750000',
    number: 'VTE-000103',
    date: '2026-09-06',
    label: 'Facture FAC-103',
  },
  {
    key: 'L6',
    account: '411',
    partner: 'CLI-002',
    side: 'credit',
    amount: '750000',
    number: 'BQ1-000203',
    date: '2026-09-15',
    label: 'Règlement FAC-103',
  },
  {
    key: 'L7',
    account: '401',
    partner: 'FOU-001',
    side: 'credit',
    amount: '900000',
    number: 'ACH-000301',
    date: '2026-09-03',
    label: 'Facture fournisseur F-301',
  },
  {
    key: 'L8',
    account: '401',
    partner: 'FOU-001',
    side: 'debit',
    amount: '900000',
    number: 'BQ1-000204',
    date: '2026-09-20',
    label: 'Paiement F-301',
  },
];

/** The server's answers to the selections the tests make (sorted keys). */
const SCENARIOS: readonly Scenario[] = [
  ...[false, true].map((allowPartial): Scenario => ({
    lines: ['L1', 'L2'],
    allowPartial,
    outcome: {
      amount: D('1200000'),
      partial: false,
      rows: { L1: [D('1200000'), D('0')], L2: [D('1200000'), D('0')] },
      effect: { L1: [D('1200000'), D('0')], L2: [D('1200000'), D('0')] },
    },
  })),
  {
    lines: ['L3', 'L4'],
    allowPartial: false,
    outcome: {
      error: 'accounting_lettering_unbalanced',
      details: { debit: D('500000'), credit: D('300000'), difference: D('200000') },
    },
  },
  {
    lines: ['L3', 'L4'],
    allowPartial: true,
    outcome: {
      amount: D('300000'),
      partial: true,
      rows: { L3: [D('300000'), D('200000')], L4: [D('300000'), D('0')] },
      effect: { L3: [D('300000'), D('200000')], L4: [D('300000'), D('0')] },
    },
  },
  ...[false, true].map((allowPartial): Scenario => ({
    lines: ['L1', 'L5'],
    allowPartial,
    outcome: { error: 'accounting_lettering_partners_differ' },
  })),
  ...[false, true].map((allowPartial): Scenario => ({
    lines: ['L1', 'L3'],
    allowPartial,
    outcome: { error: 'accounting_lettering_one_sided' },
  })),
];

/** The server's proposals (pairs of keys), listed while both lines are open. */
const PROPOSALS: readonly { debit: string; credit: string }[] = [{ debit: 'L5', credit: 'L6' }];

const error = (code: string, details: unknown = null) => ({
  error: { code, message: code, details, correlation_id: 'e2e' },
});

let sequence = 0;
const uuid = () => `70000000-0000-4000-9000-${String(++sequence).padStart(12, '0')}`;
const NOW = '2026-10-04T10:00:00Z';

interface Desk {
  company: string;
  lines: Map<string, LineJson>;
  letterings: LetteringJson[];
  /** The line states before each lettering (restored by its unlettering). */
  before: Map<string, Map<string, LineJson>>;
  keys: Map<string, string>;
  number: number;
}

export class FakeLettering {
  private readonly desks: Record<string, Desk> = {};

  constructor(
    private readonly context: PartnersContext,
    private readonly accounting: FakeAccounting,
    private readonly partners: FakePartners,
    private readonly entries: FakeAccountingEntries,
  ) {}

  /** The fixture line of a key (`L1`), for the tests. */
  line(company: string, key: string): LineJson {
    const found = this.desk(company).lines.get(key);
    if (!found) {
      throw new Error(`No fixture line ${key}`);
    }
    return found;
  }

  letterings(company: string): readonly LetteringJson[] {
    return this.desk(company).letterings;
  }

  /** A partner of the company by its public id, with its name (note backend 0044). */
  partnerOf(
    company: string,
    publicId: string,
  ): { public_id: string; code: string; name: string } | null {
    const found = this.partners.list(company).find((item) => item.public_id === publicId);
    return found ? { public_id: found.public_id, code: found.code, name: found.name } : null;
  }

  /** A line settled by a treasury transaction: what it lettered (note backend 0044). */
  settle(
    company: string,
    linePublicId: string,
    amount: string,
  ): { line: LineJson; reference: string } | null {
    const line = [...this.desk(company).lines.values()].find(
      (item) => item.public_id === linePublicId,
    );
    if (!line) {
      return null;
    }
    const units = (value: string) => BigInt(value.split('.')[0]);
    const settled =
      units(amount) < units(line.open_amount) ? units(amount) : units(line.open_amount);
    const open = units(line.open_amount) - settled;
    line.open_amount = D(String(open));
    line.lettered_amount = D(String(units(line.amount) - open));
    line.status = open === 0n ? 'lettered' : 'partial';
    return { line, reference: line.document_reference || line.entry.entry_number };
  }

  /**
   * A line left open on an account by a treasury transaction: an internal transfer sent onto
   * its transfer account, waiting for the other journal (note backend 0049).
   */
  openLine(
    company: string,
    line: Pick<LineJson, 'account' | 'journal' | 'side' | 'label' | 'entry_date'> & {
      units: string;
    },
  ): LineJson {
    const desk = this.desk(company);
    const key = `T${desk.lines.size + 1}`;
    const json: LineJson = {
      public_id: uuid(),
      entry: { public_id: uuid(), entry_number: `${line.journal}-${key}` },
      entry_date: line.entry_date,
      journal: line.journal,
      document_reference: '',
      account: line.account,
      partner: null,
      label: line.label,
      side: line.side,
      currency: 'GNF',
      amount: D(line.units),
      lettered_amount: D('0'),
      open_amount: D(line.units),
      status: 'open',
    };
    desk.lines.set(key, json);
    return json;
  }

  /** Another user letters these lines first (the screen then shows stale lines). */
  letterBehind(company: string, keys: readonly string[]): void {
    const desk = this.desk(company);
    const scenario = this.scenario(keys, false);
    if (!scenario || 'error' in scenario.outcome) {
      throw new Error(`No lettering scenario for ${keys.join(', ')}`);
    }
    this.apply(desk, scenario, 'manual', '');
  }

  async install(): Promise<void> {
    const page = this.context.page;
    // Registered after the accounting fake: tried first for these paths.
    await page.route('**/api/v1/accounting/letterable-lines/**', (route) => this.handle(route));
    await page.route('**/api/v1/accounting/letterings/**', (route) => this.handle(route));
  }

  private desk(company: string): Desk {
    const existing = this.desks[company];
    if (existing) {
      return existing;
    }
    const desk: Desk = {
      company,
      lines: new Map(),
      letterings: [],
      before: new Map(),
      keys: new Map(),
      number: 0,
    };
    this.desks[company] = desk;
    if (company !== 'A') {
      return desk; // Another company: nothing to letter (and nothing of A).
    }
    const accounts = this.accounting.books(company).accounts;
    const partners = this.partners.list(company);
    for (const item of LINES) {
      const account = accounts.find((candidate) => candidate.code === item.account)!;
      const partner = partners.find((candidate) => candidate.code === item.partner)!;
      desk.lines.set(item.key, {
        public_id: uuid(),
        entry: { public_id: uuid(), entry_number: item.number },
        entry_date: item.date,
        journal: item.number.split('-')[0],
        document_reference: item.label.split(' ').at(-1) ?? '',
        account: { public_id: account.public_id, code: account.code },
        partner: { public_id: partner.public_id, code: partner.code },
        label: item.label,
        side: item.side,
        currency: 'GNF',
        amount: D(item.amount),
        lettered_amount: D('0'),
        open_amount: D(item.amount),
        status: 'open',
      });
    }
    // A lettering already made: the supplier invoice and its payment.
    const made = SCENARIOS_MADE[0];
    this.apply(desk, made, 'manual', '');
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

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const permissions = await this.context.permissionsOf(request);
    if (!permissions.includes('accounting.read')) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    const company = await this.context.companyOf(request);
    const desk = this.desk(company);
    const url = new URL(request.url());
    const parts = url.pathname.replace('/api/v1/accounting/', '').split('/').filter(Boolean);
    const q = (name: string) => url.searchParams.get(name);
    const method = request.method();
    if (method === 'POST' && !(await this.context.csrfOk(request))) {
      return this.answer(route, 403, error('csrf_failed'));
    }

    if (parts[0] === 'letterable-lines') {
      const lettered = q('lettering')
        ? new Set(
            desk.letterings
              .find((item) => item.public_id === q('lettering'))
              ?.items.map((item) => item.line) ?? [],
          )
        : null;
      return this.paged(
        route,
        [...desk.lines.values()]
          .filter(
            (line) =>
              (!q('account') || line.account.public_id === q('account')) &&
              (!q('partner') || line.partner?.public_id === q('partner')) &&
              (!q('status') ||
                (q('status') === 'open'
                  ? line.status !== 'lettered'
                  : line.status === 'lettered')) &&
              (!q('date_from') || line.entry_date >= q('date_from')!) &&
              (!q('date_to') || line.entry_date <= q('date_to')!) &&
              (!lettered || lettered.has(line.public_id)),
          )
          .sort((a, b) => a.entry_date.localeCompare(b.entry_date)),
      );
    }

    // letterings/…
    const [, first, second] = parts;
    if (!first && method === 'GET') {
      return this.paged(
        route,
        desk.letterings
          .filter(
            (item) =>
              (!q('account') || item.account.public_id === q('account')) &&
              (!q('partner') || item.partner?.public_id === q('partner')) &&
              (!q('status') || item.status === q('status')) &&
              (!q('reference') || item.reference === q('reference')?.toUpperCase()) &&
              (!q('date_from') || item.created_at.slice(0, 10) >= q('date_from')!) &&
              (!q('date_to') || item.created_at.slice(0, 10) <= q('date_to')!),
          )
          .slice()
          .reverse(),
      );
    }
    if (first === 'proposals' && !second && method === 'GET') {
      return this.paged(
        route,
        PROPOSALS.map((pair) => ({
          debit: this.keyLine(desk, pair.debit),
          credit: this.keyLine(desk, pair.credit),
        }))
          .filter(
            ({ debit, credit }) =>
              debit.status === 'open' &&
              credit.status === 'open' &&
              (!q('account') || debit.account.public_id === q('account')) &&
              (!q('partner') || debit.partner?.public_id === q('partner')),
          )
          .map(({ debit, credit }) => ({
            account: debit.account,
            partner: debit.partner,
            currency: debit.currency,
            amount: debit.open_amount,
            debit: this.proposalLine(debit),
            credit: this.proposalLine(credit),
          })),
      );
    }
    if (
      method === 'POST' &&
      (!first || first === 'preview' || (first === 'proposals' && second === 'confirm'))
    ) {
      if (!permissions.includes('accounting.letter')) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
      return first === 'proposals'
        ? this.confirm(route, desk)
        : this.letter(route, desk, first === 'preview');
    }
    const lettering = desk.letterings.find((item) => item.public_id === first);
    if (!lettering) {
      return this.answer(route, 404, error('not_found'));
    }
    if (!second && method === 'GET') {
      return this.answer(route, 200, lettering);
    }
    if (second === 'unletter' && method === 'POST') {
      if (!permissions.includes('accounting.unletter')) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
      const body = request.postDataJSON() as { reason?: string };
      if (!body.reason?.trim()) {
        return this.answer(
          route,
          400,
          error('validation_error', {
            reason: [{ message: 'This field is required.', code: 'required' }],
          }),
        );
      }
      if (lettering.status === 'cancelled') {
        return this.answer(route, 400, error('accounting_lettering_cancelled'));
      }
      for (const [key, line] of desk.before.get(lettering.public_id) ?? []) {
        desk.lines.set(key, line);
      }
      lettering.status = 'cancelled';
      lettering.cancelled_by = 'dddddddd-0000-4000-8000-000000000004';
      lettering.cancelled_at = NOW;
      lettering.cancellation_reason = body.reason.trim();
      this.entries.recordEvent(
        company,
        'unletter',
        'accounting.lettering',
        lettering.public_id,
        lettering.reference,
      );
      return this.answer(route, 200, lettering);
    }
    return this.answer(route, 404, error('not_found'));
  }

  private async letter(route: Route, desk: Desk, preview: boolean): Promise<void> {
    const body = route.request().postDataJSON() as {
      lines: string[];
      allow_partial?: boolean;
      write_off?: boolean;
      idempotency_key?: string;
    };
    if (body.write_off) {
      return this.answer(route, 400, error('accounting_lettering_write_off_unavailable'));
    }
    if (!preview && body.idempotency_key && desk.keys.has(body.idempotency_key)) {
      return this.answer(
        route,
        400,
        error('accounting_lettering_exists', { lettering: desk.keys.get(body.idempotency_key) }),
      );
    }
    const keys = body.lines.map((id) => this.keyOf(desk, id));
    if (keys.some((key) => key === null)) {
      return this.answer(
        route,
        400,
        error('validation_error', { lines: [{ message: 'Unknown line.', code: 'invalid' }] }),
      );
    }
    if (keys.some((key) => desk.lines.get(key!)!.status === 'lettered')) {
      return this.answer(route, 400, error('accounting_lettering_line_lettered'));
    }
    const scenario = this.scenario(keys as string[], !!body.allow_partial);
    if (!scenario) {
      return this.answer(route, 400, error('accounting_lettering_selection_invalid'));
    }
    if ('error' in scenario.outcome) {
      return this.answer(
        route,
        400,
        error(scenario.outcome.error, scenario.outcome.details ?? null),
      );
    }
    if (preview) {
      const rows = Object.entries(scenario.outcome.rows).map(([key, [amount, residual]]) => {
        const line = desk.lines.get(key)!;
        return {
          line: line.public_id,
          entry: line.entry,
          side: line.side,
          open_amount: line.open_amount,
          amount,
          residual,
        };
      });
      const first = desk.lines.get(scenario.lines[0])!;
      const total = (side: Side) =>
        scenario.lines.map((key) => desk.lines.get(key)!).filter((line) => line.side === side);
      return this.answer(route, 200, {
        account: first.account,
        partner: first.partner,
        // Fixture figures: each scenario has one line per side.
        debit_total: total('debit')[0]?.open_amount ?? D('0'),
        credit_total: total('credit')[0]?.open_amount ?? D('0'),
        amount: scenario.outcome.amount,
        balanced: !scenario.outcome.partial,
        partial: scenario.outcome.partial,
        rows,
      });
    }
    const created = this.apply(desk, scenario, 'manual', body.idempotency_key ?? '');
    return this.answer(route, 201, created);
  }

  private async confirm(route: Route, desk: Desk): Promise<void> {
    const body = route.request().postDataJSON() as {
      debit: string;
      credit: string;
      idempotency_key?: string;
    };
    if (body.idempotency_key && desk.keys.has(body.idempotency_key)) {
      return this.answer(
        route,
        400,
        error('accounting_lettering_exists', { lettering: desk.keys.get(body.idempotency_key) }),
      );
    }
    const debit = this.keyOf(desk, body.debit);
    const credit = this.keyOf(desk, body.credit);
    const proposal = PROPOSALS.find((pair) => pair.debit === debit && pair.credit === credit);
    if (!proposal) {
      return this.answer(route, 400, error('accounting_lettering_not_a_proposal'));
    }
    if ([debit, credit].some((key) => desk.lines.get(key!)!.status !== 'open')) {
      return this.answer(route, 400, error('accounting_lettering_line_lettered'));
    }
    const amount = desk.lines.get(debit!)!.open_amount;
    const scenario: Scenario = {
      lines: [debit!, credit!],
      allowPartial: false,
      outcome: {
        amount,
        partial: false,
        rows: {},
        effect: { [debit!]: [amount, D('0')], [credit!]: [amount, D('0')] },
      },
    };
    return this.answer(
      route,
      201,
      this.apply(desk, scenario, 'automatic', body.idempotency_key ?? ''),
    );
  }

  /** Records a lettering of a scenario: its items and the line states the fixture gives. */
  private apply(
    desk: Desk,
    scenario: Scenario,
    kind: 'manual' | 'automatic',
    key: string,
  ): LetteringJson {
    if ('error' in scenario.outcome) {
      throw new Error('An error scenario letters nothing');
    }
    const outcome = scenario.outcome;
    const lines = scenario.lines.map((item) => desk.lines.get(item)!);
    const before = new Map(scenario.lines.map((item) => [item, { ...desk.lines.get(item)! }]));
    desk.number += 1;
    const lettering: LetteringJson = {
      public_id: uuid(),
      reference: `LET-${String(desk.number).padStart(6, '0')}`,
      kind,
      status: 'active',
      account: lines[0].account,
      partner: lines[0].partner,
      currency: 'GNF',
      amount: outcome.amount,
      partial: outcome.partial,
      created_by: 'dddddddd-0000-4000-8000-000000000004',
      created_at: NOW,
      cancelled_by: null,
      cancelled_at: null,
      cancellation_reason: '',
      items: lines.map((line) => ({
        line: line.public_id,
        entry: line.entry,
        entry_date: line.entry_date,
        side: line.side,
        amount: outcome.amount,
      })),
    };
    for (const [item, [lettered, open]] of Object.entries(outcome.effect)) {
      const line = desk.lines.get(item)!;
      desk.lines.set(item, {
        ...line,
        lettered_amount: lettered,
        open_amount: open,
        status: open === D('0') ? 'lettered' : 'partial',
      });
    }
    desk.before.set(lettering.public_id, before);
    this.entries.recordEvent(
      desk.company,
      'letter',
      'accounting.lettering',
      lettering.public_id,
      lettering.reference,
    );
    desk.letterings.push(lettering);
    if (key) {
      desk.keys.set(key, lettering.public_id);
    }
    return lettering;
  }

  private scenario(keys: readonly string[], allowPartial: boolean): Scenario | undefined {
    const wanted = [...keys].sort().join(',');
    return SCENARIOS.concat(SCENARIOS_MADE).find(
      (item) => [...item.lines].sort().join(',') === wanted && item.allowPartial === allowPartial,
    );
  }

  private keyOf(desk: Desk, id: string): string | null {
    for (const [key, line] of desk.lines) {
      if (line.public_id === id) {
        return key;
      }
    }
    return null;
  }

  private keyLine(desk: Desk, key: string): LineJson {
    return desk.lines.get(key)!;
  }

  private proposalLine(line: LineJson) {
    return {
      public_id: line.public_id,
      entry: line.entry,
      entry_date: line.entry_date,
      label: line.label,
    };
  }
}

/** The lettering the fixture starts with (company A): LET-000001 on 401, FOU-001. */
const SCENARIOS_MADE: readonly Scenario[] = [
  {
    lines: ['L7', 'L8'],
    allowPartial: false,
    outcome: {
      amount: D('900000'),
      partial: false,
      rows: {},
      effect: { L7: [D('900000'), D('0')], L8: [D('900000'), D('0')] },
    },
  },
];
