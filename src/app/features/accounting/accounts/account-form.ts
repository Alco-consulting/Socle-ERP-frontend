import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, firstValueFrom, of } from 'rxjs';

import { serverFieldErrors } from '../../../core/errors/field-errors';
import { UserError, toUserError } from '../../../core/errors/user-error';
import { ApiError, toApiError } from '../../../core/http/api-error';
import { BreadcrumbService } from '../../../core/navigation/route-trail';
import { UnsavedChangesService } from '../../../core/navigation/unsaved-changes';
import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import {
  ACCOUNTING_FIELD_MESSAGES,
  ACCOUNTING_REFERENTIAL_ERRORS,
  ACCOUNT_TYPES,
} from '../accounting-presentation';
import { Account, AccountType, AccountWrite } from '../data-access/accounting-models';
import { AccountingApi } from '../data-access/accounting-api';

/** Business refusals that belong to one field (by their stable code). */
const FIELD_OF_CODE: Readonly<Record<string, [string, string]>> = {
  accounting_account_code_exists: ['code', 'Ce code est déjà utilisé par un autre compte.'],
  accounting_account_cycle: [
    'parent',
    'Un compte ne peut pas être placé sous l’un de ses propres sous-comptes.',
  ],
  accounting_account_inactive: ['parent', 'Ce compte parent est inactif.'],
};

/** Raised when the parent code is not an account of the company (said under the field). */
class UnknownParentError extends Error {}

/**
 * Creation (`…/plan-comptable/nouveau`) and modification (`…/:id/modifier`) of an account
 * with exactly the fields of `AccountingAccountWriteRequest`. The parent is given by its
 * code and found by the server (`?code=`); the class is what the user types (never derived
 * from the code here); « saisie autorisée » starts as the server's default (yes). A
 * modification sends only the fields changed, never the code.
 */
@Component({
  selector: 'alco-account-form',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoButton,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
  ],
  templateUrl: './account-form.html',
  styleUrl: '../accounting-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountFormPage {
  private readonly api = inject(AccountingApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AlcoToastService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly id = this.route.snapshot.paramMap.get('id');
  protected readonly isNew = this.id === null;
  protected readonly types = ACCOUNT_TYPES;

  protected readonly form = new FormGroup({
    code: new FormControl('', {
      nonNullable: true,
      validators: this.isNew ? [Validators.required, Validators.maxLength(32)] : [],
    }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(255)],
    }),
    description: new FormControl('', { nonNullable: true }),
    parent: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(32)] }),
    account_type: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    account_class: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(16)],
    }),
    allow_entries: new FormControl(true, { nonNullable: true }),
  });

  protected readonly account = signal<Account | null>(null);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly invalidSubmit = signal(false);
  protected readonly ready = computed(() => this.isNew || this.account() !== null);

  constructor() {
    inject(UnsavedChangesService).track(() => this.form.dirty);
    if (this.id) {
      this.api.account(this.id).subscribe({
        next: (account) => this.fill(account),
        error: (failure: unknown) =>
          this.loadError.set(toUserError(failure, ACCOUNTING_REFERENTIAL_ERRORS)),
      });
    } else {
      afterNextRender(() => this.focus('code'), { injector: this.injector });
    }
  }

  protected async save(): Promise<void> {
    if (this.saving()) {
      return;
    }
    this.error.set(null);
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.invalidSubmit.set(true);
      this.focusFirstInvalid();
      return;
    }
    this.invalidSubmit.set(false);
    const account = this.account();
    if (account && !this.form.dirty) {
      this.toast.info('Aucune modification à enregistrer.');
      await this.router.navigate(['..'], { relativeTo: this.route });
      return;
    }
    this.saving.set(true);
    try {
      const parent = await this.parentId();
      const saved = await firstValueFrom(
        account
          ? this.api.updateAccount(account.public_id, this.changes(parent))
          : this.api.createAccount(this.creation(parent)),
      );
      this.form.markAsPristine();
      if (account) {
        this.toast.success('Modifications enregistrées.');
        await this.router.navigate(['..'], { relativeTo: this.route });
      } else {
        this.toast.success(`Compte « ${saved.code} » créé.`);
        await this.router.navigate(['/app/comptabilite/plan-comptable', saved.public_id]);
      }
    } catch (failure) {
      if (failure instanceof UnknownParentError) {
        this.showFields({ parent: 'Aucun compte de cette société n’a ce code.' });
      } else {
        this.showFailure(toApiError(failure));
      }
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    void this.router.navigate(this.isNew ? ['/app/comptabilite/plan-comptable'] : ['..'], {
      relativeTo: this.route,
    });
  }

  /** The parent's `public_id` from its code, asked to the server; `null` for none. */
  private async parentId(): Promise<string | null> {
    const code = this.form.controls.parent.value.trim();
    if (!code) {
      return null;
    }
    const found = await firstValueFrom(
      this.api.accountByCode(code).pipe(catchError(() => of(null))),
    );
    if (!found) {
      throw new UnknownParentError();
    }
    return found.public_id;
  }

  private creation(parent: string | null): AccountWrite {
    const value = this.form.getRawValue();
    return {
      code: value.code.trim(),
      name: value.name.trim(),
      description: value.description.trim(),
      parent,
      account_type: value.account_type as AccountType,
      account_class: value.account_class.trim(),
      allow_entries: value.allow_entries,
    };
  }

  private changes(parent: string | null): Partial<Omit<AccountWrite, 'code'>> {
    const creation = this.creation(parent) as unknown as Record<string, unknown>;
    const changes: Record<string, unknown> = {};
    for (const [name, control] of Object.entries(this.form.controls)) {
      if (name !== 'code' && control.dirty) {
        changes[name] = creation[name];
      }
    }
    return changes;
  }

  private fill(account: Account): void {
    this.account.set(account);
    this.breadcrumbs.nameCurrent(`${account.code} — ${account.name}`, 1);
    this.form.setValue({
      code: account.code,
      name: account.name,
      description: account.description,
      parent: '',
      account_type: account.account_type,
      account_class: account.account_class,
      allow_entries: account.allow_entries,
    });
    if (account.parent) {
      this.api
        .account(account.parent)
        .pipe(catchError(() => of(null)))
        .subscribe((parent) => {
          // Shown, not sent: only a changed parent goes in the PATCH.
          if (!this.form.controls.parent.dirty) {
            this.form.controls.parent.setValue(parent?.code ?? '');
          }
        });
    }
    this.form.markAsPristine();
    afterNextRender(() => this.focus('name'), { injector: this.injector });
  }

  private showFailure(error: ApiError): void {
    if (error.kind === 'unauthenticated') {
      return;
    }
    const fields: Record<string, string> = {
      ...serverFieldErrors(error, ACCOUNTING_FIELD_MESSAGES),
    };
    const business = error.code ? FIELD_OF_CODE[error.code] : undefined;
    if (business) {
      fields[business[0]] = business[1];
    }
    if (!this.showFields(fields)) {
      this.error.set(toUserError(error, ACCOUNTING_REFERENTIAL_ERRORS));
    }
  }

  private showFields(fields: Record<string, string>): boolean {
    const names = Object.keys(fields).filter((name) => this.form.get(name));
    for (const name of names) {
      this.form.get(name)?.setErrors({ server: fields[name] });
    }
    if (names.length > 0) {
      this.invalidSubmit.set(true);
      this.focus(names[0]);
    }
    return names.length > 0;
  }

  private focusFirstInvalid(): void {
    const first = Object.entries(this.form.controls).find(([, control]) => control.invalid);
    if (first) {
      this.focus(first[0]);
    }
  }

  private focus(name: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(`[formControlName="${name}"]`)?.focus();
  }
}
