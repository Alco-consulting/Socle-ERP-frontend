import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { serverFieldErrors } from '../../../core/errors/field-errors';
import { UserError, toUserError } from '../../../core/errors/user-error';
import { ApiError, toApiError } from '../../../core/http/api-error';
import { UnsavedChangesService } from '../../../core/navigation/unsaved-changes';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import {
  Company,
  CompanyChanges,
  DateFormat,
  NumberFormat,
  SettingsApi,
} from '../data-access/settings-api';
import { DATE_FORMATS, NUMBER_FORMATS, SETTINGS_ERRORS } from '../settings-presentation';

const REGIONS = new Intl.DisplayNames(['fr'], { type: 'region' });

/**
 * Paramètres › Société, as Odoo's company form: identity, contact details and display
 * formats of the active company (`GET` / `PATCH companies/{id}/`, `companies.update` to
 * change them). The country, the currency and the accounting framework are fixed at its
 * creation.
 */
@Component({
  selector: 'alco-company-page',
  imports: [
    ReactiveFormsModule,
    AlcoButton,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
  ],
  templateUrl: './company-page.html',
  styleUrls: ['../../accounting/accounting-sheet.scss', './company-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompanyPage {
  private readonly api = inject(SettingsApi);
  private readonly session = inject(SessionStore);
  private readonly toast = inject(AlcoToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly canSave = computed(() => this.session.can('companies.update'));
  protected readonly dateFormats = DATE_FORMATS;
  protected readonly numberFormats = NUMBER_FORMATS;

  protected readonly form = new FormGroup({
    legal_name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(255)],
    }),
    trade_name: new FormControl('', { nonNullable: true, validators: Validators.maxLength(255) }),
    registration_number: new FormControl('', {
      nonNullable: true,
      validators: Validators.maxLength(64),
    }),
    tax_identifier: new FormControl('', {
      nonNullable: true,
      validators: Validators.maxLength(64),
    }),
    address: new FormControl('', { nonNullable: true }),
    city: new FormControl('', { nonNullable: true, validators: Validators.maxLength(128) }),
    phone: new FormControl('', { nonNullable: true, validators: Validators.maxLength(32) }),
    email: new FormControl('', { nonNullable: true, validators: Validators.email }),
    number_format: new FormControl<NumberFormat>('space_comma', { nonNullable: true }),
    date_format: new FormControl<DateFormat>('DD/MM/YYYY', { nonNullable: true }),
  });

  protected readonly company = signal<Company | null>(null);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly invalidSubmit = signal(false);
  protected readonly title = computed(() => {
    const company = this.company();
    return company ? company.trade_name || company.legal_name : 'Société';
  });
  protected readonly country = computed(() => {
    const code = this.company()?.country ?? '';
    return code ? `${REGIONS.of(code) ?? code} (${code})` : '';
  });

  constructor() {
    inject(UnsavedChangesService).track(() => this.form.dirty);
    effect(() => {
      const id = this.session.activeCompany()?.id;
      if (id) {
        untracked(() => this.load(id));
      }
    });
    effect(() => {
      if (this.canSave()) {
        this.form.enable();
      } else {
        this.form.disable();
      }
    });
  }

  protected async save(): Promise<void> {
    const company = this.company();
    if (!company || this.saving() || !this.canSave()) {
      return;
    }
    this.error.set(null);
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.invalidSubmit.set(true);
      this.focusFirstInvalid();
      return;
    }
    this.invalidSubmit.set(false);
    const changes = this.changes(company);
    if (Object.keys(changes).length === 0) {
      this.form.markAsPristine();
      this.toast.info('Aucune modification à enregistrer.');
      return;
    }
    this.saving.set(true);
    try {
      this.fill(await firstValueFrom(this.api.updateCompany(company.public_id, changes)));
      this.toast.success('Fiche de la société enregistrée.');
    } catch (failure) {
      this.showFailure(toApiError(failure));
    } finally {
      this.saving.set(false);
    }
  }

  protected discard(): void {
    const company = this.company();
    if (company) {
      this.fill(company);
    }
    this.error.set(null);
    this.invalidSubmit.set(false);
  }

  private load(id: string): void {
    this.company.set(null);
    this.loadError.set(null);
    this.api.company(id).subscribe({
      next: (company) => this.fill(company),
      error: (failure: unknown) => this.loadError.set(toUserError(failure, SETTINGS_ERRORS)),
    });
  }

  private fill(company: Company): void {
    this.company.set(company);
    this.form.reset({
      legal_name: company.legal_name,
      trade_name: company.trade_name,
      registration_number: company.registration_number,
      tax_identifier: company.tax_identifier,
      address: company.address,
      city: company.city,
      phone: company.phone,
      email: company.email,
      number_format: company.number_format,
      date_format: company.date_format,
    });
  }

  /** Only the fields changed, trimmed: a partial update. */
  private changes(company: Company): CompanyChanges {
    const value = this.form.getRawValue();
    const changes: Record<string, string> = {};
    for (const [name, raw] of Object.entries(value)) {
      const text = raw.trim();
      if (text !== company[name as keyof CompanyChanges]) {
        changes[name] = text;
      }
    }
    return changes as CompanyChanges;
  }

  private showFailure(error: ApiError): void {
    if (error.kind === 'unauthenticated') {
      return;
    }
    const fields = serverFieldErrors(error);
    const names = Object.keys(fields).filter((name) => this.form.get(name));
    for (const name of names) {
      this.form.get(name)?.setErrors({ server: fields[name] });
    }
    if (names.length > 0) {
      this.invalidSubmit.set(true);
      this.focus(names[0]);
      return;
    }
    this.error.set(toUserError(error, SETTINGS_ERRORS));
  }

  private focusFirstInvalid(): void {
    const first = Object.entries(this.form.controls).find(([, control]) => control.invalid);
    if (first) {
      this.focus(first[0]);
    }
  }

  private focus(name: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(`[formControlName="${name}"]`)?.focus();
  }
}
