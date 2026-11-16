import { Route } from '@playwright/test';

import { FakeAccounting } from './fake-accounting';
import { EntryJson, FakeAccountingEntries } from './fake-accounting-entries';
import { FakeLettering } from './fake-lettering';
import { FakePartners, PartnersContext } from './fake-partners';

/**
 * Due dates and the aged balance (V2.1, lot A5) in the fake API, shaped like the OpenAPI
 * schemas (`AccountingDueItem`, `AccountingDueSchedule`, `AccountingPendingLine`, the aged
 * balance and the aging policy), company scoped, with the contract's permissions, statuses
 * and errors. It computes NOTHING: no due date, no amount, no delay, no bucket, no open amount
 * — every figure is an explicit fixture (the installments, the schedule each pending line
 * gives when generated, the reports for each set of buckets). The entries are the fake ledger's
 * own (an installment opens a real entry).
 */

type Role = 'customer' | 'supplier';

interface Ref {
  public_id: string;
  code: string;
}
interface PartnerRef extends Ref {
  name: string;
}
interface EntryRef {
  public_id: string;
  entry_number: string;
  entry_date: string;
}

interface ItemJson {
  public_id: string;
  schedule: string;
  sequence: number;
  due_date: string;
  percentage: string;
  partner: PartnerRef;
  role: Role;
  account: Ref;
  entry: EntryRef;
  line: string;
  currency: string;
  amount: string;
  settled_amount: string;
  open_amount: string;
  status: 'open' | 'partial' | 'settled';
  last_settled_on: string | null;
  settlements: {
    lettering: { public_id: string; reference: string };
    amount: string;
    settled_on: string;
  }[];
}

interface ScheduleJson {
  public_id: string;
  line: string;
  entry: EntryRef;
  partner: PartnerRef;
  account: Ref;
  role: Role;
  payment_days: number;
  reference_date: string;
  currency: string;
  amount: string;
  created_at: string;
  recomputed_at: string | null;
}

interface PendingJson {
  public_id: string;
  entry: EntryRef;
  document_date: string | null;
  partner: PartnerRef;
  account: Ref;
  role: Role;
  label: string;
  currency: string;
  amount: string;
}

interface Desk {
  company: string;
  items: ItemJson[];
  schedules: ScheduleJson[];
  pending: PendingJson[];
  /** What generating each pending line gives (explicit fixture). */
  generates: Map<string, { schedule: ScheduleJson; items: ItemJson[] }>;
  limits: number[];
}

const D = (units: string) => `${units}.000000`;
const NOW = '2026-10-04T10:00:00Z';
/** Le délai des fixtures : 30 jours après la date de référence. */
const NET_DAYS = 30;

let sequence = 0;
const uuid = () => `80000000-0000-4000-9000-${String(++sequence).padStart(12, '0')}`;

const error = (code: string, details: unknown = null) => ({
  error: { code, message: code, details, correlation_id: 'e2e' },
});

/** The buckets of each policy the fixtures know (the server's answer, never computed here). */
const BUCKETS: Readonly<
  Record<string, { code: string; first_day: number | null; last_day: number | null }[]>
> = {
  '30,60,90,120': [
    { code: 'not_due', first_day: null, last_day: 0 },
    { code: '1-30', first_day: 1, last_day: 30 },
    { code: '31-60', first_day: 31, last_day: 60 },
    { code: '61-90', first_day: 61, last_day: 90 },
    { code: '91-120', first_day: 91, last_day: 120 },
    { code: '121+', first_day: 121, last_day: null },
  ],
  '15,45': [
    { code: 'not_due', first_day: null, last_day: 0 },
    { code: '1-15', first_day: 1, last_day: 15 },
    { code: '16-45', first_day: 16, last_day: 45 },
    { code: '46+', first_day: 46, last_day: null },
  ],
};

interface AgedFigures {
  /** Amount per bucket code (absent: zero). */
  buckets: Record<string, string>;
  total: string;
  unscheduled: string;
  unapplied: string;
  balance: string;
}

interface AgedFixture {
  totals: AgedFigures;
  rows: { partner: string; oldest: string | null; figures: AgedFigures }[];
}

const CLI001 = (bucket: string): AgedFigures => ({
  buckets: { [bucket]: '600000' },
  total: '600000',
  unscheduled: '500000',
  unapplied: '50000',
  balance: '1050000',
});
const CLI002: AgedFigures = {
  buckets: { not_due: '750000' },
  total: '750000',
  unscheduled: '0',
  unapplied: '0',
  balance: '750000',
};
const FOU001: AgedFigures = {
  buckets: {},
  total: '0',
  unscheduled: '300000',
  unapplied: '0',
  balance: '300000',
};

/** The server's aged balance per policy and role (fixtures: every figure written out). */
const AGED: Readonly<Record<string, Record<Role, AgedFixture>>> = Object.fromEntries(
  (['30,60,90,120', '15,45'] as const).map((key) => {
    const overdue = key === '15,45' ? '1-15' : '1-30';
    return [
      key,
      {
        customer: {
          totals: {
            buckets: { [overdue]: '600000', not_due: '750000' },
            total: '1350000',
            unscheduled: '500000',
            unapplied: '50000',
            balance: '1800000',
          },
          rows: [
            { partner: 'CLI-001', oldest: '2026-04-01', figures: CLI001(overdue) },
            { partner: 'CLI-002', oldest: '2026-05-15', figures: CLI002 },
          ],
        },
        supplier: {
          totals: FOU001,
          rows: [{ partner: 'FOU-001', oldest: null, figures: FOU001 }],
        },
      },
    ];
  }),
);

/**
 * A large bucket (lot A5.1): 260 explicit installments of CLI-002, not yet due, more than a
 * page of 200 — so that a bucket is always the server's complete, paged list.
 */
const BUCKET_DOCS: Readonly<Record<string, (desk: Desk) => Record<string, unknown>[]>> = {
  'CLI-002:not_due': (desk) => {
    const item = desk.items.find((found) => found.partner.code === 'CLI-002')!;
    return Array.from({ length: 259 }, (_, index) => ({
      kind: 'installment',
      due_item: `90000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`,
      schedule: item.schedule,
      line: `91000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`,
      entry: item.entry,
      account: item.account.code,
      document_reference: `FAC-${String(index + 1).padStart(3, '0')}`,
      label: `Échéance ${index + 2} de la facture`,
      due_date: '2026-05-15',
      days_past_due: -30,
      bucket: 'not_due',
      amount: '1000.000000',
      open_amount: '1000.000000',
    }));
  },
};

const NOTHING: AgedFixture = {
  totals: { buckets: {}, total: '0', unscheduled: '0', unapplied: '0', balance: '0' },
  rows: [],
};

export class FakeDues {
  private readonly desks: Record<string, Desk> = {};

  constructor(
    private readonly context: PartnersContext,
    private readonly accounting: FakeAccounting,
    private readonly partners: FakePartners,
    private readonly entries: FakeAccountingEntries,
    private readonly lettering: FakeLettering,
  ) {}

  items(company: string): readonly ItemJson[] {
    return this.desk(company).items;
  }

  schedules(company: string): readonly ScheduleJson[] {
    return this.desk(company).schedules;
  }

  pending(company: string): readonly PendingJson[] {
    return this.desk(company).pending;
  }

  limits(company: string): readonly number[] {
    return this.desk(company).limits;
  }

  async install(): Promise<void> {
    const page = this.context.page;
    // Registered after the accounting fake: tried first for these paths.
    await page.route('**/api/v1/accounting/due-items/**', (route) => this.handle(route));
    await page.route('**/api/v1/accounting/due-schedules/**', (route) => this.handle(route));
    await page.route('**/api/v1/reporting/aged-balance/**', (route) => this.report(route));
  }

  // ---- Fixtures ------------------------------------------------------------------------------

  private desk(company: string): Desk {
    const found = this.desks[company];
    if (found) {
      return found;
    }
    const desk: Desk = {
      company,
      items: [],
      schedules: [],
      pending: [],
      generates: new Map(),
      limits: [30, 60, 90, 120],
    };
    this.desks[company] = desk;
    if (company !== 'A') {
      return desk; // Another company: nothing of A.
    }
    const posted = this.entries
      .entries(company)
      .filter((entry) => entry.status === 'validated')
      .slice(0, 5);
    const accounts = this.accounting.books(company).accounts;
    const account = (code: string) => {
      const found = accounts.find((item) => item.code === code)!;
      return { public_id: found.public_id, code: found.code };
    };
    const partner = (code: string) => {
      const found = this.partners.list(company).find((item) => item.code === code)!;
      return { public_id: found.public_id, code: found.code, name: found.name };
    };
    const entry = (index: number): EntryRef => {
      const found: EntryJson = posted[index];
      return {
        public_id: found.public_id,
        entry_number: found.entry_number,
        entry_date: found.entry_date,
      };
    };
    const lettering = this.lettering.letterings(company)[0];
    const schedule = (
      at: number,
      who: PartnerRef,
      role: Role,
      [amount, settled, open]: [string, string, string],
      due: string,
      status: ItemJson['status'],
    ) => {
      const line = uuid();
      const made: ScheduleJson = {
        public_id: uuid(),
        line,
        entry: entry(at),
        partner: who,
        account: account(role === 'customer' ? '411' : '401'),
        role,
        payment_days: NET_DAYS,
        reference_date: entry(at).entry_date,
        currency: 'GNF',
        amount: D(amount),
        created_at: NOW,
        recomputed_at: null,
      };
      const item: ItemJson = {
        public_id: uuid(),
        schedule: made.public_id,
        sequence: 1,
        due_date: due,
        percentage: '100.0000',
        partner: who,
        role,
        account: made.account,
        entry: made.entry,
        line,
        currency: 'GNF',
        amount: D(amount),
        settled_amount: D(settled),
        open_amount: D(open),
        status,
        last_settled_on: settled === '0' ? null : '2026-03-10',
        settlements:
          settled === '0'
            ? []
            : [
                {
                  lettering: { public_id: lettering.public_id, reference: lettering.reference },
                  amount: D(settled),
                  settled_on: '2026-03-10',
                },
              ],
      };
      return { schedule: made, items: [item] };
    };
    for (const made of [
      schedule(
        0,
        partner('CLI-001'),
        'customer',
        ['1000000', '400000', '600000'],
        '2026-04-01',
        'partial',
      ),
      schedule(1, partner('CLI-002'), 'customer', ['750000', '0', '750000'], '2026-05-15', 'open'),
      schedule(
        2,
        partner('FOU-001'),
        'supplier',
        ['900000', '900000', '0'],
        '2026-03-20',
        'settled',
      ),
    ]) {
      desk.schedules.push(made.schedule);
      desk.items.push(...made.items);
    }
    const pending = (at: number, who: PartnerRef, role: Role, amount: string, due: string) => {
      const generated = schedule(at, who, role, [amount, '0', amount], due, 'open');
      const line: PendingJson = {
        public_id: generated.schedule.line,
        entry: generated.schedule.entry,
        document_date: null,
        partner: who,
        account: generated.schedule.account,
        role,
        label: `Facture ${generated.schedule.entry.entry_number}`,
        currency: 'GNF',
        amount: D(amount),
      };
      desk.pending.push(line);
      desk.generates.set(line.public_id, generated);
    };
    pending(3, partner('CLI-001'), 'customer', '500000', '2026-04-30');
    pending(4, partner('FOU-001'), 'supplier', '300000', '2026-05-05');
    return desk;
  }

  // ---- Accounting: installments, schedules, pending lines --------------------------------------

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
    if (request.method() === 'POST') {
      if (!(await this.context.csrfOk(request))) {
        return this.answer(route, 403, error('csrf_failed'));
      }
      if (!permissions.includes('accounting.manage_due_dates')) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
    }
    const desk = this.desk(await this.context.companyOf(request));
    const url = new URL(request.url());
    const q = (name: string) => url.searchParams.get(name);
    const [resource, id, command] = url.pathname
      .replace('/api/v1/accounting/', '')
      .split('/')
      .filter(Boolean);

    if (resource === 'due-items') {
      if (!id) {
        return this.paged(
          route,
          desk.items
            .filter(
              (item) =>
                (!q('partner') || item.partner.public_id === q('partner')) &&
                (!q('role') || item.role === q('role')) &&
                (!q('status') || item.status === q('status')) &&
                (!q('due_from') || item.due_date >= q('due_from')!) &&
                (!q('due_to') || item.due_date <= q('due_to')!),
            )
            .map((item) => ({ ...item, settlements: undefined }))
            .sort((a, b) => a.due_date.localeCompare(b.due_date)),
        );
      }
      const found = desk.items.find((item) => item.public_id === id);
      return found ? this.answer(route, 200, found) : this.answer(route, 404, error('not_found'));
    }
    if (id === 'pending-lines') {
      return this.paged(
        route,
        desk.pending.filter(
          (line) =>
            (!q('partner') || line.partner.public_id === q('partner')) &&
            (!q('role') || line.role === q('role')),
        ),
      );
    }
    if (!id && request.method() === 'POST') {
      const body = request.postDataJSON() as { lines?: string[] };
      const lines = body.lines ?? [];
      const unknown = lines.filter((line) => !desk.generates.has(line));
      if (lines.length === 0 || unknown.length > 0) {
        return this.answer(
          route,
          400,
          error('validation_error', {
            lines: [{ message: 'Unknown reference.', code: 'unknown' }],
          }),
        );
      }
      const created = lines.map((line) => desk.generates.get(line)!);
      for (const made of created) {
        desk.schedules.push(made.schedule);
        desk.items.push(...made.items);
        desk.pending = desk.pending.filter((line) => line.public_id !== made.schedule.line);
        desk.generates.delete(made.schedule.line);
        this.entries.recordEvent(
          desk.company,
          'create',
          'accounting.dueschedule',
          made.schedule.public_id,
          made.schedule.entry.entry_number,
        );
      }
      return this.answer(
        route,
        201,
        created.map((made) => this.withItems(desk, made.schedule)),
      );
    }
    const schedule = desk.schedules.find((item) => item.public_id === id);
    if (!schedule) {
      return this.answer(route, 404, error('not_found'));
    }
    if (command === 'recompute' && request.method() === 'POST') {
      const body = request.postDataJSON() as {
        reason?: string;
        payment_days?: number;
        reference_date?: string;
      };
      if (!body.reason?.trim()) {
        return this.answer(
          route,
          400,
          error('validation_error', {
            reason: [{ message: 'This field is required.', code: 'required' }],
          }),
        );
      }
      schedule.recomputed_at = NOW;
      if (body.payment_days !== undefined) {
        schedule.payment_days = body.payment_days;
      }
      if (body.reference_date) {
        schedule.reference_date = body.reference_date;
      }
      this.entries.recordEvent(
        desk.company,
        'update',
        'accounting.dueschedule',
        schedule.public_id,
        schedule.entry.entry_number,
      );
      return this.answer(route, 200, this.withItems(desk, schedule));
    }
    return this.answer(route, 200, this.withItems(desk, schedule));
  }

  private withItems(desk: Desk, schedule: ScheduleJson) {
    return {
      ...schedule,
      items: desk.items
        .filter((item) => item.schedule === schedule.public_id)
        .map((item) => ({
          public_id: item.public_id,
          sequence: item.sequence,
          due_date: item.due_date,
          percentage: item.percentage,
          amount: item.amount,
          settled_amount: item.settled_amount,
          open_amount: item.open_amount,
          status: item.status,
          last_settled_on: item.last_settled_on,
        })),
    };
  }

  // ---- Reporting: the aged balance and its buckets ----------------------------------------------

  private async report(route: Route): Promise<void> {
    const request = route.request();
    const permissions = await this.context.permissionsOf(request);
    if (!permissions.includes('reporting.read_auxiliary')) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    const company = await this.context.companyOf(request);
    const desk = this.desk(company);
    const url = new URL(request.url());
    const role = url.searchParams.get('role') as Role | null;
    const asOf = url.searchParams.get('as_of');
    const missing = Object.fromEntries(
      [
        ['role', role],
        ['as_of', asOf],
      ]
        .filter(([, value]) => !value)
        .map(([name]) => [
          name as string,
          [{ message: 'This field is required.', code: 'required' }],
        ]),
    );
    if (Object.keys(missing).length > 0) {
      return this.answer(route, 400, error('validation_error', missing));
    }
    const key = desk.limits.join(',');
    const buckets = BUCKETS[key];
    const fixture = company === 'A' ? AGED[key][role!] : NOTHING;
    const partners = this.partners.list(company);
    const shape = (figures: AgedFigures) => ({
      buckets: buckets.map((bucket) => ({
        code: bucket.code,
        amount: D(figures.buckets[bucket.code] ?? '0'),
      })),
      total: D(figures.total),
      unscheduled: D(figures.unscheduled),
      unapplied: D(figures.unapplied),
      balance: D(figures.balance),
    });
    const ref = (code: string) => {
      const found = partners.find((item) => item.code === code)!;
      return { public_id: found.public_id, code: found.code, name: found.name };
    };
    const header = { as_of: asOf, role, currency: 'GNF', buckets };
    const partnerId = url.pathname.replace('/api/v1/reporting/aged-balance/', '').split('/')[1];
    if (!partnerId) {
      const results = fixture.rows.map((row) => ({
        partner: ref(row.partner),
        oldest_due_date: row.oldest,
        ...shape(row.figures),
      }));
      return this.answer(route, 200, {
        ...header,
        totals: shape(fixture.totals),
        count: results.length,
        next: null,
        previous: null,
        results,
      });
    }
    const partner = partners.find((item) => item.public_id === partnerId);
    if (!partner) {
      return this.answer(route, 404, error('not_found'));
    }
    const own = fixture.rows.find((row) => row.partner === partner.code);
    const code = url.searchParams.get('bucket');
    const bucket = code === null ? null : (buckets.find((item) => item.code === code) ?? null);
    if (code !== null && bucket === null) {
      return this.answer(
        route,
        400,
        error('reporting_aging_bucket_unknown', {
          bucket: code,
          buckets: buckets.map((item) => item.code),
        }),
      );
    }
    // One bucket: the fixture documents the « server » put in it (lot A5.1), paged.
    const documents =
      code === null
        ? this.documents(desk, partner.code, role!, key)
        : [
            ...this.documents(desk, partner.code, role!, key),
            ...(BUCKET_DOCS[`${partner.code}:${code}`]?.(desk) ?? []),
          ].filter((document) => document.bucket === code);
    const size = Number(url.searchParams.get('page_size')) || 50;
    const number = Number(url.searchParams.get('page')) || 1;
    const results = documents.slice((number - 1) * size, number * size);
    if (number > 1 && results.length === 0) {
      return this.answer(route, 404, error('not_found'));
    }
    return this.answer(route, 200, {
      ...header,
      totals: shape(own ? own.figures : NOTHING.totals),
      partner: { public_id: partner.public_id, code: partner.code, name: partner.name },
      bucket,
      count: documents.length,
      next: number * size < documents.length ? 'next' : null,
      previous: number > 1 ? 'previous' : null,
      results,
    });
  }

  /** A partner's open documents (fixtures: the installments and pending lines above). */
  private documents(desk: Desk, code: string, role: Role, key: string) {
    const bucket = key === '15,45' ? '1-15' : '1-30';
    const installments = desk.items
      .filter(
        (item) => item.partner.code === code && item.role === role && item.status !== 'settled',
      )
      .map((item) => ({
        kind: 'installment',
        due_item: item.public_id,
        schedule: item.schedule,
        line: item.line,
        entry: item.entry,
        account: item.account.code,
        document_reference: '',
        label: `Facture ${item.entry.entry_number}`,
        due_date: item.due_date,
        days_past_due: item.due_date === '2026-04-01' ? 14 : -30,
        bucket: item.due_date === '2026-04-01' ? bucket : 'not_due',
        amount: item.amount,
        open_amount: item.open_amount,
      }));
    const unscheduled = desk.pending
      .filter((line) => line.partner.code === code && line.role === role)
      .map((line) => ({
        kind: 'unscheduled',
        due_item: null,
        schedule: null,
        line: line.public_id,
        entry: line.entry,
        account: line.account.code,
        document_reference: '',
        label: line.label,
        due_date: null,
        days_past_due: null,
        bucket: null,
        amount: line.amount,
        open_amount: line.amount,
      }));
    return [...installments, ...unscheduled];
  }
}
