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
import { Observable, firstValueFrom, map, of } from 'rxjs';

import { UserError, toUserError } from '../../../../core/errors/user-error';
import { toApiError } from '../../../../core/http/api-error';
import { requestState } from '../../../../core/http/request-state';
import { APP_ROOT } from '../../../../core/navigation/applications';
import { NavigationService } from '../../../../core/navigation/navigation.service';
import { BreadcrumbService } from '../../../../core/navigation/route-trail';
import { SessionStore } from '../../../../core/session/session.store';
import { AlcoBadge } from '../../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../../shared/ui/button/button';
import { AlcoConfirmService } from '../../../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoDropdown, DropdownItem } from '../../../../shared/ui/dropdown/dropdown';
import { AlcoErrorState } from '../../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../../shared/ui/page-header/page-header';
import { AlcoSmartButton } from '../../../../shared/ui/smart-button/smart-button';
import { AlcoToastService } from '../../../../shared/ui/toast/toast.service';
import { AUDIT_TYPES, AlcoObjectHistory } from '../../../audit/object-history';
import { DueApi } from '../../../accounting/data-access/due-api';
import { LetteringApi } from '../../../accounting/data-access/lettering-api';
import { CollectiveAccount, RelationsApi } from '../../../relations/data-access/relations-api';
import { Partner, PaymentTerm } from '../../data-access/partner-models';
import { PartnersApi } from '../../data-access/partners-api';
import { PARTNER_ERRORS, PARTNER_STATUS, roleLabel } from '../../partner-presentation';

/**
 * The record of a partner (`GET partners/{id}/`). A partner of another company, or an
 * unknown one, is a 404 of the server: « n'existe pas ou plus ». Actions: those the API
 * offers and the user's permissions allow — Modifier (`partners.update`), Désactiver /
 * Réactiver (`partners.disable`; the partner stays, with its history). Smart buttons, each
 * with its own permission: its entries (`accounting.read`, the entry list's `count`), its
 * subsidiary ledger (`reporting.read_auxiliary`), its collective accounts
 * (`accounting/partners/<id>/accounts/`), its lettering (its open lines, the `count` of
 * `accounting/letterable-lines/`), its installments (the `count` of `accounting/due-items/`)
 * and its history (`audit.read`).
 */
@Component({
  selector: 'alco-partner-detail',
  imports: [
    DatePipe,
    RouterLink,
    AlcoBadge,
    AlcoButton,
    AlcoDropdown,
    AlcoErrorState,
    AlcoLoading,
    AlcoObjectHistory,
    AlcoPageHeader,
    AlcoSmartButton,
  ],
  templateUrl: './partner-detail.html',
  styleUrl: './partner-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartnerDetailPage {
  private readonly api = inject(PartnersApi);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly confirm = inject(AlcoConfirmService);
  private readonly toast = inject(AlcoToastService);
  protected readonly session = inject(SessionStore);

  private readonly id = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('id') ?? '')),
    { requireSync: true },
  );

  protected readonly record = requestState(() => this.api.get(untracked(this.id)), {
    immediate: false,
  });
  /** The record shown: the loaded one, then the answer of each action. */
  protected readonly partner = signal<Partner | null>(null);
  protected readonly busy = signal(false);
  protected readonly actionError = signal<UserError | null>(null);

  protected readonly loadError = computed(() => {
    const error = this.record.error();
    return error ? toUserError(error, PARTNER_ERRORS) : null;
  });
  protected readonly status = computed(() => {
    const partner = this.partner();
    return partner ? PARTNER_STATUS[partner.status] : null;
  });
  protected readonly role = computed(() => {
    const partner = this.partner();
    return partner ? roleLabel(partner) : '';
  });
  protected readonly canEdit = computed(() => this.session.can('partners.update'));

  // ---- Related objects (one request per relation, each with its permission) -----------
  private readonly relations = inject(RelationsApi);
  private readonly navigation = inject(NavigationService);
  protected readonly accounting = `${APP_ROOT}/comptabilite`;
  protected readonly canReadAccounting = computed(() => this.session.can('accounting.read'));
  protected readonly canOpenEntries = computed(() => this.canOpen('ecritures'));
  protected readonly canOpenLedger = computed(() => this.canOpen('analyse/grand-livre-auxiliaire'));
  protected readonly canOpenAccounts = computed(() => this.canOpen('plan-comptable'));
  protected readonly canOpenLettering = computed(() => this.canOpen('lettrage'));
  private readonly lettering = inject(LetteringApi);
  protected readonly openLines = requestState(
    (): Observable<number | null> =>
      untracked(this.canOpenLettering)
        ? this.lettering.openLineCount({ partner: untracked(this.id) })
        : of(null),
    { immediate: false },
  );
  protected readonly entries = requestState(
    (): Observable<number | null> =>
      untracked(this.canOpenEntries)
        ? this.relations.entryCount(null, { partner: untracked(this.id) })
        : of(null),
    { immediate: false },
  );
  protected readonly collective = requestState(
    (): Observable<readonly CollectiveAccount[] | null> =>
      untracked(this.canReadAccounting)
        ? this.relations.collectiveAccounts(untracked(this.id))
        : of(null),
    { immediate: false },
  );
  protected readonly auditType = AUDIT_TYPES.partner;
  protected readonly canSeeHistory = computed(() => this.session.can('audit.read'));
  private readonly history = viewChild(AlcoObjectHistory);
  protected readonly historyCount = computed(() => this.history()?.total() ?? null);
  protected readonly canOpenDues = computed(() => this.canOpen('echeances'));
  private readonly dues = inject(DueApi);
  protected readonly dueItems = requestState(
    (): Observable<number | null> =>
      untracked(this.canOpenDues) ? this.dues.itemCount(untracked(this.id)) : of(null),
    { immediate: false },
  );
  protected readonly roleWords: Readonly<Partial<Record<string, string>>> = {
    customer: 'Compte client',
    supplier: 'Compte fournisseur',
  };

  protected readonly actions = computed<readonly DropdownItem[]>(() => {
    const partner = this.partner();
    if (!partner || !this.session.can('partners.disable')) {
      return [];
    }
    return partner.status === 'active'
      ? [{ id: 'deactivate', label: 'Désactiver', icon: 'lock', disabled: this.busy() }]
      : [{ id: 'reactivate', label: 'Réactiver', icon: 'refresh', disabled: this.busy() }];
  });

  constructor() {
    effect(() => {
      this.id();
      untracked(() => {
        this.partner.set(null);
        this.record.reload();
        this.entries.reload();
        this.collective.reload();
        this.openLines.reload();
        this.dueItems.reload();
      });
    });
    effect(() => {
      const loaded = this.record.value();
      if (loaded) {
        untracked(() => this.show(loaded));
      }
    });
  }

  /** Comptabilité and its screen are both open to the user (never one alone). */
  private canOpen(path: string): boolean {
    return this.navigation.canOpenUrl(`${APP_ROOT}/comptabilite/${path}`);
  }

  protected termLabel(term: PaymentTerm | null): string {
    return term ? `${term.code} — ${term.name}` : 'Aucune';
  }

  protected retry(): void {
    this.record.reload();
  }

  protected async onAction(item: DropdownItem): Promise<void> {
    const partner = this.partner();
    if (!partner || this.busy()) {
      return;
    }
    const deactivate = item.id === 'deactivate';
    const confirmed = await this.confirm.confirm({
      title: deactivate ? `Désactiver ${partner.name} ?` : `Réactiver ${partner.name} ?`,
      message: deactivate
        ? 'Le contact reste, avec son historique ; il ne sera plus proposé pour une nouvelle opération. Vous pourrez le réactiver.'
        : 'Le contact sera de nouveau proposé pour les nouvelles opérations.',
      confirmLabel: deactivate ? 'Désactiver' : 'Réactiver',
    });
    if (!confirmed) {
      return;
    }
    this.busy.set(true);
    this.actionError.set(null);
    try {
      const updated = await firstValueFrom(
        deactivate
          ? this.api.deactivate(partner.public_id)
          : this.api.reactivate(partner.public_id),
      );
      this.show(updated);
      this.toast.success(deactivate ? 'Contact désactivé.' : 'Contact réactivé.');
    } catch (failure) {
      const error = toApiError(failure);
      if (error.kind !== 'unauthenticated') {
        this.actionError.set(toUserError(error, PARTNER_ERRORS));
      }
    } finally {
      this.busy.set(false);
    }
  }

  private show(partner: Partner): void {
    this.partner.set(partner);
    this.breadcrumbs.nameCurrent(`${partner.code} — ${partner.name}`);
  }
}
