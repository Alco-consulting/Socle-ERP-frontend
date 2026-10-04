import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { UserError, toUserError } from '../../../core/errors/user-error';
import { toApiError } from '../../../core/http/api-error';
import { requestState } from '../../../core/http/request-state';
import { UnsavedChangesService } from '../../../core/navigation/unsaved-changes';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoConfirmService } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { AgingApi } from '../data-access/aging-api';
import { AgingPolicy } from '../data-access/aging-models';
import { AGING_ERRORS, bucketDescription, bucketLabel } from './aging-presentation';

/** At most 12 limits (the server's rule, repeated as the form's size only). */
const MAX_LIMITS = 12;

/**
 * Comptabilité › Configuration › Paiements › Balance âgée (V2.1, lot A5): the company's
 * buckets (`GET reporting/aging-policy/`) and, with `reporting.manage_aging`, their limits
 * (`PUT`), confirmed. The server validates the limits and returns the buckets; nothing is
 * computed here — the buckets shown are always the server's.
 */
@Component({
  selector: 'alco-aging-policy-page',
  imports: [
    ReactiveFormsModule,
    AlcoButton,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
  ],
  templateUrl: './aging-policy-page.html',
  styleUrl: './aging.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgingPolicyPage {
  private readonly api = inject(AgingApi);
  private readonly confirm = inject(AlcoConfirmService);
  private readonly toast = inject(AlcoToastService);
  private readonly session = inject(SessionStore);

  protected readonly record = requestState(() => this.api.policy());
  protected readonly policy = signal<AgingPolicy | null>(null);
  protected readonly canManage = computed(() => this.session.can('reporting.manage_aging'));
  protected readonly saving = signal(false);
  protected readonly saveError = signal<UserError | null>(null);
  protected readonly loadError = computed(() => {
    const error = this.record.error();
    return error ? toUserError(error, AGING_ERRORS) : null;
  });
  protected readonly label = bucketLabel;
  protected readonly describe = bucketDescription;
  protected readonly maxLimits = MAX_LIMITS;
  protected readonly form = new FormGroup({
    limits: new FormArray<FormControl<number | null>>([]),
  });
  protected readonly limits = this.form.controls.limits;

  constructor() {
    inject(UnsavedChangesService).track(() => this.limits.dirty);
    effect(() => {
      const loaded = this.record.value();
      if (loaded) {
        this.show(loaded);
      }
    });
  }

  protected add(): void {
    if (this.limits.length < MAX_LIMITS) {
      this.limits.push(this.control(null));
      this.limits.markAsDirty();
    }
  }

  protected remove(index: number): void {
    this.limits.removeAt(index);
    this.limits.markAsDirty();
  }

  protected async save(): Promise<void> {
    this.limits.markAllAsTouched();
    if (this.limits.invalid || this.saving()) {
      return;
    }
    const values = this.limits.getRawValue().map((value) => Number(value));
    const confirmed = await this.confirm.confirm({
      title: 'Enregistrer ces tranches ?',
      message:
        'Les prochaines balances âgées de la société utiliseront ces tranches (limites en jours de retard). Le changement est gardé dans l’historique.',
      confirmLabel: 'Enregistrer les tranches',
    });
    if (!confirmed) {
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);
    try {
      this.show(await firstValueFrom(this.api.setPolicy(values)));
      this.toast.success('Tranches enregistrées.');
    } catch (failure) {
      const error = toApiError(failure);
      if (error.kind !== 'unauthenticated') {
        this.saveError.set(toUserError(error, AGING_ERRORS));
      }
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    const policy = this.policy();
    if (policy) {
      this.show(policy);
    }
  }

  private show(policy: AgingPolicy): void {
    this.policy.set(policy);
    this.limits.clear();
    for (const limit of policy.limits) {
      this.limits.push(this.control(limit));
    }
    this.limits.markAsPristine();
  }

  private control(value: number | null): FormControl<number | null> {
    return new FormControl<number | null>(value, [
      Validators.required,
      Validators.min(1),
      Validators.pattern(/^\d+$/),
    ]);
  }
}
