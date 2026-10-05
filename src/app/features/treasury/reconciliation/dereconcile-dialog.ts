import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoModal } from '../../../shared/ui/modal/modal';

interface DereconcileDialogData {
  /** « 05/03/2026 » */
  readonly lineDate: string;
  /** The reference of the lettering the confirmation created (A6.1), if any. */
  readonly lettering: string | null;
}

const TITLE_ID = 'alco-dereconcile-title';

/**
 * The confirmation of a reconciliation's cancellation, with the reason the server requires
 * (`TreasuryReasonRequest`). It says what the server does (A6.1): the bank relation only is
 * cancelled — the payment, its entry, the lettering and the installments stay as they are.
 */
@Component({
  selector: 'alco-dereconcile-dialog',
  imports: [ReactiveFormsModule, AlcoButton, AlcoFormField, AlcoInput, AlcoModal],
  template: `
    <alco-modal
      [title]="'Dé-rapprocher la ligne du ' + data.lineDate + ' ?'"
      [titleId]="titleId"
      (closed)="ref.close(null)"
    >
      <p>
        Le rapprochement sera annulé et conservé, avec la date, l’auteur et le motif. La ligne de
        relevé et l’opération de trésorerie redeviendront disponibles pour un rapprochement.
      </p>
      <p class="kept">Restent inchangés :</p>
      <ul class="kept-list">
        <li>l’opération de trésorerie et son écriture comptable ;</li>
        @if (data.lettering; as lettering) {
          <li>
            le lettrage {{ lettering }} et les échéances qu’il a réglées : la facture reste réglée
            par ce paiement.
          </li>
        } @else {
          <li>tout lettrage et toute échéance.</li>
        }
      </ul>
      @if (data.lettering; as lettering) {
        <p class="hint">
          Pour rouvrir la facture, délettrez {{ lettering }} depuis sa fiche, dans Lettrage.
        </p>
      }
      <form
        id="dereconcile-form"
        class="fields"
        [formGroup]="form"
        (ngSubmit)="submit()"
        novalidate
      >
        <alco-form-field label="Motif" [required]="true" hint="Gardé avec le rapprochement annulé.">
          <textarea alcoInput formControlName="reason" rows="2" data-autofocus></textarea>
        </alco-form-field>
      </form>
      @if (invalid()) {
        <p class="error" role="alert">Indiquez le motif de l’annulation du rapprochement.</p>
      }
      <ng-container alcoModalFooter>
        <button alcoButton type="button" (click)="ref.close(null)">Annuler</button>
        <button alcoButton type="submit" form="dereconcile-form" variant="danger">
          Dé-rapprocher
        </button>
      </ng-container>
    </alco-modal>
  `,
  styles: `
    .kept {
      margin: var(--space-3) 0 var(--space-1);
      font-weight: var(--font-weight-medium);
    }
    .kept-list {
      margin: 0;
      padding-left: var(--space-5);
    }
    .hint {
      margin: var(--space-2) 0 0;
      color: var(--color-text-muted);
    }
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
export class AlcoDereconcileDialog {
  protected readonly data = inject<DereconcileDialogData>(DIALOG_DATA);
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

/** Opens the cancellation dialog; resolves the reason, or `null` when cancelled. */
@Injectable({ providedIn: 'root' })
export class DereconcileDialogService {
  private readonly dialog = inject(Dialog);

  ask(data: DereconcileDialogData): Promise<string | null> {
    const ref = this.dialog.open<string | null, DereconcileDialogData>(AlcoDereconcileDialog, {
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
