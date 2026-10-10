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
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  catchError,
  distinctUntilChanged,
  firstValueFrom,
  map,
  of,
  startWith,
  switchMap,
} from 'rxjs';

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
import { PartnersApi } from '../../partners/data-access/partners-api';
import { CurrencyOption } from '../../partners/data-access/partner-models';
import {
  ACCOUNTING_FIELD_MESSAGES,
  ACCOUNTING_REFERENTIAL_ERRORS,
  JOURNAL_ACCOUNT_FIELDS,
  JOURNAL_TYPES,
} from '../accounting-presentation';
import { Account, Journal, JournalType, JournalWrite } from '../data-access/accounting-models';
import { AccountingApi } from '../data-access/accounting-api';

/** « 601100 — Achats de marchandises »: an account of the selection list. */
const accountLabel = (account: { readonly code: string; readonly name: string }) =>
  `${account.code} — ${account.name}`;

/** An account of the selection list: its public id (what the form keeps) and its words. */
interface AccountChoice {
  readonly id: string;
  readonly label: string;
}

/** Business refusals that belong to one field (by their stable code). */
const FIELD_OF_CODE: Readonly<Record<string, [string, string]>> = {
  accounting_journal_code_exists: ['code', 'Ce code est déjà utilisé par un autre journal.'],
  accounting_journal_code_in_use: [
    'code',
    'Des écritures validées sont déjà numérotées avec ce code : il ne change plus.',
  ],
  accounting_journal_numbering_in_use: [
    'sequence_prefix',
    'Des écritures sont déjà numérotées dans ce journal : sa numérotation ne change plus.',
  ],
  accounting_account_inactive: ['default_account', 'Ce compte est inactif.'],
  accounting_account_not_postable: [
    'default_account',
    'Ce compte ne reçoit pas d’écritures : choisissez un compte sans sous-compte.',
  ],
  currency_inactive: ['default_currency', 'Cette devise est inactive.'],
};

/**
 * A journal as Odoo shows it, to create it (`…/journaux/nouveau`) or change it
 * (`…/journaux/:id/modifier`): Nom du journal, Type (Ventes, Achats, Banque, Caisse,
 * Opérations diverses), Code court (it changes until an entry of the journal is numbered: the
 * server decides), Devise and the « Compte » of the type (revenue, expense, bank or cash
 * account; none for miscellaneous operations), chosen in a selection list of the type's
 * accounts, optional (« Aucun compte »). The
 * numbering's prefix is an advanced option; its number of digits stays the server's. A
 * modification sends only the fields changed. The server decides; its errors go under their
 * field.
 */
@Component({
  selector: 'alco-journal-form',
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
  templateUrl: './journal-form.html',
  styleUrls: ['../accounting-sheet.scss', './journal-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JournalFormPage {
  private readonly api = inject(AccountingApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AlcoToastService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly id = this.route.snapshot.paramMap.get('id');
  protected readonly isNew = this.id === null;
  protected readonly types = JOURNAL_TYPES;

  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    journal_type: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    code: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(32)],
    }),
    default_currency: new FormControl('', { nonNullable: true }),
    /** The public id of the chosen account, '' : none (the field is optional). */
    default_account: new FormControl('', { nonNullable: true }),
    sequence_prefix: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(32)],
    }),
  });

  protected readonly journal = signal<Journal | null>(null);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly invalidSubmit = signal(false);
  protected readonly currencies = signal<readonly CurrencyOption[]>([]);
  protected readonly ready = computed(() => this.isNew || this.journal() !== null);

  protected readonly currencyOptions = computed(() => {
    const current = this.journal()?.default_currency;
    return this.currencies().filter((item) => item.status === 'active' || item.code === current);
  });

  private readonly value = toSignal(
    this.form.valueChanges.pipe(
      startWith(null),
      map(() => this.form.getRawValue()),
    ),
    { requireSync: true },
  );
  private readonly type = computed(() => this.value().journal_type as JournalType);
  /** The « Compte par défaut » of the chosen type, in Odoo's words; none for OD. */
  protected readonly accountField = computed(() => JOURNAL_ACCOUNT_FIELDS[this.type()] ?? null);
  /** Every account of the chosen type, by code; read again when the type changes. */
  private readonly accounts = toSignal(
    toObservable(this.type).pipe(
      distinctUntilChanged(),
      switchMap((type) =>
        this.api.journalAccounts(type).pipe(catchError(() => of([] as readonly Account[]))),
      ),
    ),
    { initialValue: [] as readonly Account[] },
  );
  /** The selection list, with the journal's own account if it is no longer one of them. */
  protected readonly accountChoices = computed<readonly AccountChoice[]>(() => {
    const choices = this.accounts().map((account) => ({
      id: account.public_id,
      label: accountLabel(account),
    }));
    const own = this.journal()?.default_account;
    return own && !choices.some((choice) => choice.id === own.public_id)
      ? [...choices, { id: own.public_id, label: accountLabel(own) }]
      : choices;
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
    // Another type takes other accounts: the default account is chosen again.
    this.form.controls.journal_type.valueChanges.subscribe(() => {
      const account = this.form.controls.default_account;
      if (account.value !== '') {
        account.setValue('');
        account.markAsDirty();
      }
    });
    if (this.id) {
      this.api.journal(this.id).subscribe({
        next: (journal) => this.fill(journal),
        error: (failure: unknown) =>
          this.loadError.set(toUserError(failure, ACCOUNTING_REFERENTIAL_ERRORS)),
      });
    } else {
      afterNextRender(() => this.focus('name'), { injector: this.injector });
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
    const journal = this.journal();
    if (journal && !this.form.dirty) {
      this.toast.info('Aucune modification à enregistrer.');
      await this.router.navigate(['..'], { relativeTo: this.route });
      return;
    }
    this.saving.set(true);
    try {
      const saved = await firstValueFrom(
        journal
          ? this.api.updateJournal(journal.public_id, this.changes())
          : this.api.createJournal(this.creation()),
      );
      this.form.markAsPristine();
      if (journal) {
        this.toast.success('Modifications enregistrées.');
        await this.router.navigate(['..'], { relativeTo: this.route });
      } else {
        this.toast.success(`Journal « ${saved.code} » créé.`);
        await this.router.navigate(['/app/comptabilite/journaux', saved.public_id]);
      }
    } catch (failure) {
      this.showFailure(toApiError(failure));
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    void this.router.navigate(this.isNew ? ['/app/comptabilite/journaux'] : ['..'], {
      relativeTo: this.route,
    });
  }

  /** Fields of the contract; the number of digits is left to the server (6). */
  private creation(): JournalWrite {
    const value = this.form.getRawValue();
    const type = value.journal_type as JournalType;
    return {
      code: value.code.trim(),
      name: value.name.trim(),
      journal_type: type,
      default_currency: value.default_currency || null,
      // Miscellaneous operations have no default account; « Aucun compte » is none.
      default_account: JOURNAL_ACCOUNT_FIELDS[type] ? value.default_account || null : null,
      sequence_prefix: value.sequence_prefix.trim(),
    };
  }

  private changes(): Partial<JournalWrite> {
    const creation = this.creation() as unknown as Record<string, unknown>;
    const changes: Record<string, unknown> = {};
    for (const [name, control] of Object.entries(this.form.controls)) {
      if (control.dirty && name in creation) {
        changes[name] = creation[name];
      }
    }
    return changes;
  }

  private fill(journal: Journal): void {
    this.journal.set(journal);
    this.breadcrumbs.nameCurrent(`${journal.code} — ${journal.name}`, 1);
    this.form.setValue(
      {
        name: journal.name,
        journal_type: journal.journal_type,
        code: journal.code,
        default_currency: journal.default_currency ?? '',
        default_account: journal.default_account?.public_id ?? '',
        sequence_prefix: journal.sequence_prefix,
      },
      { emitEvent: false },
    );
    this.form.updateValueAndValidity();
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
    const names = Object.keys(fields).filter((name) => this.form.get(name));
    for (const name of names) {
      this.form.get(name)?.setErrors({ server: fields[name] });
    }
    if (names.length > 0) {
      this.invalidSubmit.set(true);
      this.focus(names[0]);
      return;
    }
    this.error.set(toUserError(error, ACCOUNTING_REFERENTIAL_ERRORS));
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
