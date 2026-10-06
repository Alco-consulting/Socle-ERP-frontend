import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoModal } from '../../shared/ui/modal/modal';

export interface ReasonDialogData {
  readonly title: string;
  /** What the server will do, in the user's words. */
  readonly message: string;
  readonly confirmLabel: string;
  readonly tone?: 'primary' | 'danger';
  /** Also ask a date (`operation_date` of a correction), proposed with this value. */
  readonly date?: { readonly label: string; readonly value: string };
}

export interface ReasonDialogResult {
  readonly reason: string;
  readonly date: string | null;
}

const TITLE_ID = 'alco-treasury-reason-title';

/**
 * The confirmation of a treasury command that needs a reason (`TreasuryReasonRequest`,
 * `TreasuryCorrectRequest`): cancelling an operation or a transfer, setting a statement line
 * aside, correcting an operation (with its date). The reason is required, kept by the server.
 */
@Component({
  selector: 'alco-treasury-reason-dialog',
  imports: [ReactiveFormsModule, AlcoButton, AlcoFormField, AlcoInput, AlcoModal],
  template: `
    <alco-modal [title]="data.title" [titleId]="titleId" (closed)="ref.close(null)">
      <p>{{ data.message }}</p>
      <form
        id="treasury-reason-form"
        class="fields"
        [formGroup]="form"
        (ngSubmit)="submit()"
        novalidate
      >
        @if (data.date; as date) {
          <alco-form-field [label]="date.label" [required]="true">
            <input alcoDatePicker type="date" formControlName="date" />
          </alco-form-field>
        }
        <alco-form-field label="Motif" [required]="true" hint="Gardé avec l’opération.">
          <textarea alcoInput formControlName="reason" rows="2" data-autofocus></textarea>
        </alco-form-field>
      </form>
      @if (invalid()) {
        <p class="error" role="alert">{{ invalid() }}</p>
      }
      <ng-container alcoModalFooter>
        <button alcoButton type="button" (click)="ref.close(null)">Annuler</button>
        <button
          alcoButton
          type="submit"
          form="treasury-reason-form"
          [variant]="data.tone === 'danger' ? 'danger' : 'primary'"
        >
          {{ data.confirmLabel }}
        </button>
      </ng-container>
    </alco-modal>
  `,
  styles: `
    .fields {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin-top: var(--space-3);
      color: var(--color-text);
    }
    .error {
      margin: var(--space-3) 0 0;
      color: var(--color-danger-text);
      font-weight: var(--font-weight-medium);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoTreasuryReasonDialog {
  protected readonly data = inject<ReasonDialogData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<ReasonDialogResult | null>>(DialogRef);
  protected readonly titleId = TITLE_ID;
  protected readonly invalid = signal<string | null>(null);
  protected readonly form = new FormGroup({
    reason: new FormControl('', { nonNullable: true }),
    date: new FormControl(this.data.date?.value ?? '', { nonNullable: true }),
  });

  protected submit(): void {
    const value = this.form.getRawValue();
    const reason = value.reason.trim();
    if (this.data.date && !value.date) {
      this.invalid.set(`Indiquez la ${this.data.date.label.toLowerCase()}.`);
      return;
    }
    if (!reason) {
      this.invalid.set('Indiquez le motif.');
      return;
    }
    this.ref.close({ reason, date: this.data.date ? value.date : null });
  }
}

/** Opens the reason dialog; resolves the reason (and date), or `null` when cancelled. */
@Injectable({ providedIn: 'root' })
export class TreasuryReasonDialogService {
  private readonly dialog = inject(Dialog);

  ask(data: ReasonDialogData): Promise<ReasonDialogResult | null> {
    const ref = this.dialog.open<ReasonDialogResult | null, ReasonDialogData>(
      AlcoTreasuryReasonDialog,
      {
        data,
        ariaLabelledBy: TITLE_ID,
        backdropClass: 'alco-dialog-backdrop',
        panelClass: 'alco-dialog-panel',
        autoFocus: '[data-autofocus]',
        restoreFocus: true,
      },
    );
    return firstValueFrom(ref.closed).then((result) => result ?? null);
  }
}
