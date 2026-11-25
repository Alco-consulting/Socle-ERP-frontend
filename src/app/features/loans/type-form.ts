import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, firstValueFrom, map, of } from 'rxjs';

import { UserError, toUserError } from '../../core/errors/user-error';
import { BreadcrumbService } from '../../core/navigation/route-trail';
import { UnsavedChangesService } from '../../core/navigation/unsaved-changes';
import { SessionStore } from '../../core/session/session.store';
import {
  AlcoAutocomplete,
  AutocompleteOption,
  AutocompleteSearch,
} from '../../shared/forms/autocomplete';
import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { AccountingApi } from '../accounting/data-access/accounting-api';
import { EntriesApi } from '../accounting/data-access/entries-api';
import { LoansApi } from './data-access/loans-api';
import { CodeRef, LoanType, LoanTypeWrite } from './data-access/loans-models';
import { LOAN_ERRORS } from './loans-presentation';

const option = (ref: CodeRef | null): AutocompleteOption | null =>
  ref ? { id: ref.public_id, label: ref.code } : null;

/** A loan type: its accounts (by code or name) and its journal. */
@Component({
  selector: 'alco-loan-type-form',
  imports: [
    ReactiveFormsModule,
    AlcoAutocomplete,
    AlcoButton,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
  ],
  templateUrl: './type-form.html',
  styleUrls: ['../accounting/accounting-sheet.scss', './loans-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoanTypeFormPage {
  private readonly api = inject(LoansApi);
  private readonly entries = inject(EntriesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AlcoToastService);
  private readonly session = inject(SessionStore);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly typeId = this.route.snapshot.paramMap.get('id');

  protected readonly isNew = this.typeId === null;
  protected readonly canSave = computed(() => this.session.can('loans.manage_types'));
  protected readonly loanType = signal<LoanType | null>(null);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly ready = computed(() => this.isNew || this.loanType() !== null);
  protected readonly title = computed(() => this.loanType()?.name ?? 'Nouveau type');
  /** The journals of miscellaneous operations, for interest added to the principal. */
  protected readonly journals = toSignal(
    inject(AccountingApi)
      .journals({ status: 'active', journalType: 'general' })
      .pipe(
        map((page) => page.results),
        catchError(() => of([])),
      ),
    { initialValue: [] },
  );

  protected readonly form = new FormGroup({
    code: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(32)],
    }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    journal: new FormControl('', { nonNullable: true }),
    principal_account: new FormControl<AutocompleteOption | null>(null),
    interest_account: new FormControl<AutocompleteOption | null>(null),
    fee_account: new FormControl<AutocompleteOption | null>(null),
  });

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

  constructor() {
    inject(UnsavedChangesService).track(() => this.form.dirty && !this.saving());
    if (this.typeId) {
      this.api.type(this.typeId).subscribe({
        next: (loanType) => this.fill(loanType),
        error: (failure: unknown) => this.loadError.set(toUserError(failure, LOAN_ERRORS)),
      });
    }
    effect(() => {
      const loanType = this.loanType();
      if (loanType) {
        untracked(() => this.breadcrumbs.nameCurrent(loanType.name));
      }
    });
    effect(() => {
      if (this.canSave()) {
        this.form.enable();
        if (!this.isNew) {
          this.form.controls.code.disable();
        }
      } else {
        this.form.disable();
      }
    });
  }

  protected async save(): Promise<void> {
    if (this.saving() || !this.canSave()) {
      return;
    }
    this.error.set(null);
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      return;
    }
    this.saving.set(true);
    try {
      const saved = this.typeId
        ? await firstValueFrom(this.api.updateType(this.typeId, this.payload()))
        : await firstValueFrom(this.api.createType(this.payload()));
      this.form.markAsPristine();
      this.toast.success('Type d’emprunt enregistré.');
      if (this.isNew) {
        await this.router.navigate(['..', saved.public_id], { relativeTo: this.route });
      } else {
        this.fill(saved);
      }
    } catch (failure) {
      this.error.set(toUserError(failure, LOAN_ERRORS));
    } finally {
      this.saving.set(false);
    }
  }

  private payload(): LoanTypeWrite {
    const value = this.form.getRawValue();
    return {
      code: value.code.trim(),
      name: value.name.trim(),
      journal: value.journal || null,
      principal_account: value.principal_account?.id ?? null,
      interest_account: value.interest_account?.id ?? null,
      fee_account: value.fee_account?.id ?? null,
    };
  }

  private fill(loanType: LoanType): void {
    this.loanType.set(loanType);
    this.form.reset({
      code: loanType.code,
      name: loanType.name,
      journal: loanType.journal?.public_id ?? '',
      principal_account: option(loanType.principal_account),
      interest_account: option(loanType.interest_account),
      fee_account: option(loanType.fee_account),
    });
  }
}
