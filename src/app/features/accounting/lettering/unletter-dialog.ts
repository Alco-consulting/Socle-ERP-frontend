import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoModal } from '../../../shared/ui/modal/modal';

interface UnletterDialogData {
  /** « LET-000001 » */
  readonly reference: string;
}

const TITLE_ID = 'alco-unletter-title';

/**
 * The confirmation of an unlettering, with the reason the server requires
 * (`AccountingUnletterRequest`). The server cancels the lettering and opens its amounts again.
 */
@Component({
  selector: 'alco-unletter-dialog',
  imports: [ReactiveFormsModule, AlcoButton, AlcoFormField, AlcoInput, AlcoModal],
  template: `
    <alco-modal
      [title]="'Délettrer ' + data.reference + ' ?'"
      [titleId]="titleId"
      (closed)="ref.close(null)"
    >
      <p>
        Le lettrage sera annulé : ses montants redeviendront ouverts sur ses lignes. Il restera
        visible dans l’historique, avec la date, l’auteur et le motif. Les lignes pourront être
        lettrées à nouveau.
      </p>
      <form id="unletter-form" class="fields" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <alco-form-field label="Motif" [required]="true" hint="Gardé avec le lettrage annulé.">
          <textarea alcoInput formControlName="reason" rows="2" data-autofocus></textarea>
        </alco-form-field>
      </form>
      @if (invalid()) {
        <p class="error" role="alert">Indiquez le motif du délettrage.</p>
      }
      <ng-container alcoModalFooter>
        <button alcoButton type="button" (click)="ref.close(null)">Annuler</button>
        <button alcoButton type="submit" form="unletter-form" variant="danger">Délettrer</button>
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
export class AlcoUnletterDialog {
  protected readonly data = inject<UnletterDialogData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<string | null>>(DialogRef);
  protected readonly titleId = TITLE_ID;
  protected readonly invalid = signal(false);
  protected readonly form = new FormGroup({
    reason: new FormControl('', { nonNullable: true, validators: Validators.required }),
  });

  protected submit(): void {
    this.form.markAllAsTouched();
    const reason = this.form.getRawValue().reason.trim();
    if (!reason) {
      this.invalid.set(true);
      return;
    }
    this.ref.close(reason);
  }
}

/** Opens the unlettering dialog; resolves the reason, or `null` when cancelled. */
@Injectable({ providedIn: 'root' })
export class UnletterDialogService {
  private readonly dialog = inject(Dialog);

  ask(reference: string): Promise<string | null> {
    const ref = this.dialog.open<string | null, UnletterDialogData>(AlcoUnletterDialog, {
      data: { reference },
      ariaLabelledBy: TITLE_ID,
      backdropClass: 'alco-dialog-backdrop',
      panelClass: 'alco-dialog-panel',
      autoFocus: '[data-autofocus]',
      restoreFocus: true,
    });
    return firstValueFrom(ref.closed).then((result) => result ?? null);
  }
}
