import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoModal } from '../../../shared/ui/modal/modal';
import { ReverseRequest } from '../data-access/entry-models';

interface ReverseDialogData {
  /** « EC-2026-000145 » */
  readonly entryName: string;
  /** Proposed date of the reversal (today, as the browser knows it). */
  readonly today: string;
}

const TITLE_ID = 'alco-reverse-title';

/**
 * The confirmation of a reversal, with what the server needs (`AccountingReverseRequest`):
 * its date and its reason. The server builds the reversal; nothing is computed here.
 */
@Component({
  selector: 'alco-reverse-dialog',
  imports: [ReactiveFormsModule, AlcoButton, AlcoFormField, AlcoInput, AlcoModal],
  template: `
    <alco-modal
      [title]="'Contrepasser ' + data.entryName + ' ?'"
      [titleId]="titleId"
      (closed)="ref.close(null)"
    >
      <p>
        Une nouvelle écriture en brouillon sera créée, chaque ligne inversée (débit et crédit
        échangés) au même taux. Elle devra être validée à son tour. L’écriture d’origine ne change
        pas, et ne peut être contrepassée qu’une fois.
      </p>
      <form id="reverse-form" class="fields" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <alco-form-field label="Date de la contrepassation" [required]="true">
          <input alcoDatePicker type="date" formControlName="entry_date" data-autofocus />
        </alco-form-field>
        <alco-form-field label="Motif" [required]="true" hint="Gardé avec la contrepassation.">
          <textarea alcoInput formControlName="reason" rows="2"></textarea>
        </alco-form-field>
        <alco-form-field
          label="Libellé"
          [optional]="true"
          hint="Vide : le libellé de l’écriture d’origine."
        >
          <input alcoInput formControlName="description" maxlength="255" />
        </alco-form-field>
      </form>
      @if (invalid()) {
        <p class="error" role="alert">Indiquez la date et le motif de la contrepassation.</p>
      }
      <ng-container alcoModalFooter>
        <button alcoButton type="button" (click)="ref.close(null)">Annuler</button>
        <button alcoButton type="submit" form="reverse-form" variant="primary">
          Créer la contrepassation
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
export class AlcoReverseDialog {
  protected readonly data = inject<ReverseDialogData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<ReverseRequest | null>>(DialogRef);
  protected readonly titleId = TITLE_ID;
  protected readonly invalid = signal(false);

  protected readonly form = new FormGroup({
    entry_date: new FormControl(this.data.today, {
      nonNullable: true,
      validators: Validators.required,
    }),
    reason: new FormControl('', { nonNullable: true, validators: Validators.required }),
    description: new FormControl('', { nonNullable: true, validators: Validators.maxLength(255) }),
  });

  protected submit(): void {
    this.form.markAllAsTouched();
    const value = this.form.getRawValue();
    if (this.form.invalid || value.reason.trim() === '') {
      this.invalid.set(true);
      return;
    }
    const request: ReverseRequest = {
      entry_date: value.entry_date,
      reason: value.reason.trim(),
      ...(value.description.trim() ? { description: value.description.trim() } : {}),
    };
    this.ref.close(request);
  }
}

/** Opens the reversal dialog; resolves the request, or `null` when cancelled. */
@Injectable({ providedIn: 'root' })
export class ReverseDialogService {
  private readonly dialog = inject(Dialog);

  ask(entryName: string, today: string): Promise<ReverseRequest | null> {
    const ref = this.dialog.open<ReverseRequest | null, ReverseDialogData>(AlcoReverseDialog, {
      data: { entryName, today },
      ariaLabelledBy: TITLE_ID,
      backdropClass: 'alco-dialog-backdrop',
      panelClass: 'alco-dialog-panel',
      autoFocus: '[data-autofocus]',
      restoreFocus: true,
    });
    return firstValueFrom(ref.closed).then((result) => result ?? null);
  }
}
