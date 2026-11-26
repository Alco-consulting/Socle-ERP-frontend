import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, firstValueFrom, of, startWith, switchMap } from 'rxjs';

import { UserError, toUserError } from '../../core/errors/user-error';
import { BreadcrumbService } from '../../core/navigation/route-trail';
import { UnsavedChangesService } from '../../core/navigation/unsaved-changes';
import { SessionStore } from '../../core/session/session.store';
import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { normalizeDecimalInput, trimDecimalZeros } from '../../shared/utils/decimal';
import { ANALYTIC_ERRORS, planUrl } from './analytics-presentation';
import { AnalyticsApi } from './data-access/analytics-api';
import { AnalyticRule, RuleWrite } from './data-access/analytics-models';

interface ShareForm {
  value: FormControl<string>;
  percentage: FormControl<string>;
}

/** A distribution model: its plan, the accounts it applies to by itself, its shares. */
@Component({
  selector: 'alco-analytic-rule-form',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoButton,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
  ],
  templateUrl: './rule-form.html',
  styleUrls: ['../accounting/accounting-sheet.scss', './rule-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticRuleFormPage {
  private readonly api = inject(AnalyticsApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AlcoToastService);
  private readonly session = inject(SessionStore);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly ruleId = this.route.snapshot.paramMap.get('id');

  protected readonly isNew = this.ruleId === null;
  protected readonly planUrl = planUrl;
  protected readonly canSave = computed(() => this.session.can('analytics.manage_rules'));
  protected readonly rule = signal<AnalyticRule | null>(null);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly saving = signal(false);
  protected readonly toggling = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly ready = computed(() => this.isNew || this.rule() !== null);
  protected readonly title = computed(() => this.rule()?.name ?? 'Nouveau modèle');
  protected readonly plans = toSignal(this.api.axes('active').pipe(catchError(() => of([]))), {
    initialValue: [],
  });

  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    // From a plan's page, its plan already chosen.
    axis: new FormControl(this.route.snapshot.queryParamMap.get('plan') ?? '', {
      nonNullable: true,
      validators: Validators.required,
    }),
    account_prefix: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(16), Validators.pattern(/^[0-9A-Za-z]*$/)],
    }),
    lines: new FormArray<FormGroup<ShareForm>>([]),
  });

  /** The active accounts of the plan chosen. */
  protected readonly accounts = toSignal(
    this.form.controls.axis.valueChanges.pipe(
      startWith(this.form.controls.axis.value),
      switchMap((axis) =>
        axis ? this.api.values(axis, 'active').pipe(catchError(() => of([]))) : of([]),
      ),
    ),
    { initialValue: [] },
  );

  constructor() {
    inject(UnsavedChangesService).track(() => this.form.dirty && !this.saving());
    if (this.ruleId) {
      this.api.rule(this.ruleId).subscribe({
        next: (rule) => this.fill(rule),
        error: (failure: unknown) => this.loadError.set(toUserError(failure, ANALYTIC_ERRORS)),
      });
    } else {
      this.addLine('100');
    }
    // Another plan: the shares of the previous one no longer apply.
    this.form.controls.axis.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.form.controls.axis.dirty) {
        this.lines.clear();
        this.addLine('100');
      }
    });
    effect(() => {
      const rule = this.rule();
      if (rule) {
        untracked(() => this.breadcrumbs.nameCurrent(rule.name));
      }
    });
    effect(() => {
      if (this.canSave()) {
        this.form.enable({ emitEvent: false });
        if (!this.isNew) {
          this.form.controls.axis.disable({ emitEvent: false });
        }
      } else {
        this.form.disable({ emitEvent: false });
      }
    });
  }

  protected get lines(): FormArray<FormGroup<ShareForm>> {
    return this.form.controls.lines;
  }

  protected addLine(percentage = ''): void {
    this.lines.push(
      new FormGroup<ShareForm>({
        value: new FormControl('', { nonNullable: true, validators: Validators.required }),
        percentage: new FormControl(percentage, {
          nonNullable: true,
          validators: Validators.required,
        }),
      }),
    );
  }

  protected removeLine(index: number): void {
    this.lines.removeAt(index);
    this.form.markAsDirty();
  }

  protected async save(): Promise<void> {
    if (this.saving() || !this.canSave()) {
      return;
    }
    this.error.set(null);
    this.form.markAllAsTouched();
    const shares = this.lines.controls.map((line) => ({
      value: line.controls.value.value,
      percentage: normalizeDecimalInput(line.controls.percentage.value),
    }));
    if (this.form.invalid || shares.length === 0 || shares.some((s) => s.percentage === null)) {
      this.error.set({
        code: 'incomplete',
        title: 'La répartition est incomplète.',
        message: 'Choisissez chaque compte et son pourcentage (ex. 60).',
      });
      return;
    }
    const value = this.form.getRawValue();
    const payload: RuleWrite = {
      name: value.name.trim(),
      axis: value.axis,
      account_prefix: value.account_prefix.trim(),
      lines: shares.map((share) => ({ value: share.value, percentage: share.percentage ?? '' })),
    };
    this.saving.set(true);
    try {
      const saved = this.ruleId
        ? await firstValueFrom(this.api.updateRule(this.ruleId, payload))
        : await firstValueFrom(this.api.createRule(payload));
      this.form.markAsPristine();
      this.toast.success('Modèle enregistré.');
      if (this.isNew) {
        await this.router.navigate(['..', saved.public_id], { relativeTo: this.route });
      } else {
        this.fill(saved);
      }
    } catch (failure) {
      this.error.set(toUserError(failure, ANALYTIC_ERRORS));
    } finally {
      this.saving.set(false);
    }
  }

  protected async toggle(): Promise<void> {
    const rule = this.rule();
    if (!rule || this.toggling()) {
      return;
    }
    this.toggling.set(true);
    try {
      const changed = await firstValueFrom(
        this.api.setRuleActive(rule.public_id, rule.status !== 'active'),
      );
      this.rule.set(changed);
      this.toast.success(changed.status === 'active' ? 'Modèle réactivé.' : 'Modèle désactivé.');
    } catch (failure) {
      const error = toUserError(failure, ANALYTIC_ERRORS);
      this.toast.error(`${error.title} ${error.message}`);
    } finally {
      this.toggling.set(false);
    }
  }

  private fill(rule: AnalyticRule): void {
    this.rule.set(rule);
    this.lines.clear();
    for (const line of rule.lines) {
      this.addLine(trimDecimalZeros(line.percentage, 0));
      this.lines.at(-1).controls.value.setValue(line.value.public_id);
    }
    this.form.reset(
      {
        name: rule.name,
        axis: rule.axis.public_id,
        account_prefix: rule.account_prefix,
        lines: this.lines.getRawValue(),
      },
      { emitEvent: true },
    );
    this.form.markAsPristine();
  }
}
