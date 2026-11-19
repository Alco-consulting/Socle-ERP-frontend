import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { UserError, toUserError } from '../../../core/errors/user-error';
import { UnsavedChangesService } from '../../../core/navigation/unsaved-changes';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { ACCOUNTING_REFERENTIAL_ERRORS } from '../accounting-presentation';
import { EntriesApi } from '../data-access/entries-api';
import { AccountingSettings } from '../data-access/entry-models';

type Setting = keyof AccountingSettings;

/** Which permission changes which setting (the server checks it too). */
const PERMISSION: Readonly<Record<Setting, string>> = {
  submission_required: 'accounting.manage_journals',
  parent_accounts_postable: 'accounting.manage_accounts',
};

/** Comptabilité › Configuration › Paramètres comptables, as Odoo's settings: one box each. */
@Component({
  selector: 'alco-accounting-settings-page',
  imports: [ReactiveFormsModule, AlcoButton, AlcoErrorState, AlcoLoading, AlcoPageHeader],
  templateUrl: './accounting-settings-page.html',
  styleUrls: ['../accounting-sheet.scss', './accounting-settings-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountingSettingsPage {
  private readonly api = inject(EntriesApi);
  private readonly session = inject(SessionStore);
  private readonly toast = inject(AlcoToastService);

  protected readonly form = new FormGroup({
    submission_required: new FormControl(true, { nonNullable: true }),
    parent_accounts_postable: new FormControl(false, { nonNullable: true }),
  });

  protected readonly settings = signal<AccountingSettings | null>(null);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly allowed = computed(() => ({
    submission_required: this.session.can(PERMISSION.submission_required),
    parent_accounts_postable: this.session.can(PERMISSION.parent_accounts_postable),
  }));
  protected readonly canSave = computed(() => Object.values(this.allowed()).some(Boolean));

  constructor() {
    inject(UnsavedChangesService).track(() => this.form.dirty);
    effect(() => {
      if (this.session.activeCompany()?.id) {
        untracked(() => this.load());
      }
    });
    effect(() => {
      for (const [name, allowed] of Object.entries(this.allowed())) {
        const control = this.form.get(name);
        if (allowed) {
          control?.enable();
        } else {
          control?.disable();
        }
      }
    });
  }

  protected async save(): Promise<void> {
    const settings = this.settings();
    if (!settings || this.saving() || !this.canSave()) {
      return;
    }
    this.error.set(null);
    const changes = this.changes(settings);
    if (Object.keys(changes).length === 0) {
      this.form.markAsPristine();
      this.toast.info('Aucune modification à enregistrer.');
      return;
    }
    this.saving.set(true);
    try {
      this.fill(await firstValueFrom(this.api.saveSettings(changes)));
      this.toast.success('Paramètres comptables enregistrés.');
    } catch (failure) {
      this.error.set(toUserError(failure, ACCOUNTING_REFERENTIAL_ERRORS));
    } finally {
      this.saving.set(false);
    }
  }

  protected discard(): void {
    const settings = this.settings();
    if (settings) {
      this.fill(settings);
    }
    this.error.set(null);
  }

  private load(): void {
    this.settings.set(null);
    this.loadError.set(null);
    this.api.settings().subscribe({
      next: (settings) => this.fill(settings),
      error: (failure: unknown) =>
        this.loadError.set(toUserError(failure, ACCOUNTING_REFERENTIAL_ERRORS)),
    });
  }

  private fill(settings: AccountingSettings): void {
    this.settings.set(settings);
    this.form.reset(settings);
  }

  /** Only the boxes changed and allowed: each setting needs its own permission. */
  private changes(settings: AccountingSettings): Partial<AccountingSettings> {
    const value = this.form.getRawValue();
    const allowed = this.allowed();
    const changes: Partial<Record<Setting, boolean>> = {};
    for (const name of Object.keys(PERMISSION) as Setting[]) {
      if (allowed[name] && value[name] !== settings[name]) {
        changes[name] = value[name];
      }
    }
    return changes;
  }
}
