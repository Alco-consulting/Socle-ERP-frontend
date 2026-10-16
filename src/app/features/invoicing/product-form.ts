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
import { catchError, firstValueFrom, map, of } from 'rxjs';

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
import { normalizeDecimalInput, trimDecimalZeros } from '../../shared/utils/decimal';
import { EntriesApi } from '../accounting/data-access/entries-api';
import { AUDIT_TYPES, AlcoObjectHistory } from '../audit/object-history';
import { TaxesApi } from '../taxes/data-access/taxes-api';
import { Tax } from '../taxes/data-access/taxes-models';
import { InvoicingApi } from './data-access/invoicing-api';
import { Product, ProductWrite, UnitCategory, UnitReference } from './data-access/invoicing-models';
import { ACCOUNTING, INVOICING_ERRORS } from './invoicing-presentation';

const LIST = `${ACCOUNTING}/produits`;

const unitId = (unit: UnitReference | null) => unit?.public_id ?? '';

/** Business refusals that belong to one field (by their stable code). */
const FIELD_OF_CODE: Readonly<Record<string, [string, string]>> = {
  invoicing_product_code_exists: ['code', 'Un produit de la société porte déjà cette référence.'],
  invoicing_tax_withholding_unsupported: ['tax', 'Une taxe retenue à la source ne se facture pas.'],
  invoicing_unit_category_mismatch: [
    'purchase_unit',
    'L’unité d’achat est de la même catégorie que l’unité de vente.',
  ],
};

/** A group of the unit lists: a category and its units offered. */
interface UnitGroup {
  readonly id: string;
  readonly name: string;
  readonly units: readonly Choice[];
}

interface Choice {
  readonly id: string;
  readonly label: string;
}

/** An account of a selection field: its code, its name beside. */
const accountOption = (account: {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
}): AutocompleteOption => ({ id: account.public_id, label: account.code, detail: account.name });

/**
 * A product on one simple page, to create it (`…/produits/nouveau`) or change it
 * (`…/produits/:id`): Référence interne, Nom, Prix de vente HT, Compte de vente and Compte d'achat
 * (any account of the chart that takes entries, searched: note backend 0045), TVA (the active
 * taxes), « Unité de vente » and « Unité d'achat » (one category, note backend 0047) and
 * « Actif » (its commands). An account may stay empty: an invoice that needs it is refused at
 * posting (note backend 0038).
 */
@Component({
  selector: 'alco-product-form',
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
  templateUrl: './product-form.html',
  styleUrls: ['../accounting/accounting-sheet.scss', '../taxes/tax-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductFormPage {
  private readonly api = inject(InvoicingApi);
  private readonly entries = inject(EntriesApi);
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
    sale_account: new FormControl<AutocompleteOption | null>(null),
    purchase_account: new FormControl<AutocompleteOption | null>(null),
    tax: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    sale_unit: new FormControl('', { nonNullable: true }),
    purchase_unit: new FormControl('', { nonNullable: true }),
    active: new FormControl(true, { nonNullable: true }),
  });

  protected readonly product = signal<Product | null>(null);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly invalidSubmit = signal(false);
  protected readonly ready = computed(() => this.isNew || this.product() !== null);
  protected readonly title = computed(() => this.product()?.name ?? 'Nouveau produit');

  /** Every account of the chart that takes entries, searched by code or name (note backend 0045). */
  protected readonly searchAccounts: AutocompleteSearch = (term) =>
    this.entries.postableAccounts(term).pipe(map((found) => found.map(accountOption)));
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

  private readonly categories = signal<readonly UnitCategory[]>([]);
  private readonly saleUnit = toSignal(this.form.controls.sale_unit.valueChanges, {
    initialValue: '',
  });
  /** The active units by category, with the product's own if retired since. */
  protected readonly unitGroups = computed<readonly UnitGroup[]>(() => {
    const product = this.product();
    const own = [product?.sale_unit, product?.purchase_unit].map((unit) => unit?.public_id);
    return this.categories().map((category) => ({
      id: category.public_id,
      name: category.name,
      units: category.units
        .filter((unit) => unit.status === 'active' || own.includes(unit.public_id))
        .map((unit) => ({ id: unit.public_id, label: unit.name })),
    }));
  });
  /** « Unité d'achat »: the units of the sale unit's category (bought by the bag, sold by the kg). */
  protected readonly purchaseUnits = computed<readonly Choice[]>(() => {
    const sale = this.saleUnit();
    return (
      this.unitGroups().find((group) => group.units.some((unit) => unit.id === sale))?.units ?? []
    );
  });

  constructor() {
    inject(UnsavedChangesService).track(() => this.form.dirty);
    this.api
      .unitCategories()
      .pipe(
        map((page) => page.results),
        catchError(() => of([] as UnitCategory[])),
      )
      .subscribe((list) => {
        this.categories.set(list);
        this.proposeUnits();
      });
    // Another category for the sale: bought in the same unit, as Odoo's form.
    this.form.controls.sale_unit.valueChanges.subscribe((sale) => {
      const purchase = this.form.controls.purchase_unit;
      if (!this.purchaseUnits().some((unit) => unit.id === purchase.value)) {
        purchase.setValue(sale);
      }
    });
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
      sale_account: value.sale_account?.id ?? null,
      purchase_account: value.purchase_account?.id ?? null,
      tax: value.tax,
      sale_unit: value.sale_unit || null,
      purchase_unit: value.purchase_unit || null,
    };
  }

  /** A new product: « Unités », the reference of the default list's first category. */
  private proposeUnits(): void {
    const controls = this.form.controls;
    const first = this.categories()[0]?.units.find((unit) => unit.unit_type === 'reference');
    if (!this.isNew || !first || controls.sale_unit.value) {
      return;
    }
    controls.sale_unit.setValue(first.public_id);
    controls.purchase_unit.setValue(first.public_id);
  }

  private fill(product: Product): void {
    this.product.set(product);
    this.breadcrumbs.nameCurrent(product.name);
    this.form.setValue({
      code: product.code,
      name: product.name,
      sale_price: product.sale_price === null ? '' : trimDecimalZeros(product.sale_price, 0),
      sale_account: product.sale_account ? accountOption(product.sale_account) : null,
      purchase_account: product.purchase_account ? accountOption(product.purchase_account) : null,
      tax: product.tax.public_id,
      sale_unit: unitId(product.sale_unit),
      purchase_unit: unitId(product.purchase_unit),
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
