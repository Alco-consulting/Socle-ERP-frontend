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
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, map, startWith } from 'rxjs';

import { serverFieldErrors } from '../../core/errors/field-errors';
import { UserError, toUserError } from '../../core/errors/user-error';
import { ApiError, toApiError } from '../../core/http/api-error';
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
import { decimalFormat } from '../../shared/forms/validators';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { normalizeDecimalInput } from '../../shared/utils/decimal';
import { AccountingApi } from '../accounting/data-access/accounting-api';
import { AUDIT_TYPES, AlcoObjectHistory } from '../audit/object-history';
import { TaxesApi } from './data-access/taxes-api';
import { Tax, TaxUse, TaxWrite } from './data-access/taxes-models';
import {
  TAX_ERRORS,
  TAX_USES,
  appliesToPurchases,
  appliesToSales,
  rateText,
} from './taxes-presentation';

const LIST = '/app/comptabilite/taxes/liste';

/** Business refusals that belong to one field (by their stable code). */
const FIELD_OF_CODE: Readonly<Record<string, [string, string]>> = {
  tax_name_exists: ['name', 'Une taxe de la société porte déjà ce nom.'],
  tax_code_exists: ['name', 'Une taxe porte déjà ce nom.'],
};

/** A chosen account of the chart: the form keeps its code. */
const accountOption = (code: string): AutocompleteOption | null =>
  code ? { id: code, label: code } : null;

/**
 * A tax on one simple page, to create it (`…/taxes/liste/nouveau`) or change it
 * (`…/taxes/liste/:id`): Nom, Taux, S'applique à (ventes, achats, les deux), the account of
 * each side it applies to (from the chart), « Retenue à la source » and « Actif » (its
 * commands, never the form). The server makes the code and writes the tax's rule; entries
 * already recorded keep the rule they used.
 */
@Component({
  selector: 'alco-tax-form',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoAutocomplete,
    AlcoButton,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoObjectHistory,
    AlcoPageHeader,
  ],
  templateUrl: './tax-form.html',
  styleUrls: ['../accounting/accounting-sheet.scss', './tax-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaxFormPage {
  private readonly api = inject(TaxesApi);
  private readonly accounting = inject(AccountingApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AlcoToastService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly session = inject(SessionStore);

  protected readonly id = this.route.snapshot.paramMap.get('id');
  protected readonly isNew = this.id === null;
  protected readonly uses = TAX_USES;
  protected readonly auditType = AUDIT_TYPES.tax;
  protected readonly list = LIST;
  /** Changing a tax needs `taxes.update`; without it the page shows it, read only. */
  protected readonly canSave = this.session.can(this.isNew ? 'taxes.create' : 'taxes.update');
  protected readonly canSeeHistory = this.session.can('audit.read');

  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    rate: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, decimalFormat(4)],
    }),
    type_tax_use: new FormControl<TaxUse>('both', { nonNullable: true }),
    sale_account: new FormControl<AutocompleteOption | null>(null),
    purchase_account: new FormControl<AutocompleteOption | null>(null),
    withholding: new FormControl(false, { nonNullable: true }),
    /** « Actif »: the tax's state, through its commands (never in the form sent). */
    active: new FormControl(true, { nonNullable: true }),
  });

  /** Only the sides the tax applies to have an account. */
  private readonly use = toSignal(
    this.form.controls.type_tax_use.valueChanges.pipe(
      startWith(this.form.controls.type_tax_use.value),
    ),
    { requireSync: true },
  );
  protected readonly onSales = computed(() => appliesToSales(this.use()));
  protected readonly onPurchases = computed(() => appliesToPurchases(this.use()));

  protected readonly tax = signal<Tax | null>(null);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly invalidSubmit = signal(false);
  protected readonly ready = computed(() => this.isNew || this.tax() !== null);
  protected readonly title = computed(() => {
    const tax = this.tax();
    return tax ? `${tax.name} · ${rateText(tax.rate)}` : 'Nouvelle taxe';
  });

  /** Any active account of the chart (the server's search: code or name). */
  protected readonly searchAccounts: AutocompleteSearch = (term) =>
    this.accounting.accounts({ search: term, status: 'active' }).pipe(
      map((page) =>
        page.results.map((account) => ({
          id: account.code,
          label: account.code,
          detail: account.name,
        })),
      ),
    );

  constructor() {
    inject(UnsavedChangesService).track(() => this.form.dirty);
    if (!this.canSave) {
      this.form.disable();
    }
    if (this.id) {
      this.api.tax(this.id).subscribe({
        next: (tax) => this.fill(tax),
        error: (failure: unknown) => this.loadError.set(toUserError(failure, TAX_ERRORS)),
      });
    } else {
      afterNextRender(() => this.focus('name'), { injector: this.injector });
    }
  }

  protected async save(): Promise<void> {
    if (this.saving() || !this.canSave) {
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
    const tax = this.tax();
    if (tax && !this.form.dirty) {
      this.toast.info('Aucune modification à enregistrer.');
      await this.router.navigateByUrl(LIST);
      return;
    }
    this.saving.set(true);
    try {
      let saved = await firstValueFrom(
        tax ? this.api.updateTax(tax.public_id, this.write()) : this.api.createTax(this.write()),
      );
      const active = this.form.controls.active.value;
      if (active !== (saved.status === 'active')) {
        saved = await firstValueFrom(this.api.setTaxActive(saved.public_id, active));
      }
      this.form.markAsPristine();
      this.toast.success(tax ? 'Modifications enregistrées.' : `Taxe « ${saved.name} » créée.`);
      await this.router.navigateByUrl(LIST);
    } catch (failure) {
      this.showFailure(toApiError(failure));
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    void this.router.navigateByUrl(LIST);
  }

  /** The whole form: the server keeps the tax's rule when what it computes is unchanged. */
  private write(): TaxWrite {
    const value = this.form.getRawValue();
    return {
      name: value.name.trim(),
      rate: normalizeDecimalInput(value.rate) ?? value.rate,
      type_tax_use: value.type_tax_use,
      sale_account_code: appliesToSales(value.type_tax_use) ? (value.sale_account?.id ?? '') : '',
      purchase_account_code: appliesToPurchases(value.type_tax_use)
        ? (value.purchase_account?.id ?? '')
        : '',
      withholding: value.withholding,
    };
  }

  private fill(tax: Tax): void {
    this.tax.set(tax);
    this.breadcrumbs.nameCurrent(tax.name);
    this.form.setValue({
      name: tax.name,
      rate: rateText(tax.rate).replace(' %', ''),
      type_tax_use: tax.type_tax_use,
      sale_account: accountOption(tax.sale_account_code),
      purchase_account: accountOption(tax.purchase_account_code),
      withholding: tax.withholding,
      active: tax.status === 'active',
    });
    this.form.markAsPristine();
    if (this.canSave) {
      afterNextRender(() => this.focus('name'), { injector: this.injector });
    }
  }

  private showFailure(error: ApiError): void {
    if (error.kind === 'unauthenticated') {
      return;
    }
    const fields: Record<string, string> = { ...serverFieldErrors(error) };
    const accountField = {
      sale_account_code: 'sale_account',
      purchase_account_code: 'purchase_account',
    };
    for (const [server, local] of Object.entries(accountField)) {
      if (fields[server]) {
        fields[local] = fields[server];
        delete fields[server];
      }
    }
    const business = error.code ? FIELD_OF_CODE[error.code] : undefined;
    if (business) {
      fields[business[0]] = business[1];
    }
    if (!this.showFields(fields)) {
      this.error.set(toUserError(error, TAX_ERRORS));
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
    const field = this.host.nativeElement.querySelector<HTMLElement>(`[formControlName="${name}"]`);
    (field?.querySelector<HTMLElement>('input') ?? field)?.focus();
  }
}
