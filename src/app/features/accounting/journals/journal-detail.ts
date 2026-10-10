import { DatePipe } from '@angular/common';
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
import { firstValueFrom, forkJoin, map } from 'rxjs';

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
  JOURNAL_ACCOUNT_FIELDS,
  RECORD_STATUS,
  journalTypeLabel,
} from '../accounting-presentation';
import { Journal } from '../data-access/accounting-models';
import { AccountingApi } from '../data-access/accounting-api';
import { AlcoSmartButton } from '../../../shared/ui/smart-button/smart-button';
import { AUDIT_TYPES, AlcoObjectHistory } from '../../audit/object-history';
import { RelationsApi } from '../../relations/data-access/relations-api';

/**
 * A journal (`GET accounting/journals/{id}/`). Actions: those of the API, allowed by
 * `accounting.manage_journals` — Modifier, Désactiver or Réactiver (the server's status).
 * Smart buttons: its entries (all, drafts, submitted: `count` of the entry list, one
 * request each, never computed) and its history (Audit, `audit.read`).
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
    AlcoObjectHistory,
    AlcoSmartButton,
  ],
  templateUrl: './journal-detail.html',
  styleUrl: '../accounting-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JournalDetailPage {
  private readonly api = inject(AccountingApi);
  private readonly relations = inject(RelationsApi);
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

  /** The entry list of this journal, by status: the server's counts. */
  protected readonly counts = requestState(
    () => {
      const journal = untracked(this.id);
      return forkJoin({
        total: this.relations.entryCount(null, { journal }),
        draft: this.relations.entryCount('draft', { journal }),
        submitted: this.relations.entryCount('submitted', { journal }),
      });
    },
    { immediate: false },
  );
  protected readonly entriesUrl = '/app/comptabilite/ecritures';
  protected readonly auditType = AUDIT_TYPES.journal;
  protected readonly canSeeHistory = computed(() => this.session.can('audit.read'));
  private readonly history = viewChild(AlcoObjectHistory);
  protected readonly historyCount = computed(() => this.history()?.total() ?? null);

  protected readonly typeLabel = journalTypeLabel;
  /** The default account's words for the journal's type (« Compte bancaire »…). */
  protected readonly accountLabel = (journal: Journal) =>
    JOURNAL_ACCOUNT_FIELDS[journal.journal_type]?.label ?? 'Compte par défaut';
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
        this.counts.reload();
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
