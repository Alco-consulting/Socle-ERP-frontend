import { Injectable, computed, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { APP_CONFIG } from '../config/app-config';
import { ApiError } from '../http/api-error';
import { CompanySummary, SessionStore } from '../session/session.store';
import { CompanyApi, CompanyContextDto } from './company-api';

/** Remembered choice of company: interface comfort only, the server re-checks it every time. */
const PREFERENCE_KEY = 'alco.company';

function readPreference(): string | null {
  try {
    return localStorage.getItem(PREFERENCE_KEY);
  } catch {
    return null;
  }
}

function writePreference(companyId: string | null): void {
  try {
    if (companyId) {
      localStorage.setItem(PREFERENCE_KEY, companyId);
    } else {
      localStorage.removeItem(PREFERENCE_KEY);
    }
  } catch {
    // Storage unavailable: the default company is used next time.
  }
}

export function toCompanies(context: CompanyContextDto): CompanySummary[] {
  const current = context.current;
  const list =
    current && !context.companies.some((c) => c.public_id === current.company.public_id)
      ? [current.company, ...context.companies]
      : context.companies;
  return list.map((company) => ({
    id: company.public_id,
    name: company.trade_name || company.legal_name,
    fiscalYearLabel: '',
    currency: company.reference_currency,
    permissions: company.public_id === current?.company.public_id ? current.permissions : [],
    features: null,
  }));
}

/**
 * The active company, sent as `X-Company-ID` by the company interceptor. Loads the company
 * context from the API and switches company; the company selector of the top bar calls
 * `select()`. Features never handle the header themselves.
 */
@Injectable({ providedIn: 'root' })
export class CompanyContextService {
  private readonly store = inject(SessionStore);
  private readonly api = inject(CompanyApi);
  private readonly config = inject(APP_CONFIG);

  readonly companyId = computed(() => this.store.activeCompany()?.id ?? null);

  /** Context of the remembered company, else of the user's default company. */
  async load(): Promise<void> {
    const preferred = readPreference();
    try {
      this.apply(await firstValueFrom(this.api.context(preferred)));
    } catch (failure) {
      const refused =
        failure instanceof ApiError && failure.code === 'company_access_denied' && preferred;
      if (!refused) {
        throw failure;
      }
      // The remembered company is no longer accessible: forget it, use the default one.
      writePreference(null);
      this.apply(await firstValueFrom(this.api.context(null)));
    }
  }

  /** Makes `companyId` the active company (its permissions come with it). */
  async select(companyId: string): Promise<void> {
    if (this.config.sessionSource === 'prototype') {
      this.store.switchCompany(companyId);
      return;
    }
    this.apply(await firstValueFrom(this.api.context(companyId)));
    writePreference(companyId);
  }

  /** Forgets the remembered company (end of session: the next user starts from their default). */
  forget(): void {
    writePreference(null);
  }

  private apply(context: CompanyContextDto): void {
    this.store.setCompanies(toCompanies(context), context.current?.company.public_id ?? '');
  }
}
