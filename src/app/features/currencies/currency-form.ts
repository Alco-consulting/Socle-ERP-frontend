import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, startWith } from 'rxjs';

import { serverFieldErrors } from '../../core/errors/field-errors';
import { UserError, toUserError } from '../../core/errors/user-error';
import { ApiError, toApiError } from '../../core/http/api-error';
import { requestState } from '../../core/http/request-state';
import { BreadcrumbService } from '../../core/navigation/route-trail';
import { UnsavedChangesService } from '../../core/navigation/unsaved-changes';
import { SessionStore } from '../../core/session/session.store';
import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { decimalFormat, inputFormat } from '../../shared/forms/validators';
import { AlcoCell, AlcoTable, TableColumn } from '../../shared/tables/table';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoConfirmService } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoEmptyState } from '../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../shared/ui/pagination/pagination';
import { AlcoTabPanel, AlcoTabs, TabItem } from '../../shared/ui/tabs/tabs';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { localToday } from '../../shared/utils/dates';
import { isZeroDecimal, normalizeDecimalInput } from '../../shared/utils/decimal';
import {
  CURRENCY_ERRORS,
  SYMBOL_POSITIONS,
  dayText,
  inverseRateText,
  rateText,
} from './currencies-presentation';
import { CurrenciesApi, RATE_PAGE_SIZE } from './data-access/currencies-api';
import {
  Currency,
  CurrencyRate,
  CurrencyWrite,
  SymbolPosition,
} from './data-access/currencies-models';

const LIST = '/app/comptabilite/configuration/devises';
/** ISO 4217 has 0 to 4 decimal places; the catalogue accepts up to 6. */
const DECIMAL_PLACES = [0, 1, 2, 3, 4, 5, 6] as const;
/** A rate keeps 12 decimals (the server's precision). */
const RATE_DECIMALS = 12;

/** Business refusals that belong to one field (by their stable code). */
const FIELD_OF_CODE: Readonly<Record<string, [string, string]>> = {
  reference_currency_in_use: ['active', 'C’est la devise de la société : elle reste active.'],
};

/** A rate is strictly positive (1 USD = 0 GNF means nothing). */
function positiveRate(control: AbstractControl<string>): ValidationErrors | null {
  const value = normalizeDecimalInput(control.value ?? '');
  return value !== null && isZeroDecimal(value)
    ? { format: 'Le taux doit être supérieur à zéro.' }
    : null;
}

/**
 * A currency on one page, as Odoo shows it: Devise, Nom, Actif | Symbole, Unité monétaire,
 * Sous-unité monétaire, Position du symbole; then the « Taux » tab of the active company:
 * Date, « Unité par GNF » and « GNF par unité », « Ajouter une ligne ». The catalogue is
 * shared: changing it needs the global `currencies.create` / `currencies.update`; the rates
 * are the company's (`currencies.manage_rates`), recorded at once, never changed — a wrong
 * one is withdrawn, then entered again. The code and the decimal places are fixed at creation.
 */
@Component({
  selector: 'alco-currency-form',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoButton,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
    AlcoPagination,
    AlcoTabPanel,
    AlcoTabs,
    AlcoTable,
  ],
  templateUrl: './currency-form.html',
  styleUrls: ['../accounting/accounting-sheet.scss', './currency-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CurrencyFormPage {
  private readonly api = inject(CurrenciesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AlcoToastService);
  private readonly confirm = inject(AlcoConfirmService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly session = inject(SessionStore);

  protected readonly id = this.route.snapshot.paramMap.get('id');
  protected readonly isNew = this.id === null;
  protected readonly list = LIST;
  protected readonly positions = SYMBOL_POSITIONS;
  protected readonly decimalPlaces = DECIMAL_PLACES;
  protected readonly ratePageSize = RATE_PAGE_SIZE;
  /** The catalogue is global: `currencies.create` / `currencies.update`, else read only. */
  protected readonly canSave = this.session.can(
    this.isNew ? 'currencies.create' : 'currencies.update',
  );
  protected readonly canManageRates = this.session.can('currencies.manage_rates');
  /** The company's currency (« GNF »): the rates are « GNF par unité ». */
  protected readonly reference = this.session.activeCompany()?.currency ?? '';

  protected readonly form = new FormGroup({
    code: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        inputFormat(/^[A-Za-z]{3}$/, 'Trois lettres : le code ISO 4217 (ex. USD).'),
      ],
    }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    decimal_places: new FormControl(2, { nonNullable: true }),
    /** « Actif »: the catalogue's status. */
    active: new FormControl(true, { nonNullable: true }),
    symbol: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(8)] }),
    unit_label: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(50)],
    }),
    subunit_label: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(50)],
    }),
    position: new FormControl<SymbolPosition>('after', { nonNullable: true }),
  });

  protected readonly currency = signal<Currency | null>(null);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly invalidSubmit = signal(false);
  protected readonly ready = computed(() => this.isNew || this.currency() !== null);
  protected readonly title = computed(() => this.currency()?.code ?? 'Nouvelle devise');
  protected readonly isReference = computed(() => this.currency()?.code === this.reference);

  // ---- « Taux » ---------------------------------------------------------------------------
  protected readonly tab = signal('rates');
  protected readonly ratePage = signal(1);
  protected readonly rates = requestState(
    () => this.api.rates(untracked(this.currency)?.code ?? '', untracked(this.ratePage)),
    { immediate: false },
  );
  protected readonly rateRows = computed(() => this.rates.value()?.results ?? []);
  protected readonly ratesFailure = computed(() => {
    const error = this.rates.error();
    return error ? toUserError(error, CURRENCY_ERRORS) : null;
  });
  protected readonly tabs = computed<readonly TabItem[]>(() => [
    { id: 'rates', label: 'Taux', count: this.rates.value()?.count },
  ]);
  protected readonly rateColumns: readonly TableColumn[] = [
    { key: 'rate_date', label: 'Date', width: '8rem' },
    { key: 'inverse', label: `Unité par ${this.reference}`, numeric: true, hideBelow: 'tablet' },
    { key: 'rate', label: `${this.reference} par unité`, numeric: true },
    { key: 'source', label: 'Source', hideBelow: 'tablet' },
    { key: 'actions', label: 'Actions', width: '7rem' },
  ];
  protected readonly rateId = (rate: CurrencyRate) => rate.public_id;
  protected readonly rateLabel = (rate: CurrencyRate) => `Taux du ${rate.rate_date}`;
  protected readonly rateText = rateText;
  protected readonly inverseText = inverseRateText;
  protected readonly dayText = dayText;

  /** « Ajouter une ligne »: one new rate, recorded at once (rates are never edited). */
  protected readonly adding = signal(false);
  protected readonly recording = signal(false);
  protected readonly withdrawing = signal<string | null>(null);
  protected readonly rateError = signal<UserError | null>(null);
  protected readonly rateForm = new FormGroup({
    rate_date: new FormControl(localToday(), {
      nonNullable: true,
      validators: [Validators.required],
    }),
    rate: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, decimalFormat(RATE_DECIMALS), positiveRate],
    }),
    source: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(100)] }),
  });
  /** « Unité par GNF » of the rate being typed, shown as the user types it. */
  private readonly typedRate = toSignal(
    this.rateForm.controls.rate.valueChanges.pipe(startWith(this.rateForm.controls.rate.value)),
    { requireSync: true },
  );
  protected readonly typedInverse = computed(() => {
    const rate = normalizeDecimalInput(this.typedRate());
    return rate ? inverseRateText(rate) : '';
  });

  constructor() {
    inject(UnsavedChangesService).track(() => this.form.dirty || this.rateForm.dirty);
    if (!this.canSave) {
      this.form.disable();
    }
    if (this.id) {
      this.form.controls.code.disable();
      this.form.controls.decimal_places.disable();
      this.api.currency(this.id).subscribe({
        next: (currency) => this.fill(currency),
        error: (failure: unknown) => this.loadError.set(toUserError(failure, CURRENCY_ERRORS)),
      });
    } else {
      afterNextRender(() => this.focus('code'), { injector: this.injector });
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
    const currency = this.currency();
    if (currency && !this.form.dirty) {
      this.toast.info('Aucune modification à enregistrer.');
      return;
    }
    this.saving.set(true);
    try {
      const value = this.form.getRawValue();
      if (currency) {
        const status = value.active ? 'active' : 'inactive';
        const saved = await firstValueFrom(
          this.api.updateCurrency(currency.public_id, {
            ...this.write(),
            ...(status !== currency.status ? { status } : {}),
          }),
        );
        this.fill(saved);
        this.toast.success('Modifications enregistrées.');
        return;
      }
      let saved = await firstValueFrom(
        this.api.createCurrency({
          ...this.write(),
          code: value.code.trim().toUpperCase(),
          decimal_places: Number(value.decimal_places),
        }),
      );
      if (!value.active) {
        saved = await firstValueFrom(this.api.setCurrencyActive(saved.public_id, false));
      }
      this.form.markAsPristine();
      this.toast.success(`Devise ${saved.code} créée.`);
      await this.router.navigate([LIST, saved.public_id], { replaceUrl: true });
    } catch (failure) {
      this.showFailure(toApiError(failure));
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    void this.router.navigateByUrl(LIST);
  }

  // ---- « Taux » ---------------------------------------------------------------------------

  protected setRatePage(page: number): void {
    this.ratePage.set(page);
    this.rates.reload();
  }

  protected addLine(): void {
    this.rateError.set(null);
    this.rateForm.reset({ rate_date: localToday(), rate: '', source: '' });
    this.adding.set(true);
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('#new-rate-value')?.focus(),
      { injector: this.injector },
    );
  }

  protected cancelLine(): void {
    this.rateForm.reset({ rate_date: localToday(), rate: '', source: '' });
    this.rateError.set(null);
    this.adding.set(false);
  }

  /** The new rate, recorded at once: « 1 USD = 8 650 GNF ». */
  protected async recordRate(): Promise<void> {
    const currency = this.currency();
    if (!currency || this.recording()) {
      return;
    }
    this.rateError.set(null);
    this.rateForm.markAllAsTouched();
    if (this.rateForm.invalid) {
      return;
    }
    const value = this.rateForm.getRawValue();
    this.recording.set(true);
    try {
      const saved = await firstValueFrom(
        this.api.recordRate({
          currency: currency.code,
          rate: normalizeDecimalInput(value.rate) ?? value.rate,
          rate_date: value.rate_date,
          source: value.source.trim(),
        }),
      );
      this.toast.success(
        `Taux enregistré : 1 ${saved.currency} = ${rateText(saved.rate)} ${saved.quote_currency}.`,
      );
      this.cancelLine();
      this.ratePage.set(1);
      this.rates.reload();
    } catch (failure) {
      const error = toApiError(failure);
      const fields = serverFieldErrors(error);
      const names = Object.keys(fields).filter((name) => this.rateForm.get(name));
      for (const name of names) {
        this.rateForm.get(name)?.setErrors({ server: fields[name] });
      }
      if (names.length === 0 && error.kind !== 'unauthenticated') {
        this.rateError.set(toUserError(error, CURRENCY_ERRORS));
      }
    } finally {
      this.recording.set(false);
    }
  }

  /** A wrong rate: withdrawn (kept in the history), then entered again. */
  protected async withdraw(rate: CurrencyRate): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: 'Retirer ce taux ?',
      message:
        `Le taux du ${dayText(rate.rate_date)} ` +
        `(1 ${rate.currency} = ${rateText(rate.rate)} ${rate.quote_currency}) ne sera plus ` +
        'utilisé. Il reste dans l’historique ; saisissez ensuite le bon taux si besoin.',
      confirmLabel: 'Retirer le taux',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    this.withdrawing.set(rate.public_id);
    try {
      await firstValueFrom(this.api.withdrawRate(rate.public_id));
      this.toast.success('Taux retiré.');
      this.rates.reload();
    } catch (failure) {
      this.toast.error(toUserError(failure, CURRENCY_ERRORS).title);
    } finally {
      this.withdrawing.set(null);
    }
  }

  private write(): CurrencyWrite {
    const value = this.form.getRawValue();
    return {
      name: value.name.trim(),
      symbol: value.symbol.trim(),
      position: value.position,
      unit_label: value.unit_label.trim(),
      subunit_label: value.subunit_label.trim(),
    };
  }

  private fill(currency: Currency): void {
    const first = this.currency() === null;
    this.currency.set(currency);
    this.breadcrumbs.nameCurrent(currency.code);
    this.form.setValue({
      code: currency.code,
      name: currency.name,
      decimal_places: currency.decimal_places,
      active: currency.status === 'active',
      symbol: currency.symbol,
      unit_label: currency.unit_label,
      subunit_label: currency.subunit_label,
      position: currency.position,
    });
    this.form.markAsPristine();
    if (first && currency.code !== this.reference) {
      this.rates.reload();
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
    this.error.set(toUserError(error, CURRENCY_ERRORS));
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
