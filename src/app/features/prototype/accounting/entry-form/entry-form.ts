import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, catchError, filter, of, startWith, switchMap, tap } from 'rxjs';

import { UserError, toUserError } from '../../../../core/errors/user-error';
import { SessionStore } from '../../../../core/session/session.store';
import { AlcoFormField } from '../../../../shared/forms/form-field';
import { AlcoInput } from '../../../../shared/forms/input';
import { decimalFormat } from '../../../../shared/forms/validators';
import { AlcoAmountPipe } from '../../../../shared/pipes/amount.pipe';
import { AlcoBadge } from '../../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../../shared/ui/button/button';
import { AlcoConfirmService } from '../../../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoDropdown, DropdownItem } from '../../../../shared/ui/dropdown/dropdown';
import { AlcoEmptyState } from '../../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../../shared/ui/error-state/error-state';
import { AlcoIcon } from '../../../../shared/ui/icon/icon';
import { AlcoLoading } from '../../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../../shared/ui/page-header/page-header';
import { AlcoTabPanel, AlcoTabs, TabItem } from '../../../../shared/ui/tabs/tabs';
import { AlcoToastService } from '../../../../shared/ui/toast/toast.service';
import { AlcoWorkflowSteps } from '../../../../shared/ui/workflow-steps/workflow-steps';
import {
  formatDecimal,
  isZeroDecimal,
  normalizeDecimalInput,
  subtractDecimals,
  sumDecimals,
} from '../../../../shared/utils/decimal';
import { ACCOUNTING_ERRORS, ENTRY_STATUS, ENTRY_WORKFLOW } from '../entry-presentation';
import { ACCOUNTS, CURRENCY, CURRENCY_DECIMALS, JOURNALS, PARTNERS } from '../prototype-data';
import { PrototypeAccountingApi } from '../prototype-accounting-api';
import { Entry, EntryDraft, EntryLine } from '../prototype-models';

type LineForm = FormGroup<{
  account: FormControl<string>;
  label: FormControl<string>;
  debit: FormControl<string>;
  credit: FormControl<string>;
}>;

/** « 1150000 » → « 1 150 000 » for reading; `normalizeDecimalInput` reads it back exactly. */
function displayAmount(value: string): string {
  const normalized = normalizeDecimalInput(value);
  return normalized === null ? value : formatDecimal(normalized, CURRENCY_DECIMALS);
}

function lineForm(line?: EntryLine): LineForm {
  return new FormGroup({
    account: new FormControl(line?.account ?? '', {
      nonNullable: true,
      validators: Validators.required,
    }),
    label: new FormControl(line?.label ?? '', {
      nonNullable: true,
      validators: Validators.maxLength(120),
    }),
    debit: new FormControl(displayAmount(line?.debit ?? ''), {
      nonNullable: true,
      validators: decimalFormat(CURRENCY_DECIMALS),
    }),
    credit: new FormControl(displayAmount(line?.credit ?? ''), {
      nonNullable: true,
      validators: decimalFormat(CURRENCY_DECIMALS),
    }),
  });
}

/**
 * PROTOTYPE — form view of the design system: « Informations générales » first, then tabs
 * for lines, attachments and advanced fields. The allowed actions and the state come from
 * the (simulated) server; the debit/credit totals are an input aid, never a decision.
 */
@Component({
  selector: 'alco-entry-form',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoButton,
    AlcoDropdown,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoFormField,
    AlcoIcon,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
    AlcoTabPanel,
    AlcoTabs,
    AlcoWorkflowSteps,
  ],
  templateUrl: './entry-form.html',
  styleUrl: './entry-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntryFormPage {
  private readonly api = inject(PrototypeAccountingApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirm = inject(AlcoConfirmService);
  private readonly toast = inject(AlcoToastService);
  protected readonly session = inject(SessionStore);

  /** Route parameter `:id` (absent on « Nouvelle écriture »). */
  readonly id = input<string>();
  /** Query parameter `?journal=ACH` (entry started from a journal block). */
  readonly journal = input<string>();

  protected readonly journals = JOURNALS;
  protected readonly accounts = ACCOUNTS;
  protected readonly partners = PARTNERS;
  protected readonly currency = CURRENCY;
  protected readonly decimals = CURRENCY_DECIMALS;
  protected readonly workflow = ENTRY_WORKFLOW;
  protected readonly entryStatus = ENTRY_STATUS;

  protected readonly form = new FormGroup({
    date: new FormControl('2026-09-28', { nonNullable: true, validators: Validators.required }),
    journal: new FormControl('', { nonNullable: true, validators: Validators.required }),
    reference: new FormControl('', { nonNullable: true, validators: Validators.maxLength(40) }),
    label: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(120)],
    }),
    partnerId: new FormControl('', { nonNullable: true }),
    currency: new FormControl({ value: CURRENCY, disabled: true }, { nonNullable: true }),
    note: new FormControl('', { nonNullable: true, validators: Validators.maxLength(500) }),
    lines: new FormArray<LineForm>([lineForm(), lineForm()]),
  });

  // ---- Loaded record -----------------------------------------------------------------
  protected readonly entry = signal<Entry | null>(null);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly loading = signal(false);
  protected readonly isNew = computed(() => !this.id());
  protected readonly editable = computed(
    () => this.isNew() || (this.entry()?.actions.includes('save') ?? false),
  );
  protected readonly status = computed(() => this.entry()?.status ?? 'draft');

  // ---- Command state -----------------------------------------------------------------
  protected readonly busy = signal<'save' | 'validate' | 'reverse' | 'delete' | null>(null);
  protected readonly actionError = signal<UserError | null>(null);
  protected readonly formInvalid = signal(false);
  protected readonly tab = signal('lines');

  // ---- Input aid: totals of what is typed (exact decimals, no rounding) -----------------
  private readonly value = toSignal(this.form.valueChanges.pipe(startWith(null)));
  protected readonly totals = computed(() => {
    this.value();
    const lines = this.form.controls.lines.getRawValue();
    const amounts = (side: 'debit' | 'credit') =>
      lines.map((line) => normalizeDecimalInput(line[side]) ?? '0');
    const debit = sumDecimals(amounts('debit'));
    const credit = sumDecimals(amounts('credit'));
    const gap = subtractDecimals(debit, credit);
    return {
      debit,
      credit,
      gap: gap.replace('-', ''),
      balanced: isZeroDecimal(gap),
      empty: isZeroDecimal(debit) && isZeroDecimal(credit),
    };
  });

  protected readonly tabs = computed<readonly TabItem[]>(() => {
    this.value();
    return [
      {
        id: 'lines',
        label: 'Lignes comptables',
        count: this.form.controls.lines.length,
        invalid: this.formInvalid() && this.form.controls.lines.invalid,
      },
      { id: 'documents', label: 'Pièces justificatives', count: 0 },
      { id: 'advanced', label: 'Informations avancées' },
    ];
  });

  protected readonly moreActions = computed<readonly DropdownItem[]>(() => {
    const actions = this.entry()?.actions ?? [];
    return [
      {
        id: 'duplicate',
        label: 'Dupliquer',
        icon: 'copy',
        description: 'Disponible avec le module Écritures',
        disabled: true,
      },
      { id: 'print', label: 'Imprimer', icon: 'download', disabled: true },
      ...(actions.includes('delete')
        ? [
            {
              id: 'delete',
              label: 'Supprimer le brouillon',
              icon: 'trash' as const,
              danger: true,
              dividerBefore: true,
            },
          ]
        : []),
    ];
  });

  constructor() {
    // Error carried over from « Nouvelle écriture » (saved, then refused by the server).
    const carried = this.router.currentNavigation()?.extras.state?.[
      'actionError'
    ] as UserError | null;
    this.actionError.set(carried ?? null);

    toObservable(this.id)
      .pipe(
        filter((id): id is string => !!id),
        tap(() => {
          this.loading.set(true);
          this.loadError.set(null);
        }),
        switchMap((id) =>
          this.api.get(id).pipe(
            catchError((failure: unknown) => {
              this.loadError.set(toUserError(failure, ACCOUNTING_ERRORS));
              return of(null);
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((entry) => {
        this.loading.set(false);
        if (entry) {
          this.show(entry);
        }
      });

    // Journal preselected when the entry is started from a journal block.
    effect(() => {
      const journal = this.journal();
      if (this.isNew() && journal && JOURNALS.some((item) => item.code === journal)) {
        this.form.controls.journal.setValue(journal);
      }
    });
  }

  protected get lines(): FormArray<LineForm> {
    return this.form.controls.lines;
  }

  protected addLine(): void {
    this.lines.push(lineForm());
  }

  protected removeLine(index: number): void {
    this.lines.removeAt(index);
    this.form.markAsDirty();
  }

  /** Groups the thousands of a typed amount when the field is left (valid input only). */
  protected formatAmount(control: FormControl<string>): void {
    if (control.valid && control.value) {
      control.setValue(displayAmount(control.value));
    }
  }

  protected async save(): Promise<void> {
    const saved = await this.persist();
    if (!saved) {
      return;
    }
    if (this.isNew()) {
      this.toast.success(`Brouillon ${saved.number} enregistré.`);
      await this.openRecord(saved);
    } else {
      this.toast.success('Modifications enregistrées.');
    }
  }

  protected async validate(): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: 'Valider cette écriture ?',
      message:
        'Une écriture validée ne peut plus être modifiée. Pour la corriger, il faudra la contrepasser.',
      confirmLabel: 'Valider l’écriture',
    });
    if (!confirmed) {
      return;
    }
    // Unsaved changes are saved first: the server validates what it has stored.
    const current =
      this.editable() && (this.form.dirty || this.isNew()) ? await this.persist() : this.entry();
    if (!current) {
      return;
    }
    const validated = await this.run('validate', this.api.validate(current.id));
    if (validated) {
      this.toast.success(`Écriture ${validated.number} validée.`);
      if (this.isNew()) {
        await this.openRecord(validated);
      } else {
        this.show(validated);
      }
    } else if (this.isNew()) {
      // Saved as a draft but refused: continue on the saved record, the error stays visible.
      await this.openRecord(current, this.actionError());
    }
  }

  protected async reverse(): Promise<void> {
    const entry = this.entry();
    if (!entry) {
      return;
    }
    const confirmed = await this.confirm.confirm({
      title: `Contrepasser ${entry.number} ?`,
      message:
        'Une nouvelle écriture inverse (débits et crédits échangés) sera créée et validée. ' +
        'L’écriture d’origine reste visible dans l’historique.',
      confirmLabel: 'Contrepasser',
    });
    if (!confirmed) {
      return;
    }
    const reversal = await this.run('reverse', this.api.reverse(entry.id));
    if (reversal) {
      this.show({ ...entry, reversedBy: reversal.number, actions: ['duplicate'] });
      this.toast.success(`Contrepassation ${reversal.number} créée.`, {
        actionLabel: 'Voir',
        action: () => void this.router.navigate(['..', reversal.id], { relativeTo: this.route }),
      });
    }
  }

  protected async onMoreAction(item: DropdownItem): Promise<void> {
    const entry = this.entry();
    if (item.id !== 'delete' || !entry) {
      return;
    }
    const confirmed = await this.confirm.confirm({
      title: `Supprimer le brouillon ${entry.number} ?`,
      message: 'Le brouillon et ses lignes seront définitivement supprimés.',
      confirmLabel: 'Supprimer le brouillon',
      tone: 'danger',
    });
    if (confirmed && (await this.run('delete', this.api.remove(entry.id))) !== null) {
      this.toast.success(`Brouillon ${entry.number} supprimé.`);
      await this.router.navigate(['..'], { relativeTo: this.route });
    }
  }

  /** Checks the form, then creates or updates the draft on the server. */
  private async persist(): Promise<Entry | null> {
    this.actionError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.formInvalid.set(true);
      if (this.lines.invalid) {
        this.tab.set('lines');
      }
      return null;
    }
    this.formInvalid.set(false);
    const id = this.id();
    const saved = await this.run(
      'save',
      id ? this.api.update(id, this.draft()) : this.api.create(this.draft()),
    );
    if (saved) {
      this.show(saved);
    }
    return saved;
  }

  private openRecord(entry: Entry, error: UserError | null = null): Promise<boolean> {
    return this.router.navigate(['..', entry.id], {
      relativeTo: this.route,
      replaceUrl: true,
      state: { actionError: error },
    });
  }

  protected cancel(): void {
    void this.router.navigate(['..'], { relativeTo: this.route });
  }

  /** Runs a server command: button busy, human error on failure, never a silent fail. */
  private run<T>(
    action: 'save' | 'validate' | 'reverse' | 'delete',
    request: Observable<T>,
  ): Promise<T | null> {
    this.busy.set(action);
    this.actionError.set(null);
    return new Promise((resolve) => {
      request.subscribe({
        next: (value) => {
          this.busy.set(null);
          resolve(value);
        },
        error: (failure: unknown) => {
          this.busy.set(null);
          this.actionError.set(toUserError(failure, ACCOUNTING_ERRORS));
          resolve(null);
        },
      });
    });
  }

  private show(entry: Entry): void {
    this.entry.set(entry);
    this.form.reset({
      date: entry.date,
      journal: entry.journal,
      reference: entry.reference,
      label: entry.label,
      partnerId: entry.partnerId ?? '',
      currency: entry.currency,
      note: entry.note,
    });
    this.lines.clear();
    entry.lines.forEach((line) => this.lines.push(lineForm(line)));
    if (entry.actions.includes('save')) {
      this.form.enable();
      this.form.controls.currency.disable();
    } else {
      this.form.disable();
    }
  }

  private draft(): EntryDraft {
    const value = this.form.getRawValue();
    return {
      date: value.date,
      journal: value.journal,
      reference: value.reference.trim(),
      label: value.label.trim(),
      partnerId: value.partnerId || null,
      note: value.note.trim(),
      lines: value.lines.map((line) => ({
        account: line.account,
        label: line.label.trim() || value.label.trim(),
        debit: normalizeDecimalInput(line.debit) ?? '',
        credit: normalizeDecimalInput(line.credit) ?? '',
      })),
    };
  }
}
