import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, firstValueFrom, map, merge, of } from 'rxjs';

import { UserError, toUserError } from '../../core/errors/user-error';
import { UnsavedChangesService } from '../../core/navigation/unsaved-changes';
import { SessionStore } from '../../core/session/session.store';
import {
  AlcoAutocomplete,
  AutocompleteOption,
  AutocompleteSearch,
} from '../../shared/forms/autocomplete';
import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { localToday } from '../../shared/utils/dates';
import { normalizeDecimalInput, trimDecimalZeros } from '../../shared/utils/decimal';
import { EntriesApi } from '../accounting/data-access/entries-api';
import { PartnersApi } from '../partners/data-access/partners-api';
import { LoansApi } from './data-access/loans-api';
import { Frequency, Loan, LoanWrite, RepaymentMethod } from './data-access/loans-models';
import {
  FREQUENCIES,
  FREQUENCY_MONTHS,
  LOAN_ERRORS,
  METHODS,
  addMonths,
} from './loans-presentation';

const FEE_LABEL = 'Frais de dossier';

/** A new loan, or a draft one: its terms; its schedule shows on its page before « Activer ». */
@Component({
  selector: 'alco-loan-form',
  imports: [
    ReactiveFormsModule,
    AlcoAutocomplete,
    AlcoButton,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
  ],
  templateUrl: './loan-form.html',
  styleUrls: ['../accounting/accounting-sheet.scss', './loans-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoanFormPage {
  private readonly api = inject(LoansApi);
  private readonly entries = inject(EntriesApi);
  private readonly partners = inject(PartnersApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AlcoToastService);
  private readonly session = inject(SessionStore);
  private readonly loanId = this.route.snapshot.paramMap.get('id');

  protected readonly isNew = this.loanId === null;
  protected readonly loan = signal<Loan | null>(null);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly ready = computed(() => this.isNew || this.loan() !== null);
  protected readonly title = computed(() => this.loan()?.name ?? 'Nouvel emprunt');
  protected readonly frequencies = FREQUENCIES;
  protected readonly methods = METHODS;
  protected readonly types = toSignal(
    this.api.types('active').pipe(
      map((page) => page.results),
      catchError(() => of([])),
    ),
    { initialValue: [] },
  );

  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(255)],
    }),
    loan_type: new FormControl('', { nonNullable: true, validators: Validators.required }),
    partner: new FormControl<AutocompleteOption | null>(null, Validators.required),
    principal_amount: new FormControl('', { nonNullable: true, validators: Validators.required }),
    start_date: new FormControl(localToday(), {
      nonNullable: true,
      validators: Validators.required,
    }),
    first_payment_date: new FormControl(addMonths(localToday(), 1), {
      nonNullable: true,
      validators: Validators.required,
    }),
    interest_rate: new FormControl('', { nonNullable: true, validators: Validators.required }),
    installments: new FormControl<number | null>(12, {
      validators: [Validators.required, Validators.min(1), Validators.max(600)],
    }),
    payment_frequency: new FormControl<Frequency>('monthly', { nonNullable: true }),
    repayment_method: new FormControl<RepaymentMethod>('annuity', { nonNullable: true }),
    fee: new FormControl('', { nonNullable: true }),
    reference: new FormControl('', { nonNullable: true, validators: Validators.maxLength(64) }),
  });

  /** The company's partners, searched by code or name: the lender (a bank, an associate…). */
  protected readonly searchPartners: AutocompleteSearch = (term) =>
    this.entries.partners(term).pipe(
      map((found) =>
        found.map((partner) => ({
          id: partner.public_id,
          label: partner.name,
          detail: partner.code,
        })),
      ),
    );

  constructor() {
    inject(UnsavedChangesService).track(() => this.form.dirty && !this.saving());
    if (this.loanId) {
      this.api.loan(this.loanId).subscribe({
        next: (loan) => this.fill(loan),
        error: (failure: unknown) => this.loadError.set(toUserError(failure, LOAN_ERRORS)),
      });
    }
    // The first installment one period after the funds, unless chosen otherwise.
    const controls = this.form.controls;
    merge(controls.start_date.valueChanges, controls.payment_frequency.valueChanges)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (!controls.first_payment_date.dirty && controls.start_date.value) {
          controls.first_payment_date.setValue(
            addMonths(
              controls.start_date.value,
              FREQUENCY_MONTHS[controls.payment_frequency.value],
            ),
          );
        }
      });
  }

  protected async save(): Promise<void> {
    if (this.saving()) {
      return;
    }
    this.error.set(null);
    this.form.markAllAsTouched();
    const controls = this.form.controls;
    const principal = normalizeDecimalInput(controls.principal_amount.value);
    const rate = normalizeDecimalInput(controls.interest_rate.value);
    const fee = controls.fee.value.trim() ? normalizeDecimalInput(controls.fee.value) : '';
    if (principal === null) {
      controls.principal_amount.setErrors({ server: 'Saisissez un montant (ex. 50000000).' });
    }
    if (rate === null) {
      controls.interest_rate.setErrors({ server: 'Saisissez un taux annuel (ex. 12 ou 12,5).' });
    }
    if (fee === null) {
      controls.fee.setErrors({ server: 'Saisissez un montant, ou laissez vide.' });
    }
    if (this.form.invalid || principal === null || rate === null || fee === null) {
      return;
    }
    this.saving.set(true);
    try {
      const payload = this.payload(principal, rate, fee);
      const saved = this.loanId
        ? await firstValueFrom(this.api.updateLoan(this.loanId, payload))
        : await firstValueFrom(this.api.createLoan(payload));
      this.form.markAsPristine();
      this.toast.success('Emprunt enregistré.');
      await this.router.navigate(this.isNew ? ['..', saved.public_id] : ['..'], {
        relativeTo: this.route,
      });
    } catch (failure) {
      this.error.set(toUserError(failure, LOAN_ERRORS));
    } finally {
      this.saving.set(false);
    }
  }

  private payload(principal: string, rate: string, fee: string): LoanWrite {
    const value = this.form.getRawValue();
    return {
      loan_type: value.loan_type,
      partner: value.partner?.id ?? '',
      currency: this.session.activeCompany()?.currency ?? '',
      name: value.name.trim(),
      reference: value.reference.trim(),
      principal_amount: principal,
      start_date: value.start_date,
      first_payment_date: value.first_payment_date,
      interest_rate: rate,
      rate_type: 'fixed',
      payment_frequency: value.payment_frequency,
      repayment_method: value.repayment_method,
      installments: Number(value.installments),
      day_count: 'periodic',
      rounding: 'half_up',
      fees: fee ? [{ kind: 'initial', label: FEE_LABEL, amount: fee }] : [],
    };
  }

  private fill(loan: Loan): void {
    this.loan.set(loan);
    const fee = loan.fees.find((item) => item.kind === 'initial');
    this.form.reset(
      {
        name: loan.name,
        loan_type: loan.loan_type.public_id,
        partner: { id: loan.partner.public_id, label: loan.partner.code },
        principal_amount: trimDecimalZeros(loan.principal_amount, 0),
        start_date: loan.start_date,
        first_payment_date: loan.first_payment_date,
        interest_rate: trimDecimalZeros(loan.interest_rate, 0),
        installments: loan.installments,
        payment_frequency: loan.payment_frequency,
        repayment_method: loan.repayment_method,
        fee: fee ? trimDecimalZeros(fee.amount, 0) : '',
        reference: loan.reference,
      },
      { emitEvent: false },
    );
    this.form.controls.first_payment_date.markAsDirty();
    // The lender by its name, which the loan does not carry.
    this.partners.get(loan.partner.public_id).subscribe({
      next: (partner) =>
        this.form.controls.partner.setValue(
          { id: partner.public_id, label: partner.name, detail: partner.code },
          { emitEvent: false },
        ),
      error: () => undefined,
    });
  }
}
