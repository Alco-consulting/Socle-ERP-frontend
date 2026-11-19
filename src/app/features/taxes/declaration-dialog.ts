import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Injectable, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoModal } from '../../shared/ui/modal/modal';

const TITLE_ID = 'alco-declaration-title';

/** « Nouvelle déclaration »: the month only; the server computes its VAT. */
@Component({
  selector: 'alco-declaration-dialog',
  imports: [ReactiveFormsModule, AlcoButton, AlcoFormField, AlcoInput, AlcoModal],
  template: `
    <alco-modal title="Nouvelle déclaration de TVA" [titleId]="titleId" (closed)="ref.close(null)">
      <p>La TVA du mois est calculée à partir des écritures validées : ventes, achats et avoirs.</p>
      <form
        id="declaration-form"
        class="fields"
        (submit)="$event.preventDefault(); submit()"
        novalidate
      >
        <alco-form-field label="Mois" [required]="true">
          <input alcoInput type="month" [formControl]="month" data-autofocus />
        </alco-form-field>
      </form>
      <ng-container alcoModalFooter>
        <button alcoButton type="button" (click)="ref.close(null)">Annuler</button>
        <button alcoButton type="submit" form="declaration-form" variant="primary">Créer</button>
      </ng-container>
    </alco-modal>
  `,
  styles: `
    .fields {
      margin-top: var(--space-3);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoDeclarationDialog {
  protected readonly ref = inject<DialogRef<string | null>>(DialogRef);
  protected readonly titleId = TITLE_ID;
  protected readonly month = new FormControl(inject<string>(DIALOG_DATA), {
    nonNullable: true,
    validators: [Validators.required, Validators.pattern(/^\d{4}-\d{2}$/)],
  });

  protected submit(): void {
    this.month.markAsTouched();
    if (this.month.valid) {
      this.ref.close(this.month.value);
    }
  }
}

/** Asks for the month to declare (`YYYY-MM`); `null` when cancelled. */
@Injectable({ providedIn: 'root' })
export class DeclarationDialogService {
  private readonly dialog = inject(Dialog);

  ask(month: string): Promise<string | null> {
    const ref = this.dialog.open<string | null, string>(AlcoDeclarationDialog, {
      data: month,
      ariaLabelledBy: TITLE_ID,
      backdropClass: 'alco-dialog-backdrop',
      panelClass: 'alco-dialog-panel',
      autoFocus: '[data-autofocus]',
      restoreFocus: true,
    });
    return firstValueFrom(ref.closed).then((result) => result ?? null);
  }
}
