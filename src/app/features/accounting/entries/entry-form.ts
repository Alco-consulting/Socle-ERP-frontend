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
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, firstValueFrom, map, of, startWith } from 'rxjs';

import { serverFieldErrors } from '../../../core/errors/field-errors';
import { UserError, toUserError } from '../../../core/errors/user-error';
import { ApiError, toApiError } from '../../../core/http/api-error';
import { BreadcrumbService } from '../../../core/navigation/route-trail';
import { UnsavedChangesService } from '../../../core/navigation/unsaved-changes';
import { SessionStore } from '../../../core/session/session.store';
import {
  AlcoAutocomplete,
  AutocompleteOption,
  AutocompleteSearch,
} from '../../../shared/forms/autocomplete';
import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { decimalFormat } from '../../../shared/forms/validators';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoIcon } from '../../../shared/ui/icon/icon';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import {
  isZeroDecimal,
  normalizeDecimalInput,
  subtractDecimals,
  sumDecimals,
} from '../../../shared/utils/decimal';
import { CurrencyOption } from '../../partners/data-access/partner-models';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { Journal } from '../data-access/accounting-models';
import { AccountingApi } from '../data-access/accounting-api';
import { EntriesApi } from '../data-access/entries-api';
import {
  Entry,
  EntryChanges,
  EntryLine,
  EntryLineWrite,
  EntryWrite,
  RoundingMode,
  TaxOption,
} from '../data-access/entry-models';
import { ENTRY_ERRORS, ENTRY_FIELD_MESSAGES, ROUNDING_MODES, isoDay } from './entry-presentation';

/** The API keeps 6 decimals for an amount; the currency's precision is the server's rule. */
const AMOUNT_DECIMALS = 6;

type LineForm = FormGroup<{
  account: FormControl<AutocompleteOption | null>;
  label: FormControl<string>;
  debit: FormControl<string>;
  credit: FormControl<string>;
  partner: FormControl<AutocompleteOption | null>;
  tax: FormControl<string>;
  tax_base_amount: FormControl<string>;
}>;
type LineField = keyof LineForm['controls'];

/** Header fields whose change must be sent with the lines (`accounting_entry_lines_required`). */
const WITH_LINES = ['journal', 'entry_date', 'currency', 'rounding'] as const;
const HEADER_FIELDS = [
  'journal',
  'entry_date',
  'description',
  'document_reference',
  'document_date',
  'currency',
  'rounding',
] as const;
const LINE_FIELDS: readonly LineField[] = [
  'account',
  'label',
  'debit',
  'credit',
  'partner',
  'tax',
  'tax_base_amount',
];

/** Business refusals that name the header field at fault. */
const HEADER_FIELD_OF_CODE: Readonly<Record<string, (typeof HEADER_FIELDS)[number]>> = {
  accounting_journal_inactive: 'journal',
  accounting_period_closed: 'entry_date',
  accounting_period_not_found: 'entry_date',
  accounting_fiscal_year_closed: 'entry_date',
  currency_inactive: 'currency',
  accounting_rounding_required: 'rounding',
};

/** « 1 150 000 » → "1150000"; empty stays empty (the server reads a missing side as zero). */
function amount(value: string): string | null {
  return value.trim() === '' ? null : normalizeDecimalInput(value);
}

/** Two amounts written differently but equal (« 150000 » and "150000.000000"). */
function sameAmount(a: string | null, b: unknown): boolean {
  return a !== null && typeof b === 'string' && isZeroDecimal(subtractDecimals(a, b));
}

function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** An amount of the API shown in the field: its trailing zeros dropped (exact). */
function shownAmount(value: string | null): string {
  if (!value || isZeroDecimal(value)) {
    return '';
  }
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

/**
 * Creation (`…/ecritures/nouvelle`) and modification (`…/ecritures/:id/modifier`) of a draft
 * with the fields of `AccountingEntryWriteRequest`. The lines are an editable grid; the
 * totals are a reading aid (exact decimal strings), never a decision: balance, periods,
 * postability, rates and taxes are checked by the server, whose refusals go under the field
 * or the line at fault. A modification sends the fields changed only — with the lines when
 * the journal, the date, the currency, the rounding or a line changed — never the id, the
 * state, the number, the company or the author.
 */
@Component({
  selector: 'alco-entry-form',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoAmountPipe,
    AlcoAutocomplete,
    AlcoButton,
    AlcoErrorState,
    AlcoFormField,
    AlcoIcon,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
  ],
  templateUrl: './entry-form.html',
  styleUrls: ['../accounting-sheet.scss', './entry-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntryFormPage {
  private readonly api = inject(EntriesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AlcoToastService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly session = inject(SessionStore);

  protected readonly id = this.route.snapshot.paramMap.get('id');
  protected readonly isNew = this.id === null;
  protected readonly roundings = ROUNDING_MODES;
  protected readonly canSeeTaxes = this.session.can('taxes.read');

  protected readonly form = new FormGroup({
    journal: new FormControl('', { nonNullable: true, validators: Validators.required }),
    entry_date: new FormControl(this.isNew ? today() : '', {
      nonNullable: true,
      validators: Validators.required,
    }),
    description: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(255)],
    }),
    document_reference: new FormControl('', {
      nonNullable: true,
      validators: Validators.maxLength(64),
    }),
    document_date: new FormControl('', { nonNullable: true }),
    currency: new FormControl('', { nonNullable: true }),
    rounding: new FormControl('', { nonNullable: true }),
    lines: new FormArray<LineForm>(this.isNew ? [this.lineForm(), this.lineForm()] : []),
  });

  protected readonly entry = signal<Entry | null>(null);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly invalidSubmit = signal(false);
  protected readonly advancedOpen = signal(false);
  protected readonly ready = computed(() => this.isNew || this.entry() !== null);
  /** The server refuses to modify it: said, no form. */
  protected readonly notEditable = computed(() => {
    const entry = this.entry();
    return (
      !!entry &&
      (entry.status !== 'draft' || entry.origin !== 'manual' || entry.kind === 'reversal')
    );
  });
  /**
   * Lines with an analytic distribution: this screen does not write analytics, so their lines
   * (and what needs them: journal, date, currency, rounding) stay as they are.
   */
  protected readonly linesLocked = signal(false);

  // ---- Options from the API ---------------------------------------------------------------
  private readonly accounting = inject(AccountingApi);
  protected readonly journals = signal<readonly Pick<Journal, 'public_id' | 'code' | 'name'>[]>([]);
  protected readonly currencies = signal<readonly CurrencyOption[]>([]);
  protected readonly taxes = signal<readonly TaxOption[]>([]);
  protected readonly searchAccounts: AutocompleteSearch = (term) =>
    this.api.postableAccounts(term).pipe(
      map((accounts) =>
        accounts.map((account) => ({
          id: account.public_id,
          label: account.code,
          detail: account.name,
        })),
      ),
    );
  protected readonly searchPartners: AutocompleteSearch = (term) =>
    this.api.partners(term).pipe(
      map((partners) =>
        partners.map((partner) => ({
          id: partner.public_id,
          label: partner.code,
          detail: partner.name,
        })),
      ),
    );

  // ---- Reading aid: totals of what is typed (exact decimals) --------------------------------
  private readonly value = toSignal(this.form.valueChanges.pipe(startWith(null)));
  protected readonly totals = computed(() => {
    this.value();
    const lines = this.lines.getRawValue();
    const side = (name: 'debit' | 'credit') => lines.map((line) => amount(line[name]) ?? '0');
    const debit = sumDecimals(side('debit'));
    const credit = sumDecimals(side('credit'));
    const gap = subtractDecimals(debit, credit);
    return {
      debit,
      credit,
      gap: gap.replace('-', ''),
      balanced: isZeroDecimal(gap),
      empty: isZeroDecimal(debit) && isZeroDecimal(credit),
    };
  });
  protected readonly currencyShown = computed(() => {
    this.value();
    return this.form.controls.currency.value || this.entry()?.currency || '';
  });
  protected readonly decimals = computed(
    () => this.currencies().find((item) => item.code === this.currencyShown())?.decimal_places ?? 0,
  );

  constructor() {
    inject(UnsavedChangesService).track(() => this.form.dirty);
    this.accounting
      .journals({ status: 'active' })
      .pipe(
        map((page) => page.results),
        catchError(() => of([] as Journal[])),
      )
      .subscribe((list) => this.addJournals(list));
    inject(PartnersApi)
      .currencies()
      .pipe(
        map((page) => page.results),
        catchError(() => of([] as CurrencyOption[])),
      )
      .subscribe((list) => this.currencies.set(list));
    if (this.canSeeTaxes) {
      this.api
        .taxes()
        .pipe(catchError(() => of([] as TaxOption[])))
        .subscribe((list) => this.taxes.set(list));
    }
    if (this.id) {
      this.api.get(this.id).subscribe({
        next: (entry) => this.fill(entry),
        error: (failure: unknown) => this.loadError.set(toUserError(failure, ENTRY_ERRORS)),
      });
    } else {
      afterNextRender(() => this.focus('journal'), { injector: this.injector });
    }
  }

  protected get lines(): FormArray<LineForm> {
    return this.form.controls.lines;
  }

  protected currencyLabel(currency: CurrencyOption): string {
    return `${currency.code} — ${currency.name}`;
  }

  protected taxLabel(tax: TaxOption): string {
    return `${tax.code} — ${tax.name}`;
  }

  protected onToggle(event: Event): void {
    this.advancedOpen.set((event.target as HTMLDetailsElement).open);
  }

  protected addLine(): void {
    this.lines.push(this.lineForm());
    this.lines.markAsDirty();
    afterNextRender(() => this.focusLine(this.lines.length - 1, 'account'), {
      injector: this.injector,
    });
  }

  protected removeLine(index: number): void {
    this.lines.removeAt(index);
    this.lines.markAsDirty();
  }

  protected async save(): Promise<void> {
    if (this.saving()) {
      return; // never sent twice
    }
    this.error.set(null);
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.invalidSubmit.set(true);
      this.focusFirstInvalid();
      return;
    }
    this.invalidSubmit.set(false);
    const entry = this.entry();
    if (entry && !this.form.dirty) {
      this.toast.info('Aucune modification à enregistrer.');
      await this.router.navigate(['..'], { relativeTo: this.route });
      return;
    }
    this.saving.set(true);
    try {
      const saved = await firstValueFrom(
        entry ? this.api.update(entry.public_id, this.changes()) : this.api.create(this.creation()),
      );
      this.form.markAsPristine();
      if (entry) {
        this.toast.success('Modifications enregistrées.');
        await this.router.navigate(['..'], { relativeTo: this.route });
      } else {
        this.toast.success('Écriture créée.');
        await this.router.navigate(['/app/comptabilite/ecritures', saved.public_id]);
      }
    } catch (failure) {
      this.showFailure(toApiError(failure));
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    void this.router.navigate(this.isNew ? ['/app/comptabilite/ecritures'] : ['..'], {
      relativeTo: this.route,
    });
  }

  // ---- What is sent ---------------------------------------------------------------------

  private creation(): EntryWrite {
    const value = this.form.getRawValue();
    return {
      journal: value.journal,
      entry_date: value.entry_date,
      description: value.description.trim(),
      ...(value.document_reference.trim()
        ? { document_reference: value.document_reference.trim() }
        : {}),
      ...(value.document_date ? { document_date: value.document_date } : {}),
      ...(value.currency ? { currency: value.currency } : {}),
      ...(value.rounding ? { rounding: value.rounding as RoundingMode } : {}),
      lines: this.lineWrites(),
    };
  }

  private changes(): EntryChanges {
    const value = this.form.getRawValue();
    const controls = this.form.controls;
    const changes: Record<string, unknown> = {};
    if (controls.description.dirty) {
      changes['description'] = value.description.trim();
    }
    if (controls.document_reference.dirty) {
      changes['document_reference'] = value.document_reference.trim();
    }
    if (controls.document_date.dirty) {
      changes['document_date'] = value.document_date || null;
    }
    const withLines = this.lines.dirty || WITH_LINES.some((name) => controls[name].dirty);
    if (withLines) {
      if (controls.journal.dirty) {
        changes['journal'] = value.journal;
      }
      if (controls.entry_date.dirty) {
        changes['entry_date'] = value.entry_date;
      }
      if (controls.currency.dirty && value.currency) {
        changes['currency'] = value.currency;
      }
      if (controls.rounding.dirty && value.rounding) {
        changes['rounding'] = value.rounding;
      }
      changes['lines'] = this.lineWrites();
    }
    return changes as EntryChanges;
  }

  private lineWrites(): EntryLineWrite[] {
    return this.lines.getRawValue().map((line) => {
      const write: Record<string, unknown> = { account: line.account?.id ?? '' };
      if (line.label.trim()) {
        write['label'] = line.label.trim();
      }
      const debit = amount(line.debit);
      const credit = amount(line.credit);
      if (debit !== null) {
        write['debit'] = debit;
      }
      if (credit !== null) {
        write['credit'] = credit;
      }
      if (line.partner) {
        write['partner'] = line.partner.id;
      }
      if (line.tax) {
        write['tax'] = line.tax;
        const base = amount(line.tax_base_amount);
        if (base !== null) {
          write['tax_base_amount'] = base;
        }
      }
      return write as unknown as EntryLineWrite;
    });
  }

  // ---- Loaded entry -------------------------------------------------------------------------

  private fill(entry: Entry): void {
    this.entry.set(entry);
    this.breadcrumbs.nameCurrent(
      entry.entry_number || `Brouillon du ${isoDay(entry.entry_date)}`,
      1,
    );
    this.addJournals([{ public_id: entry.journal.public_id, code: entry.journal.code, name: '' }]);
    this.lines.clear({ emitEvent: false });
    for (const line of entry.lines) {
      this.lines.push(this.lineForm(line), { emitEvent: false });
    }
    this.form.patchValue({
      journal: entry.journal.public_id,
      entry_date: entry.entry_date,
      description: entry.description,
      document_reference: entry.document_reference,
      document_date: entry.document_date ?? '',
      currency: entry.currency,
      rounding: entry.rounding,
    });
    const analytic = entry.lines.some((line) => line.analytic_allocation !== null);
    this.linesLocked.set(analytic);
    if (analytic) {
      this.lines.disable({ emitEvent: false });
      for (const name of WITH_LINES) {
        this.form.controls[name].disable({ emitEvent: false });
      }
    }
    this.advancedOpen.set(!!entry.rounding);
    this.form.markAsPristine();
    afterNextRender(() => this.focus('description'), { injector: this.injector });
  }

  private addJournals(list: readonly Pick<Journal, 'public_id' | 'code' | 'name'>[]): void {
    const known = new Map(this.journals().map((journal) => [journal.public_id, journal]));
    for (const journal of list) {
      if (!known.has(journal.public_id) || !known.get(journal.public_id)?.name) {
        known.set(journal.public_id, journal);
      }
    }
    this.journals.set([...known.values()].sort((a, b) => a.code.localeCompare(b.code)));
  }

  private lineForm(line?: EntryLine): LineForm {
    const decimal = decimalFormat(AMOUNT_DECIMALS);
    return new FormGroup({
      account: new FormControl<AutocompleteOption | null>(
        line ? { id: line.account.public_id, label: line.account.code } : null,
        Validators.required,
      ),
      label: new FormControl(line?.label ?? '', {
        nonNullable: true,
        validators: Validators.maxLength(255),
      }),
      debit: new FormControl(shownAmount(line?.debit ?? null), {
        nonNullable: true,
        validators: decimal,
      }),
      credit: new FormControl(shownAmount(line?.credit ?? null), {
        nonNullable: true,
        validators: decimal,
      }),
      partner: new FormControl<AutocompleteOption | null>(
        line?.partner ? { id: line.partner.public_id, label: line.partner.code } : null,
      ),
      tax: new FormControl(line?.tax?.public_id ?? '', { nonNullable: true }),
      tax_base_amount: new FormControl(shownAmount(line?.tax_base_amount ?? null), {
        nonNullable: true,
        validators: decimal,
      }),
    });
  }

  // ---- The server's refusals, under their field or line ------------------------------------

  private showFailure(error: ApiError): void {
    if (error.kind === 'unauthenticated') {
      return;
    }
    const marked: string[] = [];
    // Field errors of a `validation_error`, the lines' ones by their position.
    const fields = serverFieldErrors(error, ENTRY_FIELD_MESSAGES);
    for (const name of HEADER_FIELDS) {
      if (fields[name]) {
        this.form.controls[name].setErrors({ server: fields[name] });
        marked.push(name);
      }
    }
    const lineErrors = error.code === 'validation_error' ? this.lineFieldErrors(error) : [];
    for (const { index, field, message } of lineErrors) {
      this.lines.at(index)?.controls[field].setErrors({ server: message });
      marked.push(`line:${index}:${field}`);
    }
    // Business refusals that name what is at fault.
    const text = toUserError(error, ENTRY_ERRORS);
    const header = error.code ? HEADER_FIELD_OF_CODE[error.code] : undefined;
    if (header) {
      this.form.controls[header].setErrors({ server: text.title });
      marked.push(header);
      if (header === 'rounding') {
        this.advancedOpen.set(true);
      }
    }
    marked.push(...this.markLines(error, text.title));
    if (marked.length > 0) {
      this.invalidSubmit.set(true);
    }
    if (error.code !== 'validation_error' || marked.length === 0) {
      this.error.set(text);
    }
    afterNextRender(() => this.focusFirstInvalid(), { injector: this.injector });
  }

  /** `lines: [{}, { account: [{ message, code }] }]` (DRF list of line errors). */
  private lineFieldErrors(error: ApiError): { index: number; field: LineField; message: string }[] {
    const raw = (error.details as Record<string, unknown> | null)?.['lines'];
    if (!Array.isArray(raw)) {
      return [];
    }
    const result: { index: number; field: LineField; message: string }[] = [];
    raw.forEach((errors: unknown, index) => {
      if (!errors || typeof errors !== 'object' || Array.isArray(errors)) {
        return;
      }
      const lineError = new ApiError('bad-request', 400, 'validation_error', '', errors);
      const messages = serverFieldErrors(lineError, ENTRY_FIELD_MESSAGES);
      for (const field of LINE_FIELDS) {
        if (messages[field]) {
          result.push({ index, field, message: messages[field] });
        }
      }
    });
    return result;
  }

  /** The lines a business refusal names through its details (account code, amount…). */
  private markLines(error: ApiError, message: string): string[] {
    const details = (error.details ?? {}) as Record<string, unknown>;
    const marked: string[] = [];
    this.lines.controls.forEach((line, index) => {
      const value = line.getRawValue();
      const debit = amount(value.debit);
      const credit = amount(value.credit);
      let field: LineField | null = null;
      switch (error.code) {
        case 'accounting_account_inactive':
        case 'accounting_account_not_postable':
          field = value.account?.label === details['account'] ? 'account' : null;
          break;
        case 'tax_inactive':
          field =
            this.taxes().find((tax) => tax.public_id === value.tax)?.code === details['tax']
              ? 'tax'
              : null;
          break;
        case 'accounting_tax_base_invalid':
          field = sameAmount(amount(value.tax_base_amount), details['tax_base_amount'])
            ? 'tax_base_amount'
            : null;
          break;
        case 'accounting_line_one_side':
          field =
            debit && credit && !isZeroDecimal(debit) && !isZeroDecimal(credit) ? 'credit' : null;
          break;
        case 'accounting_precision_exceeded':
        case 'accounting_line_rounds_to_zero':
          field = sameAmount(debit, details['amount'])
            ? 'debit'
            : sameAmount(credit, details['amount'])
              ? 'credit'
              : null;
          break;
      }
      if (field) {
        line.controls[field].setErrors({ server: message });
        line.controls[field].markAsTouched();
        marked.push(`line:${index}:${field}`);
      }
    });
    return marked;
  }

  // ---- Focus ------------------------------------------------------------------------------

  private focusFirstInvalid(): void {
    const header = HEADER_FIELDS.find((name) => this.form.controls[name].invalid);
    if (header) {
      this.focus(header);
      return;
    }
    const index = this.lines.controls.findIndex((line) => line.invalid);
    if (index >= 0) {
      const field = LINE_FIELDS.find((name) => this.lines.at(index).controls[name].invalid);
      this.focusLine(index, field ?? 'account');
    }
  }

  private focus(name: string): void {
    this.focusIn(this.host.nativeElement, name);
  }

  private focusLine(index: number, field: LineField): void {
    const line = this.host.nativeElement.querySelector(`[data-line="${index}"]`);
    if (line) {
      this.focusIn(line, field);
    }
  }

  /** The control itself, or the text field inside a component (autocomplete). */
  private focusIn(scope: ParentNode, name: string): void {
    const control = scope.querySelector<HTMLElement>(`[formControlName="${name}"]`);
    (control?.querySelector<HTMLElement>('input') ?? control)?.focus();
  }
}
