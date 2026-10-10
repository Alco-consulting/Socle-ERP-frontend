import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import { catchError, firstValueFrom, map, of } from 'rxjs';

import { serverFieldErrors } from '../../../core/errors/field-errors';
import { UserError, toUserError } from '../../../core/errors/user-error';
import { ApiError, toApiError } from '../../../core/http/api-error';
import { UnsavedChangesService } from '../../../core/navigation/unsaved-changes';
import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { localToday } from '../../../shared/utils/dates';
import {
  ACCOUNTING_FIELD_MESSAGES,
  ACCOUNTING_REFERENTIAL_ERRORS,
} from '../accounting-presentation';
import { FiscalYear } from '../data-access/accounting-models';
import { AccountingApi } from '../data-access/accounting-api';

const LIST = '/app/comptabilite/configuration/exercices';

/** Business refusals that belong to one field (by their stable code). */
const FIELD_OF_CODE: Readonly<Record<string, [string, string]>> = {
  accounting_fiscal_year_code_exists: ['code', 'Un exercice de la société porte déjà ce code.'],
  accounting_fiscal_year_overlap: [
    'start_date',
    'Ces dates chevauchent un autre exercice de la société.',
  ],
};

/** « 2026-12-31 » → « 2027-01-01 » (local dates, at noon: no daylight saving surprise). */
function nextDay(iso: string): string {
  const day = new Date(`${iso}T12:00:00`);
  day.setDate(day.getDate() + 1);
  return localToday(day);
}

/** The last day of the twelve months that start on `iso` (« 2026-01-01 » → « 2026-12-31 »). */
function twelveMonthsFrom(iso: string): string {
  const day = new Date(`${iso}T12:00:00`);
  day.setFullYear(day.getFullYear() + 1);
  day.setDate(day.getDate() - 1);
  return localToday(day);
}

/** « 2026 » for a calendar year, « 2026-2027 » for one across two years. */
function yearCode(start: string, end: string): string {
  const [first, last] = [start.slice(0, 4), end.slice(0, 4)];
  return first === last ? first : `${first}-${last}`;
}

/** The end comes after the start (the server checks it too). */
function ordered(group: AbstractControl): ValidationErrors | null {
  const { start_date: start, end_date: end } = group.value as Record<string, string>;
  return start && end && end < start ? { order: true } : null;
}

/**
 * « Nouvel exercice » (`…/configuration/exercices/nouveau`, `accounting.manage_periods`):
 * Code, Libellé, Début, Fin, proposed as the twelve months after the last fiscal year (else
 * the current calendar year, the OHADA rule), and created with one period per calendar month,
 * all or nothing: every date of the year then finds its open period.
 */
@Component({
  selector: 'alco-fiscal-year-form',
  imports: [
    ReactiveFormsModule,
    AlcoButton,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoPageHeader,
  ],
  templateUrl: './fiscal-year-form.html',
  styleUrl: '../accounting-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FiscalYearFormPage {
  private readonly api = inject(AccountingApi);
  private readonly router = inject(Router);
  private readonly toast = inject(AlcoToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly form = new FormGroup(
    {
      code: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(32)],
      }),
      label: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(100)],
      }),
      start_date: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
      end_date: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    },
    { validators: [ordered] },
  );

  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly invalidSubmit = signal(false);

  constructor() {
    inject(UnsavedChangesService).track(() => this.form.dirty);
    this.api
      .fiscalYears()
      .pipe(
        map((page) => page.results),
        catchError(() => of([] as readonly FiscalYear[])),
      )
      .subscribe((years) => this.propose(years));
    // A new start: the twelve months after it, unless the end, code or label were typed.
    this.form.controls.start_date.valueChanges.subscribe((start) => {
      if (!start) {
        return;
      }
      const controls = this.form.controls;
      if (!controls.end_date.dirty) {
        controls.end_date.setValue(twelveMonthsFrom(start));
      }
      this.suggestNames();
    });
    afterNextRender(() => this.focus('code'), { injector: this.injector });
  }

  protected async save(): Promise<void> {
    if (this.saving()) {
      return;
    }
    this.error.set(null);
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.invalidSubmit.set(true);
      return;
    }
    this.invalidSubmit.set(false);
    this.saving.set(true);
    try {
      const value = this.form.getRawValue();
      const saved = await firstValueFrom(
        this.api.createFiscalYear({
          code: value.code.trim(),
          label: value.label.trim(),
          start_date: value.start_date,
          end_date: value.end_date,
          monthly_periods: true,
        }),
      );
      this.form.markAsPristine();
      this.toast.success(`${saved.label} créé, avec ses périodes mensuelles.`);
      await this.router.navigate([LIST], { queryParams: { exercice: saved.public_id } });
    } catch (failure) {
      this.showFailure(toApiError(failure));
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    void this.router.navigateByUrl(LIST);
  }

  /** The twelve months after the last fiscal year, else the current calendar year. */
  private propose(years: readonly FiscalYear[]): void {
    if (this.form.dirty) {
      return;
    }
    const last = years
      .map((year) => year.end_date)
      .sort()
      .at(-1);
    const start = last ? nextDay(last) : `${localToday().slice(0, 4)}-01-01`;
    this.form.controls.start_date.setValue(start, { emitEvent: false });
    this.form.controls.end_date.setValue(twelveMonthsFrom(start), { emitEvent: false });
    this.suggestNames();
    this.form.markAsPristine();
  }

  /** Code and label follow the dates until the user types them. */
  private suggestNames(): void {
    const { code, label, start_date: start, end_date: end } = this.form.controls;
    if (!start.value || !end.value) {
      return;
    }
    const suggested = yearCode(start.value, end.value);
    if (!code.dirty) {
      code.setValue(suggested);
    }
    if (!label.dirty) {
      label.setValue(`Exercice ${suggested}`);
    }
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

  private focus(name: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(`[formControlName="${name}"]`)?.focus();
  }
}
