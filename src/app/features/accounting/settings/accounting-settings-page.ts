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
import { firstValueFrom, forkJoin, of } from 'rxjs';

import { UserError, toUserError } from '../../../core/errors/user-error';
import { UnsavedChangesService } from '../../../core/navigation/unsaved-changes';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { TaxesApi } from '../../taxes/data-access/taxes-api';
import { TaxSettings } from '../../taxes/data-access/taxes-models';
import { ACCOUNTING_REFERENTIAL_ERRORS } from '../accounting-presentation';
import { EntriesApi } from '../data-access/entries-api';
import { AccountingSettings } from '../data-access/entry-models';

type AccountingSetting = keyof AccountingSettings;
type Setting = AccountingSetting | keyof TaxSettings;

/** Which permission changes which setting (the server checks it too). */
const PERMISSION: Readonly<Record<Setting, string>> = {
  submission_required: 'accounting.manage_journals',
  parent_accounts_postable: 'accounting.manage_accounts',
  declaration_check_required: 'taxes.update',
};
const ACCOUNTING_SETTINGS: readonly AccountingSetting[] = [
  'submission_required',
  'parent_accounts_postable',
];

interface Loaded {
  readonly accounting: AccountingSettings;
  /** `null`: no right to read the taxes. */
  readonly taxes: TaxSettings | null;
}

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
  private readonly taxesApi = inject(TaxesApi);
  private readonly session = inject(SessionStore);
  private readonly toast = inject(AlcoToastService);

  protected readonly form = new FormGroup({
    submission_required: new FormControl(true, { nonNullable: true }),
    parent_accounts_postable: new FormControl(false, { nonNullable: true }),
    declaration_check_required: new FormControl(true, { nonNullable: true }),
  });

  protected readonly settings = signal<Loaded | null>(null);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly allowed = computed(
    () =>
      Object.fromEntries(
        Object.entries(PERMISSION).map(([name, permission]) => [
          name,
          this.session.can(permission),
        ]),
      ) as Record<Setting, boolean>,
  );
  protected readonly canSave = computed(() => {
    const allowed = this.allowed();
    const taxes = this.settings()?.taxes !== null && allowed.declaration_check_required;
    return ACCOUNTING_SETTINGS.some((name) => allowed[name]) || taxes;
  });

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
    const accounting = this.accountingChanges(settings.accounting);
    const value = this.form.getRawValue();
    const taxes =
      settings.taxes !== null &&
      this.allowed().declaration_check_required &&
      value.declaration_check_required !== settings.taxes.declaration_check_required
        ? { declaration_check_required: value.declaration_check_required }
        : null;
    if (Object.keys(accounting).length === 0 && taxes === null) {
      this.form.markAsPristine();
      this.toast.info('Aucune modification à enregistrer.');
      return;
    }
    this.saving.set(true);
    try {
      this.fill({
        accounting:
          Object.keys(accounting).length > 0
            ? await firstValueFrom(this.api.saveSettings(accounting))
            : settings.accounting,
        taxes: taxes ? await firstValueFrom(this.taxesApi.saveSettings(taxes)) : settings.taxes,
      });
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
    forkJoin({
      accounting: this.api.settings(),
      taxes: this.session.can('taxes.read') ? this.taxesApi.settings() : of(null),
    }).subscribe({
      next: (settings) => this.fill(settings),
      error: (failure: unknown) =>
        this.loadError.set(toUserError(failure, ACCOUNTING_REFERENTIAL_ERRORS)),
    });
  }

  private fill(settings: Loaded): void {
    this.settings.set(settings);
    this.form.reset({
      ...settings.accounting,
      declaration_check_required: settings.taxes?.declaration_check_required ?? true,
    });
  }

  /** Only the boxes changed and allowed: each setting needs its own permission. */
  private accountingChanges(settings: AccountingSettings): Partial<AccountingSettings> {
    const value = this.form.getRawValue();
    const allowed = this.allowed();
    const changes: Partial<Record<AccountingSetting, boolean>> = {};
    for (const name of ACCOUNTING_SETTINGS) {
      if (allowed[name] && value[name] !== settings[name]) {
        changes[name] = value[name];
      }
    }
    return changes;
  }
}
