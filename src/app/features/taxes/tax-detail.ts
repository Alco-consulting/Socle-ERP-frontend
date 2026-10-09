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
import { firstValueFrom, map } from 'rxjs';

import { UserError, toUserError } from '../../core/errors/user-error';
import { toApiError } from '../../core/http/api-error';
import { requestState } from '../../core/http/request-state';
import { BreadcrumbService } from '../../core/navigation/route-trail';
import { SessionStore } from '../../core/session/session.store';
import { AlcoBadge } from '../../shared/ui/badge/badge';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoConfirmService } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoDropdown, DropdownItem } from '../../shared/ui/dropdown/dropdown';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoSmartButton } from '../../shared/ui/smart-button/smart-button';
import { AlcoTabPanel, AlcoTabs, TabItem } from '../../shared/ui/tabs/tabs';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { AccountingApi } from '../accounting/data-access/accounting-api';
import { AUDIT_TYPES, AlcoObjectHistory } from '../audit/object-history';
import { accountNames } from './account-names';
import { TaxesApi } from './data-access/taxes-api';
import { Tax } from './data-access/taxes-models';
import { AlcoRepartitionTable } from './repartition-table';
import {
  TAX_ERRORS,
  amountTypeLabel,
  percentText,
  priceInclusionLabel,
  taxCategoryCodeLabel,
  taxScopeLabel,
  taxUseLabel,
} from './taxes-presentation';

const TABS: readonly TabItem[] = [
  { id: 'definition', label: 'Définition' },
  { id: 'advanced', label: 'Options avancées' },
];

/**
 * A tax as Odoo's form shows it (`GET taxes/{id}/`), read only: the header fields, then the
 * tabs « Définition » (the repartition lines for invoices and credit notes) and « Options
 * avancées ». Actions (`taxes.update`): Modifier, Désactiver / Activer (commands).
 */
@Component({
  selector: 'alco-tax-detail',
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
    AlcoRepartitionTable,
    AlcoSmartButton,
    AlcoTabPanel,
    AlcoTabs,
  ],
  templateUrl: './tax-detail.html',
  styleUrls: ['../accounting/accounting-sheet.scss', './tax-sheet.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaxDetailPage {
  private readonly api = inject(TaxesApi);
  private readonly accounting = inject(AccountingApi);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly confirm = inject(AlcoConfirmService);
  private readonly toast = inject(AlcoToastService);
  private readonly session = inject(SessionStore);

  private readonly id = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('id') ?? '')),
    { requireSync: true },
  );
  protected readonly record = requestState(() => this.api.tax(untracked(this.id)), {
    immediate: false,
  });
  protected readonly tax = signal<Tax | null>(null);
  protected readonly names = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly busy = signal(false);
  protected readonly actionError = signal<UserError | null>(null);
  protected readonly tabs = TABS;
  protected readonly tab = signal('definition');

  protected readonly useLabel = taxUseLabel;
  protected readonly scopeLabel = taxScopeLabel;
  protected readonly amountTypeLabel = amountTypeLabel;
  protected readonly priceLabel = priceInclusionLabel;
  protected readonly categoryLabel = taxCategoryCodeLabel;
  protected readonly percent = percentText;
  protected readonly canUpdate = computed(() => this.session.can('taxes.update'));
  protected readonly auditType = AUDIT_TYPES.tax;
  protected readonly canSeeHistory = computed(() => this.session.can('audit.read'));
  private readonly history = viewChild(AlcoObjectHistory);
  protected readonly historyCount = computed(() => this.history()?.total() ?? null);
  protected readonly companyName = computed(() => this.session.activeCompany()?.name ?? '');

  protected readonly loadError = computed(() => {
    const error = this.record.error();
    return error ? toUserError(error, TAX_ERRORS) : null;
  });
  protected readonly actions = computed<readonly DropdownItem[]>(() => {
    const tax = this.tax();
    if (!tax || !this.canUpdate()) {
      return [];
    }
    return tax.status === 'active'
      ? [{ id: 'deactivate', label: 'Désactiver', icon: 'lock', disabled: this.busy() }]
      : [{ id: 'activate', label: 'Activer', icon: 'refresh', disabled: this.busy() }];
  });

  constructor() {
    effect(() => {
      this.id();
      untracked(() => {
        this.tax.set(null);
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
    const tax = this.tax();
    if (!tax || this.busy()) {
      return;
    }
    const activate = item.id === 'activate';
    const confirmed = await this.confirm.confirm({
      title: `${activate ? 'Activer' : 'Désactiver'} la taxe ${tax.name} ?`,
      message: activate
        ? 'La taxe sera de nouveau proposée sur les écritures et les comptes.'
        : 'La taxe reste, avec son historique ; elle ne sera plus proposée. Vous pourrez l’activer.',
      confirmLabel: activate ? 'Activer' : 'Désactiver',
    });
    if (!confirmed) {
      return;
    }
    this.busy.set(true);
    this.actionError.set(null);
    try {
      this.show(await firstValueFrom(this.api.setTaxActive(tax.public_id, activate)));
      this.toast.success(activate ? 'Taxe activée.' : 'Taxe désactivée.');
    } catch (failure) {
      const error = toApiError(failure);
      if (error.kind !== 'unauthenticated') {
        this.actionError.set(toUserError(error, TAX_ERRORS));
      }
    } finally {
      this.busy.set(false);
    }
  }

  private show(tax: Tax): void {
    this.tax.set(tax);
    this.breadcrumbs.nameCurrent(tax.name);
    if (this.session.can('accounting.read')) {
      accountNames(this.accounting, [...tax.invoice_lines, ...tax.refund_lines]).subscribe(
        (names) => this.names.set(names),
      );
    }
  }
}
