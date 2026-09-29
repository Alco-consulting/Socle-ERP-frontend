import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { safeReturnUrl } from '../../core/auth/return-url';
import { LOGIN_RETURN, SessionService } from '../../core/auth/session.service';
import { CompanyContextService } from '../../core/company/company-context.service';
import { UserError, toUserError } from '../../core/errors/user-error';
import { toApiError } from '../../core/http/api-error';
import { AlcoLogo } from '../../core/layout/logo/logo';
import { CompanySummary, SessionStore } from '../../core/session/session.store';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { AlcoBadge } from '../../shared/ui/badge/badge';
import { AlcoEmptyState } from '../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoIcon } from '../../shared/ui/icon/icon';

/**
 * `/societe` — choice of the active company when the server gives none (several accessible
 * companies, no default one). The list is the server's (`company-context/`); choosing asks
 * the server for that company's context. Optionally makes it the default company
 * (`PUT company-context/default/`) so that the next login opens it directly.
 */
@Component({
  selector: 'alco-company-choice',
  imports: [AlcoLogo, AlcoBadge, AlcoEmptyState, AlcoErrorState, AlcoIcon],
  templateUrl: './company-choice.html',
  styleUrl: './company-choice.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompanyChoicePage {
  private readonly context = inject(CompanyContextService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AlcoToastService);
  private readonly injector = inject(Injector);
  protected readonly store = inject(SessionStore);

  protected readonly companies = this.store.companies;
  protected readonly activeId = computed(() => this.store.activeCompany()?.id ?? null);
  /** The company being opened (one at a time). */
  protected readonly pending = signal<string | null>(null);
  protected readonly makeDefault = signal(false);
  protected readonly error = signal<UserError | null>(null);

  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');

  constructor() {
    afterNextRender(() => this.heading().nativeElement.focus());
  }

  protected detail(company: CompanySummary): string {
    return [company.legalName !== company.name ? company.legalName : '', company.currency]
      .filter(Boolean)
      .join(' · ');
  }

  protected toggleDefault(event: Event): void {
    this.makeDefault.set((event.target as HTMLInputElement).checked);
  }

  protected async choose(company: CompanySummary): Promise<void> {
    if (this.pending()) {
      return;
    }
    this.pending.set(company.id);
    this.error.set(null);
    try {
      await this.context.select(company.id);
    } catch (failure) {
      this.pending.set(null);
      const error = toApiError(failure);
      if (error.kind !== 'unauthenticated') {
        this.error.set(toUserError(error));
        afterNextRender(() => this.heading().nativeElement.focus(), { injector: this.injector });
      }
      return;
    }
    if (this.makeDefault()) {
      try {
        await this.context.setDefault(company.id);
      } catch (failure) {
        // The company is open anyway: only the default could not be saved.
        const text = toUserError(failure);
        this.toast.show('warning', `${text.title} ${text.message}`);
      }
    }
    const back = this.route.snapshot.queryParamMap.get(LOGIN_RETURN);
    await this.router.navigateByUrl(safeReturnUrl(back));
  }

  protected async logout(): Promise<void> {
    try {
      await this.session.logout();
    } catch (failure) {
      const text = toUserError(failure);
      this.toast.error(`${text.title} ${text.message}`);
    }
  }
}
