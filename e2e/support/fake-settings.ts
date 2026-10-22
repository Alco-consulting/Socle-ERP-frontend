import { Request, Route } from '@playwright/test';

import { PartnersContext } from './fake-partners';

/**
 * Paramètres of the fake API, shaped like the OpenAPI schemas: the active company's record
 * (`companies/{id}/`, `companies.read` / `companies.update`), the platform's users
 * (`users/`, the global `users.read`) and the company's members (`memberships/`,
 * `companies.manage_members`), with the backend's rules: one membership per user and company,
 * only rights the user holds are granted, their own membership is not changed here.
 */

interface CompanyBase {
  readonly public_id: string;
  readonly legal_name: string;
  readonly trade_name: string;
  readonly country: string;
  readonly reference_currency: string;
  readonly status: 'active' | 'inactive';
}

interface UserJson {
  readonly public_id: string;
  readonly email: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly is_active: boolean;
}

interface MembershipJson {
  readonly public_id: string;
  readonly user: Omit<UserJson, 'is_active'>;
  status: 'active' | 'inactive';
  readonly is_default: boolean;
  permissions: string[];
  readonly roles: string[];
  readonly created_at: string;
}

/** The other accounts of the platform (fictitious). */
const PEOPLE: readonly UserJson[] = [
  {
    public_id: 'eeeeeeee-0000-4000-8000-000000000011',
    email: 'ibrahima.diallo@example.org',
    first_name: 'Ibrahima',
    last_name: 'Diallo',
    is_active: true,
  },
  {
    public_id: 'eeeeeeee-0000-4000-8000-000000000012',
    email: 'fatoumata.camara@example.org',
    first_name: 'Fatoumata',
    last_name: 'Camara',
    is_active: true,
  },
  {
    public_id: 'eeeeeeee-0000-4000-8000-000000000013',
    email: 'ousmane.bah@example.org',
    first_name: 'Ousmane',
    last_name: 'Bah',
    is_active: false,
  },
  {
    public_id: 'eeeeeeee-0000-4000-8000-000000000014',
    email: 'aissatou.sow@example.org',
    first_name: 'Aïssatou',
    last_name: 'Sow',
    is_active: true,
  },
];

const STAMP = '2026-01-05T08:00:00Z';

const error = (code: string, details: unknown = null) => ({
  error: { code, message: code, details, correlation_id: 'e2e' },
});

const member = (user: UserJson): MembershipJson['user'] => ({
  public_id: user.public_id,
  email: user.email,
  first_name: user.first_name,
  last_name: user.last_name,
});

export class FakeSettings {
  private readonly companies = new Map<string, Record<string, unknown>>();
  private readonly members = new Map<string, MembershipJson[]>();

  constructor(
    private readonly context: PartnersContext,
    private readonly self: UserJson,
    private readonly companyById: (id: string) => CompanyBase | undefined,
    private readonly globalPermissions: () => readonly string[],
  ) {}

  async install(): Promise<void> {
    const page = this.context.page;
    await page.route('**/api/v1/companies/*/', (route) => this.company(route));
    await page.route('**/api/v1/users/**', (route) => this.users(route));
    await page.route('**/api/v1/memberships/**', (route) => this.memberships(route));
  }

  private async answer(route: Route, status: number, json: unknown): Promise<void> {
    this.context.calls.push(route.request());
    await route.fulfill({ status, json });
  }

  private async company(route: Route): Promise<void> {
    const request = route.request();
    const id = new URL(request.url()).pathname.split('/').at(-2) ?? '';
    const base = this.companyById(id);
    const permissions = await this.context.permissionsOf(request);
    if (!base || (await request.headerValue('x-company-id')) !== id) {
      return this.answer(route, 404, error('not_found'));
    }
    if (!permissions.includes('companies.read')) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    const record = this.companies.get(id) ?? {
      ...base,
      registration_number: 'GN.TCC.2019.B.04512',
      tax_identifier: '123456789',
      address: 'Immeuble Kaloum Center, 5e étage',
      city: 'Conakry',
      phone: '+224 620 00 00 00',
      email: 'contact@alco.example.org',
      accounting_framework: 'SYSCOHADA',
      number_format: 'space_comma',
      date_format: 'DD/MM/YYYY',
      fiscal_settings: {},
      accounting_settings: {},
      created_at: STAMP,
    };
    this.companies.set(id, record);
    if (request.method() === 'PATCH') {
      if (!(await this.context.csrfOk(request))) {
        return this.answer(route, 403, error('csrf_failed'));
      }
      if (!permissions.includes('companies.update')) {
        return this.answer(route, 403, error('company_permission_denied'));
      }
      const changes = request.postDataJSON() as Record<string, string>;
      if ('legal_name' in changes && !changes['legal_name']) {
        return this.answer(
          route,
          400,
          error('validation_error', { legal_name: [{ message: 'x', code: 'blank' }] }),
        );
      }
      Object.assign(record, changes);
    }
    return this.answer(route, 200, record);
  }

  private async users(route: Route): Promise<void> {
    if (!this.globalPermissions().includes('users.read')) {
      return this.answer(route, 403, error('permission_denied'));
    }
    const results = [this.self, ...PEOPLE];
    return this.answer(route, 200, { count: results.length, next: null, previous: null, results });
  }

  private async memberships(route: Route): Promise<void> {
    const request = route.request();
    const permissions = await this.context.permissionsOf(request);
    if (!permissions.includes('companies.manage_members')) {
      return this.answer(route, 403, error('company_permission_denied'));
    }
    const company = (await request.headerValue('x-company-id')) ?? '';
    const members = this.list(company, permissions);
    const id = new URL(request.url()).pathname.replace(/.*\/memberships\//, '').replace('/', '');
    const method = request.method();
    if (method !== 'GET' && !(await this.context.csrfOk(request))) {
      return this.answer(route, 403, error('csrf_failed'));
    }
    if (!id) {
      if (method === 'POST') {
        return this.add(route, request, members, permissions);
      }
      return this.answer(route, 200, {
        count: members.length,
        next: null,
        previous: null,
        results: members,
      });
    }
    const found = members.find((item) => item.public_id === id);
    if (!found) {
      return this.answer(route, 404, error('not_found'));
    }
    if (method === 'PATCH') {
      const body = request.postDataJSON() as { status?: 'active' | 'inactive'; permissions?: [] };
      if (found.user.email === this.self.email) {
        return this.answer(route, 400, error('cannot_change_own_membership'));
      }
      const refused = (body.permissions ?? []).filter((code) => !permissions.includes(code));
      if (refused.length > 0) {
        return this.answer(route, 403, error('permission_delegation_denied', { refused }));
      }
      found.status = body.status ?? found.status;
      found.permissions = [...(body.permissions ?? found.permissions)].sort();
    }
    return this.answer(route, 200, found);
  }

  private async add(
    route: Route,
    request: Request,
    members: MembershipJson[],
    permissions: readonly string[],
  ): Promise<void> {
    const body = request.postDataJSON() as { email: string; permissions?: string[] };
    const user = [this.self, ...PEOPLE].find(
      (item) => item.is_active && item.email === body.email.toLowerCase(),
    );
    if (!user) {
      return this.answer(
        route,
        400,
        error('validation_error', { email: [{ message: 'x', code: 'unknown' }] }),
      );
    }
    if (members.some((item) => item.user.email === user.email)) {
      return this.answer(route, 400, error('already_member'));
    }
    const refused = (body.permissions ?? []).filter((code) => !permissions.includes(code));
    if (refused.length > 0) {
      return this.answer(route, 403, error('permission_delegation_denied', { refused }));
    }
    const created: MembershipJson = {
      public_id: `m-${user.public_id}`,
      user: member(user),
      status: 'active',
      is_default: false,
      permissions: [...(body.permissions ?? [])].sort(),
      roles: [],
      created_at: new Date().toISOString(),
    };
    members.push(created);
    return this.answer(route, 201, created);
  }

  /** The company's members: the user (their grants in the context), then fixtures. */
  private list(company: string, own: readonly string[]): MembershipJson[] {
    let members = this.members.get(company);
    if (!members) {
      const [ibrahima, fatoumata, ousmane] = PEOPLE;
      members = [
        {
          public_id: `m-${company}-self`,
          user: member(this.self),
          status: 'active',
          is_default: true,
          permissions: [],
          roles: [],
          created_at: STAMP,
        },
        {
          public_id: `m-${company}-${ibrahima.public_id}`,
          user: member(ibrahima),
          status: 'active',
          is_default: true,
          permissions: ['accounting.create', 'accounting.read', 'documents.read'],
          roles: ['Comptable'],
          created_at: STAMP,
        },
        {
          public_id: `m-${company}-${fatoumata.public_id}`,
          user: member(fatoumata),
          status: 'active',
          is_default: false,
          permissions: ['dashboards.read', 'reporting.read'],
          roles: [],
          created_at: STAMP,
        },
        {
          public_id: `m-${company}-${ousmane.public_id}`,
          user: member(ousmane),
          status: 'inactive',
          is_default: false,
          permissions: [],
          roles: [],
          created_at: STAMP,
        },
      ];
      this.members.set(company, members);
    }
    members[0].permissions = [...own].sort();
    return members;
  }
}
