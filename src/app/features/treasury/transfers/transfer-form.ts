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
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, firstValueFrom, map, of } from 'rxjs';

import { serverFieldErrors } from '../../../core/errors/field-errors';
import { UserError, toUserError } from '../../../core/errors/user-error';
import { ApiError, toApiError } from '../../../core/http/api-error';
import { UnsavedChangesService } from '../../../core/navigation/unsaved-changes';
import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { normalizeDecimalInput } from '../../../shared/utils/decimal';
import { RoundingMode, TransferWrite, TreasuryAccount } from '../data-access/reconciliation-models';
import { TreasuryApi } from '../data-access/treasury-api';
import { ROUNDING_MODES, TREASURY_ERRORS, TREASURY_FIELD_MESSAGES } from '../treasury-presentation';

/** Business refusals that belong to one field (by their stable code). */
const FIELD_OF_CODE: Readonly<Record<string, [string, string]>> = {
  treasury_transfer_same_account: [
    'destination_account',
    'Choisissez un compte différent du compte d’origine.',
  ],
  treasury_rounding_required: [
    'rounding',
    'Les deux comptes n’ont pas la même devise : choisissez un mode d’arrondi.',
  ],
  treasury_amount_invalid: [
    'amount',
    'Montant strictement positif, dans les décimales de la devise.',
  ],
};

/**
 * Creation of a transfer between two treasury accounts (`POST treasury/transfers/`,
 * `treasury.create`) with the fields of `TreasuryTransferWriteRequest`: a draft of two
 * operations, confirmed and posted from its record. Between two currencies the server
 * converts (Currencies) and fixes the rate; a rounding mode is then required — the server
 * says so (`treasury_rounding_required`).
 */
@Component({
  selector: 'alco-treasury-transfer-form',
  imports: [
    ReactiveFormsModule,
    AlcoButton,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoPageHeader,
  ],
  templateUrl: './transfer-form.html',
  styleUrl: '../../accounting/accounting-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreasuryTransferFormPage {
  private readonly api = inject(TreasuryApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AlcoToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly roundings = ROUNDING_MODES;
  protected readonly form = new FormGroup({
    source_account: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    destination_account: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    transfer_date: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    amount: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    rounding: new FormControl('', { nonNullable: true }),
    reference: new FormControl('', { nonNullable: true, validators: Validators.maxLength(64) }),
    description: new FormControl('', {
      nonNullable: true,
      validators: Validators.maxLength(255),
    }),
  });
  protected readonly accounts = signal<readonly TreasuryAccount[]>([]);
  protected readonly activeAccounts = computed(() =>
    this.accounts().filter((item) => item.status === 'active'),
  );
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly invalidSubmit = signal(false);

  constructor() {
    inject(UnsavedChangesService).track(() => this.form.dirty);
    this.api
      .accounts()
      .pipe(
        map((page) => page.results),
        catchError(() => of([])),
      )
      .subscribe((list) => this.accounts.set(list));
    afterNextRender(() => this.focus('source_account'), { injector: inject(Injector) });
  }

  protected async save(): Promise<void> {
    if (this.saving()) {
      return;
    }
    this.error.set(null);
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.invalidSubmit.set(true);
      const first = Object.entries(this.form.controls).find(([, control]) => control.invalid);
      if (first) {
        this.focus(first[0]);
      }
      return;
    }
    this.invalidSubmit.set(false);
    this.saving.set(true);
    try {
      const saved = await firstValueFrom(this.api.createTransfer(this.write()));
      this.form.markAsPristine();
      this.toast.success('Virement créé en brouillon.');
      await this.router.navigate(['/app/comptabilite/tresorerie/virements', saved.public_id]);
    } catch (failure) {
      this.showFailure(toApiError(failure));
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    void this.router.navigate(['..'], { relativeTo: this.route });
  }

  private write(): TransferWrite {
    const value = this.form.getRawValue();
    const amount = value.amount.trim();
    const write: Record<string, unknown> = {
      source_account: value.source_account,
      destination_account: value.destination_account,
      transfer_date: value.transfer_date,
      amount: normalizeDecimalInput(amount) ?? amount,
      reference: value.reference.trim(),
      description: value.description.trim(),
    };
    if (value.rounding) {
      write['rounding'] = value.rounding as RoundingMode;
    }
    return write as unknown as TransferWrite;
  }

  private showFailure(error: ApiError): void {
    if (error.kind === 'unauthenticated') {
      return;
    }
    const fields: Record<string, string> = { ...serverFieldErrors(error, TREASURY_FIELD_MESSAGES) };
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
    this.error.set(toUserError(error, TREASURY_ERRORS));
  }

  private focus(name: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(`[formControlName="${name}"]`)?.focus();
  }
}
