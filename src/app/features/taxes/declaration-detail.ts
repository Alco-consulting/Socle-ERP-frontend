import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { toUserError } from '../../core/errors/user-error';
import { requestState } from '../../core/http/request-state';
import { BreadcrumbService } from '../../core/navigation/route-trail';
import { SessionStore } from '../../core/session/session.store';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoAmountPipe } from '../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../shared/tables/table';
import { AlcoBadge } from '../../shared/ui/badge/badge';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoCard } from '../../shared/ui/card/card';
import { AlcoConfirmService } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { AlcoWorkflowSteps } from '../../shared/ui/workflow-steps/workflow-steps';
import { isZeroDecimal, normalizeDecimalInput, subtractDecimals } from '../../shared/utils/decimal';
import { referencePlaces } from '../currencies/reference-places';
import { TaxesApi } from './data-access/taxes-api';
import { DeclarationCommand, DeclarationDetail, VatLine } from './data-access/taxes-models';
import {
  DECLARATION_COMMANDS,
  DECLARATION_ERRORS,
  DECLARATION_STATUS,
  DECLARATION_WORKFLOW,
  VAT_SIDES,
  periodLabel,
} from './declarations-presentation';

const EDITABLE = new Set(['draft', 'checked']);

/** One VAT declaration: what the entries give, the amount declared, then each step. */
@Component({
  selector: 'alco-declaration-detail',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoButton,
    AlcoCard,
    AlcoCell,
    AlcoErrorState,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
    AlcoTable,
    AlcoWorkflowSteps,
  ],
  templateUrl: './declaration-detail.html',
  styleUrl: './declaration-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeclarationDetailPage {
  private readonly api = inject(TaxesApi);
  private readonly session = inject(SessionStore);
  private readonly toast = inject(AlcoToastService);
  private readonly confirm = inject(AlcoConfirmService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly declarationId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  protected readonly status = DECLARATION_STATUS;
  protected readonly workflow = DECLARATION_WORKFLOW;
  protected readonly commands = DECLARATION_COMMANDS;
  protected readonly places = referencePlaces();
  private readonly loaded = requestState(() => this.api.declaration(this.declarationId));
  /** The record shown: as loaded, then as each command answers. */
  protected readonly record = signal<DeclarationDetail | null>(null);
  /** The command running, or `declared` while the amount is saved. */
  protected readonly busy = signal<string | null>(null);
  protected readonly declared = new FormControl('', { nonNullable: true });
  protected readonly declaredError = signal<string | null>(null);

  protected readonly title = computed(() => {
    const record = this.record();
    return record ? `TVA — ${periodLabel(record.period_start, record.period_end)}` : 'Déclaration';
  });
  protected readonly editable = computed(() => {
    const record = this.record();
    return (
      record !== null &&
      EDITABLE.has(record.status) &&
      this.session.can('taxes.manage_declarations')
    );
  });
  /** The steps open now that this user may run, in workflow order. */
  protected readonly steps = computed(() =>
    (this.record()?.next_steps ?? []).filter((command) =>
      this.session.can(DECLARATION_COMMANDS[command].permission),
    ),
  );
  /** Entries changed since the amount was computed: it is computed again at the next step. */
  protected readonly stale = computed(() => {
    const record = this.record();
    return (
      record !== null &&
      EDITABLE.has(record.status) &&
      !isZeroDecimal(subtractDecimals(record.vat.payable, record.calculated_amount))
    );
  });
  protected readonly credit = computed(() =>
    (this.record()?.calculated_amount ?? '').startsWith('-'),
  );
  protected readonly forbidden = computed(() => this.loaded.status() === 'forbidden');
  protected readonly loadError = computed(() => {
    const error = this.loaded.error();
    return error ? toUserError(error, DECLARATION_ERRORS) : null;
  });

  protected readonly columns: readonly TableColumn[] = [
    { key: 'tax', label: 'Taxe' },
    { key: 'side', label: 'Côté', width: '8rem' },
    { key: 'base', label: 'Base HT', width: '11rem', numeric: true, hideBelow: 'tablet' },
    { key: 'amount', label: 'TVA', width: '11rem', numeric: true },
  ];
  protected readonly lineId = (line: VatLine) => `${line.tax.public_id}-${line.side}`;

  constructor() {
    effect(() => {
      const loaded = this.loaded.value();
      if (loaded) {
        untracked(() => this.record.set(loaded));
      }
    });
    effect(() => {
      const record = this.record();
      if (record) {
        untracked(() => {
          this.breadcrumbs.nameCurrent(periodLabel(record.period_start, record.period_end));
          this.declared.reset(record.declared_amount);
          this.declaredError.set(null);
        });
      }
    });
  }

  protected retry(): void {
    this.loaded.reload();
  }

  protected sideLabel(line: VatLine): string {
    return VAT_SIDES[line.side];
  }

  protected isZero(value: string): boolean {
    return isZeroDecimal(value);
  }

  protected async saveDeclared(record: DeclarationDetail): Promise<void> {
    const amount = normalizeDecimalInput(this.declared.value);
    this.declaredError.set(amount === null ? 'Saisissez un montant (ex. 150000).' : null);
    if (amount === null) {
      return;
    }
    await this.run('declared', async () => {
      this.record.set(await firstValueFrom(this.api.setDeclaredAmount(record.public_id, amount)));
      this.toast.success('Montant déclaré enregistré.');
    });
  }

  protected async step(record: DeclarationDetail, command: DeclarationCommand): Promise<void> {
    if (command === 'validate' && !(await this.confirmValidate())) {
      return;
    }
    await this.run(command, async () => {
      this.record.set(await firstValueFrom(this.api.runDeclarationStep(record.public_id, command)));
      this.toast.success(`Déclaration ${DECLARATION_COMMANDS[command].done}.`);
    });
  }

  private confirmValidate(): Promise<boolean> {
    return this.confirm.confirm({
      title: 'Valider la déclaration ?',
      message:
        'La TVA est recalculée à partir des écritures, puis les montants sont figés : ils ne changeront plus.',
      confirmLabel: 'Valider',
    });
  }

  private async run(key: string, action: () => Promise<void>): Promise<void> {
    this.busy.set(key);
    try {
      await action();
    } catch (failure) {
      const error = toUserError(failure, DECLARATION_ERRORS);
      this.toast.error(`${error.title} ${error.message}`);
      this.loaded.reload();
    } finally {
      this.busy.set(null);
    }
  }
}
