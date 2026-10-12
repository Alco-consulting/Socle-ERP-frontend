import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, firstValueFrom, map, of } from 'rxjs';

import { serverFieldErrors } from '../../../../core/errors/field-errors';
import { UserError, toUserError } from '../../../../core/errors/user-error';
import { ApiError, toApiError } from '../../../../core/http/api-error';
import { BreadcrumbService } from '../../../../core/navigation/route-trail';
import { UnsavedChangesService } from '../../../../core/navigation/unsaved-changes';
import { AlcoFormField } from '../../../../shared/forms/form-field';
import { AlcoInput } from '../../../../shared/forms/input';
import { inputFormat } from '../../../../shared/forms/validators';
import { AlcoButton } from '../../../../shared/ui/button/button';
import { AlcoErrorState } from '../../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../../../shared/ui/toast/toast.service';
import {
  CurrencyOption,
  Partner,
  PartnerUpdate,
  PartnerWrite,
  PaymentTerm,
} from '../../data-access/partner-models';
import { PartnersApi } from '../../data-access/partners-api';
import { PARTNER_ERRORS, PARTNER_FIELD_MESSAGES } from '../../partner-presentation';

/** Text fields of the API (`PartnersPartnerWriteRequest`), in the order of the form. */
const TEXT_FIELDS = [
  'name',
  'legal_name',
  'tax_identifier',
  'registration_number',
  'address',
  'city',
  'phone',
  'email',
] as const;

/** References: an empty choice is sent as `null` (none). */
const REFERENCE_FIELDS = [
  'default_currency',
  'customer_payment_term',
  'supplier_payment_term',
] as const;

type TextField = (typeof TEXT_FIELDS)[number];

function text(maxLength?: number, ...more: ReturnType<typeof inputFormat>[]) {
  return new FormControl('', {
    nonNullable: true,
    validators: [...(maxLength ? [Validators.maxLength(maxLength)] : []), ...more],
  });
}

/**
 * Creation (`/app/tiers/nouveau`) and modification (`…/:id/modifier`) of a partner with
 * exactly the writable fields of the API. The browser only checks the obvious (required,
 * lengths, formats); the server decides and its field errors are shown under the fields.
 * The server gives the code, by default the company's country (note backend 0037), and both
 * collective accounts, customer and supplier, whatever the roles (note backend 0038): the form
 * has none of them, nor the default tax code. « Client » and « Fournisseur » are labels. A
 * modification sends only the fields changed, never the status (its own commands), the
 * identifier or the company.
 */
@Component({
  selector: 'alco-partner-form',
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
  templateUrl: './partner-form.html',
  styleUrl: './partner-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartnerFormPage {
  private readonly api = inject(PartnersApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AlcoToastService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** `null`: creation. */
  protected readonly id = this.route.snapshot.paramMap.get('id');
  protected readonly isNew = this.id === null;

  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(255)],
    }),
    legal_name: text(255),
    is_customer: new FormControl(false, { nonNullable: true }),
    is_supplier: new FormControl(false, { nonNullable: true }),
    tax_identifier: text(64),
    registration_number: text(64),
    address: text(),
    city: text(128),
    phone: text(32, inputFormat(/^[0-9+().\s-]+$/, 'Chiffres, espaces et + ( ) . - seulement.')),
    email: new FormControl('', { nonNullable: true, validators: [Validators.email] }),
    default_currency: text(),
    customer_payment_term: text(),
    supplier_payment_term: text(),
  });

  /** Edition: the record being changed (its code is shown, never sent). */
  protected readonly partner = signal<Partner | null>(null);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly invalidSubmit = signal(false);

  protected readonly currencies = signal<readonly CurrencyOption[] | null>(null);
  protected readonly paymentTerms = signal<readonly PaymentTerm[] | null>(null);
  protected readonly ready = computed(() => this.isNew || this.partner() !== null);

  /** Active choices, plus the current one even if it became inactive. */
  protected readonly currencyOptions = computed(() => {
    const current = this.partner()?.default_currency;
    return (this.currencies() ?? []).filter(
      (currency) => currency.status === 'active' || currency.code === current,
    );
  });
  protected termOptions(field: 'customer_payment_term' | 'supplier_payment_term') {
    const current = this.partner()?.[field]?.public_id;
    return (this.paymentTerms() ?? []).filter(
      (term) => term.status === 'active' || term.public_id === current,
    );
  }

  constructor() {
    inject(UnsavedChangesService).track(() => this.form.dirty);
    this.api
      .currencies()
      .pipe(
        map((page) => page.results),
        catchError(() => of([])),
      )
      .subscribe((list) => this.currencies.set(list));
    this.api
      .paymentTerms()
      .pipe(
        map((page) => page.results),
        catchError(() => of([])),
      )
      .subscribe((list) => this.paymentTerms.set(list));
    if (this.id) {
      this.api.get(this.id).subscribe({
        next: (partner) => this.fill(partner),
        error: (failure: unknown) => this.loadError.set(toUserError(failure, PARTNER_ERRORS)),
      });
    } else {
      afterNextRender(() => this.focus('name'), { injector: this.injector });
    }
  }

  protected async save(): Promise<void> {
    if (this.saving()) {
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
    const partner = this.partner();
    if (partner && !this.form.dirty) {
      this.toast.info('Aucune modification à enregistrer.');
      await this.router.navigate(['..'], { relativeTo: this.route });
      return;
    }
    this.saving.set(true);
    try {
      const saved = await firstValueFrom(
        partner
          ? this.api.update(partner.public_id, this.changes())
          : this.api.create(this.creation()),
      );
      this.form.markAsPristine();
      if (partner) {
        this.toast.success('Modifications enregistrées.');
        await this.router.navigate(['..'], { relativeTo: this.route });
      } else {
        this.toast.success(`Tiers « ${saved.name} » créé.`);
        await this.router.navigate(['/app/tiers/liste', saved.public_id]);
      }
    } catch (failure) {
      this.showFailure(toApiError(failure));
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    void this.router.navigate(this.isNew ? ['/app/tiers/liste'] : ['..'], {
      relativeTo: this.route,
    });
  }

  /** Every writable field, as the API expects it (creation). */
  private creation(): PartnerWrite {
    const value = this.form.getRawValue();
    const write: Record<string, unknown> = {
      is_customer: value.is_customer,
      is_supplier: value.is_supplier,
    };
    for (const field of TEXT_FIELDS) {
      write[field] = value[field].trim();
    }
    for (const field of REFERENCE_FIELDS) {
      write[field] = value[field] || null;
    }
    return write as unknown as PartnerWrite;
  }

  /** Only the fields changed (modification). */
  private changes(): PartnerUpdate {
    const creation = this.creation() as unknown as Record<string, unknown>;
    const changes: Record<string, unknown> = {};
    for (const [name, control] of Object.entries(this.form.controls)) {
      if (control.dirty) {
        changes[name] = creation[name];
      }
    }
    return changes as PartnerUpdate;
  }

  private fill(partner: Partner): void {
    this.partner.set(partner);
    this.breadcrumbs.nameCurrent(`${partner.code} — ${partner.name}`, 1);
    const values: Record<string, unknown> = {
      is_customer: partner.is_customer,
      is_supplier: partner.is_supplier,
      default_currency: partner.default_currency ?? '',
      customer_payment_term: partner.customer_payment_term?.public_id ?? '',
      supplier_payment_term: partner.supplier_payment_term?.public_id ?? '',
    };
    for (const field of TEXT_FIELDS) {
      values[field] = partner[field as TextField];
    }
    this.form.setValue(values as ReturnType<typeof this.form.getRawValue>);
    this.form.markAsPristine();
    afterNextRender(() => this.focus('name'), { injector: this.injector });
  }

  private showFailure(error: ApiError): void {
    if (error.kind === 'unauthenticated') {
      return;
    }
    const fields = {
      ...serverFieldErrors(error, PARTNER_FIELD_MESSAGES),
      ...this.businessFieldError(error),
    };
    const names = Object.keys(fields).filter((name) => this.form.get(name));
    for (const name of names) {
      this.form.get(name)?.setErrors({ server: fields[name] });
    }
    if (names.length > 0) {
      this.invalidSubmit.set(true);
      this.focus(names[0]);
      return;
    }
    this.error.set(toUserError(error, PARTNER_ERRORS));
  }

  /** Business refusals that belong to one field (by their stable code). */
  private businessFieldError(error: ApiError): Record<string, string> {
    switch (error.code) {
      case 'partner_code_exists':
        return { code: 'Ce code est déjà utilisé par un autre tiers de la société.' };
      case 'currency_inactive':
        return { default_currency: 'Cette devise est inactive.' };
      case 'payment_term_inactive': {
        const code = (error.details as Record<string, unknown> | null)?.['payment_term'];
        const field = (['customer_payment_term', 'supplier_payment_term'] as const).find(
          (name) =>
            this.paymentTerms()?.find((term) => term.public_id === this.form.controls[name].value)
              ?.code === code,
        );
        return field ? { [field]: 'Cette condition de paiement est inactive.' } : {};
      }
      default:
        return {};
    }
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
