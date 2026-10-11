import { Route } from '@playwright/test';

import { FakeAccounting, PeriodJson } from './fake-accounting';
import { PartnersContext } from './fake-partners';

/**
 * The closing part of the fake API (`closing/runs/…`): a fiscal year's closing and its ten
 * steps, run in order. Each step succeeds, except `blockingOnce`, which first fails with a
 * blocking point. The close closes the fiscal year and all its periods in the fake books
 * (note backend 0036); the reopening reopens the fiscal year alone, then one period at a
 * time. Only the rules the tests need.
 */

const STEPS = [
  'pre_close_checks',
  'inventory',
  'depreciation',
  'provisions',
  'fx',
  'tax_check',
  'validation',
  'result',
  'close',
  'opening',
] as const;
type StepCode = (typeof STEPS)[number];

/** The validation and the close are decisions with their own permission. */
const PERMISSIONS: Partial<Record<StepCode, string>> = {
  validation: 'closing.validate',
  close: 'closing.close',
};

interface CheckJson {
  step: StepCode;
  attempt: number;
  code: string;
  level: 'ok' | 'warning' | 'blocking';
  message: string;
  details: Record<string, unknown>;
  source: string;
}

interface StepJson {
  public_id: string;
  code: StepCode;
  sequence: number;
  status: 'pending' | 'succeeded' | 'failed' | 'skipped';
  attempts: number;
  finished_at: string | null;
  result: Record<string, unknown>;
  checks: CheckJson[];
}

interface ReopeningJson {
  public_id: string;
  reason: string;
  reopened_by: string;
  periods: string[];
  fiscal_year_reopened: boolean;
  created_at: string;
}

interface RunJson {
  public_id: string;
  scope: 'fiscal_year';
  fiscal_year: { public_id: string; code: string };
  period: null;
  status: 'in_progress' | 'closed' | 'completed' | 'cancelled' | 'reopened';
  current_step: StepCode | '';
  result: null;
  next_fiscal_year: null;
  failed_step: StepCode | '';
  reason: string;
  created_at: string;
  closed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  reopenings: ReopeningJson[];
}

const STAMP = '2026-12-31T10:00:00Z';
const LIVE = ['in_progress', 'closed', 'completed'];
let sequence = 0;
const uuid = () => `50000000-0000-4000-9000-${String(++sequence).padStart(12, '0')}`;
const error = (code: string, details: unknown = null) => ({
  error: { code, message: code, details, correlation_id: 'e2e' },
});

export class FakeClosing {
  private readonly runs: Record<string, RunJson[]> = {};
  private readonly steps = new Map<string, StepJson[]>();
  /** A step that fails once with a blocking point (`pending_entries`), then succeeds. */
  blockingOnce: StepCode | null = null;

  constructor(
    private readonly context: PartnersContext,
    private readonly accounting: FakeAccounting,
  ) {}

  async install(): Promise<void> {
    await this.context.page.route('**/api/v1/closing/**', (route) => this.handle(route));
  }

  private async answer(route: Route, status: number, json?: unknown): Promise<void> {
    this.context.calls.push(route.request());
    await route.fulfill({ status, json });
  }

  private view(run: RunJson) {
    const steps = this.steps.get(run.public_id) ?? [];
    return {
      ...run,
      steps: steps.map(({ code, sequence: number, status, attempts, finished_at }) => ({
        code,
        sequence: number,
        status,
        attempts,
        finished_at,
      })),
    };
  }

  private periodsOf(company: string, run: RunJson): PeriodJson[] {
    return this.accounting
      .books(company)
      .periods.filter((item) => item.fiscal_year === run.fiscal_year.public_id)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const permissions = await this.context.permissionsOf(request);
    if (!permissions.includes('closing.read')) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    const method = request.method();
    if (method !== 'GET' && !(await this.context.csrfOk(request))) {
      return this.answer(route, 403, error('csrf_failed'));
    }
    const company = await this.context.companyOf(request);
    const runs = (this.runs[company] ??= []);
    const parts = new URL(request.url()).pathname
      .replace('/api/v1/closing/runs/', '')
      .split('/')
      .filter(Boolean);
    const body =
      method === 'POST' ? ((request.postDataJSON() ?? {}) as Record<string, string>) : {};
    const can = (permission: string) => permissions.includes(permission);

    if (parts.length === 0) {
      if (method === 'GET') {
        const results = runs.map((run) => this.view(run));
        return this.answer(route, 200, {
          count: results.length,
          next: null,
          previous: null,
          results,
        });
      }
      if (!can('closing.start')) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
      return this.start(route, company, body['fiscal_year']);
    }
    const run = runs.find((item) => item.public_id === parts[0]);
    if (!run) {
      return this.answer(route, 404, error('not_found'));
    }
    const [, resource, target, command] = parts;
    if (method === 'GET' && !resource) {
      return this.answer(route, 200, this.view(run));
    }
    if (method === 'GET' && resource === 'steps') {
      return this.answer(route, 200, this.steps.get(run.public_id));
    }
    if (method === 'GET' && resource === 'periods') {
      return this.answer(
        route,
        200,
        this.periodsOf(company, run).map(
          ({ public_id, code, label, start_date, end_date, status }) => ({
            public_id,
            code,
            label,
            start_date,
            end_date,
            status,
          }),
        ),
      );
    }
    if (method === 'POST' && resource === 'steps') {
      return this.execute(route, company, run, target as StepCode, command === 'retry', can);
    }
    if (method === 'POST' && ['reopen', 'cancel'].includes(resource) && !target) {
      if (!can(resource === 'reopen' ? 'closing.reopen' : 'closing.start')) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
      if (!body['reason']?.trim()) {
        return this.answer(
          route,
          400,
          error('validation_error', { reason: [{ message: 'x', code: 'required' }] }),
        );
      }
      return resource === 'reopen'
        ? this.reopen(route, company, run, body['reason'])
        : this.cancel(route, run, body['reason']);
    }
    if (method === 'POST' && resource === 'periods' && command === 'reopen') {
      if (!can('closing.reopen')) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
      if (!body['reason']?.trim()) {
        return this.answer(
          route,
          400,
          error('validation_error', { reason: [{ message: 'x', code: 'required' }] }),
        );
      }
      return this.reopenPeriod(route, company, run, target, body['reason']);
    }
    return this.answer(route, 404, error('not_found'));
  }

  private start(route: Route, company: string, fiscalYearId: string): Promise<void> {
    const year = this.accounting
      .books(company)
      .years.find((item) => item.public_id === fiscalYearId);
    if (!year || year.status !== 'open') {
      return this.answer(route, 400, error('closing_invalid_transition'));
    }
    const live = (this.runs[company] ??= []).find(
      (item) => item.fiscal_year.public_id === year.public_id && LIVE.includes(item.status),
    );
    if (live) {
      return this.answer(route, 400, error('closing_run_exists', { run: live.public_id }));
    }
    return this.answer(route, 201, this.view(this.open(company, year.public_id, year.code)));
  }

  /** A fiscal year's closing in progress, its ten steps pending (also seeded by the tests). */
  open(company: string, fiscalYearId: string, code: string): RunJson {
    const run: RunJson = {
      public_id: uuid(),
      scope: 'fiscal_year',
      fiscal_year: { public_id: fiscalYearId, code },
      period: null,
      status: 'in_progress',
      current_step: STEPS[0],
      result: null,
      next_fiscal_year: null,
      failed_step: '',
      reason: '',
      created_at: STAMP,
      closed_at: null,
      completed_at: null,
      cancelled_at: null,
      reopenings: [],
    };
    (this.runs[company] ??= []).unshift(run);
    this.steps.set(
      run.public_id,
      STEPS.map((step, index) => ({
        public_id: uuid(),
        code: step,
        sequence: index + 1,
        status: 'pending',
        attempts: 0,
        finished_at: null,
        result: {},
        checks: [],
      })),
    );
    return run;
  }

  private execute(
    route: Route,
    company: string,
    run: RunJson,
    code: StepCode,
    retry: boolean,
    can: (permission: string) => boolean,
  ): Promise<void> {
    const steps = this.steps.get(run.public_id) ?? [];
    const step = steps.find((item) => item.code === code);
    if (!step) {
      return this.answer(route, 404, error('not_found'));
    }
    if (!can(PERMISSIONS[code] ?? 'closing.execute')) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    const runnable = code === 'opening' ? run.status === 'closed' : run.status === 'in_progress';
    if (!runnable || run.current_step !== code || step.status !== (retry ? 'failed' : 'pending')) {
      return this.answer(route, 400, error('closing_step_invalid_transition'));
    }
    step.attempts += 1;
    step.finished_at = STAMP;
    if (this.blockingOnce === code) {
      this.blockingOnce = null;
      step.status = 'failed';
      step.checks = [
        {
          step: code,
          attempt: step.attempts,
          code: 'pending_entries',
          level: 'blocking',
          message: 'Draft or submitted entries could no longer be validated once closed.',
          details: { count: 1 },
          source: 'accounting',
        },
      ];
      run.failed_step = code;
      return this.answer(route, 200, step);
    }
    step.status = 'succeeded';
    step.checks =
      code === 'tax_check'
        ? [
            {
              step: code,
              attempt: step.attempts,
              code: 'tax_calendar_undefined',
              level: 'warning',
              message: 'No tax calendar.',
              details: {},
              source: 'taxes',
            },
          ]
        : [];
    run.failed_step = '';
    if (code === 'close') {
      // The fiscal year and every period of it (note backend 0036).
      const books = this.accounting.books(company);
      for (const period of this.periodsOf(company, run)) {
        period.status = 'closed';
      }
      const year = books.years.find((item) => item.public_id === run.fiscal_year.public_id);
      if (year) {
        year.status = 'closed';
      }
      run.status = 'closed';
      run.closed_at = STAMP;
    }
    if (code === 'opening') {
      run.status = 'completed';
      run.completed_at = STAMP;
    }
    run.current_step = steps.find((item) => item.status === 'pending')?.code ?? '';
    return this.answer(route, 200, step);
  }

  private reopen(route: Route, company: string, run: RunJson, reason: string): Promise<void> {
    if (!['closed', 'completed'].includes(run.status)) {
      return this.answer(route, 400, error('closing_invalid_transition'));
    }
    // The fiscal year alone: its periods stay closed.
    const year = this.accounting
      .books(company)
      .years.find((item) => item.public_id === run.fiscal_year.public_id);
    if (year) {
      year.status = 'open';
    }
    run.status = 'reopened';
    run.reopenings.push({
      public_id: uuid(),
      reason: reason.trim(),
      reopened_by: 'dddddddd-0000-4000-8000-000000000004',
      periods: [],
      fiscal_year_reopened: true,
      created_at: '2027-01-10T09:00:00Z',
    });
    return this.answer(route, 200, this.view(run));
  }

  private reopenPeriod(
    route: Route,
    company: string,
    run: RunJson,
    periodId: string,
    reason: string,
  ): Promise<void> {
    if (run.status !== 'reopened') {
      return this.answer(route, 400, error('closing_invalid_transition'));
    }
    const period = this.periodsOf(company, run).find((item) => item.public_id === periodId);
    if (!period) {
      return this.answer(route, 404, error('not_found'));
    }
    if (period.status !== 'closed') {
      return this.answer(route, 400, error('closing_period_not_closed', { period: period.code }));
    }
    period.status = 'open';
    run.reopenings.push({
      public_id: uuid(),
      reason: reason.trim(),
      reopened_by: 'dddddddd-0000-4000-8000-000000000004',
      periods: [period.code],
      fiscal_year_reopened: false,
      created_at: '2027-01-10T09:30:00Z',
    });
    return this.answer(route, 200, this.view(run));
  }

  private cancel(route: Route, run: RunJson, reason: string): Promise<void> {
    if (run.status !== 'in_progress') {
      return this.answer(route, 400, error('closing_invalid_transition'));
    }
    run.status = 'cancelled';
    run.reason = reason.trim();
    run.cancelled_at = STAMP;
    run.current_step = '';
    return this.answer(route, 200, this.view(run));
  }
}
