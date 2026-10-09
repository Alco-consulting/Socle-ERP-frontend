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
import { SessionStore } from '../../core/session/session.store';
import {
  AlcoAutocomplete,
  AutocompleteOption,
  AutocompleteSearch,
} from '../../shared/forms/autocomplete';
import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoTagInput } from '../../shared/forms/tag-input';
import { decimalFormat, inputFormat } from '../../shared/forms/validators';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoTabPanel, AlcoTabs, TabItem } from '../../shared/ui/tabs/tabs';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { normalizeDecimalInput } from '../../shared/utils/decimal';
import { AccountingApi } from '../accounting/data-access/accounting-api';
import { TaxesApi } from './data-access/taxes-api';
import {
  AmountType,
  NamedRecord,
  PriceInclusion,
  RepartitionLine,
  RepartitionType,
  Tax,
  TaxScope,
  TaxUse,
  TaxWrite,
} from './data-access/taxes-models';
import {
  AMOUNT_TYPES,
  PRICE_INCLUSIONS,
  REPARTITION_TYPES,
  TAX_CATEGORY_CODES,
  TAX_ERRORS,
  TAX_SCOPES,
  TAX_USES,
  defaultLines,
  repartitionProblem,
} from './taxes-presentation';

const TABS: readonly TabItem[] = [
  { id: 'definition', label: 'Définition' },
  { id: 'advanced', label: 'Options avancées' },
];

/** Fields of the « Options avancées » tab (an error there opens it). */
const ADVANCED_FIELDS: readonly string[] = ['invoice_label', 'description', 'heading', 'country'];

/** Business refusals that belong to one field (by their stable code). */
const FIELD_OF_CODE: Readonly<Record<string, [string, string]>> = {
  tax_name_exists: ['name', 'Une taxe de ce type, portée et pays porte déjà ce nom.'],
  tax_code_exists: ['name', 'Une taxe porte déjà ce nom.'],
};

type LineForm = FormGroup<{
  repartition_type: FormControl<RepartitionType>;
  factor_percent: FormControl<string>;
  account: FormControl<AutocompleteOption | null>;
  grids: FormControl<readonly string[]>;
}>;
type Side = 'invoice_lines' | 'refund_lines';

function lineForm(line: RepartitionLine): LineForm {
  return new FormGroup({
    repartition_type: new FormControl<RepartitionType>(line.repartition_type, {
      nonNullable: true,
    }),
    factor_percent: new FormControl(line.factor_percent.replace('.', ','), {
      nonNullable: true,
      validators: [Validators.required, decimalFormat(4, { signed: true })],
    }),
    account: new FormControl<AutocompleteOption | null>(
      line.account_code ? { id: line.account_code, label: line.account_code } : null,
    ),
    grids: new FormControl<readonly string[]>(line.grids, { nonNullable: true }),
  });
}

/**
 * Creation (`…/taxes/liste/nouveau`) and modification (`…/:id/modifier`) of a tax, as
 * Odoo's form: Nom de la taxe, Calcul de la taxe, Actif | Type de taxe, Portée de la taxe,
 * Montant, Position fiscale; tab « Définition »: the repartition lines for invoices and for
 * credit notes (%, Basé sur, Compte, Grilles de taxes, « Ajouter une ligne »); tab « Options
 * avancées ». The server makes the code, checks the lines and writes the rule; « Actif »
 * goes through the activate / deactivate commands.
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
    AlcoPageHeader,
    AlcoTabPanel,
    AlcoTabs,
    AlcoTagInput,
  ],
  templateUrl: './tax-form.html',
  styleUrls: ['../accounting/accounting-sheet.scss', './tax-sheet.scss', './tax-form.scss'],
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
  protected readonly tabs = TABS;
  protected readonly tab = signal('definition');
  protected readonly uses = TAX_USES;
  protected readonly scopes = TAX_SCOPES;
  protected readonly amountTypes = AMOUNT_TYPES;
  protected readonly inclusions = PRICE_INCLUSIONS;
  protected readonly repartitionTypes = REPARTITION_TYPES;
  protected readonly categoryCodes = TAX_CATEGORY_CODES;
  protected readonly sides: readonly { id: Side; title: string }[] = [
    { id: 'invoice_lines', title: 'Répartition pour les factures' },
    { id: 'refund_lines', title: 'Répartition pour les notes de crédit' },
  ];

  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    amount_type: new FormControl<AmountType>('percent', { nonNullable: true }),
    /** Odoo's « Actif »: the tax's state, through its commands (never in the form sent). */
    active: new FormControl(true, { nonNullable: true }),
    type_tax_use: new FormControl<TaxUse>('sale', { nonNullable: true }),
    tax_scope: new FormControl<TaxScope>('', { nonNullable: true }),
    amount: new FormControl('0', {
      nonNullable: true,
      validators: [Validators.required, decimalFormat(4, { signed: true })],
    }),
    fiscal_positions: new FormControl<readonly string[]>([], { nonNullable: true }),
    invoice_lines: new FormArray<LineForm>(defaultLines().map((line) => lineForm(line))),
    refund_lines: new FormArray<LineForm>(defaultLines().map((line) => lineForm(line))),
    invoice_label: new FormControl('', {
      nonNullable: true,
      validators: Validators.maxLength(100),
    }),
    description: new FormControl('', { nonNullable: true, validators: Validators.maxLength(255) }),
    heading: new FormControl('', { nonNullable: true, validators: Validators.maxLength(100) }),
    country: new FormControl(this.session.activeCompany()?.country ?? '', {
      nonNullable: true,
      validators: [
        Validators.required,
        inputFormat(/^[A-Za-z]{2}$/, 'Saisissez le code pays à 2 lettres (ex. GN).'),
      ],
    }),
    tax_category_code: new FormControl('', { nonNullable: true }),
    legal_notes: new FormControl('', { nonNullable: true }),
    price_include_override: new FormControl<PriceInclusion>('', { nonNullable: true }),
    include_base_amount: new FormControl(false, { nonNullable: true }),
  });

  /** What the server proposes: the company's « Groupes de taxes » and positions. */
  protected readonly headings = signal<readonly string[]>([]);
  protected readonly positions = signal<readonly string[]>([]);
  /** Grids already typed on this tax, proposed on the other lines. */
  protected readonly gridSuggestions = signal<readonly string[]>([]);

  protected readonly tax = signal<Tax | null>(null);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly invalidSubmit = signal(false);
  protected readonly ready = computed(() => this.isNew || this.tax() !== null);

  /** Any account of the chart (the server's search: code or name). */
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
    const names = (list: readonly NamedRecord[]) => list.map((item) => item.name);
    this.api
      .headings()
      .pipe(catchError(() => of([] as NamedRecord[])))
      .subscribe((list) => this.headings.set(names(list)));
    this.api
      .fiscalPositions()
      .pipe(catchError(() => of([] as NamedRecord[])))
      .subscribe((list) => this.positions.set(names(list)));
    this.form.valueChanges.subscribe(() => this.gridSuggestions.set(this.typedGrids()));
    if (this.id) {
      this.api.tax(this.id).subscribe({
        next: (tax) => this.fill(tax),
        error: (failure: unknown) => this.loadError.set(toUserError(failure, TAX_ERRORS)),
      });
    } else {
      afterNextRender(() => this.focus('name'), { injector: this.injector });
    }
  }

  protected lines(side: Side): FormArray<LineForm> {
    return this.form.controls[side];
  }

  /** Odoo's « Ajouter une ligne »: a tax line of 100 %. */
  protected addLine(side: Side): void {
    const lines = this.lines(side);
    lines.push(
      lineForm({ repartition_type: 'tax', factor_percent: '100', account_code: '', grids: [] }),
    );
    lines.markAsDirty();
  }

  protected removeLine(side: Side, index: number): void {
    const lines = this.lines(side);
    lines.removeAt(index);
    lines.markAsDirty();
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
    const tax = this.tax();
    if (tax && !this.form.dirty) {
      this.toast.info('Aucune modification à enregistrer.');
      await this.router.navigate(['..'], { relativeTo: this.route });
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
      if (tax) {
        this.toast.success('Modifications enregistrées.');
        await this.router.navigate(['..'], { relativeTo: this.route });
      } else {
        this.toast.success(`Taxe « ${saved.name} » créée.`);
        await this.router.navigate(['..', saved.public_id], { relativeTo: this.route });
      }
    } catch (failure) {
      this.showFailure(toApiError(failure), failure);
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    void this.router.navigate(['..'], { relativeTo: this.route });
  }

  /** The whole form (the server compares: an unchanged computation keeps the tax's rule). */
  private write(): TaxWrite {
    const value = this.form.getRawValue();
    return {
      name: value.name.trim(),
      country: value.country.trim().toUpperCase(),
      type_tax_use: value.type_tax_use,
      tax_scope: value.tax_scope,
      amount_type: value.amount_type,
      amount: normalizeDecimalInput(value.amount) ?? value.amount,
      price_include_override: value.price_include_override,
      include_base_amount: value.include_base_amount,
      description: value.description.trim(),
      invoice_label: value.invoice_label.trim(),
      heading: value.heading.trim(),
      fiscal_positions: value.fiscal_positions,
      tax_category_code: value.tax_category_code,
      legal_notes: value.legal_notes.trim(),
      invoice_lines: this.lineValues('invoice_lines'),
      refund_lines: this.lineValues('refund_lines'),
    };
  }

  private lineValues(side: Side): RepartitionLine[] {
    return this.lines(side)
      .getRawValue()
      .map((line) => ({
        repartition_type: line.repartition_type,
        factor_percent:
          line.repartition_type === 'base'
            ? '100'
            : (normalizeDecimalInput(line.factor_percent) ?? line.factor_percent),
        account_code: line.account?.id ?? '',
        grids: line.grids,
      }));
  }

  private typedGrids(): readonly string[] {
    const all = (['invoice_lines', 'refund_lines'] as const).flatMap((side) =>
      this.lines(side)
        .getRawValue()
        .flatMap((line) => line.grids),
    );
    return [...new Set(all)];
  }

  private fill(tax: Tax): void {
    this.tax.set(tax);
    this.breadcrumbs.nameCurrent(tax.name, 1);
    this.form.patchValue({
      name: tax.name,
      amount_type: tax.amount_type,
      active: tax.status === 'active',
      type_tax_use: tax.type_tax_use,
      tax_scope: tax.tax_scope,
      amount: tax.amount.replace('.', ','),
      fiscal_positions: tax.fiscal_positions,
      invoice_label: tax.invoice_label,
      description: tax.description,
      heading: tax.heading,
      country: tax.country,
      tax_category_code: tax.tax_category_code,
      legal_notes: tax.legal_notes,
      price_include_override: tax.price_include_override,
      include_base_amount: tax.include_base_amount,
    });
    this.setLines('invoice_lines', tax.invoice_lines);
    this.setLines('refund_lines', tax.refund_lines);
    this.form.markAsPristine();
    afterNextRender(() => this.focus('name'), { injector: this.injector });
  }

  /** The lines of the server (an existing tax without lines shows Odoo's default ones). */
  private setLines(side: Side, lines: readonly RepartitionLine[]): void {
    const array = this.lines(side);
    array.clear({ emitEvent: false });
    for (const line of lines.length > 0 ? lines : defaultLines()) {
      array.push(lineForm(line), { emitEvent: false });
    }
    array.updateValueAndValidity();
  }

  private showFailure(error: ApiError, failure: unknown): void {
    if (error.kind === 'unauthenticated') {
      return;
    }
    const problem = repartitionProblem(failure);
    if (problem) {
      this.tab.set('definition');
      this.error.set({ ...toUserError(error, TAX_ERRORS), message: problem });
      return;
    }
    const fields: Record<string, string> = { ...serverFieldErrors(error) };
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
    if (!first) {
      return;
    }
    if (first[0] === 'invoice_lines' || first[0] === 'refund_lines') {
      this.tab.set('definition');
      return;
    }
    if (ADVANCED_FIELDS.includes(first[0])) {
      this.tab.set('advanced');
      afterNextRender(() => this.focus(first[0]), { injector: this.injector });
      return;
    }
    this.focus(first[0]);
  }

  private focus(name: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(`[formControlName="${name}"]`)?.focus();
  }
}
