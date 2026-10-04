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
import { PartnersApi } from '../../partners/data-access/partners-api';
import { CurrencyOption } from '../../partners/data-access/partner-models';
import {
  ACCOUNTING_FIELD_MESSAGES,
  ACCOUNTING_REFERENTIAL_ERRORS,
  JOURNAL_TYPES,
} from '../accounting-presentation';
import { Journal, JournalType, JournalWrite } from '../data-access/accounting-models';
import { AccountingApi } from '../data-access/accounting-api';

/** Business refusals that belong to one field (by their stable code). */
const FIELD_OF_CODE: Readonly<Record<string, [string, string]>> = {
  accounting_journal_code_exists: ['code', 'Ce code est déjà utilisé par un autre journal.'],
  accounting_journal_numbering_in_use: [
    'sequence_prefix',
    'Des écritures sont déjà numérotées dans ce journal : sa numérotation ne change plus.',
  ],
  currency_inactive: ['default_currency', 'Cette devise est inactive.'],
};

/**
 * Creation (`…/journaux/nouveau`) and modification (`…/journaux/:id/modifier`) of a
 * journal with exactly the fields of `AccountingJournalWriteRequest`. A modification sends
 * only the fields changed, never the code (fixed at creation). The server decides; its
 * errors go under their field.
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
  styleUrl: '../accounting-sheet.scss',
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
    code: new FormControl('', {
      nonNullable: true,
      validators: this.isNew ? [Validators.required, Validators.maxLength(32)] : [],
    }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    journal_type: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    default_currency: new FormControl('', { nonNullable: true }),
    sequence_prefix: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(32)],
    }),
    sequence_padding: new FormControl<number | null>(null, {
      validators: [Validators.min(1), Validators.max(12)],
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

  constructor() {
    inject(UnsavedChangesService).track(() => this.form.dirty);
    inject(PartnersApi)
      .currencies()
      .pipe(
        map((page) => page.results),
        catchError(() => of([])),
      )
      .subscribe((list) => this.currencies.set(list));
    if (this.id) {
      this.api.journal(this.id).subscribe({
        next: (journal) => this.fill(journal),
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

  /** Fields of the contract; the numbering is sent only when the user gave it. */
  private creation(): JournalWrite {
    const value = this.form.getRawValue();
    const write: Record<string, unknown> = {
      code: value.code.trim(),
      name: value.name.trim(),
      journal_type: value.journal_type as JournalType,
      default_currency: value.default_currency || null,
      sequence_prefix: value.sequence_prefix.trim(),
    };
    if (value.sequence_padding !== null) {
      write['sequence_padding'] = value.sequence_padding;
    }
    return write as unknown as JournalWrite;
  }

  private changes(): Partial<Omit<JournalWrite, 'code'>> {
    const creation = this.creation() as unknown as Record<string, unknown>;
    const changes: Record<string, unknown> = {};
    for (const [name, control] of Object.entries(this.form.controls)) {
      if (name !== 'code' && control.dirty && name in creation) {
        changes[name] = creation[name];
      }
    }
    return changes;
  }

  private fill(journal: Journal): void {
    this.journal.set(journal);
    this.breadcrumbs.nameCurrent(`${journal.code} — ${journal.name}`, 1);
    this.form.setValue({
      code: journal.code,
      name: journal.name,
      journal_type: journal.journal_type,
      default_currency: journal.default_currency ?? '',
      sequence_prefix: journal.sequence_prefix,
      sequence_padding: journal.sequence_padding,
    });
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
