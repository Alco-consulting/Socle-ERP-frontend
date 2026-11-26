import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { UserError, toUserError } from '../../core/errors/user-error';
import { requestState } from '../../core/http/request-state';
import { SessionStore } from '../../core/session/session.store';
import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoCell, AlcoTable, TableColumn } from '../../shared/tables/table';
import { AlcoBadge } from '../../shared/ui/badge/badge';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoEmptyState } from '../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { ANALYTIC_ERRORS } from './analytics-presentation';
import { AnalyticsApi } from './data-access/analytics-api';
import { AnalyticAxis } from './data-access/analytics-models';

/** Comptabilité › Configuration › Analytique › Plans analytiques: Chantiers, Départements… */
@Component({
  selector: 'alco-analytic-plan-list',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoBadge,
    AlcoButton,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
    AlcoTable,
  ],
  templateUrl: './plan-list.html',
  styleUrl: './analytics-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticPlanListPage {
  private readonly api = inject(AnalyticsApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(SessionStore);

  protected readonly canCreate = computed(() => this.session.can('analytics.create'));
  protected readonly plans = requestState(() => this.api.axes());
  protected readonly creating = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
  });
  protected readonly columns: readonly TableColumn[] = [
    { key: 'name', label: 'Plan' },
    { key: 'status', label: 'État', width: '8rem' },
  ];
  protected readonly rowId = (row: AnalyticAxis) => row.public_id;
  protected readonly loadError = computed(() => {
    const error = this.plans.error();
    return error ? toUserError(error, ANALYTIC_ERRORS) : null;
  });

  protected async create(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.creating()) {
      return;
    }
    this.creating.set(true);
    this.error.set(null);
    try {
      const plan = await firstValueFrom(this.api.createAxis(this.form.getRawValue().name.trim()));
      await this.router.navigate([plan.public_id], { relativeTo: this.route });
    } catch (failure) {
      this.error.set(toUserError(failure, ANALYTIC_ERRORS));
    } finally {
      this.creating.set(false);
    }
  }
}
