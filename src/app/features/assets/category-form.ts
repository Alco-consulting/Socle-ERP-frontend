import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, firstValueFrom, map, of } from 'rxjs';

import { UserError, toUserError } from '../../core/errors/user-error';
import { BreadcrumbService } from '../../core/navigation/route-trail';
import { UnsavedChangesService } from '../../core/navigation/unsaved-changes';
import { SessionStore } from '../../core/session/session.store';
import {
  AlcoAutocomplete,
  AutocompleteOption,
  AutocompleteSearch,
} from '../../shared/forms/autocomplete';
import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { AccountingApi } from '../accounting/data-access/accounting-api';
import { EntriesApi } from '../accounting/data-access/entries-api';
import { ASSET_ERRORS } from './assets-presentation';
import { AssetsApi } from './data-access/assets-api';
import { AssetCategory, CategoryWrite, CodeRef } from './data-access/assets-models';

const ACCOUNTS = [
  'asset_account',
  'accumulated_depreciation_account',
  'depreciation_expense_account',
  'disposal_value_account',
  'disposal_proceeds_account',
] as const;
type AccountField = (typeof ACCOUNTS)[number];

const option = (ref: CodeRef | null): AutocompleteOption | null =>
  ref ? { id: ref.public_id, label: ref.code } : null;

/** A category: its accounts (by code or name), its journal, its usual duration. */
@Component({
  selector: 'alco-asset-category-form',
  imports: [
    ReactiveFormsModule,
    AlcoAutocomplete,
    AlcoButton,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
  ],
  templateUrl: './category-form.html',
  styleUrls: ['../accounting/accounting-sheet.scss', './category-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetCategoryFormPage {
  private readonly api = inject(AssetsApi);
  private readonly entries = inject(EntriesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AlcoToastService);
  private readonly session = inject(SessionStore);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly categoryId = this.route.snapshot.paramMap.get('id');

  protected readonly isNew = this.categoryId === null;
  protected readonly canSave = computed(() => this.session.can('assets.manage_categories'));
  protected readonly category = signal<AssetCategory | null>(null);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly ready = computed(() => this.isNew || this.category() !== null);
  protected readonly title = computed(() => this.category()?.name ?? 'Nouvelle catégorie');
  /** The journals of miscellaneous operations, where the postings go. */
  protected readonly journals = toSignal(
    inject(AccountingApi)
      .journals({ status: 'active', journalType: 'general' })
      .pipe(
        map((page) => page.results),
        catchError(() => of([])),
      ),
    { initialValue: [] },
  );

  protected readonly form = new FormGroup({
    code: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(32)],
    }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    journal: new FormControl('', { nonNullable: true }),
    asset_account: new FormControl<AutocompleteOption | null>(null),
    accumulated_depreciation_account: new FormControl<AutocompleteOption | null>(null),
    depreciation_expense_account: new FormControl<AutocompleteOption | null>(null),
    disposal_value_account: new FormControl<AutocompleteOption | null>(null),
    disposal_proceeds_account: new FormControl<AutocompleteOption | null>(null),
    duration_months: new FormControl<number | null>(60, {
      validators: [Validators.required, Validators.min(1), Validators.max(1200)],
    }),
  });

  /** Every account of the chart that takes entries, searched by code or name. */
  protected readonly searchAccounts: AutocompleteSearch = (term) =>
    this.entries.postableAccounts(term).pipe(
      map((found) =>
        found.map((account) => ({
          id: account.public_id,
          label: account.code,
          detail: account.name,
        })),
      ),
    );

  constructor() {
    inject(UnsavedChangesService).track(() => this.form.dirty && !this.saving());
    if (this.categoryId) {
      this.api.category(this.categoryId).subscribe({
        next: (category) => this.fill(category),
        error: (failure: unknown) => this.loadError.set(toUserError(failure, ASSET_ERRORS)),
      });
    }
    effect(() => {
      const category = this.category();
      if (category) {
        untracked(() => this.breadcrumbs.nameCurrent(category.name));
      }
    });
    effect(() => {
      if (this.canSave()) {
        this.form.enable();
        if (!this.isNew) {
          this.form.controls.code.disable();
        }
      } else {
        this.form.disable();
      }
    });
  }

  protected async save(): Promise<void> {
    if (this.saving() || !this.canSave()) {
      return;
    }
    this.error.set(null);
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      return;
    }
    this.saving.set(true);
    try {
      const saved = this.categoryId
        ? await firstValueFrom(this.api.updateCategory(this.categoryId, this.payload()))
        : await firstValueFrom(this.api.createCategory(this.payload()));
      this.form.markAsPristine();
      this.toast.success('Catégorie enregistrée.');
      if (this.isNew) {
        await this.router.navigate(['..', saved.public_id], { relativeTo: this.route });
      } else {
        this.fill(saved);
      }
    } catch (failure) {
      this.error.set(toUserError(failure, ASSET_ERRORS));
    } finally {
      this.saving.set(false);
    }
  }

  private payload(): CategoryWrite {
    const value = this.form.getRawValue();
    const accounts = Object.fromEntries(
      ACCOUNTS.map((field: AccountField) => [field, value[field]?.id ?? null]),
    ) as Record<AccountField, string | null>;
    return {
      code: value.code.trim(),
      name: value.name.trim(),
      journal: value.journal || null,
      ...accounts,
      default_method: 'linear',
      default_duration_months: Number(value.duration_months),
      default_prorata: 'daily',
      default_residual_rule: 'last_period',
    };
  }

  private fill(category: AssetCategory): void {
    this.category.set(category);
    this.form.reset({
      code: category.code,
      name: category.name,
      journal: category.journal?.public_id ?? '',
      asset_account: option(category.asset_account),
      accumulated_depreciation_account: option(category.accumulated_depreciation_account),
      depreciation_expense_account: option(category.depreciation_expense_account),
      disposal_value_account: option(category.disposal_value_account),
      disposal_proceeds_account: option(category.disposal_proceeds_account),
      duration_months: category.default_duration_months,
    });
  }
}
