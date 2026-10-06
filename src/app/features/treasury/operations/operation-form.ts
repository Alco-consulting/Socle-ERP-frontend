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
import { AccountingApi } from '../../accounting/data-access/accounting-api';
import { EntriesApi } from '../../accounting/data-access/entries-api';
import {
  Direction,
  OperationType,
  OperationWrite,
  TreasuryAccount,
  TreasuryOperation,
} from '../data-access/reconciliation-models';
import { TreasuryApi } from '../data-access/treasury-api';
import {
  DIRECTIONS,
  OPERATION_TYPES,
  TREASURY_ERRORS,
  TREASURY_FIELD_MESSAGES,
} from '../treasury-presentation';

/** Business refusals that belong to one field (by their stable code). */
const FIELD_OF_CODE: Readonly<Record<string, [string, string]>> = {
  treasury_direction_mismatch: ['direction', 'Ce type d’opération fixe le sens du mouvement.'],
  treasury_amount_invalid: [
    'amount',
    'Montant strictement positif, dans les décimales de la devise du compte.',
  ],
  treasury_account_inactive: ['treasury_account', 'Ce compte de trésorerie est inactif.'],
};

/** Types offered for a new operation: an internal transfer is made by « Nouveau virement ». */
const CREATABLE_TYPES = OPERATION_TYPES.filter((item) => item.id !== 'transfer');

/**
 * Creation (`…/operations/nouvelle`, `treasury.create`) and modification of a draft
 * (`…/operations/:id/modifier`, `treasury.update`) with the fields of
 * `TreasuryOperationWriteRequest`. The partner and the offset account are given by their
 * code and found by the server. One idempotency key per new operation, kept while it is
 * retried. A modification sends only the fields changed; the server decides (type and
 * direction, amount, draft only) and its errors go under their field.
 */
@Component({
  selector: 'alco-treasury-operation-form',
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
  templateUrl: './operation-form.html',
  styleUrl: '../../accounting/accounting-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreasuryOperationFormPage {
  private readonly api = inject(TreasuryApi);
  private readonly accounting = inject(AccountingApi);
  private readonly entries = inject(EntriesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AlcoToastService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly id = this.route.snapshot.paramMap.get('id');
  protected readonly isNew = this.id === null;
  protected readonly types = CREATABLE_TYPES;
  protected readonly directions = (['inflow', 'outflow'] as const).map((id) => ({
    id,
    label: DIRECTIONS[id],
  }));
  /** Kept while the same new operation is retried: the server creates it once. */
  private readonly idempotencyKey = crypto.randomUUID();

  protected readonly form = new FormGroup({
    treasury_account: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    operation_type: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    direction: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    operation_date: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    value_date: new FormControl('', { nonNullable: true }),
    amount: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    reference: new FormControl('', { nonNullable: true, validators: Validators.maxLength(64) }),
    description: new FormControl('', {
      nonNullable: true,
      validators: Validators.maxLength(255),
    }),
    counterparty: new FormControl('', { nonNullable: true }),
    counterparty_name: new FormControl('', {
      nonNullable: true,
      validators: Validators.maxLength(255),
    }),
    offset_account: new FormControl('', { nonNullable: true }),
  });

  protected readonly operation = signal<TreasuryOperation | null>(null);
  protected readonly accounts = signal<readonly TreasuryAccount[]>([]);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly invalidSubmit = signal(false);
  protected readonly ready = computed(() => this.isNew || this.operation() !== null);
  /** Active accounts, and the operation's own even if inactive since. */
  protected readonly accountOptions = computed(() => {
    const current = this.operation()?.treasury_account.public_id;
    return this.accounts().filter((item) => item.status === 'active' || item.public_id === current);
  });

  constructor() {
    inject(UnsavedChangesService).track(() => this.form.dirty);
    // « Nouvelle opération » from an account (`?compte=`): that account, once the list is read.
    const preset = this.id ? null : this.route.snapshot.queryParamMap.get('compte');
    this.api
      .accounts()
      .pipe(
        map((page) => page.results),
        catchError(() => of([])),
      )
      .subscribe((list) => {
        this.accounts.set(list);
        const found = preset ? list.find((item) => item.code === preset.toUpperCase()) : null;
        if (found) {
          this.form.controls.treasury_account.setValue(found.public_id);
        }
      });
    if (this.id) {
      this.api.operation(this.id).subscribe({
        next: (operation) => this.fill(operation),
        error: (failure: unknown) => this.loadError.set(toUserError(failure, TREASURY_ERRORS)),
      });
    } else {
      afterNextRender(() => this.focus('treasury_account'), { injector: this.injector });
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
    const operation = this.operation();
    if (operation && !this.form.dirty) {
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
        operation
          ? this.api.updateOperation(operation.public_id, this.changes(write))
          : this.api.createOperation({ ...write, idempotency_key: this.idempotencyKey }),
      );
      this.form.markAsPristine();
      this.toast.success(
        operation ? 'Modifications enregistrées.' : 'Opération créée en brouillon.',
      );
      await this.router.navigate(['/app/comptabilite/tresorerie/operations', saved.public_id]);
    } catch (failure) {
      this.showFailure(toApiError(failure));
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    void this.router.navigate(this.isNew ? ['/app/comptabilite/tresorerie/operations'] : ['..'], {
      relativeTo: this.route,
    });
  }

  /** The partner and the offset account of their codes, found by the server. */
  private async references(): Promise<{ partner: string | null; offset: string | null } | null> {
    const value = this.form.getRawValue();
    const partnerCode = value.counterparty.trim();
    const offsetCode = value.offset_account.trim();
    const partner = partnerCode
      ? await firstValueFrom(this.entries.partnerByCode(partnerCode))
      : null;
    if (partnerCode && !partner) {
      this.fieldError('counterparty', 'Aucun tiers de la société n’a ce code.');
      return null;
    }
    const offset = offsetCode
      ? await firstValueFrom(this.accounting.accountByCode(offsetCode))
      : null;
    if (offsetCode && !offset) {
      this.fieldError('offset_account', 'Aucun compte de la société n’a ce code.');
      return null;
    }
    return { partner: partner?.public_id ?? null, offset: offset?.public_id ?? null };
  }

  private write(references: { partner: string | null; offset: string | null }): OperationWrite {
    const value = this.form.getRawValue();
    const amount = value.amount.trim();
    return {
      treasury_account: value.treasury_account,
      operation_type: value.operation_type as OperationType,
      direction: value.direction as Direction,
      operation_date: value.operation_date,
      value_date: value.value_date || null,
      // The typed figure, normalised; the server decides whether it stands.
      amount: normalizeDecimalInput(amount) ?? amount,
      reference: value.reference.trim(),
      description: value.description.trim(),
      counterparty: references.partner,
      counterparty_name: value.counterparty_name.trim(),
      offset_account: references.offset,
    };
  }

  private changes(write: OperationWrite): Partial<OperationWrite> {
    const all = write as unknown as Record<string, unknown>;
    const changes: Record<string, unknown> = {};
    for (const [name, control] of Object.entries(this.form.controls)) {
      if (control.dirty && name in all) {
        changes[name] = all[name];
      }
    }
    return changes;
  }

  private fill(operation: TreasuryOperation): void {
    this.operation.set(operation);
    this.breadcrumbs.nameCurrent(operation.reference || operation.description || 'Opération', 1);
    this.form.setValue({
      treasury_account: operation.treasury_account.public_id,
      operation_type: operation.operation_type,
      direction: operation.direction,
      operation_date: operation.operation_date,
      value_date: operation.value_date ?? '',
      amount: operation.amount,
      reference: operation.reference,
      description: operation.description,
      counterparty: operation.counterparty?.code ?? '',
      counterparty_name: operation.counterparty_name,
      offset_account: operation.offset_account?.code ?? '',
    });
    this.form.markAsPristine();
    afterNextRender(() => this.focus('operation_date'), { injector: this.injector });
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
