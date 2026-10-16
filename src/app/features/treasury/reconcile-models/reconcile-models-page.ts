import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Observable, firstValueFrom, map } from 'rxjs';

import { UserError, toUserError } from '../../../core/errors/user-error';
import { toApiError } from '../../../core/http/api-error';
import { requestState } from '../../../core/http/request-state';
import { SessionStore } from '../../../core/session/session.store';
import {
  AlcoAutocomplete,
  AutocompleteOption,
  AutocompleteSearch,
} from '../../../shared/forms/autocomplete';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { EntriesApi } from '../../accounting/data-access/entries-api';
import { ReconcileModel, ReconcileModelWrite } from '../data-access/reconciliation-models';
import { TreasuryApi } from '../data-access/treasury-api';
import { TREASURY_ERRORS } from '../treasury-presentation';

/** An account of a selection field: its code, its name beside. */
const accountOption = (account: { public_id: string; code: string; name: string }) => ({
  id: account.public_id,
  label: account.code,
  detail: account.name,
});

/** A new model, or the model changed. */
type Editing =
  { readonly kind: 'new' } | { readonly kind: 'model'; readonly model: ReconcileModel };

/**
 * Odoo's « Modèles de rapprochement » (note backend 0048), opened by « Gérer modèles » of the ⋮
 * menu of a line: each gives the line its account and label in one click (« Frais
 * bancaires »: 631100). « Virements internes » is built in. Typed in the list itself.
 */
@Component({
  selector: 'alco-reconcile-models-page',
  imports: [
    NgTemplateOutlet,
    ReactiveFormsModule,
    AlcoAutocomplete,
    AlcoButton,
    AlcoErrorState,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
  ],
  templateUrl: './reconcile-models-page.html',
  styleUrl: './reconcile-models-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReconcileModelsPage {
  private readonly treasury = inject(TreasuryApi);
  private readonly entries = inject(EntriesApi);
  private readonly toast = inject(AlcoToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly canManage = inject(SessionStore).can('treasury.manage_accounts');
  protected readonly models = requestState(() =>
    this.treasury.reconcileModels().pipe(map((found) => found.results)),
  );

  protected readonly editing = signal<Editing | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly invalid = signal<string | null>(null);

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    account: new FormControl<AutocompleteOption | null>(null),
    label: new FormControl('', { nonNullable: true }),
  });

  /** Every account of the chart that takes entries, by its code or name. */
  protected readonly searchAccounts: AutocompleteSearch = (term) =>
    this.entries.postableAccounts(term).pipe(map((found) => found.map(accountOption)));

  protected isEdited(model: ReconcileModel): boolean {
    const editing = this.editing();
    return editing?.kind === 'model' && editing.model.public_id === model.public_id;
  }

  protected newModel(): void {
    this.form.reset({ name: '', account: null, label: '' });
    this.start({ kind: 'new' });
  }

  protected change(model: ReconcileModel): void {
    this.form.reset({
      name: model.name,
      account: accountOption(model.account),
      label: model.label,
    });
    this.start({ kind: 'model', model });
  }

  protected cancel(): void {
    this.editing.set(null);
    this.invalid.set(null);
    this.error.set(null);
  }

  /** Entrée in the row typed: saved (a choice in a list stays a choice). */
  protected onEnter(event: Event): void {
    if (event.defaultPrevented) {
      return;
    }
    event.preventDefault();
    void this.save();
  }

  protected async save(): Promise<void> {
    const editing = this.editing();
    if (!editing || this.saving()) {
      return;
    }
    const value = this.form.getRawValue();
    if (!value.name.trim() || !value.account) {
      this.invalid.set('Saisissez le nom du modèle et choisissez son compte.');
      return;
    }
    const write: ReconcileModelWrite = {
      name: value.name.trim(),
      account: value.account.id,
      label: value.label.trim(),
    };
    await this.run(
      editing.kind === 'new'
        ? this.treasury.createReconcileModel(write)
        : this.treasury.updateReconcileModel(editing.model.public_id, write),
      `Modèle « ${write.name} » enregistré.`,
    );
  }

  protected async setActive(model: ReconcileModel, active: boolean): Promise<void> {
    if (this.saving()) {
      return;
    }
    await this.run(
      this.treasury.updateReconcileModel(model.public_id, {
        status: active ? 'active' : 'inactive',
      }),
      active ? `« ${model.name} » réactivé.` : `« ${model.name} » archivé.`,
    );
  }

  private async run(request: Observable<unknown>, done: string): Promise<void> {
    this.invalid.set(null);
    this.error.set(null);
    this.saving.set(true);
    try {
      await firstValueFrom(request);
      this.editing.set(null);
      this.toast.success(done);
      this.models.reload();
    } catch (failure) {
      const error = toApiError(failure);
      if (error.kind !== 'unauthenticated') {
        this.error.set(toUserError(error, TREASURY_ERRORS));
      }
    } finally {
      this.saving.set(false);
    }
  }

  private start(editing: Editing): void {
    this.invalid.set(null);
    this.error.set(null);
    this.editing.set(editing);
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('#model-name')?.focus());
  }
}
