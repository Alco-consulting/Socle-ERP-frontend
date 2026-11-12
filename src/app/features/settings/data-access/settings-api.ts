import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';

export type DateFormat = 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'MM/DD/YYYY';
export type NumberFormat = 'space_comma' | 'dot_comma' | 'comma_dot';

/** `CompaniesCompany`. */
export interface Company {
  readonly public_id: string;
  readonly legal_name: string;
  readonly trade_name: string;
  readonly country: string;
  readonly reference_currency: string;
  readonly status: 'active' | 'inactive';
  readonly registration_number: string;
  readonly tax_identifier: string;
  readonly address: string;
  readonly city: string;
  readonly phone: string;
  readonly email: string;
  readonly accounting_framework: string;
  readonly number_format: NumberFormat;
  readonly date_format: DateFormat;
  readonly created_at: string;
}

/** The fields of the company this screen changes (`PatchedCompaniesCompanyWriteRequest`). */
export type CompanyChanges = Partial<
  Pick<
    Company,
    | 'legal_name'
    | 'trade_name'
    | 'registration_number'
    | 'tax_identifier'
    | 'address'
    | 'city'
    | 'phone'
    | 'email'
    | 'number_format'
    | 'date_format'
  >
>;

/** `UsersUser`. */
export interface AppUser {
  readonly public_id: string;
  readonly email: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly is_active: boolean;
}

/** `CompaniesMembership`: the direct grants in `permissions`, the roles (groups) by name. */
export interface Membership {
  readonly public_id: string;
  readonly user: Omit<AppUser, 'is_active'>;
  readonly status: 'active' | 'inactive';
  readonly is_default: boolean;
  readonly permissions: readonly string[];
  readonly roles: readonly string[];
  readonly created_at: string;
}

export const SETTINGS_PAGE_SIZE = 50;

/** Paramètres on the API: the active company, the users, the company's members. */
@Injectable({ providedIn: 'root' })
export class SettingsApi {
  private readonly api = inject(ApiClient);

  company(id: string): Observable<Company> {
    return this.api.get<Company>(`companies/${encodeURIComponent(id)}/`);
  }

  updateCompany(id: string, changes: CompanyChanges): Observable<Company> {
    return this.api.patch<Company>(`companies/${encodeURIComponent(id)}/`, changes);
  }

  users(page: number, pageSize = SETTINGS_PAGE_SIZE): Observable<Paginated<AppUser>> {
    return this.api.get<Paginated<AppUser>>('users/', {
      params: { page, page_size: pageSize },
    });
  }

  memberships(page: number, pageSize = SETTINGS_PAGE_SIZE): Observable<Paginated<Membership>> {
    return this.api.get<Paginated<Membership>>('memberships/', {
      params: { page, page_size: pageSize },
    });
  }

  membership(id: string): Observable<Membership> {
    return this.api.get<Membership>(`memberships/${encodeURIComponent(id)}/`);
  }

  addMember(email: string, permissions: readonly string[]): Observable<Membership> {
    return this.api.post<Membership>('memberships/', { email, permissions });
  }

  updateMembership(
    id: string,
    changes: { status?: Membership['status']; permissions?: readonly string[] },
  ): Observable<Membership> {
    return this.api.patch<Membership>(`memberships/${encodeURIComponent(id)}/`, changes);
  }
}
