import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { UserError, toUserError } from '../../core/errors/user-error';
import { requestState } from '../../core/http/request-state';
import { BreadcrumbService } from '../../core/navigation/route-trail';
import { SessionStore } from '../../core/session/session.store';
import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoCell, AlcoTable, TableColumn } from '../../shared/tables/table';
import { AlcoBadge } from '../../shared/ui/badge/badge';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoCard } from '../../shared/ui/card/card';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { ANALYTIC_ERRORS, NEW_RULE_URL } from './analytics-presentation';
import { AnalyticsApi } from './data-access/analytics-api';
import { AnalyticValue } from './data-access/analytics-models';

/** One plan and its analytic accounts: added on one line, deactivated, never deleted. */
@Component({
  selector: 'alco-analytic-plan-detail',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoBadge,
    AlcoButton,
    AlcoCard,
    AlcoCell,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
    AlcoTable,
  ],
  templateUrl: './plan-detail.html',
  styleUrl: './analytics-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticPlanDetailPage {
  private readonly api = inject(AnalyticsApi);
  private readonly session = inject(SessionStore);
  private readonly toast = inject(AlcoToastService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly planId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  protected readonly plan = requestState(() => this.api.axis(this.planId));
  protected readonly accounts = requestState(() => this.api.values(this.planId));
  protected readonly canAdd = computed(
    () => this.session.can('analytics.create') && this.plan.value()?.status === 'active',
  );
  protected readonly canDisable = computed(() => this.session.can('analytics.disable'));
  /** The account (or `plan`) whose state is changing. */
  protected readonly busy = signal<string | null>(null);
  protected readonly adding = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly newRuleUrl = NEW_RULE_URL;
  protected readonly canModel = computed(() => this.session.can('analytics.manage_rules'));
  protected readonly form = new FormGroup({
    label: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
  });
  protected readonly columns: readonly TableColumn[] = [
    { key: 'label', label: 'Compte analytique' },
    { key: 'code', label: 'Code', width: '12rem', hideBelow: 'tablet' },
    { key: 'status', label: 'État', width: '8rem' },
    { key: 'action', label: '', width: '9rem' },
  ];
  protected readonly rowId = (row: AnalyticValue) => row.public_id;
  protected readonly loadError = computed(() => {
    const error = this.plan.error();
    return error ? toUserError(error, ANALYTIC_ERRORS) : null;
  });

  constructor() {
    effect(() => {
      const plan = this.plan.value();
      if (plan) {
        untracked(() => this.breadcrumbs.nameCurrent(plan.name));
      }
    });
  }

  protected async add(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.adding()) {
      return;
    }
    this.adding.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.api.createValue(this.planId, this.form.getRawValue().label.trim()));
      this.form.reset();
      this.accounts.reload();
    } catch (failure) {
      this.error.set(toUserError(failure, ANALYTIC_ERRORS));
    } finally {
      this.adding.set(false);
    }
  }

  protected async toggleAccount(row: AnalyticValue): Promise<void> {
    await this.run(row.public_id, async () => {
      await firstValueFrom(this.api.setValueActive(row.public_id, row.status !== 'active'));
      this.accounts.reload();
    });
  }

  protected async togglePlan(): Promise<void> {
    const plan = this.plan.value();
    if (plan) {
      await this.run('plan', async () => {
        await firstValueFrom(this.api.setAxisActive(plan.public_id, plan.status !== 'active'));
        this.plan.reload();
        this.toast.success(plan.status === 'active' ? 'Plan désactivé.' : 'Plan réactivé.');
      });
    }
  }

  private async run(key: string, action: () => Promise<void>): Promise<void> {
    this.busy.set(key);
    try {
      await action();
    } catch (failure) {
      const error = toUserError(failure, ANALYTIC_ERRORS);
      this.toast.error(`${error.title} ${error.message}`);
    } finally {
      this.busy.set(null);
    }
  }
}
