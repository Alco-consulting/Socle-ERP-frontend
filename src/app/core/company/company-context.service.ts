import { Injectable, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Observable, Subject, firstValueFrom } from 'rxjs';

import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { toUserError } from '../errors/user-error';
import { ApiError, toApiError } from '../http/api-error';
import { AuthFailures } from '../http/auth-failures';
import { APP_ROOT } from '../navigation/applications';
import { NavigationService } from '../navigation/navigation.service';
import { NotificationCenter } from '../notifications/notification-center';
import { CompanyContext, CompanySummary, SessionStore } from '../session/session.store';
import { CompanyApi, CompanyContextDto, CompanySummaryDto } from './company-api';

/** Screen where the user chooses a company (several, no default one). */
export const COMPANY_CHOICE_URL = '/societe';

/** A company the user can no longer enter (same text wherever it happens). */
export const REFUSED_MESSAGE =
  'La société sélectionnée n’est plus accessible. La liste de vos sociétés a été mise à jour.';

/**
 * The company chosen in this tab, so that a reload stays in it. Only an identifier the
 * server checks again: the list and the permissions always come from the server. Per tab
 * (sessionStorage), forgotten at the end of the session.
 */
const TAB_CHOICE_KEY = 'alco.company';

function readTabChoice(): string | null {
  try {
    return sessionStorage.getItem(TAB_CHOICE_KEY);
  } catch {
    return null;
  }
}

function writeTabChoice(companyId: string | null): void {
  try {
    if (companyId) {
      sessionStorage.setItem(TAB_CHOICE_KEY, companyId);
    } else {
      sessionStorage.removeItem(TAB_CHOICE_KEY);
    }
  } catch {
    // Storage unavailable: a reload opens the default company.
  }
}

function isRefusal(failure: unknown): boolean {
  return failure instanceof ApiError && failure.code === 'company_access_denied';
}

export function toCompany(company: CompanySummaryDto): CompanySummary {
  return {
    id: company.public_id,
    name: company.trade_name || company.legal_name,
    legalName: company.legal_name,
    country: company.country,
    currency: company.reference_currency,
    active: company.status === 'active',
  };
}

export function toCompanyContext(context: CompanyContextDto): CompanyContext {
  const current = context.current;
  const list =
    current && !context.companies.some((c) => c.public_id === current.company.public_id)
      ? [current.company, ...context.companies]
      : context.companies;
  return {
    companies: list.map(toCompany),
    defaultCompanyId: context.default_company,
    activeCompanyId: current?.company.public_id ?? null,
    permissions: current?.permissions ?? [],
    features: null,
  };
}

/**
 * The active company — sent as `X-Company-ID` by the company interceptor, features never
 * handle the header — and everything that follows from it. Only the server decides:
 * - opening: the company of this tab (reload), else the user's default one; without a
 *   default, the only accessible company, else none: the user chooses (`/societe`);
 * - switch: `GET company-context/` for that company (its permissions come with it);
 * - refusal (403 `company_access_denied`, the same answer for an unknown, inaccessible or
 *   inactive company): the list is refreshed, a still valid company is kept;
 * - default company: `PUT company-context/default/`.
 */
@Injectable({ providedIn: 'root' })
export class CompanyContextService {
  private readonly store = inject(SessionStore);
  private readonly api = inject(CompanyApi);
  private readonly router = inject(Router);
  private readonly navigation = inject(NavigationService);
  private readonly toast = inject(AlcoToastService);
  private readonly notifications = inject(NotificationCenter);
  private readonly changed = new Subject<CompanySummary | null>();

  readonly companyId = computed(() => this.store.activeCompany()?.id ?? null);

  /**
   * Emits once the active company changed (opening, switch, refusal): a feature keeping data
   * of the company in memory forgets it here. Screens need nothing: they are rebuilt.
   */
  readonly changed$: Observable<CompanySummary | null> = this.changed.asObservable();

  constructor() {
    inject(AuthFailures)
      .companyRefused$.pipe(takeUntilDestroyed())
      .subscribe((companyId) => void this.onRefused(companyId));
  }

  /**
   * Company context at the opening of the session. A remembered company the server refuses
   * is forgotten (said once). Rejects with the `ApiError` when the server cannot answer.
   */
  async load(): Promise<void> {
    const remembered = readTabChoice();
    let context: CompanyContextDto;
    try {
      context = await this.fetch(remembered);
    } catch (failure) {
      if (!remembered || !isRefusal(failure)) {
        throw failure;
      }
      writeTabChoice(null);
      this.report(failure);
      context = await this.fetch(null);
    }
    this.apply(await this.settle(context));
  }

  /**
   * Makes `companyId` the active company, with the permissions the server gives in it.
   * A refusal refreshes the list (the active company stays when still valid) and rejects.
   */
  async select(companyId: string): Promise<void> {
    let context: CompanyContextDto;
    try {
      context = await this.fetch(companyId);
    } catch (failure) {
      if (isRefusal(failure)) {
        await this.refresh(companyId).catch(() => undefined);
      }
      throw failure;
    }
    this.apply(context);
  }

  /**
   * The company selector of the top bar. The screens of the previous company are removed at
   * once (`AlcoCompanyScope`), the new context is loaded, then the screens are rebuilt with
   * the new company's data on `NavigationService.landingUrl()`. Failures are said here.
   */
  async switchTo(companyId: string): Promise<void> {
    if (companyId === this.companyId() || this.store.activity()) {
      return;
    }
    const from = this.router.url;
    this.store.setActivity('switching-company');
    try {
      try {
        await this.select(companyId);
      } catch (failure) {
        this.report(failure);
        return;
      }
      await this.router.navigateByUrl(this.navigation.landingUrl(from));
      const company = this.store.activeCompany();
      if (company) {
        this.toast.info(`Société active : ${company.name}.`);
      }
    } finally {
      this.store.setActivity(null);
    }
  }

  /** The user's default company, on the server (a membership of that company is required). */
  async setDefault(companyId: string): Promise<void> {
    const result = await firstValueFrom(this.api.setDefault(companyId));
    this.store.setDefaultCompany(result.default_company);
  }

  /** End of the session: the next user starts from their own default company. */
  forget(): void {
    writeTabChoice(null);
  }

  /**
   * A request was refused for the active company (membership ended, company deactivated):
   * the list again, then the launcher of a valid company — or the choice of one.
   */
  private async onRefused(companyId: string): Promise<void> {
    if (companyId !== this.companyId() || this.store.activity()) {
      return;
    }
    this.store.setActivity('switching-company');
    try {
      try {
        await this.refresh(companyId);
      } catch (failure) {
        this.report(failure);
        return;
      }
      this.toast.show('warning', REFUSED_MESSAGE);
      await this.router.navigateByUrl(this.store.activeCompany() ? APP_ROOT : COMPANY_CHOICE_URL);
    } finally {
      this.store.setActivity(null);
    }
  }

  /** After a refusal: the list again; the active company is kept when still valid. */
  private async refresh(refused: string): Promise<void> {
    const active = this.companyId();
    const keep = active && active !== refused ? active : null;
    let context: CompanyContextDto;
    try {
      context = await this.fetch(keep);
    } catch (failure) {
      if (!keep || !isRefusal(failure)) {
        throw failure;
      }
      context = await this.fetch(null);
    }
    this.apply(await this.settle(context));
  }

  /** No default company and a single accessible one: there is nothing to choose. */
  private async settle(context: CompanyContextDto): Promise<CompanyContextDto> {
    return !context.current && context.companies.length === 1
      ? this.fetch(context.companies[0].public_id)
      : context;
  }

  private fetch(companyId: string | null): Promise<CompanyContextDto> {
    return firstValueFrom(this.api.context(companyId));
  }

  private apply(dto: CompanyContextDto): void {
    const previous = this.companyId();
    const context = toCompanyContext(dto);
    this.store.setCompanyContext(context);
    writeTabChoice(context.activeCompanyId);
    if (context.activeCompanyId !== previous) {
      // Nothing of the previous company stays in a global cache.
      this.notifications.load([]);
      this.changed.next(this.store.activeCompany());
    }
  }

  /** An ended session is explained by the login screen: no second message here. */
  private report(failure: unknown): void {
    const error = toApiError(failure);
    if (error.kind === 'unauthenticated') {
      return;
    }
    const text = toUserError(error);
    this.toast.show(
      isRefusal(error) ? 'warning' : 'danger',
      isRefusal(error) ? REFUSED_MESSAGE : `${text.title} ${text.message}`,
    );
  }
}
