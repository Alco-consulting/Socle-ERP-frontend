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
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, firstValueFrom, map, of } from 'rxjs';

import { serverFieldErrors } from '../../core/errors/field-errors';
import { UserError, toUserError } from '../../core/errors/user-error';
import { ApiError, toApiError } from '../../core/http/api-error';
import { BreadcrumbService } from '../../core/navigation/route-trail';
import { UnsavedChangesService } from '../../core/navigation/unsaved-changes';
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
import { localToday } from '../../shared/utils/dates';
import { normalizeDecimalInput, trimDecimalZeros } from '../../shared/utils/decimal';
import { AccountingApi } from '../accounting/data-access/accounting-api';
import { Journal } from '../accounting/data-access/accounting-models';
import { TaxesApi } from '../taxes/data-access/taxes-api';
import { Tax } from '../taxes/data-access/taxes-models';
import { InvoicingApi } from './data-access/invoicing-api';
import {
  Invoice,
  InvoiceKind,
  InvoiceLineWrite,
  InvoiceUpdate,
  InvoiceWrite,
  Product,
} from './data-access/invoicing-models';
import { INVOICING_ERRORS, KINDS, KindSpec, invoiceUrl } from './invoicing-presentation';

interface LineForm {
  product: FormControl<string>;
  description: FormControl<string>;
  quantity: FormControl<string>;
  unit_price: FormControl<string>;
  tax: FormControl<string>;
}

/** Business refusals that belong to one field (by their stable code). */
const FIELD_OF_CODE: Readonly<Record<string, [string, string]>> = {
  partner_inactive: ['partner', 'Ce tiers est inactif.'],
  invoicing_journal_kind: ['journal', 'Ce journal ne convient pas à ce côté.'],
};

/**
 * A draft invoice or credit note (note backend 0038): created from its list
 * (`…/ventes/factures/nouvelle`, `…/achats/factures/nouvelle`) or changed
 * (`…/<liste>/:id/modifier`). The partner, the date, the supplier's number, the journal when
 * the company has several, and the lines: product, description, quantity, unit price
 * (excluding tax), tax. The server computes every amount and the taxes at saving; the draft's
 * record then shows them, and « Comptabiliser ».
 */
@Component({
  selector: 'alco-invoice-form',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoAutocomplete,
    AlcoButton,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
  ],
  templateUrl: './invoice-form.html',
  styleUrls: ['../accounting/accounting-sheet.scss', '../accounting/entries/entry-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvoiceFormPage {
  private readonly api = inject(InvoicingApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AlcoToastService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly id = this.route.snapshot.paramMap.get('id');
  protected readonly isNew = this.id === null;
  private readonly kindOfRoute = this.route.snapshot.data['kind'] as InvoiceKind | undefined;
  protected readonly invoice = signal<Invoice | null>(null);
  protected readonly spec = computed<KindSpec>(
    () => KINDS[this.invoice()?.kind ?? this.kindOfRoute ?? 'customer_invoice'],
  );
  protected readonly isCreditNote = computed(() => !this.spec().creatable);
  protected readonly customerSide = computed(() => this.spec().side === 'customer');

  protected readonly form = new FormGroup({
    partner: new FormControl<AutocompleteOption | null>(null, {
      validators: [Validators.required],
    }),
    invoice_date: new FormControl(localToday(), {
      nonNullable: true,
      validators: [Validators.required],
    }),
    reference: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(64)] }),
    journal: new FormControl('', { nonNullable: true }),
    lines: new FormArray<FormGroup<LineForm>>([]),
  });

  protected readonly loadError = signal<UserError | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly invalidSubmit = signal(false);
  protected readonly ready = computed(() => this.isNew || this.invoice() !== null);
  protected readonly title = computed(() => {
    const invoice = this.invoice();
    if (!invoice) {
      return 'Nouvelle facture';
    }
    return `Modifier : ${this.spec().word.toLowerCase()} ${invoice.number || 'brouillon'}`;
  });

  protected readonly products = signal<readonly Product[]>([]);
  private readonly taxes = signal<readonly Tax[]>([]);
  protected readonly journals = signal<readonly Journal[]>([]);
  /** The taxes of the side: of sales for a customer document, of purchases for a supplier. */
  protected readonly sideTaxes = computed(() => {
    const side = this.customerSide() ? 'sale' : 'purchase';
    return this.taxes().filter(
      (tax) => !tax.withholding && (tax.type_tax_use === side || tax.type_tax_use === 'both'),
    );
  });
  protected readonly searchPartners: AutocompleteSearch = (term) =>
    this.api.partners(term).pipe(
      map((partners) =>
        partners.map((partner) => ({
          id: partner.public_id,
          label: partner.name,
          detail: partner.code,
        })),
      ),
    );

  constructor() {
    inject(UnsavedChangesService).track(() => this.form.dirty);
    this.api
      .productOptions()
      .pipe(
        map((page) => page.results),
        catchError(() => of([] as Product[])),
      )
      .subscribe((list) => this.products.set(list));
    inject(TaxesApi)
      .taxes({ status: 'active' })
      .pipe(
        map((page) => page.results),
        catchError(() => of([] as Tax[])),
      )
      .subscribe((list) => this.taxes.set(list));
    const accounting = inject(AccountingApi);
    const loadJournals = (spec: KindSpec) =>
      accounting
        .journals({
          status: 'active',
          journalType: spec.side === 'customer' ? 'sales' : 'purchase',
        })
        .pipe(
          map((page) => page.results),
          catchError(() => of([] as Journal[])),
        )
        .subscribe((list) => this.journals.set(list));
    if (this.id) {
      this.api.invoice(this.id).subscribe({
        next: (invoice) => {
          this.fill(invoice);
          loadJournals(KINDS[invoice.kind]);
        },
        error: (failure: unknown) => this.loadError.set(toUserError(failure, INVOICING_ERRORS)),
      });
    } else {
      loadJournals(this.spec());
      this.addLine();
      this.form.markAsPristine();
      afterNextRender(() => this.focus('partner'), { injector: this.injector });
    }
  }

  protected get lines(): FormArray<FormGroup<LineForm>> {
    return this.form.controls.lines;
  }

  protected addLine(): void {
    this.lines.push(this.line());
    this.form.markAsDirty();
  }

  protected removeLine(index: number): void {
    this.lines.removeAt(index);
    this.form.markAsDirty();
  }

  /** A product chosen: its price (customer documents) and its tax, as proposals. */
  protected productChosen(index: number): void {
    const line = this.lines.at(index);
    const product = this.products().find((item) => item.public_id === line.controls.product.value);
    if (!product) {
      return;
    }
    if (this.customerSide() && product.sale_price !== null && !line.controls.unit_price.value) {
      line.controls.unit_price.setValue(trimDecimalZeros(product.sale_price, 0));
    }
    if (this.sideTaxes().some((tax) => tax.public_id === product.tax.public_id)) {
      line.controls.tax.setValue(product.tax.public_id);
    }
  }

  /** The active products, with a line's own product if it was retired since. */
  protected productChoices(current: string): readonly { id: string; label: string }[] {
    const choices = this.products().map((product) => ({
      id: product.public_id,
      label: product.code ? `${product.code} — ${product.name}` : product.name,
    }));
    const own = this.invoice()?.lines.find((line) => line.product.public_id === current);
    return own && !choices.some((choice) => choice.id === current)
      ? [...choices, { id: own.product.public_id, label: own.product.name }]
      : choices;
  }

  protected async save(): Promise<void> {
    if (this.saving()) {
      return;
    }
    this.error.set(null);
    this.form.markAllAsTouched();
    if (this.form.invalid || this.lines.length === 0) {
      this.invalidSubmit.set(true);
      this.focusFirstInvalid();
      return;
    }
    this.invalidSubmit.set(false);
    const invoice = this.invoice();
    this.saving.set(true);
    try {
      const saved = await firstValueFrom(
        invoice
          ? this.api.updateInvoice(invoice.public_id, this.update())
          : this.api.createInvoice(this.creation()),
      );
      this.form.markAsPristine();
      this.toast.success(invoice ? 'Modifications enregistrées.' : 'Brouillon enregistré.');
      await this.router.navigateByUrl(invoiceUrl(saved.kind, saved.public_id));
    } catch (failure) {
      this.showFailure(toApiError(failure));
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    void this.router.navigate(['..'], { relativeTo: this.route });
  }

  private line(values?: Partial<Record<keyof LineForm, string>>): FormGroup<LineForm> {
    return new FormGroup<LineForm>({
      product: new FormControl(values?.product ?? '', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      description: new FormControl(values?.description ?? '', {
        nonNullable: true,
        validators: [Validators.maxLength(255)],
      }),
      quantity: new FormControl(values?.quantity ?? '1', {
        nonNullable: true,
        validators: [Validators.required, decimalFormat(4)],
      }),
      unit_price: new FormControl(values?.unit_price ?? '', {
        nonNullable: true,
        validators: this.customerSide()
          ? [decimalFormat(6)]
          : [Validators.required, decimalFormat(6)],
      }),
      tax: new FormControl(values?.tax ?? '', { nonNullable: true }),
    });
  }

  private writtenLines(): InvoiceLineWrite[] {
    return this.lines.controls.map((line) => {
      const value = line.getRawValue();
      const price = value.unit_price.trim();
      return {
        product: value.product,
        quantity: normalizeDecimalInput(value.quantity) ?? value.quantity,
        unit_price: price ? (normalizeDecimalInput(price) ?? price) : null,
        description: value.description.trim(),
        tax: value.tax || null,
      };
    });
  }

  private creation(): InvoiceWrite {
    const value = this.form.getRawValue();
    return {
      kind: this.spec().kind as InvoiceWrite['kind'],
      partner: value.partner?.id ?? '',
      invoice_date: value.invoice_date,
      journal: value.journal || null,
      reference: value.reference.trim(),
      lines: this.writtenLines(),
    };
  }

  /** The whole draft again: the lines given replace them all. */
  private update(): InvoiceUpdate {
    const value = this.form.getRawValue();
    return {
      ...(this.isCreditNote() ? {} : { partner: value.partner?.id ?? '' }),
      invoice_date: value.invoice_date,
      ...(value.journal ? { journal: value.journal } : {}),
      reference: value.reference.trim(),
      lines: this.writtenLines(),
    };
  }

  private fill(invoice: Invoice): void {
    this.invoice.set(invoice);
    this.breadcrumbs.nameCurrent(`${KINDS[invoice.kind].word} ${invoice.number || 'brouillon'}`, 1);
    if (invoice.status !== 'draft') {
      this.loadError.set({
        title: 'Ce document n’est plus un brouillon : il ne se modifie plus.',
        message: 'Corrigez-le par un avoir, ou par son annulation.',
        code: 'invoicing_invoice_not_draft',
      });
      return;
    }
    this.form.controls.partner.setValue({
      id: invoice.partner.public_id,
      label: invoice.partner.name,
      detail: invoice.partner.code,
    });
    if (this.isCreditNote()) {
      this.form.controls.partner.disable();
    }
    this.form.controls.invoice_date.setValue(invoice.invoice_date);
    this.form.controls.reference.setValue(invoice.reference);
    this.form.controls.journal.setValue(invoice.journal.public_id);
    this.lines.clear();
    for (const line of invoice.lines) {
      this.lines.push(
        this.line({
          product: line.product.public_id,
          description: line.description,
          quantity: trimDecimalZeros(line.quantity, 0),
          unit_price: trimDecimalZeros(line.unit_price, 0),
          tax: line.tax.public_id,
        }),
      );
    }
    this.form.markAsPristine();
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
    const names = Object.keys(fields).filter((name) => name !== 'lines' && this.form.get(name));
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
    const element = this.host.nativeElement.querySelector<HTMLElement>(
      'input.ng-invalid, select.ng-invalid, alco-autocomplete.ng-invalid input',
    );
    element?.focus();
  }

  private focus(name: string): void {
    this.host.nativeElement
      .querySelector<HTMLElement>(
        `[formControlName="${name}"] input, input[formControlName="${name}"], select[formControlName="${name}"]`,
      )
      ?.focus();
  }
}
