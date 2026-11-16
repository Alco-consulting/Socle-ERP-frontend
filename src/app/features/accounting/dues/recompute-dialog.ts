import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoModal } from '../../../shared/ui/modal/modal';
import { RecomputeRequest } from '../data-access/due-models';

interface RecomputeDialogData {
  /** « VTE-000101 · CLI-001 » */
  readonly name: string;
}

const TITLE_ID = 'alco-recompute-title';

/**
 * The confirmation of a recomputation, with what the server takes
 * (`AccountingRecomputeRequest`): the reason (required), and optionally another payment delay
 * (in days) or reference date. The server computes and audits; nothing is computed here.
 */
@Component({
  selector: 'alco-recompute-dialog',
  imports: [ReactiveFormsModule, AlcoButton, AlcoFormField, AlcoInput, AlcoModal],
  template: `
    <alco-modal
      [title]="'Recalculer l’échéancier ' + data.name + ' ?'"
      [titleId]="titleId"
      (closed)="ref.close(null)"
    >
      <p>
        Les échéances existantes seront recalculées par le serveur, à partir du délai de paiement
        (celui du tiers aujourd’hui, ou celui saisi) et de la date de référence, puis réglées à
        nouveau selon le lettrage. L’ancien échéancier reste dans l’historique.
      </p>
      <form id="recompute-form" class="fields" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <alco-form-field label="Motif" [required]="true" hint="Gardé dans l’historique.">
          <textarea alcoInput formControlName="reason" rows="2" data-autofocus></textarea>
        </alco-form-field>
        <alco-form-field
          label="Délai de paiement (jours)"
          [optional]="true"
          hint="Vide : celui du tiers. 0 : à réception."
          class="alco-field--short"
        >
          <input
            alcoInput
            type="number"
            min="0"
            max="365"
            step="1"
            inputmode="numeric"
            formControlName="payment_days"
          />
        </alco-form-field>
        <alco-form-field
          label="Date de référence"
          [optional]="true"
          hint="Vide : celle de l’échéancier."
        >
          <input alcoDatePicker type="date" formControlName="reference_date" />
        </alco-form-field>
      </form>
      @if (invalid()) {
        <p class="error" role="alert">{{ invalid() }}</p>
      }
      <ng-container alcoModalFooter>
        <button alcoButton type="button" (click)="ref.close(null)">Annuler</button>
        <button alcoButton type="submit" form="recompute-form" variant="primary">Recalculer</button>
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
export class AlcoRecomputeDialog {
  protected readonly data = inject<RecomputeDialogData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<RecomputeRequest | null>>(DialogRef);
  protected readonly titleId = TITLE_ID;
  /** Le message de saisie à corriger, ou `null`. */
  protected readonly invalid = signal<string | null>(null);
  protected readonly form = new FormGroup({
    reason: new FormControl('', { nonNullable: true, validators: Validators.required }),
    /** Vide (`null`) : le délai du tiers ; sinon un entier de 0 à 365. */
    payment_days: new FormControl<number | null>(null, {
      validators: [Validators.min(0), Validators.max(365), Validators.pattern(/^\d+$/)],
    }),
    reference_date: new FormControl('', { nonNullable: true }),
  });

  protected submit(): void {
    this.form.markAllAsTouched();
    const value = this.form.getRawValue();
    if (!value.reason.trim()) {
      this.invalid.set('Indiquez le motif du recalcul.');
      return;
    }
    if (this.form.controls.payment_days.invalid) {
      this.invalid.set('Saisissez un délai entier entre 0 et 365 jours, ou laissez vide.');
      return;
    }
    this.ref.close({
      reason: value.reason.trim(),
      ...(value.payment_days !== null ? { payment_days: value.payment_days } : {}),
      ...(value.reference_date ? { reference_date: value.reference_date } : {}),
    });
  }
}

/** Opens the recomputation dialog; resolves the request, or `null` when cancelled. */
@Injectable({ providedIn: 'root' })
export class RecomputeDialogService {
  private readonly dialog = inject(Dialog);

  ask(name: string): Promise<RecomputeRequest | null> {
    const ref = this.dialog.open<RecomputeRequest | null, RecomputeDialogData>(
      AlcoRecomputeDialog,
      {
        data: { name },
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
