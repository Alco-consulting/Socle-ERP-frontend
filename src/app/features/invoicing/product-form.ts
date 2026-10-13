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

import { serverFieldErrors } from '../../core/errors/field-errors';
import { UserError, toUserError } from '../../core/errors/user-error';
import { ApiError, toApiError } from '../../core/http/api-error';
import { BreadcrumbService } from '../../core/navigation/route-trail';
import { UnsavedChangesService } from '../../core/navigation/unsaved-changes';
import { SessionStore } from '../../core/session/session.store';
import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { decimalFormat } from '../../shared/forms/validators';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { normalizeDecimalInput, trimDecimalZeros } from '../../shared/utils/decimal';
import { AccountingApi } from '../accounting/data-access/accounting-api';
import { Account } from '../accounting/data-access/accounting-models';
import { AUDIT_TYPES, AlcoObjectHistory } from '../audit/object-history';
import { TaxesApi } from '../taxes/data-access/taxes-api';
import { Tax } from '../taxes/data-access/taxes-models';
import { InvoicingApi } from './data-access/invoicing-api';
import { Product, ProductWrite } from './data-access/invoicing-models';
import { ACCOUNTING, INVOICING_ERRORS } from './invoicing-presentation';

const LIST = `${ACCOUNTING}/produits`;

/** Business refusals that belong to one field (by their stable code). */
const FIELD_OF_CODE: Readonly<Record<string, [string, string]>> = {
  invoicing_product_code_exists: ['code', 'Un produit de la société porte déjà cette référence.'],
  invoicing_tax_withholding_unsupported: ['tax', 'Une taxe retenue à la source ne se facture pas.'],
};

interface Choice {
  readonly id: string;
  readonly label: string;
}

const accountChoice = (account: Pick<Account, 'public_id' | 'code' | 'name'>): Choice => ({
  id: account.public_id,
  label: `${account.code} — ${account.name}`,
});

/**
 * A product on one simple page, to create it (`…/produits/nouveau`) or change it
 * (`…/produits/:id`): Référence interne, Nom, Prix de vente HT, Compte de vente (the chart's
 * income accounts, class 7), Compte d'achat (expense accounts, class 6), TVA (the active
 * taxes) and « Actif » (its commands). An account may stay empty: an invoice that needs it
 * is refused at posting (note backend 0038).
 */
@Component({
  selector: 'alco-product-form',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoButton,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoObjectHistory,
    AlcoPageHeader,
  ],
  templateUrl: './product-form.html',
  styleUrls: ['../accounting/accounting-sheet.scss', '../taxes/tax-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductFormPage {
  private readonly api = inject(InvoicingApi);
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
  protected readonly list = LIST;
  protected readonly auditType = AUDIT_TYPES.product;
  protected readonly canSave = this.session.can('invoicing.manage_products');
  protected readonly canSeeHistory = this.session.can('audit.read');

  protected readonly form = new FormGroup({
    code: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(32)] }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(255)],
    }),
    sale_price: new FormControl('', { nonNullable: true, validators: [decimalFormat(6)] }),
    sale_account: new FormControl('', { nonNullable: true }),
    purchase_account: new FormControl('', { nonNullable: true }),
    tax: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    unit: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(32)] }),
    active: new FormControl(true, { nonNullable: true }),
  });

  protected readonly product = signal<Product | null>(null);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly invalidSubmit = signal(false);
  protected readonly ready = computed(() => this.isNew || this.product() !== null);
  protected readonly title = computed(() => this.product()?.name ?? 'Nouveau produit');

  private readonly income = signal<readonly Account[]>([]);
  private readonly expense = signal<readonly Account[]>([]);
  private readonly taxes = signal<readonly Tax[]>([]);
  protected readonly taxChoices = computed<readonly Choice[]>(() => {
    const current = this.product()?.tax;
    const choices = this.taxes()
      .filter((tax) => !tax.withholding)
      .map((tax) => ({ id: tax.public_id, label: tax.name }));
    return current && !choices.some((choice) => choice.id === current.public_id)
      ? [...choices, { id: current.public_id, label: current.name }]
      : choices;
  });

  constructor() {
    inject(UnsavedChangesService).track(() => this.form.dirty);
    this.accounting
      .accountsOfNature('income')
      .pipe(catchError(() => of([] as readonly Account[])))
      .subscribe((list) => this.income.set(list));
    this.accounting
      .accountsOfNature('expense')
      .pipe(catchError(() => of([] as readonly Account[])))
      .subscribe((list) => this.expense.set(list));
    inject(TaxesApi)
      .taxes({ status: 'active' })
      .pipe(
        map((page) => page.results),
        catchError(() => of([] as Tax[])),
      )
      .subscribe((list) => this.taxes.set(list));
    if (!this.canSave) {
      this.form.disable();
    }
    if (this.id) {
      this.api.product(this.id).subscribe({
        next: (product) => this.fill(product),
        error: (failure: unknown) => this.loadError.set(toUserError(failure, INVOICING_ERRORS)),
      });
    } else {
      afterNextRender(() => this.focus('name'), { injector: this.injector });
    }
  }

  /** The income or expense accounts, with the product's own one if the list lacks it. */
  protected accountChoices(field: 'sale_account' | 'purchase_account'): readonly Choice[] {
    const choices = (field === 'sale_account' ? this.income() : this.expense()).map(accountChoice);
    const current = this.product()?.[field];
    return current && !choices.some((choice) => choice.id === current.public_id)
      ? [...choices, accountChoice(current)]
      : choices;
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
    const product = this.product();
    if (product && !this.form.dirty) {
      this.toast.info('Aucune modification à enregistrer.');
      await this.router.navigateByUrl(LIST);
      return;
    }
    this.saving.set(true);
    try {
      let saved = await firstValueFrom(
        product
          ? this.api.updateProduct(product.public_id, this.write())
          : this.api.createProduct(this.write()),
      );
      const active = this.form.controls.active.value;
      if (active !== (saved.status === 'active')) {
        saved = await firstValueFrom(this.api.setProductActive(saved.public_id, active));
      }
      this.form.markAsPristine();
      this.toast.success(
        product ? 'Modifications enregistrées.' : `Produit « ${saved.name} » créé.`,
      );
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

  private write(): ProductWrite {
    const value = this.form.getRawValue();
    return {
      code: value.code.trim(),
      name: value.name.trim(),
      sale_price: value.sale_price.trim()
        ? (normalizeDecimalInput(value.sale_price) ?? value.sale_price)
        : null,
      sale_account: value.sale_account || null,
      purchase_account: value.purchase_account || null,
      tax: value.tax,
      unit: value.unit.trim(),
    };
  }

  private fill(product: Product): void {
    this.product.set(product);
    this.breadcrumbs.nameCurrent(product.name);
    this.form.setValue({
      code: product.code,
      name: product.name,
      sale_price: product.sale_price === null ? '' : trimDecimalZeros(product.sale_price, 0),
      sale_account: product.sale_account?.public_id ?? '',
      purchase_account: product.purchase_account?.public_id ?? '',
      tax: product.tax.public_id,
      unit: product.unit,
      active: product.status === 'active',
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
    const business = error.code ? FIELD_OF_CODE[error.code] : undefined;
    if (business) {
      fields[business[0]] = business[1];
    }
    if (error.code === 'invoicing_product_account_nature') {
      const account = (error.details as Record<string, unknown> | null)?.['expected'];
      fields[account === 'expense' ? 'purchase_account' : 'sale_account'] =
        account === 'expense'
          ? 'Un compte de charges (classe 6) actif.'
          : 'Un compte de produits (classe 7) actif.';
    }
    const names = Object.keys(fields).filter((name) => this.form.get(name));
    for (const name of names) {
      this.form.get(name)?.setErrors({ server: fields[name] });
    }
    if (names.length > 0) {
      this.invalidSubmit.set(true);
      this.focus(names[0]);
      return;
    }
    this.error.set(toUserError(error, INVOICING_ERRORS));
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
