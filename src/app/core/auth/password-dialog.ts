import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoModal } from '../../shared/ui/modal/modal';
import { FieldMessageOverrides, serverFieldErrors } from '../errors/field-errors';
import { toUserError } from '../errors/user-error';
import { ApiError, toApiError } from '../http/api-error';
import { AuthApi } from './auth-api';

const TITLE_ID = 'alco-password-title';
const MISMATCH = 'Les deux mots de passe ne correspondent pas.';

/** The codes of Django's password validators and of the current password check. */
const PASSWORD_MESSAGES: FieldMessageOverrides = {
  current_password: { incorrect: 'Mot de passe actuel incorrect.' },
  new_password: {
    password_too_short: '12 caractères au minimum.',
    password_too_common: 'Ce mot de passe est trop courant.',
    password_entirely_numeric: 'Il ne doit pas contenir que des chiffres.',
    password_too_similar: 'Il ressemble trop à votre nom ou à votre adresse e-mail.',
  },
};

type Field = 'current_password' | 'new_password';

function sameAsNew(control: AbstractControl): ValidationErrors | null {
  const fresh = control.parent?.get('new_password')?.value as string | undefined;
  return control.value && fresh !== undefined && control.value !== fresh
    ? { server: MISMATCH }
    : null;
}

/** « Changer le mot de passe »: the server checks everything; the session stays open. */
@Component({
  selector: 'alco-password-dialog',
  imports: [ReactiveFormsModule, AlcoButton, AlcoFormField, AlcoInput, AlcoModal],
  template: `
    <alco-modal title="Changer le mot de passe" [titleId]="titleId" (closed)="ref.close(false)">
      <form id="password-form" class="fields" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <alco-form-field label="Mot de passe actuel" [required]="true">
          <input
            alcoInput
            type="password"
            autocomplete="current-password"
            formControlName="current_password"
            data-autofocus
          />
        </alco-form-field>
        <alco-form-field
          label="Nouveau mot de passe"
          [required]="true"
          hint="12 caractères au minimum, pas uniquement des chiffres."
        >
          <input
            alcoInput
            type="password"
            autocomplete="new-password"
            formControlName="new_password"
          />
        </alco-form-field>
        <alco-form-field label="Confirmer le nouveau mot de passe" [required]="true">
          <input
            alcoInput
            type="password"
            autocomplete="new-password"
            formControlName="confirmation"
          />
        </alco-form-field>
      </form>
      @if (failure()) {
        <p class="error" role="alert">{{ failure() }}</p>
      }
      <ng-container alcoModalFooter>
        <button alcoButton type="button" (click)="ref.close(false)">Annuler</button>
        <button
          alcoButton
          type="submit"
          form="password-form"
          variant="primary"
          [loading]="saving()"
          loadingLabel="Enregistrement…"
        >
          Enregistrer
        </button>
      </ng-container>
    </alco-modal>
  `,
  styles: `
    .fields {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
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
export class AlcoPasswordDialog {
  private readonly auth = inject(AuthApi);
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
  protected readonly titleId = TITLE_ID;
  protected readonly saving = signal(false);
  /** A failure that belongs to no field (network, too many attempts…), or `null`. */
  protected readonly failure = signal<string | null>(null);
  protected readonly form = new FormGroup({
    current_password: new FormControl('', { nonNullable: true, validators: Validators.required }),
    new_password: new FormControl('', { nonNullable: true, validators: Validators.required }),
    confirmation: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, sameAsNew],
    }),
  });

  constructor() {
    // A new password typed after the confirmation checks the confirmation again.
    this.form.controls.new_password.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() =>
        this.form.controls.confirmation.updateValueAndValidity({ emitEvent: false }),
      );
  }

  protected async submit(): Promise<void> {
    if (this.saving()) {
      return;
    }
    this.failure.set(null);
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      return;
    }
    const { current_password, new_password } = this.form.getRawValue();
    this.saving.set(true);
    try {
      await firstValueFrom(this.auth.changePassword(current_password, new_password));
    } catch (failure) {
      this.saving.set(false);
      this.show(toApiError(failure));
      return;
    }
    this.ref.close(true);
  }

  private show(error: ApiError): void {
    const fields =
      error.code === 'validation_error' ? serverFieldErrors(error, PASSWORD_MESSAGES) : {};
    const names = Object.keys(fields).filter(
      (name): name is Field => name === 'current_password' || name === 'new_password',
    );
    for (const name of names) {
      this.form.controls[name].setErrors({ server: fields[name] });
    }
    if (names.length === 0) {
      const text = toUserError(error);
      this.failure.set(`${text.title} ${text.message}`);
    }
  }
}

/** Opens « Changer le mot de passe »; resolves `true` once the password is changed. */
@Injectable({ providedIn: 'root' })
export class PasswordDialogService {
  private readonly dialog = inject(Dialog);

  open(): Promise<boolean> {
    const ref = this.dialog.open<boolean>(AlcoPasswordDialog, {
      ariaLabelledBy: TITLE_ID,
      backdropClass: 'alco-dialog-backdrop',
      panelClass: 'alco-dialog-panel',
      autoFocus: '[data-autofocus]',
      restoreFocus: true,
    });
    return firstValueFrom(ref.closed).then((changed) => changed === true);
  }
}
