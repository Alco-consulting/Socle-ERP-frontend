import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoModal } from '../../shared/ui/modal/modal';

export interface ClosingReasonData {
  readonly title: string;
  /** What the server will do, in the user's words. */
  readonly message: string;
  readonly confirmLabel: string;
  readonly tone?: 'primary' | 'danger';
}

const TITLE_ID = 'alco-closing-reason-title';

/** A closing command that needs a reason (cancel, reopen): required, kept by the server. */
@Component({
  selector: 'alco-closing-reason-dialog',
  imports: [ReactiveFormsModule, AlcoButton, AlcoFormField, AlcoInput, AlcoModal],
  template: `
    <alco-modal [title]="data.title" [titleId]="titleId" (closed)="ref.close(null)">
      <p>{{ data.message }}</p>
      <form
        id="closing-reason-form"
        class="fields"
        [formGroup]="form"
        (ngSubmit)="submit()"
        novalidate
      >
        <alco-form-field
          label="Motif"
          [required]="true"
          hint="Gardé dans l’historique de la clôture."
        >
          <textarea alcoInput formControlName="reason" rows="2" data-autofocus></textarea>
        </alco-form-field>
      </form>
      @if (invalid()) {
        <p class="error" role="alert">Indiquez le motif.</p>
      }
      <ng-container alcoModalFooter>
        <button alcoButton type="button" (click)="ref.close(null)">Annuler</button>
        <button
          alcoButton
          type="submit"
          form="closing-reason-form"
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
export class AlcoClosingReasonDialog {
  protected readonly data = inject<ClosingReasonData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<string | null>>(DialogRef);
  protected readonly titleId = TITLE_ID;
  protected readonly invalid = signal(false);
  protected readonly form = new FormGroup({
    reason: new FormControl('', { nonNullable: true }),
  });

  protected submit(): void {
    const reason = this.form.getRawValue().reason.trim();
    if (!reason) {
      this.invalid.set(true);
      return;
    }
    this.ref.close(reason);
  }
}

/** Opens the reason dialog; resolves the reason, or `null` when cancelled. */
@Injectable({ providedIn: 'root' })
export class ClosingReasonDialogService {
  private readonly dialog = inject(Dialog);

  ask(data: ClosingReasonData): Promise<string | null> {
    const ref = this.dialog.open<string | null, ClosingReasonData>(AlcoClosingReasonDialog, {
      data,
      ariaLabelledBy: TITLE_ID,
      backdropClass: 'alco-dialog-backdrop',
      panelClass: 'alco-dialog-panel',
      autoFocus: '[data-autofocus]',
      restoreFocus: true,
    });
    return firstValueFrom(ref.closed).then((result) => result ?? null);
  }
}
