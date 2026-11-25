import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Observable, catchError, firstValueFrom, forkJoin, map, of } from 'rxjs';

import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoModal } from '../../shared/ui/modal/modal';
import { localToday } from '../../shared/utils/dates';
import { normalizeDecimalInput } from '../../shared/utils/decimal';
import { AccountingApi } from '../accounting/data-access/accounting-api';
import { Journal } from '../accounting/data-access/accounting-models';
import { Prepayment, PrepaymentStrategy } from './data-access/loans-models';
import { STRATEGIES } from './loans-presentation';

const PAY_TITLE = 'alco-loan-pay-title';
const PREPAY_TITLE = 'alco-loan-prepay-title';

const DIALOG_OPTIONS = {
  backdropClass: 'alco-dialog-backdrop',
  panelClass: 'alco-dialog-panel',
  autoFocus: '[data-autofocus]',
  restoreFocus: true,
};

const STYLES = `
  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }
  .error {
    margin: var(--space-3) 0 0;
    color: var(--color-danger-text);
    font-weight: var(--font-weight-medium);
  }
`;

/** The active bank and cash journals: where a loan's money comes in or goes out. */
function cashJournals(api: AccountingApi): Observable<readonly Journal[]> {
  const of_type = (journalType: 'bank' | 'cash') =>
    api.journals({ status: 'active', journalType }).pipe(map((page) => page.results));
  return forkJoin([of_type('bank'), of_type('cash')]).pipe(
    map(([banks, cash]) => [...banks, ...cash]),
    catchError(() => of([])),
  );
}

export interface PaymentQuestion {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  /** The date proposed, or `null` when the date is fixed (the funds of an activation). */
  readonly date: string | null;
}

export interface PaymentAnswer {
  readonly journal: string;
  readonly date: string;
}

/** « Activer », « Payer l'échéance »: from which bank or cash journal, and when. */
@Component({
  selector: 'alco-loan-pay-dialog',
  imports: [ReactiveFormsModule, AlcoButton, AlcoFormField, AlcoInput, AlcoModal],
  template: `
    <alco-modal [title]="question.title" [titleId]="titleId" (closed)="ref.close(null)">
      <p>{{ question.message }}</p>
      <form id="loan-pay-form" class="fields" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <alco-form-field label="Banque ou caisse" [required]="true">
          <select alcoSelect formControlName="journal" data-autofocus>
            <option value="" disabled>Choisir…</option>
            @for (journal of journals(); track journal.public_id) {
              <option [value]="journal.public_id">{{ journal.code }} — {{ journal.name }}</option>
            }
          </select>
        </alco-form-field>
        @if (question.date !== null) {
          <alco-form-field label="Date du paiement" [required]="true">
            <input alcoInput type="date" formControlName="date" />
          </alco-form-field>
        }
      </form>
      @if (invalid()) {
        <p class="error" role="alert">{{ invalid() }}</p>
      }
      <ng-container alcoModalFooter>
        <button alcoButton type="button" (click)="ref.close(null)">Annuler</button>
        <button alcoButton type="submit" form="loan-pay-form" variant="primary">
          {{ question.confirmLabel }}
        </button>
      </ng-container>
    </alco-modal>
  `,
  styles: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoLoanPayDialog {
  protected readonly question = inject<PaymentQuestion>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<PaymentAnswer | null>>(DialogRef);
  protected readonly titleId = PAY_TITLE;
  protected readonly journals = toSignal(cashJournals(inject(AccountingApi)), {
    initialValue: [],
  });
  protected readonly invalid = signal<string | null>(null);
  protected readonly form = new FormGroup({
    journal: new FormControl('', { nonNullable: true }),
    date: new FormControl(this.question.date ?? localToday(), { nonNullable: true }),
  });

  protected submit(): void {
    const value = this.form.getRawValue();
    if (!value.journal || !value.date) {
      this.invalid.set('Choisissez la banque ou la caisse, et la date.');
      return;
    }
    this.ref.close({ journal: value.journal, date: value.date });
  }
}

/** « Remboursement anticipé »: how much, how the rest changes, from which journal. */
@Component({
  selector: 'alco-loan-prepay-dialog',
  imports: [ReactiveFormsModule, AlcoButton, AlcoFormField, AlcoInput, AlcoModal],
  template: `
    <alco-modal title="Remboursement anticipé" [titleId]="titleId" (closed)="ref.close(null)">
      <p>Le capital remboursé est déduit ; l’échéancier restant est recalculé.</p>
      <form
        id="loan-prepay-form"
        class="fields"
        [formGroup]="form"
        (ngSubmit)="submit()"
        novalidate
      >
        <alco-form-field label="Capital remboursé" [required]="true">
          <input
            alcoInput
            inputmode="decimal"
            formControlName="amount"
            autocomplete="off"
            data-autofocus
          />
        </alco-form-field>
        <alco-form-field
          label="Intérêts payés en plus"
          [optional]="true"
          hint="Intérêts courus ou indemnité demandés par la banque."
        >
          <input alcoInput inputmode="decimal" formControlName="interest" autocomplete="off" />
        </alco-form-field>
        <alco-form-field label="Ensuite" [required]="true">
          <select alcoSelect formControlName="strategy">
            @for (strategy of strategies; track strategy.id) {
              <option [value]="strategy.id">{{ strategy.label }}</option>
            }
          </select>
        </alco-form-field>
        <alco-form-field label="Banque ou caisse" [required]="true">
          <select alcoSelect formControlName="journal">
            <option value="" disabled>Choisir…</option>
            @for (journal of journals(); track journal.public_id) {
              <option [value]="journal.public_id">{{ journal.code }} — {{ journal.name }}</option>
            }
          </select>
        </alco-form-field>
        <alco-form-field label="Date" [required]="true">
          <input alcoInput type="date" formControlName="date" />
        </alco-form-field>
        <alco-form-field label="Motif" [required]="true" hint="Gardé dans l’historique.">
          <textarea alcoInput formControlName="reason" rows="2"></textarea>
        </alco-form-field>
      </form>
      @if (invalid()) {
        <p class="error" role="alert">{{ invalid() }}</p>
      }
      <ng-container alcoModalFooter>
        <button alcoButton type="button" (click)="ref.close(null)">Annuler</button>
        <button alcoButton type="submit" form="loan-prepay-form" variant="primary">
          Rembourser
        </button>
      </ng-container>
    </alco-modal>
  `,
  styles: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoLoanPrepayDialog {
  protected readonly ref = inject<DialogRef<Prepayment | null>>(DialogRef);
  protected readonly titleId = PREPAY_TITLE;
  protected readonly strategies = STRATEGIES;
  protected readonly journals = toSignal(cashJournals(inject(AccountingApi)), {
    initialValue: [],
  });
  protected readonly invalid = signal<string | null>(null);
  protected readonly form = new FormGroup({
    amount: new FormControl('', { nonNullable: true }),
    interest: new FormControl('', { nonNullable: true }),
    strategy: new FormControl<PrepaymentStrategy>('reduce_installment', { nonNullable: true }),
    journal: new FormControl('', { nonNullable: true }),
    date: new FormControl(localToday(), { nonNullable: true }),
    reason: new FormControl('', { nonNullable: true }),
  });

  protected submit(): void {
    const value = this.form.getRawValue();
    const amount = normalizeDecimalInput(value.amount);
    const interest = value.interest.trim() ? normalizeDecimalInput(value.interest) : '';
    if (amount === null || interest === null) {
      this.invalid.set('Saisissez les montants (ex. 5000000).');
      return;
    }
    if (!value.journal || !value.date || !value.reason.trim()) {
      this.invalid.set('Choisissez la banque ou la caisse, la date, et donnez le motif.');
      return;
    }
    this.ref.close({
      prepayment_date: value.date,
      amount,
      strategy: value.strategy,
      reason: value.reason.trim(),
      journal: value.journal,
      ...(interest ? { interest } : {}),
    });
  }
}

/** The loan's money questions; `null` when cancelled. */
@Injectable({ providedIn: 'root' })
export class LoanDialogService {
  private readonly dialog = inject(Dialog);

  pay(question: PaymentQuestion): Promise<PaymentAnswer | null> {
    const ref = this.dialog.open<PaymentAnswer | null, PaymentQuestion>(AlcoLoanPayDialog, {
      ...DIALOG_OPTIONS,
      data: question,
      ariaLabelledBy: PAY_TITLE,
    });
    return firstValueFrom(ref.closed).then((result) => result ?? null);
  }

  prepay(): Promise<Prepayment | null> {
    const ref = this.dialog.open<Prepayment | null>(AlcoLoanPrepayDialog, {
      ...DIALOG_OPTIONS,
      ariaLabelledBy: PREPAY_TITLE,
    });
    return firstValueFrom(ref.closed).then((result) => result ?? null);
  }
}
