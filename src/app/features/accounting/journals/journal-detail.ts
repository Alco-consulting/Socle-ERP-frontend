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
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';

import { UserError, toUserError } from '../../../core/errors/user-error';
import { toApiError } from '../../../core/http/api-error';
import { requestState } from '../../../core/http/request-state';
import { BreadcrumbService } from '../../../core/navigation/route-trail';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoConfirmService } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoDropdown, DropdownItem } from '../../../shared/ui/dropdown/dropdown';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import {
  ACCOUNTING_REFERENTIAL_ERRORS,
  RECORD_STATUS,
  journalTypeLabel,
} from '../accounting-presentation';
import { Journal } from '../data-access/accounting-models';
import { AccountingApi } from '../data-access/accounting-api';

/**
 * A journal (`GET accounting/journals/{id}/`). Actions: those of the API, allowed by
 * `accounting.manage_journals` — Modifier, Désactiver or Réactiver (the server's status).
 */
@Component({
  selector: 'alco-journal-detail',
  imports: [
    DatePipe,
    RouterLink,
    AlcoBadge,
    AlcoButton,
    AlcoDropdown,
    AlcoErrorState,
    AlcoLoading,
    AlcoPageHeader,
  ],
  templateUrl: './journal-detail.html',
  styleUrl: '../accounting-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JournalDetailPage {
  private readonly api = inject(AccountingApi);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly confirm = inject(AlcoConfirmService);
  private readonly toast = inject(AlcoToastService);
  protected readonly session = inject(SessionStore);

  private readonly id = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('id') ?? '')),
    { requireSync: true },
  );
  protected readonly record = requestState(() => this.api.journal(untracked(this.id)), {
    immediate: false,
  });
  protected readonly journal = signal<Journal | null>(null);
  protected readonly busy = signal(false);
  protected readonly actionError = signal<UserError | null>(null);

  protected readonly typeLabel = journalTypeLabel;
  protected readonly canManage = computed(() => this.session.can('accounting.manage_journals'));
  protected readonly status = computed(() => {
    const journal = this.journal();
    return journal ? RECORD_STATUS[journal.status] : null;
  });
  protected readonly loadError = computed(() => {
    const error = this.record.error();
    return error ? toUserError(error, ACCOUNTING_REFERENTIAL_ERRORS) : null;
  });
  protected readonly actions = computed<readonly DropdownItem[]>(() => {
    const journal = this.journal();
    if (!journal || !this.canManage()) {
      return [];
    }
    return journal.status === 'active'
      ? [{ id: 'deactivate', label: 'Désactiver', icon: 'lock', disabled: this.busy() }]
      : [{ id: 'reactivate', label: 'Réactiver', icon: 'refresh', disabled: this.busy() }];
  });

  constructor() {
    effect(() => {
      this.id();
      untracked(() => {
        this.journal.set(null);
        this.record.reload();
      });
    });
    effect(() => {
      const loaded = this.record.value();
      if (loaded) {
        untracked(() => this.show(loaded));
      }
    });
  }

  protected async onAction(item: DropdownItem): Promise<void> {
    const journal = this.journal();
    if (!journal || this.busy()) {
      return;
    }
    const activate = item.id === 'reactivate';
    const confirmed = await this.confirm.confirm({
      title: `${activate ? 'Réactiver' : 'Désactiver'} le journal ${journal.code} ?`,
      message: activate
        ? 'Le journal sera de nouveau proposé pour les nouvelles écritures.'
        : 'Le journal reste, avec ses écritures ; il ne sera plus proposé pour de nouvelles écritures. Vous pourrez le réactiver.',
      confirmLabel: activate ? 'Réactiver' : 'Désactiver',
    });
    if (!confirmed) {
      return;
    }
    this.busy.set(true);
    this.actionError.set(null);
    try {
      this.show(await firstValueFrom(this.api.setJournalActive(journal.public_id, activate)));
      this.toast.success(activate ? 'Journal réactivé.' : 'Journal désactivé.');
    } catch (failure) {
      const error = toApiError(failure);
      if (error.kind !== 'unauthenticated') {
        this.actionError.set(toUserError(error, ACCOUNTING_REFERENTIAL_ERRORS));
      }
    } finally {
      this.busy.set(false);
    }
  }

  private show(journal: Journal): void {
    this.journal.set(journal);
    this.breadcrumbs.nameCurrent(`${journal.code} — ${journal.name}`);
  }
}
