import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { AlcoButton } from '../button/button';
import { AlcoModal } from '../modal/modal';

export interface ConfirmOptions {
  readonly title: string;
  /** What will happen, in the user's words, including what cannot be undone. */
  readonly message: string;
  /** Names the action (« Valider l'écriture »), never just « OK ». */
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  /** `danger` for destructive or irreversible actions. */
  readonly tone?: 'primary' | 'danger';
}

const TITLE_ID = 'alco-confirm-title';

@Component({
  selector: 'alco-confirm-dialog',
  imports: [AlcoButton, AlcoModal],
  template: `
    <alco-modal [title]="data.title" [titleId]="titleId" (closed)="ref.close(false)">
      <p>{{ data.message }}</p>
      <ng-container alcoModalFooter>
        <button alcoButton type="button" data-autofocus (click)="ref.close(false)">
          {{ data.cancelLabel ?? 'Annuler' }}
        </button>
        <button
          alcoButton
          type="button"
          [variant]="data.tone === 'danger' ? 'danger' : 'primary'"
          (click)="ref.close(true)"
        >
          {{ data.confirmLabel }}
        </button>
      </ng-container>
    </alco-modal>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoConfirmDialog {
  protected readonly data = inject<ConfirmOptions>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
  protected readonly titleId = TITLE_ID;
}

/** Asks for an explicit confirmation before a sensitive action. Resolves `true` if confirmed. */
@Injectable({ providedIn: 'root' })
export class AlcoConfirmService {
  private readonly dialog = inject(Dialog);

  confirm(options: ConfirmOptions): Promise<boolean> {
    const ref = this.dialog.open<boolean, ConfirmOptions>(AlcoConfirmDialog, {
      data: options,
      role: 'alertdialog',
      ariaLabelledBy: TITLE_ID,
      backdropClass: 'alco-dialog-backdrop',
      panelClass: 'alco-dialog-panel',
      // Safe default: the focus lands on « Annuler », never on the confirmation.
      autoFocus: '[data-autofocus]',
      restoreFocus: true,
    });
    return firstValueFrom(ref.closed).then((result) => result === true);
  }
}
