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

import { serverFieldErrors } from '../../../core/errors/field-errors';
import { UserError, toUserError } from '../../../core/errors/user-error';
import { ApiError, toApiError } from '../../../core/http/api-error';
import { BreadcrumbService } from '../../../core/navigation/route-trail';
import { UnsavedChangesService } from '../../../core/navigation/unsaved-changes';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoTagSelect, TagOption } from '../../../shared/forms/tag-select';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { CurrencyOption } from '../../partners/data-access/partner-models';
import { PartnersApi } from '../../partners/data-access/partners-api';
import {
  ACCOUNTING_FIELD_MESSAGES,
  ACCOUNTING_REFERENTIAL_ERRORS,
  TYPE_SECTIONS,
} from '../accounting-presentation';
import { Account, AccountWrite, DetailedType, Journal } from '../data-access/accounting-models';
import { AccountingApi } from '../data-access/accounting-api';
import { EntriesApi } from '../data-access/entries-api';
import { TaxOption } from '../data-access/entry-models';

/** Business refusals that belong to one field (by their stable code). */
const FIELD_OF_CODE: Readonly<Record<string, [string, string]>> = {
  accounting_account_code_exists: ['code', 'Ce code est déjà utilisé par un autre compte.'],
  accounting_account_currency_mismatch: [
    'currency',
    'Ce compte a déjà des écritures dans une autre devise.',
  ],
};

/**
 * Creation (`…/plan-comptable/nouveau`) and modification (`…/:id/modifier`) of an account,
 * with the fields of Odoo's account form: code, name; « Comptabilité »: type (Odoo's list,
 * its nature following on the server), default taxes, allowed journals, currency, lettering,
 * obsolete (the account's state, through its commands), group and company (shown only). A
 * modification sends only the fields changed, never the code.
 */
@Component({
  selector: 'alco-account-form',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoButton,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoTagSelect,
    AlcoPageHeader,
  ],
  templateUrl: './account-form.html',
  styleUrls: ['../accounting-sheet.scss', './account-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountFormPage {
  private readonly api = inject(AccountingApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AlcoToastService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly session = inject(SessionStore);

  protected readonly id = this.route.snapshot.paramMap.get('id');
  protected readonly isNew = this.id === null;
  protected readonly sections = TYPE_SECTIONS;
  protected readonly canSeeTaxes = this.session.can('taxes.read');
  /** Every account belongs to the active company (the API is company scoped). */
  protected readonly companyName = computed(() => this.session.activeCompany()?.name ?? '');

  protected readonly form = new FormGroup({
    code: new FormControl('', {
      nonNullable: true,
      validators: this.isNew ? [Validators.required, Validators.maxLength(32)] : [],
    }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(255)],
    }),
    detailed_type: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    default_taxes: new FormControl<readonly string[]>([], { nonNullable: true }),
    allowed_journals: new FormControl<readonly string[]>([], { nonNullable: true }),
    /** Empty: entries in any currency; set: only in this one (the server's rule). */
    currency: new FormControl<string>('', { nonNullable: true }),
    letterable: new FormControl(false, { nonNullable: true }),
    /** Odoo's « Obsolète »: the account inactive (its deactivate / reactivate commands). */
    obsolete: new FormControl(false, { nonNullable: true }),
  });

  /** Options of the API: active currencies, journals and taxes of the company. */
  protected readonly currencies = signal<readonly CurrencyOption[]>([]);
  protected readonly journals = signal<readonly Pick<Journal, 'public_id' | 'code' | 'name'>[]>([]);
  protected readonly taxes = signal<readonly TaxOption[]>([]);
  protected readonly taxOptions = computed<readonly TagOption[]>(() =>
    this.taxes().map((tax) => ({ id: tax.public_id, label: `${tax.code} — ${tax.name}` })),
  );
  protected readonly journalOptions = computed<readonly TagOption[]>(() =>
    this.journals().map((journal) => ({
      id: journal.public_id,
      label: `${journal.code} — ${journal.name}`,
    })),
  );

  protected readonly account = signal<Account | null>(null);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly invalidSubmit = signal(false);
  protected readonly ready = computed(() => this.isNew || this.account() !== null);

  constructor() {
    inject(UnsavedChangesService).track(() => this.form.dirty);
    inject(PartnersApi)
      .currencies()
      .pipe(catchError(() => of(null)))
      .subscribe((page) =>
        this.currencies.set((page?.results ?? []).filter((item) => item.status === 'active')),
      );
    this.api
      .journals({ status: 'active' })
      .pipe(
        map((page) => page.results),
        catchError(() => of([] as Journal[])),
      )
      .subscribe((list) => this.journals.set(list));
    if (this.canSeeTaxes) {
      inject(EntriesApi)
        .taxes()
        .pipe(catchError(() => of([] as TaxOption[])))
        .subscribe((list) => this.taxes.set(list));
    }
    if (this.id) {
      this.api.account(this.id).subscribe({
        next: (account) => this.fill(account),
        error: (failure: unknown) =>
          this.loadError.set(toUserError(failure, ACCOUNTING_REFERENTIAL_ERRORS)),
      });
    } else {
      afterNextRender(() => this.focus('code'), { injector: this.injector });
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
    const account = this.account();
    if (account && !this.form.dirty) {
      this.toast.info('Aucune modification à enregistrer.');
      await this.router.navigate(['..'], { relativeTo: this.route });
      return;
    }
    this.saving.set(true);
    try {
      const changes = this.changes();
      let saved =
        account && Object.keys(changes).length === 0
          ? account
          : await firstValueFrom(
              account
                ? this.api.updateAccount(account.public_id, changes)
                : this.api.createAccount(this.creation()),
            );
      const obsolete = this.form.controls.obsolete.value;
      if (obsolete !== (saved.status === 'inactive')) {
        saved = await firstValueFrom(this.api.setAccountActive(saved.public_id, !obsolete));
      }
      this.form.markAsPristine();
      if (account) {
        this.toast.success('Modifications enregistrées.');
        await this.router.navigate(['..'], { relativeTo: this.route });
      } else {
        this.toast.success(`Compte « ${saved.code} » créé.`);
        await this.router.navigate(['/app/comptabilite/plan-comptable', saved.public_id]);
      }
    } catch (failure) {
      this.showFailure(toApiError(failure));
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    void this.router.navigate(this.isNew ? ['/app/comptabilite/plan-comptable'] : ['..'], {
      relativeTo: this.route,
    });
  }

  private creation(): AccountWrite {
    const value = this.form.getRawValue();
    return {
      code: value.code.trim(),
      name: value.name.trim(),
      detailed_type: value.detailed_type as DetailedType,
      currency: value.currency || null,
      letterable: value.letterable,
      allowed_journals: value.allowed_journals,
      default_taxes: value.default_taxes,
    };
  }

  /** The fields changed (the state goes through its commands, never in the PATCH). */
  private changes(): Partial<Omit<AccountWrite, 'code'>> {
    const creation = this.creation() as unknown as Record<string, unknown>;
    const changes: Record<string, unknown> = {};
    for (const [name, control] of Object.entries(this.form.controls)) {
      if (name !== 'code' && name !== 'obsolete' && control.dirty) {
        changes[name] = creation[name];
      }
    }
    return changes;
  }

  private fill(account: Account): void {
    this.account.set(account);
    this.breadcrumbs.nameCurrent(`${account.code} — ${account.name}`, 1);
    this.form.setValue({
      code: account.code,
      name: account.name,
      detailed_type: account.detailed_type,
      default_taxes: account.default_taxes,
      allowed_journals: account.allowed_journals,
      currency: account.currency ?? '',
      letterable: account.letterable,
      obsolete: account.status === 'inactive',
    });
    this.form.markAsPristine();
    afterNextRender(() => this.focus('name'), { injector: this.injector });
  }

  private showFailure(error: ApiError): void {
    if (error.kind === 'unauthenticated') {
      return;
    }
    const fields: Record<string, string> = {
      ...serverFieldErrors(error, ACCOUNTING_FIELD_MESSAGES),
    };
    const business = error.code ? FIELD_OF_CODE[error.code] : undefined;
    if (business) {
      fields[business[0]] = business[1];
    }
    if (!this.showFields(fields)) {
      this.error.set(toUserError(error, ACCOUNTING_REFERENTIAL_ERRORS));
    }
  }

  private showFields(fields: Record<string, string>): boolean {
    const names = Object.keys(fields).filter((name) => this.form.get(name));
    for (const name of names) {
      this.form.get(name)?.setErrors({ server: fields[name] });
    }
    if (names.length > 0) {
      this.invalidSubmit.set(true);
      this.focus(names[0]);
    }
    return names.length > 0;
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
