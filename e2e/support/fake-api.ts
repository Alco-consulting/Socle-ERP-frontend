import { Page, Request, test as base } from '@playwright/test';

import { FakeAccountImport } from './fake-account-import';
import { FakeAccounting } from './fake-accounting';
import { FakeAccountingEntries } from './fake-accounting-entries';
import { FakeCurrencies } from './fake-currencies';
import { FakeDashboards } from './fake-dashboards';
import { FakeDues } from './fake-dues';
import { FakeLettering } from './fake-lettering';
import { FakeReporting } from './fake-reporting';
import { FakeTreasury } from './fake-treasury';
import { FakePartners, PartnersContext } from './fake-partners';

/**
 * A small stateful fake of the Django API contract (backend/docs/api/openapi.yaml), used by
 * every end-to-end test: session opened by a good login and closed by the logout, CSRF
 * cookie rotated at login, company context with `X-Company-ID`, default company,
 * `company_access_denied` for a company the user can no longer enter. Every `/api/v1/…`
 * request is answered here: nothing reaches the deployed API, no real account is used, and
 * an unexpected call gets a 404 (and fails its test).
 */

export interface CompanyJson {
  readonly public_id: string;
  readonly legal_name: string;
  readonly trade_name: string;
  readonly country: string;
  readonly reference_currency: string;
  readonly status: 'active' | 'inactive';
}

export const COMPANY_A: CompanyJson = {
  public_id: 'aaaaaaaa-0000-4000-8000-000000000001',
  legal_name: 'Alco Guinée SARL (test)',
  trade_name: 'ALCO GUINÉE (test)',
  country: 'GN',
  reference_currency: 'GNF',
  status: 'active',
};
export const COMPANY_B: CompanyJson = {
  public_id: 'bbbbbbbb-0000-4000-8000-000000000002',
  legal_name: 'Filiale Sénégal SA (test)',
  trade_name: 'FILIALE SÉNÉGAL (test)',
  country: 'SN',
  reference_currency: 'XOF',
  status: 'active',
};
export const COMPANY_C: CompanyJson = {
  public_id: 'cccccccc-0000-4000-8000-000000000003',
  legal_name: 'Alco Mali SARL (test)',
  trade_name: 'ALCO MALI (test)',
  country: 'ML',
  reference_currency: 'XOF',
  status: 'active',
};

/** Short names of the companies, for the partners of each. */
const COMPANY_KEYS: Readonly<Record<string, string>> = {
  [COMPANY_A.public_id]: 'A',
  [COMPANY_B.public_id]: 'B',
  [COMPANY_C.public_id]: 'C',
};

const READ = [
  'accounting.read',
  'treasury.read',
  'partners.read',
  'assets.read',
  'loans.read',
  'taxes.read',
  'currencies.read',
  'analytics.read',
  'reporting.read',
  'reporting.read_auxiliary',
  'reporting.read_analytics',
  'reporting.read_financial_statements',
  'closing.read',
  'audit.read',
  'imports_exports.read',
  'documents.read',
  'dashboards.read',
  // The accounting dashboard's treasury part (V2.1): granted explicitly, never implied.
  'dashboards.read_treasury',
];
const WRITE = [
  'accounting.create',
  'accounting.update',
  'accounting.submit',
  'accounting.validate',
  'accounting.lock',
  'accounting.reverse',
  'accounting.manage_journals',
  'accounting.manage_accounts',
  // Lettering (V2.1 A4), due dates and aged buckets (A5): granted explicitly, never implied.
  'accounting.letter',
  'accounting.unletter',
  'accounting.manage_due_dates',
  'reporting.manage_aging',
  // Treasury (Module 6) and bank reconciliation (V2.1 A6): granted explicitly, never implied.
  'treasury.create',
  'treasury.update',
  'treasury.confirm',
  'treasury.account',
  'treasury.manage_accounts',
  'treasury.manage_statements',
  'treasury.reconcile',
  'partners.create',
  'partners.update',
  'partners.disable',
  // Taxes as Odoo's screens: granted explicitly, never implied.
  'taxes.create',
  'taxes.update',
  // The rates of the company (the catalogue's own permissions are global).
  'currencies.manage_rates',
  'imports_exports.create',
  'imports_exports.validate',
  'imports_exports.execute',
  'imports_exports.cancel',
  'imports_exports.export',
  'documents.upload',
  'documents.download',
];

/** Permissions of a membership, per profile (backend codes). */
export const PROFILES = {
  /** Comptabilité (and its Analyse), Tiers, Documents, Tableau de bord; every domain. */
  accountant: [...READ, ...WRITE],
  /** A services company: no fixed assets, no loans, no cost accounting. */
  services: [
    ...READ.filter((code) => !['assets.read', 'loans.read', 'analytics.read'].includes(code)),
    ...WRITE,
  ],
  /**
   * Comptabilité (dashboard, Analyse) and Tableau de bord; read only. No
   * `dashboards.read_treasury`: the treasury part of the dashboard is not shown.
   */
  viewer: ['accounting.read', 'treasury.read', 'taxes.read', 'reporting.read', 'dashboards.read'],
} as const;

export const USER = {
  public_id: 'dddddddd-0000-4000-8000-000000000004',
  email: 'mariam.test@example.org',
  first_name: 'Mariam',
  last_name: 'Test',
  is_active: true,
};
export const PASSWORD = 'fictitious test password';
/** An address the fake server throttles (429, Retry-After: 30). */
export const THROTTLED = 'trop.de.tentatives@example.org';

interface Membership {
  readonly company: CompanyJson;
  permissions: readonly string[];
  accessible: boolean;
}

const error = (code: string) => ({
  error: { code, message: code, details: null, correlation_id: 'e2e' },
});

export class FakeApi {
  /** Every API request, in order. */
  readonly calls: Request[] = [];
  private signedIn = true;
  private down = false;
  private csrf = '';
  private globalPermissions: readonly string[] = [];
  private memberships: Membership[] = [
    { company: COMPANY_A, permissions: PROFILES.accountant, accessible: true },
    { company: COMPANY_B, permissions: PROFILES.services, accessible: true },
  ];
  private defaultCompany: string | null = COMPANY_A.public_id;
  private expiresOn: string | null = null;
  private loginDelayMs = 0;
  private contextDelayMs = 0;

  /** Partners, their import and export (company scoped). */
  readonly partners: FakePartners;
  /** Accounting referential: fiscal years, periods, journals, accounts (company scoped). */
  readonly accounting: FakeAccounting;
  /** Entries, their workflow, taxes, documents and audit history (company scoped). */
  readonly entries: FakeAccountingEntries;
  /** Dashboards (journals, alerts) and the treasury operations of an entry. */
  readonly dashboards: FakeDashboards;
  /** Reporting's ledgers and a partner's collective accounts. */
  readonly reporting: FakeReporting;
  /** Lettering: letterable lines, letterings, proposals (fixtures, no matching). */
  readonly lettering: FakeLettering;
  /** Due dates and the aged balance (fixtures: nothing computed). */
  readonly dues: FakeDues;
  /** Bank reconciliation: accounts, statement lines, proposals, reconciliations (fixtures). */
  readonly treasury: FakeTreasury;
  /** Import of a chart of accounts (`accounting.accounts`, explicit scenarios). */
  readonly accountImport: FakeAccountImport;
  /** The shared currency catalogue and each company's exchange rates. */
  readonly currencies: FakeCurrencies;

  constructor(private readonly page: Page) {
    const context: PartnersContext = {
      page,
      calls: this.calls,
      companyOf: async (request) => {
        const id = await this.companyId(request);
        return COMPANY_KEYS[id] ?? id;
      },
      permissionsOf: async (request) => {
        const id = await this.companyId(request);
        return (
          this.memberships.find((item) => item.accessible && item.company.public_id === id)
            ?.permissions ?? []
        );
      },
      csrfOk: (request) => this.csrfOk(request),
    };
    this.partners = new FakePartners(context);
    this.accounting = new FakeAccounting(context);
    this.entries = new FakeAccountingEntries(context, this.accounting, this.partners);
    this.dashboards = new FakeDashboards(context, this.accounting, this.entries);
    this.reporting = new FakeReporting(context, this.accounting, this.entries, this.partners);
    this.lettering = new FakeLettering(context, this.accounting, this.partners, this.entries);
    this.dues = new FakeDues(context, this.accounting, this.partners, this.entries, this.lettering);
    this.treasury = new FakeTreasury(context, this.lettering);
    this.accountImport = new FakeAccountImport(context, this.accounting);
    this.currencies = new FakeCurrencies(context, () => this.globalPermissions);
  }

  /** No session open at start (the login screen). */
  signedOut(): this {
    this.signedIn = false;
    return this;
  }

  /** The server does not answer at all. */
  serverDown(): this {
    this.down = true;
    return this;
  }

  /** Permissions of `auth/me/` (a platform administrator gets them all from Django). */
  withGlobalPermissions(...permissions: string[]): this {
    this.globalPermissions = permissions;
    return this;
  }

  /** The memberships of the user (accessible companies) and the default one. */
  withCompanies(
    companies: readonly { company: CompanyJson; permissions: readonly string[] }[],
    defaultCompany: string | null,
  ): this {
    this.memberships = companies.map((item) => ({ ...item, accessible: true }));
    this.defaultCompany = defaultCompany;
    return this;
  }

  withPermissions(companyId: string, permissions: readonly string[]): this {
    this.membership(companyId).permissions = permissions;
    return this;
  }

  /** The membership ends (or the company is deactivated): the same refusal for both. */
  revoke(companyId: string): this {
    this.membership(companyId).accessible = false;
    if (this.defaultCompany === companyId) {
      this.defaultCompany = null;
    }
    return this;
  }

  /** The session ends when this company's context is asked (403 `not_authenticated`). */
  expireOn(companyId: string): this {
    this.expiresOn = companyId;
    return this;
  }

  slowLogin(ms: number): this {
    this.loginDelayMs = ms;
    return this;
  }

  slowContext(ms: number): this {
    this.contextDelayMs = ms;
    return this;
  }

  callsTo(path: string): Request[] {
    return this.calls.filter((call) => new URL(call.url()).pathname === `/api/v1/${path}`);
  }

  async install(): Promise<void> {
    const page = this.page;
    // Registered first = tried last: anything unexpected is refused.
    await page.route('**/api/v1/**', (route) => {
      this.calls.push(route.request());
      return route.fulfill({ status: 404, json: error('not_found') });
    });
    await this.partners.install();
    await this.currencies.install();
    await this.accounting.install();
    await this.entries.install();
    await this.dashboards.install();
    await this.reporting.install();
    await this.lettering.install();
    await this.dues.install();
    await this.treasury.install();
    await this.accountImport.install();
    await page.route('**/api/v1/auth/me/', (route) => {
      this.calls.push(route.request());
      if (this.down) {
        return route.abort('connectionrefused');
      }
      return this.signedIn
        ? route.fulfill({ status: 200, json: this.user() })
        : route.fulfill({ status: 403, json: error('not_authenticated') });
    });
    await page.route('**/api/v1/company-context/', async (route) => {
      this.calls.push(route.request());
      const requested = await route.request().headerValue('x-company-id');
      if (this.contextDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, this.contextDelayMs));
      }
      if (!this.signedIn || (requested && requested === this.expiresOn)) {
        return route.fulfill({ status: 403, json: error('not_authenticated') });
      }
      const accessible = this.memberships.filter((item) => item.accessible);
      const current = accessible.find(
        (item) => item.company.public_id === (requested ?? this.defaultCompany),
      );
      if (requested && !current) {
        return route.fulfill({ status: 403, json: error('company_access_denied') });
      }
      return route.fulfill({
        status: 200,
        json: {
          current: current ? { company: current.company, permissions: current.permissions } : null,
          default_company: this.defaultCompany,
          companies: accessible.map((item) => item.company),
        },
      });
    });
    await page.route('**/api/v1/company-context/default/', async (route) => {
      this.calls.push(route.request());
      if (!(await this.csrfOk(route.request()))) {
        return route.fulfill({ status: 403, json: error('csrf_failed') });
      }
      const { company } = route.request().postDataJSON() as { company: string };
      if (!this.memberships.some((item) => item.accessible && item.company.public_id === company)) {
        return route.fulfill({ status: 403, json: error('company_access_denied') });
      }
      this.defaultCompany = company;
      return route.fulfill({ status: 200, json: { default_company: company } });
    });
    await page.route('**/api/v1/auth/csrf/', async (route) => {
      this.calls.push(route.request());
      await this.setCsrf('tok-e2e');
      return route.fulfill({ status: 204 });
    });
    await page.route('**/api/v1/auth/login/', async (route) => {
      this.calls.push(route.request());
      if (!(await this.csrfOk(route.request()))) {
        return route.fulfill({ status: 403, json: error('csrf_failed') });
      }
      if (this.loginDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, this.loginDelayMs));
      }
      const body = route.request().postDataJSON() as { email: string; password: string };
      if (body.email === THROTTLED) {
        return route.fulfill({
          status: 429,
          headers: { 'Retry-After': '30' },
          json: error('throttled'),
        });
      }
      if (body.email !== USER.email || body.password !== PASSWORD) {
        return route.fulfill({ status: 400, json: error('invalid_credentials') });
      }
      this.signedIn = true;
      await this.setCsrf('tok-after-login'); // Django rotates the token at login
      return route.fulfill({ status: 200, json: this.user() });
    });
    await page.route('**/api/v1/auth/logout/', async (route) => {
      this.calls.push(route.request());
      if (!(await this.csrfOk(route.request()))) {
        return route.fulfill({ status: 403, json: error('csrf_failed') });
      }
      this.signedIn = false;
      return route.fulfill({ status: 204 });
    });
  }

  /** The company a request is sent for (`X-Company-ID`, else the default one). */
  private async companyId(request: Request): Promise<string> {
    return (await request.headerValue('x-company-id')) ?? this.defaultCompany ?? '';
  }

  private user() {
    return { ...USER, permissions: this.globalPermissions };
  }

  private membership(companyId: string): Membership {
    const found = this.memberships.find((item) => item.company.public_id === companyId);
    if (!found) {
      throw new Error(`No membership for ${companyId}`);
    }
    return found;
  }

  private async csrfOk(request: Request): Promise<boolean> {
    return !!this.csrf && (await request.headerValue('x-xsrf-token')) === this.csrf;
  }

  /** What Django's Set-Cookie does: a readable XSRF-TOKEN cookie on the page's origin. */
  private async setCsrf(value: string): Promise<void> {
    this.csrf = value;
    await this.page
      .context()
      .addCookies([{ name: 'XSRF-TOKEN', value, url: new URL(this.page.url()).origin }]);
  }
}

/** Every test gets the fake API, installed before its first navigation. */
export const test = base.extend<{ api: FakeApi }>({
  api: [
    async ({ page }, provide) => {
      const api = new FakeApi(page);
      await api.install();
      await provide(api);
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
