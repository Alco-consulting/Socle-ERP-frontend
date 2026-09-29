import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { UserError, toUserError } from '../../../../core/errors/user-error';
import { NavigationService } from '../../../../core/navigation/navigation.service';
import { SessionStore } from '../../../../core/session/session.store';
import { AlcoAmountPipe } from '../../../../shared/pipes/amount.pipe';
import { AlcoButton } from '../../../../shared/ui/button/button';
import { AlcoCard } from '../../../../shared/ui/card/card';
import { AlcoErrorState } from '../../../../shared/ui/error-state/error-state';
import { AlcoIcon } from '../../../../shared/ui/icon/icon';
import { AlcoLoading } from '../../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../../shared/ui/page-header/page-header';
import { CURRENCY_DECIMALS } from '../prototype-data';
import { PrototypeAccountingApi } from '../prototype-accounting-api';
import { AccountingDashboard } from '../prototype-models';

/**
 * PROTOTYPE — workspace of the accounting module: functional blocks that lead to an action
 * (validate drafts, enter in a journal), not a row of isolated KPIs.
 * Every figure comes from the (simulated) server; nothing is computed here.
 */
@Component({
  selector: 'alco-accounting-dashboard',
  imports: [
    DatePipe,
    RouterLink,
    AlcoAmountPipe,
    AlcoButton,
    AlcoCard,
    AlcoErrorState,
    AlcoIcon,
    AlcoLoading,
    AlcoPageHeader,
  ],
  templateUrl: './accounting-dashboard.html',
  styleUrl: './accounting-dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountingDashboardPage {
  private readonly api = inject(PrototypeAccountingApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly session = inject(SessionStore);
  protected readonly navigation = inject(NavigationService);

  protected readonly data = signal<AccountingDashboard | null>(null);
  protected readonly error = signal<UserError | null>(null);
  protected readonly decimals = CURRENCY_DECIMALS;

  constructor() {
    this.load();
  }

  protected load(): void {
    this.error.set(null);
    this.data.set(null);
    const subscription = this.api.dashboard().subscribe({
      next: (data) => this.data.set(data),
      error: (failure: unknown) => this.error.set(toUserError(failure)),
    });
    this.destroyRef.onDestroy(() => subscription.unsubscribe());
  }
}
