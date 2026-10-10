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
import { catchError, firstValueFrom, map, of } from 'rxjs';

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
import { normalizeDecimalInput } from '../../../shared/utils/decimal';
import { Journal } from '../../accounting/data-access/accounting-models';
import { AccountingApi } from '../../accounting/data-access/accounting-api';
import { CurrencyOption } from '../../partners/data-access/partner-models';
import { PartnersApi } from '../../partners/data-access/partners-api';
import {
  TreasuryAccount,
  TreasuryAccountType,
  TreasuryAccountWrite,
} from '../data-access/reconciliation-models';
import { TreasuryApi } from '../data-access/treasury-api';
import { ACCOUNT_TYPES, TREASURY_ERRORS, TREASURY_FIELD_MESSAGES } from '../treasury-presentation';

/** Business refusals that belong to one field (by their stable code). */
const FIELD_OF_CODE: Readonly<Record<string, [string, string]>> = {
  treasury_account_code_exists: ['code', 'Ce code est déjà utilisé par un autre compte.'],
  treasury_opening_balance_locked: [
    'opening_balance',
    'Des opérations sont déjà comptées : le solde d’ouverture ne change plus.',
  ],
};

const BANK_FIELDS = ['bank_name', 'bank_branch', 'account_number', 'iban', 'bic'] as const;

/**
 * Creation (`…/comptes/nouveau`) and modification (`…/comptes/:id/modifier`) of a treasury
 * account with the fields of `TreasuryTreasuryAccountWriteRequest`
 * (`treasury.manage_accounts`). The ledger account and the journal are given by their code
 * and found by the server (`accounting/accounts/?code=`, `accounting/journals/?code=`); the
 * journal is chosen among the bank and cash journals. A modification sends only the fields
 * changed; the server decides (code unique, opening balance locked once operations are
 * booked) and its errors go under their field.
 */
@Component({
  selector: 'alco-treasury-account-form',
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
  styleUrl: '../../accounting/accounting-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreasuryAccountFormPage {
  private readonly api = inject(TreasuryApi);
  private readonly accounting = inject(AccountingApi);
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
      validators: [Validators.required, Validators.maxLength(32)],
    }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    account_type: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    currency: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    ledger_account: new FormControl('', { nonNullable: true }),
    journal: new FormControl('', { nonNullable: true }),
    opening_balance: new FormControl('', { nonNullable: true }),
    bank_name: new FormControl('', { nonNullable: true, validators: Validators.maxLength(100) }),
    bank_branch: new FormControl('', { nonNullable: true, validators: Validators.maxLength(100) }),
    account_number: new FormControl('', {
      nonNullable: true,
      validators: Validators.maxLength(64),
    }),
    iban: new FormControl('', { nonNullable: true, validators: Validators.maxLength(64) }),
    bic: new FormControl('', { nonNullable: true, validators: Validators.maxLength(32) }),
  });

  protected readonly account = signal<TreasuryAccount | null>(null);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly invalidSubmit = signal(false);
  protected readonly currencies = signal<readonly CurrencyOption[]>([]);
  protected readonly ready = computed(() => this.isNew || this.account() !== null);
  protected readonly currencyOptions = computed(() => {
    const current = this.account()?.currency;
    return this.currencies().filter((item) => item.status === 'active' || item.code === current);
  });
  /** The active bank and cash journals, and the account's own if it is no longer one. */
  private readonly journals = signal<readonly Journal[]>([]);
  protected readonly journalOptions = computed(() => {
    const current = this.account()?.journal?.code ?? '';
    const options = this.journals()
      .filter(
        (journal) =>
          journal.code === current ||
          (journal.status === 'active' && ['bank', 'cash'].includes(journal.journal_type)),
      )
      .map((journal) => ({ code: journal.code, label: `${journal.code} — ${journal.name}` }));
    return current && !options.some((option) => option.code === current)
      ? [...options, { code: current, label: current }]
      : options;
  });

  constructor() {
    inject(UnsavedChangesService).track(() => this.form.dirty);
    inject(PartnersApi)
      .currencies()
      .pipe(
        map((page) => page.results),
        catchError(() => of([])),
      )
      .subscribe((list) => this.currencies.set(list));
    this.accounting
      .journals()
      .pipe(
        map((page) => page.results),
        catchError(() => of([] as Journal[])),
      )
      .subscribe((list) => this.journals.set(list));
    if (this.id) {
      this.api.account(this.id).subscribe({
        next: (account) => this.fill(account),
        error: (failure: unknown) => this.loadError.set(toUserError(failure, TREASURY_ERRORS)),
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
      const references = await this.references();
      if (references === null) {
        return;
      }
      const write = this.write(references);
      const saved = await firstValueFrom(
        account
          ? this.api.updateAccount(account.public_id, this.changes(write))
          : this.api.createAccount(write),
      );
      this.form.markAsPristine();
      if (account) {
        this.toast.success('Modifications enregistrées.');
        await this.router.navigate(['..'], { relativeTo: this.route });
      } else {
        this.toast.success(`Compte « ${saved.code} » créé.`);
        await this.router.navigate(['/app/comptabilite/tresorerie/comptes', saved.public_id]);
      }
    } catch (failure) {
      this.showFailure(toApiError(failure));
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    void this.router.navigate(this.isNew ? ['/app/comptabilite/tresorerie/comptes'] : ['..'], {
      relativeTo: this.route,
    });
  }

  /**
   * The ledger account and the journal of their codes, found by the server; `null` (and the
   * field says so) when a code matches nothing.
   */
  private async references(): Promise<{ ledger: string | null; journal: string | null } | null> {
    const value = this.form.getRawValue();
    const ledgerCode = value.ledger_account.trim();
    const journalCode = value.journal.trim();
    const ledger = ledgerCode
      ? await firstValueFrom(this.accounting.accountByCode(ledgerCode))
      : null;
    if (ledgerCode && !ledger) {
      this.fieldError('ledger_account', 'Aucun compte de la société n’a ce code.');
      return null;
    }
    const journal = journalCode
      ? ((await firstValueFrom(this.accounting.journals({ code: journalCode }))).results[0] ?? null)
      : null;
    if (journalCode && !journal) {
      this.fieldError('journal', 'Aucun journal de la société n’a ce code.');
      return null;
    }
    return { ledger: ledger?.public_id ?? null, journal: journal?.public_id ?? null };
  }

  private write(references: {
    ledger: string | null;
    journal: string | null;
  }): TreasuryAccountWrite {
    const value = this.form.getRawValue();
    const write: Record<string, unknown> = {
      code: value.code.trim(),
      name: value.name.trim(),
      account_type: value.account_type as TreasuryAccountType,
      currency: value.currency,
      ledger_account: references.ledger,
      journal: references.journal,
    };
    const opening = value.opening_balance.trim();
    if (opening) {
      // The typed figure, normalised (« 1 250 000,5 »); the server decides whether it stands.
      write['opening_balance'] = normalizeDecimalInput(opening) ?? opening;
    }
    for (const name of BANK_FIELDS) {
      write[name] = value[name].trim();
    }
    return write as unknown as TreasuryAccountWrite;
  }

  private changes(write: TreasuryAccountWrite): Partial<TreasuryAccountWrite> {
    const all = write as unknown as Record<string, unknown>;
    const changes: Record<string, unknown> = {};
    for (const [name, control] of Object.entries(this.form.controls)) {
      if (control.dirty && name in all) {
        changes[name] = all[name];
      }
    }
    return changes;
  }

  private fill(account: TreasuryAccount): void {
    this.account.set(account);
    this.breadcrumbs.nameCurrent(`${account.code} — ${account.name}`, 1);
    this.form.setValue({
      code: account.code,
      name: account.name,
      account_type: account.account_type,
      currency: account.currency,
      ledger_account: account.ledger_account?.code ?? '',
      journal: account.journal?.code ?? '',
      opening_balance: account.opening_balance ?? '',
      bank_name: account.bank_name ?? '',
      bank_branch: account.bank_branch ?? '',
      account_number: account.account_number ?? '',
      iban: account.iban ?? '',
      bic: account.bic ?? '',
    });
    this.form.markAsPristine();
    afterNextRender(() => this.focus('name'), { injector: this.injector });
  }

  private fieldError(name: string, message: string): void {
    this.form.get(name)?.setErrors({ server: message });
    this.invalidSubmit.set(true);
    this.focus(name);
  }

  private showFailure(error: ApiError): void {
    if (error.kind === 'unauthenticated') {
      return;
    }
    const fields: Record<string, string> = { ...serverFieldErrors(error, TREASURY_FIELD_MESSAGES) };
    const business = error.code ? FIELD_OF_CODE[error.code] : undefined;
    if (business) {
      fields[business[0]] = business[1];
    }
    const names = Object.keys(fields).filter((name) => this.form.get(name));
    for (const name of names) {
      this.form.get(name)?.setErrors({ server: fields[name] });
    }
    if (names.length > 0) {
      this.invalidSubmit.set(true);
      this.focus(names[0]);
      return;
    }
    this.error.set(toUserError(error, TREASURY_ERRORS));
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
