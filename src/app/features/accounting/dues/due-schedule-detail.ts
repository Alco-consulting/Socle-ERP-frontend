import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, firstValueFrom, map, of } from 'rxjs';

import { UserError, toUserError } from '../../../core/errors/user-error';
import { toApiError } from '../../../core/http/api-error';
import { requestState } from '../../../core/http/request-state';
import { APP_ROOT } from '../../../core/navigation/applications';
import { BreadcrumbService } from '../../../core/navigation/route-trail';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { AUDIT_TYPES, AlcoObjectHistory } from '../../audit/object-history';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { DueApi } from '../data-access/due-api';
import { ScheduleItem } from '../data-access/due-models';
import { paymentDaysLabel } from '../../partners/partner-presentation';
import { isoDay } from '../entries/entry-presentation';
import { DUE_ERRORS, DUE_ROLES, DUE_STATUS } from './due-presentation';
import { RecomputeDialogService } from './recompute-dialog';

/**
 * A due schedule (`GET due-schedules/{id}/`): its invoice, partner, payment term as it was
 * when computed, reference date and installments (amount, settled, open, state), with its
 * history (Audit, `accounting.dueschedule`). One action: Recalculer
 * (`accounting.manage_due_dates`), confirmed with a reason; the schedule is then read again.
 */
@Component({
  selector: 'alco-due-schedule-detail',
  imports: [
    RouterLink,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoButton,
    AlcoCell,
    AlcoErrorState,
    AlcoLoading,
    AlcoObjectHistory,
    AlcoPageHeader,
    AlcoTable,
  ],
  templateUrl: './due-schedule-detail.html',
  styleUrls: ['../accounting-sheet.scss', './due-detail.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DueScheduleDetailPage {
  private readonly api = inject(DueApi);
  private readonly partners = inject(PartnersApi);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly dialog = inject(RecomputeDialogService);
  private readonly toast = inject(AlcoToastService);
  protected readonly session = inject(SessionStore);

  private readonly id = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('id') ?? '')),
    { requireSync: true },
  );
  protected readonly record = requestState(() => this.api.schedule(untracked(this.id)), {
    immediate: false,
  });
  protected readonly schedule = computed(() => this.record.value());
  protected readonly loadError = computed(() => {
    const error = this.record.error();
    return error ? toUserError(error, DUE_ERRORS) : null;
  });
  protected readonly busy = signal(false);
  protected readonly actionError = signal<UserError | null>(null);
  protected readonly decimals = signal<ReadonlyMap<string, number>>(new Map());
  protected readonly accounting = `${APP_ROOT}/comptabilite`;
  protected readonly day = isoDay;
  protected readonly roles = DUE_ROLES;
  /** « À réception », « 30 jours » : le délai du serveur, en mots. */
  protected readonly daysLabel = paymentDaysLabel;
  protected readonly canRecompute = computed(() => this.session.can('accounting.manage_due_dates'));
  protected readonly auditType = AUDIT_TYPES.dueSchedule;
  protected readonly canSeeHistory = computed(() => this.session.can('audit.read'));
  private readonly history = viewChild(AlcoObjectHistory);

  protected readonly columns: readonly TableColumn[] = [
    { key: 'due', label: 'Échéance', width: '8rem' },
    { key: 'share', label: 'Part', numeric: true, hideBelow: 'tablet' },
    { key: 'amount', label: 'Montant', numeric: true },
    { key: 'settled', label: 'Réglé', numeric: true, hideBelow: 'tablet' },
    { key: 'open', label: 'Ouvert', numeric: true },
    { key: 'status', label: 'État', width: '9rem' },
  ];
  protected readonly rowId = (row: ScheduleItem) => row.public_id;

  constructor() {
    this.partners
      .currencies()
      .pipe(
        map((page) => new Map(page.results.map((item) => [item.code, item.decimal_places]))),
        catchError(() => of(new Map<string, number>())),
      )
      .subscribe((decimals) => this.decimals.set(decimals));
    effect(() => {
      this.id();
      untracked(() => this.record.reload());
    });
    effect(() => {
      const loaded = this.record.value();
      if (loaded) {
        untracked(() => this.breadcrumbs.nameCurrent(`Échéancier ${loaded.entry.entry_number}`));
      }
    });
  }

  protected statusLook(item: ScheduleItem) {
    return DUE_STATUS[item.status];
  }

  protected decimalsOf(currency: string): number {
    return this.decimals().get(currency) ?? 0;
  }

  protected async recompute(): Promise<void> {
    const schedule = this.schedule();
    if (!schedule || this.busy()) {
      return;
    }
    const request = await this.dialog.ask(
      `${schedule.entry.entry_number} · ${schedule.partner.code}`,
    );
    if (request === null) {
      return;
    }
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await firstValueFrom(this.api.recompute(schedule.public_id, request));
      this.toast.success('Échéancier recalculé.');
      this.record.reload();
      this.history()?.reload();
    } catch (failure) {
      const error = toApiError(failure);
      if (error.kind !== 'unauthenticated') {
        this.actionError.set(toUserError(error, DUE_ERRORS));
      }
    } finally {
      this.busy.set(false);
    }
  }
}
