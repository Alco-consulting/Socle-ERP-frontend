import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom, map } from 'rxjs';

import {
  AlcoAutocomplete,
  AutocompleteOption,
  AutocompleteSearch,
} from '../../shared/forms/autocomplete';
import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoModal } from '../../shared/ui/modal/modal';
import { localToday } from '../../shared/utils/dates';
import { normalizeDecimalInput } from '../../shared/utils/decimal';
import { EntriesApi } from '../accounting/data-access/entries-api';
import { DISPOSAL_KINDS } from './assets-presentation';
import { DisposalKind, DisposalRequest } from './data-access/assets-models';

const TITLE_ID = 'alco-dispose-title';

/** « Céder / mettre au rebut »: the server posts the depreciation due first, then the disposal. */
@Component({
  selector: 'alco-dispose-dialog',
  imports: [ReactiveFormsModule, AlcoAutocomplete, AlcoButton, AlcoFormField, AlcoInput, AlcoModal],
  template: `
    <alco-modal [title]="'Céder ' + name + ' ?'" [titleId]="titleId" (closed)="ref.close(null)">
      <p>Le bien sort du registre à cette date ; ses dotations suivantes sont annulées.</p>
      <form id="dispose-form" class="fields" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <alco-form-field label="Nature" [required]="true">
          <select alcoSelect formControlName="kind" data-autofocus>
            @for (kind of kinds; track kind.id) {
              <option [value]="kind.id">{{ kind.label }}</option>
            }
          </select>
        </alco-form-field>
        <alco-form-field label="Date" [required]="true">
          <input alcoInput type="date" formControlName="disposal_date" />
        </alco-form-field>
        @if (kind() === 'sale') {
          <alco-form-field label="Prix de vente HT" [required]="true">
            <input alcoInput inputmode="decimal" formControlName="proceeds" autocomplete="off" />
          </alco-form-field>
          <alco-form-field
            label="Compte du prix"
            [required]="true"
            hint="La créance sur l’acheteur (ex. 485100) ou la banque si c’est déjà encaissé."
          >
            <alco-autocomplete
              formControlName="proceeds_account"
              [search]="searchAccounts"
              placeholder="Aucun compte"
              emptyText="Aucun compte ne correspond."
            />
          </alco-form-field>
        }
        <alco-form-field label="Motif" [required]="true" hint="Gardé dans l’historique.">
          <textarea alcoInput formControlName="reason" rows="2"></textarea>
        </alco-form-field>
      </form>
      @if (invalid()) {
        <p class="error" role="alert">{{ invalid() }}</p>
      }
      <ng-container alcoModalFooter>
        <button alcoButton type="button" (click)="ref.close(null)">Annuler</button>
        <button alcoButton type="submit" form="dispose-form" variant="primary">Céder</button>
      </ng-container>
    </alco-modal>
  `,
  styles: `
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
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoDisposeDialog {
  protected readonly name = inject<string>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<DisposalRequest | null>>(DialogRef);
  private readonly entries = inject(EntriesApi);
  /** Every account of the chart that takes entries, searched by code or name. */
  protected readonly searchAccounts: AutocompleteSearch = (term) =>
    this.entries.postableAccounts(term).pipe(
      map((found) =>
        found.map((account) => ({
          id: account.public_id,
          label: account.code,
          detail: account.name,
        })),
      ),
    );
  protected readonly titleId = TITLE_ID;
  protected readonly kinds = DISPOSAL_KINDS;
  protected readonly invalid = signal<string | null>(null);
  protected readonly form = new FormGroup({
    kind: new FormControl<DisposalKind>('sale', { nonNullable: true }),
    disposal_date: new FormControl(localToday(), {
      nonNullable: true,
      validators: Validators.required,
    }),
    proceeds: new FormControl('', { nonNullable: true }),
    proceeds_account: new FormControl<AutocompleteOption | null>(null),
    reason: new FormControl('', { nonNullable: true, validators: Validators.required }),
  });
  protected readonly kind = toSignal(this.form.controls.kind.valueChanges, {
    initialValue: this.form.controls.kind.value,
  });

  protected submit(): void {
    const value = this.form.getRawValue();
    const proceeds = value.kind === 'sale' ? normalizeDecimalInput(value.proceeds) : null;
    if (!value.disposal_date || !value.reason.trim()) {
      this.invalid.set('Indiquez la date et le motif.');
      return;
    }
    if (value.kind === 'sale' && (proceeds === null || !value.proceeds_account)) {
      this.invalid.set('Saisissez le prix de vente (ex. 150000) et le compte du prix.');
      return;
    }
    this.ref.close({
      disposal: {
        kind: value.kind,
        disposal_date: value.disposal_date,
        reason: value.reason.trim(),
        ...(proceeds !== null ? { proceeds } : {}),
      },
      proceedsAccount: value.kind === 'sale' ? (value.proceeds_account?.id ?? null) : null,
    });
  }
}

/** Asks how an asset leaves; `null` when cancelled. */
@Injectable({ providedIn: 'root' })
export class DisposeDialogService {
  private readonly dialog = inject(Dialog);

  ask(name: string): Promise<DisposalRequest | null> {
    const ref = this.dialog.open<DisposalRequest | null, string>(AlcoDisposeDialog, {
      data: name,
      ariaLabelledBy: TITLE_ID,
      backdropClass: 'alco-dialog-backdrop',
      panelClass: 'alco-dialog-panel',
      autoFocus: '[data-autofocus]',
      restoreFocus: true,
    });
    return firstValueFrom(ref.closed).then((result) => result ?? null);
  }
}
