import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, firstValueFrom, map, of } from 'rxjs';

import { UserError, toUserError } from '../../core/errors/user-error';
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
import { localToday } from '../../shared/utils/dates';
import { normalizeDecimalInput, trimDecimalZeros } from '../../shared/utils/decimal';
import { EntriesApi } from '../accounting/data-access/entries-api';
import { ASSET_ERRORS } from './assets-presentation';
import { AssetsApi } from './data-access/assets-api';
import { Asset, AssetWrite } from './data-access/assets-models';

/** A new asset, or a draft one: the category proposes its duration (Odoo's form, simplified). */
@Component({
  selector: 'alco-asset-form',
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
  templateUrl: './asset-form.html',
  styleUrls: ['../accounting/accounting-sheet.scss', './category-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetFormPage {
  private readonly api = inject(AssetsApi);
  private readonly entries = inject(EntriesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AlcoToastService);
  private readonly session = inject(SessionStore);
  private readonly assetId = this.route.snapshot.paramMap.get('id');

  protected readonly isNew = this.assetId === null;
  protected readonly asset = signal<Asset | null>(null);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly ready = computed(() => this.isNew || this.asset() !== null);
  protected readonly title = computed(() => this.asset()?.name ?? 'Nouvelle immobilisation');
  protected readonly categories = toSignal(
    this.api.categories('active').pipe(
      map((page) => page.results),
      catchError(() => of([])),
    ),
    { initialValue: [] },
  );

  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(255)],
    }),
    category: new FormControl('', { nonNullable: true, validators: Validators.required }),
    acquisition_date: new FormControl(localToday(), {
      nonNullable: true,
      validators: Validators.required,
    }),
    gross_value: new FormControl('', { nonNullable: true, validators: Validators.required }),
    duration_months: new FormControl<number | null>(null, {
      validators: [Validators.required, Validators.min(1), Validators.max(1200)],
    }),
    reference: new FormControl('', { nonNullable: true, validators: Validators.maxLength(64) }),
    partner: new FormControl<AutocompleteOption | null>(null),
  });

  /** The company's partners, searched by code or name: the supplier of the asset. */
  protected readonly searchPartners: AutocompleteSearch = (term) =>
    this.entries.partners(term).pipe(
      map((found) =>
        found.map((partner) => ({
          id: partner.public_id,
          label: partner.name,
          detail: partner.code,
        })),
      ),
    );

  constructor() {
    inject(UnsavedChangesService).track(() => this.form.dirty && !this.saving());
    if (this.assetId) {
      this.api.asset(this.assetId).subscribe({
        next: (asset) => this.fill(asset),
        error: (failure: unknown) => this.loadError.set(toUserError(failure, ASSET_ERRORS)),
      });
    }
    // A category chosen proposes its duration (the asset may keep another one).
    this.form.controls.category.valueChanges.pipe(takeUntilDestroyed()).subscribe((id) => {
      const chosen = this.categories().find((category) => category.public_id === id);
      if (chosen) {
        this.form.controls.duration_months.setValue(chosen.default_duration_months);
      }
    });
  }

  protected async save(): Promise<void> {
    if (this.saving()) {
      return;
    }
    this.error.set(null);
    this.form.markAllAsTouched();
    const amount = normalizeDecimalInput(this.form.controls.gross_value.value);
    if (amount === null) {
      this.form.controls.gross_value.setErrors({ server: 'Saisissez un montant (ex. 150000).' });
    }
    if (this.form.invalid || amount === null) {
      return;
    }
    this.saving.set(true);
    try {
      const saved = this.assetId
        ? await firstValueFrom(this.api.updateAsset(this.assetId, this.payload(amount)))
        : await firstValueFrom(this.api.createAsset(this.payload(amount)));
      this.form.markAsPristine();
      this.toast.success('Immobilisation enregistrée.');
      await this.router.navigate(this.isNew ? ['..', saved.public_id] : ['..'], {
        relativeTo: this.route,
      });
    } catch (failure) {
      this.error.set(toUserError(failure, ASSET_ERRORS));
    } finally {
      this.saving.set(false);
    }
  }

  private payload(amount: string): AssetWrite {
    const value = this.form.getRawValue();
    return {
      category: value.category,
      name: value.name.trim(),
      reference: value.reference.trim(),
      acquisition_date: value.acquisition_date,
      currency: this.session.activeCompany()?.currency ?? '',
      gross_value: amount,
      duration_months: Number(value.duration_months),
      partner: value.partner?.id ?? null,
    };
  }

  private fill(asset: Asset): void {
    this.asset.set(asset);
    this.form.reset(
      {
        name: asset.name,
        category: asset.category.public_id,
        acquisition_date: asset.acquisition_date,
        gross_value: trimDecimalZeros(asset.gross_value, 0),
        duration_months: asset.duration_months,
        reference: asset.reference,
        partner: asset.partner ? { id: asset.partner.public_id, label: asset.partner.code } : null,
      },
      { emitEvent: false },
    );
  }
}
