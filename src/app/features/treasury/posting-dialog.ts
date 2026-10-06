import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { catchError, firstValueFrom, map, of } from 'rxjs';

import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoModal } from '../../shared/ui/modal/modal';
import { AccountingApi } from '../accounting/data-access/accounting-api';
import { Journal } from '../accounting/data-access/accounting-models';

export interface PostingDialogData {
  readonly title: string;
  readonly message: string;
  /** The treasury account's default journal (`journal`), if it has one. */
  readonly defaultJournal: string | null;
}

/** `TreasuryPostRequest`: the journal is optional (the account's default otherwise). */
export interface PostingChoice {
  readonly journal?: string;
}

const TITLE_ID = 'alco-treasury-posting-title';

/**
 * The confirmation of a posting (`POST …/account/`, `TreasuryPostRequest`): the server creates
 * a draft entry in Accounting, in the journal chosen here or, when none is, the account's
 * default journal. The active journals are the server's (`accounting/journals/?status=active`).
 */
@Component({
  selector: 'alco-treasury-posting-dialog',
  imports: [ReactiveFormsModule, AlcoButton, AlcoFormField, AlcoInput, AlcoModal],
  template: `
    <alco-modal [title]="data.title" [titleId]="titleId" (closed)="ref.close(null)">
      <p>{{ data.message }}</p>
      <form
        id="treasury-posting-form"
        class="fields"
        [formGroup]="form"
        (ngSubmit)="submit()"
        novalidate
      >
        <alco-form-field
          label="Journal"
          [hint]="
            data.defaultJournal
              ? 'Vide : le journal du compte (' + data.defaultJournal + ')'
              : 'Le compte n’a pas de journal par défaut : choisissez-en un.'
          "
        >
          <select alcoSelect formControlName="journal" data-autofocus>
            <option value="">
              {{
                data.defaultJournal
                  ? 'Journal du compte (' + data.defaultJournal + ')'
                  : 'Choisir un journal'
              }}
            </option>
            @for (journal of journals(); track journal.public_id) {
              <option [value]="journal.public_id">{{ journal.code }} — {{ journal.name }}</option>
            }
          </select>
        </alco-form-field>
      </form>
      <ng-container alcoModalFooter>
        <button alcoButton type="button" (click)="ref.close(null)">Annuler</button>
        <button alcoButton type="submit" form="treasury-posting-form" variant="primary">
          Comptabiliser
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
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoTreasuryPostingDialog {
  protected readonly data = inject<PostingDialogData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<PostingChoice | null>>(DialogRef);
  protected readonly titleId = TITLE_ID;
  protected readonly journals = signal<readonly Journal[]>([]);
  protected readonly form = new FormGroup({
    journal: new FormControl('', { nonNullable: true }),
  });

  constructor() {
    inject(AccountingApi)
      .journals({ status: 'active' })
      .pipe(
        map((page) => page.results),
        catchError(() => of([])),
      )
      .subscribe((list) => this.journals.set(list));
  }

  protected submit(): void {
    const journal = this.form.getRawValue().journal;
    this.ref.close(journal ? { journal } : {});
  }
}

/** Opens the posting dialog; resolves the choice, or `null` when cancelled. */
@Injectable({ providedIn: 'root' })
export class TreasuryPostingDialogService {
  private readonly dialog = inject(Dialog);

  ask(data: PostingDialogData): Promise<PostingChoice | null> {
    const ref = this.dialog.open<PostingChoice | null, PostingDialogData>(
      AlcoTreasuryPostingDialog,
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
