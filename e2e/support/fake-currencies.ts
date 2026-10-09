import { Request, Route } from '@playwright/test';

import { PartnersContext } from './fake-partners';

/**
 * The currencies part of the fake API (`currencies/…`): the shared catalogue (a few of
 * Odoo's currencies, the active ones first; no `X-Company-ID`, changed with the global
 * `currencies.create` / `currencies.update`) and each company's rates (`currencies.read`,
 * `currencies.manage_rates`; never changed: withdrawn). Only the rules the tests need: a
 * company's currency stays active and has no rate, one active rate per currency and day, no
 * rate for an inactive currency.
 */

export interface CurrencyJson {
  public_id: string;
  code: string;
  name: string;
  symbol: string;
  decimal_places: number;
  status: 'active' | 'inactive';
  position: 'before' | 'after';
  unit_label: string;
  subunit_label: string;
}

export interface RateJson {
  public_id: string;
  currency: string;
  quote_currency: string;
  rate: string;
  rate_date: string;
  source: string;
  retrieved_at: null;
  status: 'active' | 'withdrawn';
  created_at: string;
}

/** The reference currency of each fake company (`fake-api.ts`). */
const REFERENCE: Readonly<Record<string, string>> = { A: 'GNF', B: 'XOF', C: 'XOF' };

const currency = (
  code: string,
  name: string,
  symbol: string,
  extra: Partial<CurrencyJson> = {},
): CurrencyJson => ({
  // One id per code (three capital letters: 65 to 90 each).
  public_id: `00000000-0000-4000-a000-${String(
    code.charCodeAt(0) * 10_000 + code.charCodeAt(1) * 100 + code.charCodeAt(2),
  ).padStart(12, '0')}`,
  code,
  name,
  symbol,
  decimal_places: 2,
  status: 'inactive',
  position: 'after',
  unit_label: '',
  subunit_label: '',
  ...extra,
});

function seedCatalogue(): CurrencyJson[] {
  return [
    currency('GNF', 'Franc guinéen', 'GNF', {
      decimal_places: 0,
      status: 'active',
      unit_label: 'Franc',
      subunit_label: 'Centime',
    }),
    currency('XOF', 'Franc CFA (BCEAO)', 'CFA', {
      decimal_places: 0,
      status: 'active',
      unit_label: 'Franc',
      subunit_label: 'Centimes',
    }),
    currency('EUR', 'Euro', '€', { status: 'active', unit_label: 'Euros', subunit_label: 'Cents' }),
    currency('USD', 'Dollar des États-Unis', '$', {
      status: 'active',
      position: 'before',
      unit_label: 'Dollars',
      subunit_label: 'Cents',
    }),
    currency('CHF', 'Franc suisse', 'CHF', { unit_label: 'Francs', subunit_label: 'Centimes' }),
    currency('CNY', 'Yuan renminbi chinois', '¥', { unit_label: 'Yuan', subunit_label: 'Fen' }),
    currency('JPY', 'Yen japonais', '¥', { decimal_places: 0, unit_label: 'Yen' }),
  ];
}

let sequence = 0;

const rate = (code: string, value: string, day: string, quote = 'GNF'): RateJson => {
  sequence += 1;
  return {
    public_id: `00000000-0000-4000-b000-${String(sequence).padStart(12, '0')}`,
    currency: code,
    quote_currency: quote,
    rate: value,
    rate_date: day,
    source: 'BCRG',
    retrieved_at: null,
    status: 'active',
    created_at: `${day}T08:00:00Z`,
  };
};

function seedRates(): Record<string, RateJson[]> {
  return {
    A: [
      rate('USD', '8600.000000000000', '2026-09-30'),
      rate('USD', '8650.000000000000', '2026-10-01'),
      rate('EUR', '9400.000000000000', '2026-10-01'),
    ],
    B: [rate('EUR', '655.957000000000', '2026-10-01', 'XOF')],
  };
}

const error = (code: string, details: unknown = null) => ({
  error: { code, message: code, details, correlation_id: 'e2e' },
});

/** Active currencies first (as Odoo lists them), then by code. */
const byStatusThenCode = (a: CurrencyJson, b: CurrencyJson) =>
  a.status.localeCompare(b.status) || a.code.localeCompare(b.code);

export class FakeCurrencies {
  readonly catalogue: CurrencyJson[] = seedCatalogue();
  readonly rates: Record<string, RateJson[]> = seedRates();

  constructor(
    private readonly context: PartnersContext,
    private readonly globalPermissions: () => readonly string[],
  ) {}

  async install(): Promise<void> {
    await this.context.page.route('**/api/v1/currencies/**', (route) => this.route(route));
  }

  private async answer(route: Route, status: number, json?: unknown): Promise<void> {
    this.context.calls.push(route.request());
    await route.fulfill({ status, json });
  }

  private async route(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1/currencies/', '');
    const method = request.method();
    if (method !== 'GET' && !(await this.context.csrfOk(request))) {
      return this.answer(route, 403, error('csrf_failed'));
    }
    if (path.startsWith('rates/')) {
      return this.ratesRoute(route, path.replace('rates/', ''), url);
    }
    if (path === '' && method === 'GET') {
      return this.answer(route, 200, this.catalogueList(url));
    }
    if (path === '' && method === 'POST') {
      return this.create(route, request);
    }
    const found = this.catalogue.find((item) => `${item.public_id}/` === path);
    if (!found) {
      return this.answer(route, 404, error('not_found'));
    }
    if (method === 'GET') {
      return this.answer(route, 200, found);
    }
    if (method === 'PATCH') {
      return this.update(route, request, found);
    }
    return this.answer(route, 405, error('method_not_allowed'));
  }

  private catalogueList(url: URL) {
    const search = (url.searchParams.get('search') ?? '').toLowerCase();
    const status = url.searchParams.get('status');
    const size = Number(url.searchParams.get('page_size') ?? 50);
    const number = Number(url.searchParams.get('page') ?? 1);
    const matching = this.catalogue
      .filter((item) => !status || item.status === status)
      .filter(
        (item) =>
          !search ||
          item.code.toLowerCase().includes(search) ||
          item.name.toLowerCase().includes(search),
      )
      .sort(byStatusThenCode);
    return {
      count: matching.length,
      next: null,
      previous: null,
      results: matching.slice((number - 1) * size, number * size),
    };
  }

  private async create(route: Route, request: Request): Promise<void> {
    if (!this.globalPermissions().includes('currencies.create')) {
      return this.answer(route, 403, error('permission_denied'));
    }
    const body = request.postDataJSON() as Partial<CurrencyJson>;
    const code = String(body.code ?? '')
      .trim()
      .toUpperCase();
    if (this.catalogue.some((item) => item.code === code)) {
      return this.answer(
        route,
        400,
        error('validation_error', { code: ['Une devise porte déjà ce code.'] }),
      );
    }
    const created = currency(code, String(body.name ?? ''), String(body.symbol ?? ''), {
      decimal_places: Number(body.decimal_places ?? 2),
      status: 'active',
      position: body.position ?? 'after',
      unit_label: body.unit_label ?? '',
      subunit_label: body.subunit_label ?? '',
    });
    this.catalogue.push(created);
    return this.answer(route, 201, created);
  }

  private async update(route: Route, request: Request, found: CurrencyJson): Promise<void> {
    if (!this.globalPermissions().includes('currencies.update')) {
      return this.answer(route, 403, error('permission_denied'));
    }
    const body = request.postDataJSON() as Partial<CurrencyJson>;
    const references = Object.values(REFERENCE);
    if (body.status === 'inactive' && references.includes(found.code)) {
      return this.answer(route, 400, error('reference_currency_in_use', { currency: found.code }));
    }
    for (const key of [
      'name',
      'symbol',
      'status',
      'position',
      'unit_label',
      'subunit_label',
    ] as const) {
      if (body[key] !== undefined) {
        Object.assign(found, { [key]: body[key] });
      }
    }
    return this.answer(route, 200, found);
  }

  private async ratesRoute(route: Route, path: string, url: URL): Promise<void> {
    const request = route.request();
    const permissions = await this.context.permissionsOf(request);
    if (!permissions.includes('currencies.read')) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    const company = await this.context.companyOf(request);
    const reference = REFERENCE[company] ?? 'GNF';
    const rates = (this.rates[company] ??= []);
    const method = request.method();
    if (path === 'current/' && method === 'GET') {
      const latest = new Map<string, RateJson>();
      for (const item of rates.filter((one) => one.status === 'active')) {
        const known = latest.get(item.currency);
        if (!known || known.rate_date < item.rate_date) {
          latest.set(item.currency, item);
        }
      }
      const current = [...latest.values()].sort((a, b) => a.currency.localeCompare(b.currency));
      return this.answer(route, 200, current);
    }
    if (path === '' && method === 'GET') {
      const code = url.searchParams.get('currency');
      const status = url.searchParams.get('status');
      const matching = rates
        .filter((item) => (!code || item.currency === code) && (!status || item.status === status))
        .sort((a, b) => b.rate_date.localeCompare(a.rate_date));
      return this.answer(route, 200, {
        count: matching.length,
        next: null,
        previous: null,
        results: matching,
      });
    }
    if (!permissions.includes('currencies.manage_rates')) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    if (path === '' && method === 'POST') {
      const body = request.postDataJSON() as Pick<RateJson, 'currency' | 'rate' | 'rate_date'>;
      const found = this.catalogue.find((item) => item.code === body.currency);
      if (!found) {
        return this.answer(
          route,
          400,
          error('validation_error', { currency: ['Devise inconnue.'] }),
        );
      }
      if (found.status !== 'active') {
        return this.answer(route, 400, error('currency_inactive', { currency: found.code }));
      }
      const twin = rates.some(
        (item) =>
          item.status === 'active' &&
          item.currency === found.code &&
          item.rate_date === body.rate_date,
      );
      if (twin) {
        return this.answer(route, 400, error('exchange_rate_exists'));
      }
      const [integer, fraction = ''] = body.rate.split('.');
      const created = rate(found.code, `${integer}.${fraction.padEnd(12, '0')}`, body.rate_date);
      created.quote_currency = reference;
      created.source = (request.postDataJSON() as { source?: string }).source ?? '';
      rates.push(created);
      return this.answer(route, 201, created);
    }
    const withdrawn = rates.find((item) => `${item.public_id}/withdraw/` === path);
    if (withdrawn && method === 'POST') {
      if (withdrawn.status === 'withdrawn') {
        return this.answer(route, 400, error('exchange_rate_withdrawn'));
      }
      withdrawn.status = 'withdrawn';
      return this.answer(route, 200, withdrawn);
    }
    return this.answer(route, 404, error('not_found'));
  }
}
