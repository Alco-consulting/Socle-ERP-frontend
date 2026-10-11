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
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { toUserError } from '../../core/errors/user-error';
import { requestState } from '../../core/http/request-state';
import { BreadcrumbService } from '../../core/navigation/route-trail';
import { SessionStore } from '../../core/session/session.store';
import { AlcoCell, AlcoTable, TableColumn } from '../../shared/tables/table';
import { AlcoBadge } from '../../shared/ui/badge/badge';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoCard } from '../../shared/ui/card/card';
import { AlcoConfirmService } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import {
  CHECK_LEVEL,
  CLOSING_ERRORS,
  PERIOD_STATUS,
  RUN_STATUS,
  STEPS,
  STEP_ACTIONS,
  STEP_STATUS,
  checkLabel,
  dateRange,
  runSubject,
} from './closing-presentation';
import { ClosingApi } from './data-access/closing-api';
import {
  ClosingCheck,
  ClosingStep,
  Reopening,
  RunPeriod,
  StepCode,
} from './data-access/closing-models';
import { ClosingReasonDialogService } from './reason-dialog';

/** The validation and the close are decisions with their own permission. */
const PERMISSIONS: Readonly<Partial<Record<StepCode, string>>> = {
  validation: 'closing.validate',
  close: 'closing.close',
};

/**
 * One closing: its ten steps run in order on the server, each with the checks of its last
 * attempt; the periods of its scope; its reopenings. A fiscal year closes with all its
 * periods, reopens alone, then each period is reopened explicitly (note backend 0036).
 */
@Component({
  selector: 'alco-closing-run',
  imports: [
    DatePipe,
    AlcoBadge,
    AlcoButton,
    AlcoCard,
    AlcoCell,
    AlcoErrorState,
    AlcoLoading,
    AlcoPageHeader,
    AlcoTable,
  ],
  templateUrl: './closing-run.html',
  styleUrl: './closing-run.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClosingRunPage {
  private readonly api = inject(ClosingApi);
  private readonly session = inject(SessionStore);
  private readonly toast = inject(AlcoToastService);
  private readonly confirm = inject(AlcoConfirmService);
  private readonly reasons = inject(ClosingReasonDialogService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly runId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  protected readonly runStatus = RUN_STATUS;
  protected readonly stepStatus = STEP_STATUS;
  protected readonly stepLabels = STEPS;
  protected readonly checkLabel = checkLabel;
  protected readonly dateRange = dateRange;

  protected readonly run = requestState(() => this.api.run(this.runId));
  protected readonly steps = requestState(() => this.api.steps(this.runId));
  protected readonly periods = requestState(() => this.api.periods(this.runId));
  /** The command running: a step's code, `cancel`, `reopen` or a period's id. */
  protected readonly busy = signal<string | null>(null);

  protected readonly subject = computed(() => {
    const run = this.run.value();
    return run ? runSubject(run) : '';
  });
  protected readonly isYear = computed(() => this.run.value()?.scope === 'fiscal_year');
  protected readonly canCancel = computed(
    () => this.run.value()?.status === 'in_progress' && this.session.can('closing.start'),
  );
  protected readonly canReopen = computed(() => {
    const status = this.run.value()?.status;
    return (status === 'closed' || status === 'completed') && this.session.can('closing.reopen');
  });
  protected readonly reopened = computed(() => this.run.value()?.status === 'reopened');

  protected readonly periodColumns = computed<readonly TableColumn[]>(() => [
    { key: 'label', label: 'Période' },
    { key: 'dates', label: 'Dates', hideBelow: 'tablet' },
    { key: 'status', label: 'État', width: '9rem' },
    ...(this.reopened() && this.isYear() && this.session.can('closing.reopen')
      ? [{ key: 'actions', label: 'Actions', width: '8rem' }]
      : []),
  ]);
  protected readonly periodId = (period: RunPeriod) => period.public_id;

  protected readonly loadError = computed(() => {
    const error = this.run.error() ?? this.steps.error();
    return error ? toUserError(error, CLOSING_ERRORS) : null;
  });

  constructor() {
    effect(() => {
      const subject = this.subject();
      if (subject) {
        untracked(() => this.breadcrumbs.nameCurrent(subject));
      }
    });
  }

  /** The step to run now: the current one, in a status that lets it run, if permitted. */
  protected runnable(step: ClosingStep): boolean {
    const run = this.run.value();
    if (!run || step.code !== run.current_step || step.status === 'succeeded') {
      return false;
    }
    const allowed =
      step.code === 'opening' ? run.status === 'closed' : run.status === 'in_progress';
    return allowed && this.session.can(PERMISSIONS[step.code] ?? 'closing.execute');
  }

  protected actionLabel(step: ClosingStep): string {
    return step.status === 'failed' ? 'Réessayer' : (STEP_ACTIONS[step.code] ?? 'Exécuter');
  }

  /** What needs attention: the blocking points and the warnings, never the OK ones. */
  protected attention(step: ClosingStep): readonly ClosingCheck[] {
    return step.checks.filter((check) => check.level !== 'ok');
  }

  protected levelLook(check: ClosingCheck) {
    return CHECK_LEVEL[check.level === 'blocking' ? 'blocking' : 'warning'];
  }

  protected periodLookOf(period: RunPeriod) {
    return PERIOD_STATUS[period.status];
  }

  /** « Exercice rouvert », « Période Mars 2026 rouverte » (its code when unknown). */
  protected reopeningText(item: Reopening): string {
    if (item.fiscal_year_reopened) {
      return 'Exercice rouvert';
    }
    const periods = this.periods.value() ?? [];
    const names = item.periods.map(
      (code) => periods.find((period) => period.code === code)?.label ?? code,
    );
    return `Période ${names.join(', ')} rouverte`;
  }

  protected canReopenPeriod(period: RunPeriod): boolean {
    return this.reopened() && this.isYear() && period.status === 'closed';
  }

  protected async execute(step: ClosingStep): Promise<void> {
    if (step.code === 'close' && !(await this.confirmClose())) {
      return;
    }
    await this.command(step.code, async () => {
      const done = await firstValueFrom(
        this.api.execute(this.runId, step.code, step.status === 'failed'),
      );
      if (done.status === 'failed') {
        this.toast.error(`${STEPS[step.code]} : des points bloquent l’étape.`);
      } else {
        this.toast.success(`${STEPS[step.code]} : étape réussie.`);
      }
    });
  }

  protected async cancel(): Promise<void> {
    const reason = await this.reasons.ask({
      title: `Abandonner la clôture ${this.of()} ?`,
      message: 'Les étapes déjà faites restent dans l’historique ; rien n’est clôturé.',
      confirmLabel: 'Abandonner la clôture',
      tone: 'danger',
    });
    if (reason) {
      await this.command('cancel', async () => {
        await firstValueFrom(this.api.cancel(this.runId, reason));
        this.toast.success('Clôture abandonnée.');
      });
    }
  }

  protected async reopen(): Promise<void> {
    const year = this.isYear();
    const reason = await this.reasons.ask({
      title: `Rouvrir ${this.named()} ?`,
      message: year
        ? 'L’exercice sera rouvert, mais ses périodes resteront clôturées : rouvrez ensuite celles qui doivent recevoir des écritures.'
        : 'La période sera rouverte : des écritures pourront de nouveau y être validées.',
      confirmLabel: year ? 'Rouvrir l’exercice' : 'Rouvrir la période',
    });
    if (reason) {
      await this.command('reopen', async () => {
        await firstValueFrom(this.api.reopen(this.runId, reason));
        this.toast.success(
          year
            ? `${this.subject()} rouvert : ses périodes restent clôturées.`
            : 'Période rouverte.',
        );
      });
    }
  }

  protected async reopenPeriod(period: RunPeriod): Promise<void> {
    const reason = await this.reasons.ask({
      title: `Rouvrir ${period.label} ?`,
      message: 'Des écritures pourront de nouveau être validées dans cette période.',
      confirmLabel: 'Rouvrir la période',
    });
    if (reason) {
      await this.command(period.public_id, async () => {
        await firstValueFrom(this.api.reopenPeriod(this.runId, period.public_id, reason));
        this.toast.success(`Période ${period.label} rouverte.`);
      });
    }
  }

  protected retry(): void {
    this.reloadAll();
  }

  private confirmClose(): Promise<boolean> {
    return this.confirm.confirm({
      title: `Clôturer ${this.named()} ?`,
      message: this.isYear()
        ? 'L’exercice et toutes ses périodes seront clôturés : plus aucune écriture n’y sera validée. Vous pourrez rouvrir l’exercice, puis une période à la fois.'
        : 'La période sera clôturée : plus aucune écriture n’y sera validée. Vous pourrez la rouvrir.',
      confirmLabel: this.isYear() ? 'Clôturer l’exercice' : 'Clôturer la période',
    });
  }

  /** « l’exercice 2026 », « la période 2026-03 ». */
  private named(): string {
    return `${this.isYear() ? 'l’' : 'la '}${this.subject().toLowerCase()}`;
  }

  /** « de l’exercice 2026 », « de la période 2026-03 ». */
  private of(): string {
    return `de ${this.named()}`;
  }

  private async command(key: string, action: () => Promise<void>): Promise<void> {
    this.busy.set(key);
    try {
      await action();
    } catch (failure) {
      this.toast.error(toUserError(failure, CLOSING_ERRORS).title);
    } finally {
      this.busy.set(null);
      this.reloadAll();
    }
  }

  private reloadAll(): void {
    this.run.reload();
    this.steps.reload();
    this.periods.reload();
  }
}
