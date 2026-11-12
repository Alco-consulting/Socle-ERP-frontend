import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Params, RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { toUserError } from '../../../core/errors/user-error';
import { ApiError } from '../../../core/http/api-error';
import { requestState } from '../../../core/http/request-state';
import { APP_ROOT } from '../../../core/navigation/applications';
import { NavigationService } from '../../../core/navigation/navigation.service';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoDropdown, DropdownItem } from '../../../shared/ui/dropdown/dropdown';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoIcon } from '../../../shared/ui/icon/icon';
import { IconName } from '../../../shared/ui/icon/icons';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { localToday } from '../../../shared/utils/dates';
import { JournalSummary } from '../../dashboards/data-access/dashboard-models';
import { DashboardsApi } from '../../dashboards/data-access/dashboards-api';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { CurrencyOption } from '../../partners/data-access/partner-models';
import { ACCOUNTING_REFERENTIAL_ERRORS } from '../accounting-presentation';
import { AlcoBalanceCurve, AlcoDueBars } from './journal-charts';
import { AlcoKpiBand } from './kpi-band';
import { CARD_ORDER, DOCUMENT_PATHS } from './dashboard-presentation';

/** A figure of a card, Odoo's « 1 À valider … 0 GNF »: the server's count and its list. */
interface Figure {
  readonly key: string;
  readonly label: string;
  readonly amount: string | null;
  readonly url: string | null;
  readonly query: Params;
}

interface JournalCard {
  readonly journal: JournalSummary;
  readonly kind: 'treasury' | 'documents' | 'general';
  /** « Nouveau » (or « Transactions » on a bank or cash card): `null` when not allowed. */
  readonly main: { readonly label: string; readonly url: string; readonly query: Params } | null;
  readonly figures: readonly Figure[];
  readonly actions: readonly DropdownItem[];
}

const ACCOUNTING = `${APP_ROOT}/comptabilite`;

/** The figures with something to count, as Odoo hides « 0 À valider ». */
function shown(...figures: readonly (Figure & { readonly count: number })[]): Figure[] {
  return figures.filter((figure) => figure.count > 0);
}

/**
 * Comptabilité › Tableau de bord, a steering board by function (not by journal card): the
 * figures on the plate, then Trésorerie, Clients, Fournisseurs and Écritures à traiter from
 * `GET dashboards/journals/?on=<today>` (note backend 0042). Every figure is the server's.
 */
@Component({
  selector: 'alco-accounting-dashboard',
  imports: [
    RouterLink,
    AlcoAmountPipe,
    AlcoBalanceCurve,
    AlcoButton,
    AlcoDropdown,
    AlcoDueBars,
    AlcoErrorState,
    AlcoIcon,
    AlcoKpiBand,
    AlcoLoading,
  ],
  templateUrl: './accounting-dashboard.html',
  styleUrl: './accounting-dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountingDashboardPage {
  private readonly dashboards = inject(DashboardsApi);
  private readonly navigation = inject(NavigationService);
  private readonly partners = inject(PartnersApi);
  protected readonly session = inject(SessionStore);

  protected readonly accounting = ACCOUNTING;

  /** Le pictogramme de chaque fonction du tableau, devant son titre. */
  protected readonly sectionIcons: Readonly<Record<string, IconName>> = {
    treasury: 'treasury',
    sales: 'partners',
    purchase: 'company',
    general: 'accounting',
  };

  /** The day of the balances and of the due weeks. */
  protected readonly today = localToday();

  protected readonly journals = requestState(() => this.dashboards.journals(this.today), {
    isEmpty: (body) => body.journals.length === 0,
  });

  /** Currency precisions, for display only (the API's amounts are exact strings). */
  private readonly currencies = requestState(() =>
    this.partners.currencies().pipe(
      map((page) => page.results),
      catchError(() => of([] as CurrencyOption[])),
    ),
  );

  /** The reference currency: the documents' amounts are in it. */
  protected readonly reference = computed(
    () => this.journals.value()?.company.reference_currency ?? '',
  );

  /** Bank and cash first, then sales, purchases and miscellaneous operations, as Odoo. */
  protected readonly cards = computed<readonly JournalCard[]>(() =>
    [...(this.journals.value()?.journals ?? [])]
      .sort((a, b) => CARD_ORDER[a.journal_type] - CARD_ORDER[b.journal_type])
      .map((journal) => this.cardOf(journal)),
  );

  /** The cards by function: treasury, customers, suppliers, entries to process. */
  protected readonly sections = computed(() => {
    const cards = this.cards();
    const of = (...types: readonly JournalSummary['journal_type'][]) =>
      cards.filter((card) => types.includes(card.journal.journal_type));
    return [
      { id: 'treasury', title: 'Trésorerie', cards: of('cash', 'bank') },
      { id: 'sales', title: 'Clients', cards: of('sales') },
      { id: 'purchase', title: 'Fournisseurs', cards: of('purchase') },
      { id: 'general', title: 'Écritures à traiter', cards: of('general') },
    ].filter((section) => section.cards.length > 0);
  });

  /** The screen of reconciliation, when the user may open it. */
  protected readonly reconcileUrl = computed(() => this.screen('tresorerie/rapprochements'));
  /** The journal's lines, where its lines « à rapprocher » wait (note backend 0050). */
  protected readonly transactionsUrl = computed(() => this.screen('tresorerie/transactions'));

  protected decimals(currency: string): number {
    // Unknown precision: no digit is ever dropped (the pipe only trims zeros).
    return this.currencies.value()?.find((item) => item.code === currency)?.decimal_places ?? 0;
  }

  protected failure(error: ApiError | null) {
    return error ? toUserError(error, ACCOUNTING_REFERENTIAL_ERRORS) : null;
  }

  private cardOf(journal: JournalSummary): JournalCard {
    const id = journal.public_id;
    const entries = `${ACCOUNTING}/ecritures/pieces`;
    switch (journal.journal_type) {
      case 'bank':
      case 'cash': {
        const accounts = journal.treasury_accounts ?? [];
        const operations = this.screen('tresorerie/transactions');
        return {
          journal,
          kind: 'treasury',
          main: operations
            ? {
                label: 'Transactions',
                url: operations,
                query: accounts.length === 1 ? { compte: accounts[0].code } : {},
              }
            : null,
          figures: [],
          actions: this.actionsOf(journal),
        };
      }
      case 'sales':
      case 'purchase': {
        const path = DOCUMENT_PATHS[journal.journal_type];
        const list = this.screen(path);
        const documents = journal.invoices;
        return {
          journal,
          kind: 'documents',
          main:
            list && this.session.can('invoicing.create')
              ? { label: 'Nouveau', url: `${list}/nouvelle`, query: {} }
              : null,
          figures: documents
            ? shown(
                {
                  key: 'drafts',
                  label: `${documents.drafts} À valider`,
                  amount: documents.draft_amount,
                  url: list,
                  query: { etat: 'draft' },
                  count: documents.drafts,
                },
                {
                  key: 'unpaid',
                  label: `${documents.unpaid} Non payé${documents.unpaid > 1 ? 's' : ''}`,
                  amount: documents.unpaid_amount,
                  url: list,
                  query: { etat: 'posted' },
                  count: documents.unpaid,
                },
              )
            : [],
          actions: this.actionsOf(journal),
        };
      }
      default:
        return {
          journal,
          kind: 'general',
          // An entry is entered by hand in miscellaneous operations only (note backend 0038).
          main: this.session.can('accounting.create')
            ? { label: 'Nouveau', url: `${ACCOUNTING}/ecritures/nouvelle`, query: { journal: id } }
            : null,
          figures: shown(
            {
              key: 'drafts',
              label: `${journal.entries.draft} Brouillon${journal.entries.draft > 1 ? 's' : ''}`,
              amount: null,
              url: entries,
              query: { journal: id, etat: 'draft' },
              count: journal.entries.draft,
            },
            {
              key: 'submitted',
              label: `${journal.entries.submitted} À valider`,
              amount: null,
              url: entries,
              query: { journal: id, etat: 'submitted' },
              count: journal.entries.submitted,
            },
          ),
          actions: this.actionsOf(journal),
        };
    }
  }

  /** ⋮ of a card: only what the API and the user's permissions allow. */
  private actionsOf(journal: JournalSummary): DropdownItem[] {
    const id = encodeURIComponent(journal.public_id);
    return [
      {
        id: 'entries',
        label: 'Voir les écritures',
        icon: 'eye',
        route: `${ACCOUNTING}/ecritures/pieces?journal=${id}`,
      },
      ...this.treasuryActions(journal),
      {
        id: 'settings',
        label: 'Configuration du journal',
        icon: 'settings',
        route: `${ACCOUNTING}/journaux/${id}`,
      },
    ];
  }

  /** No « Trésorerie » tab, as Odoo (note backend 0043): a bank or cash card opens them. */
  private treasuryActions(journal: JournalSummary): DropdownItem[] {
    const accounts = journal.treasury_accounts ?? [];
    if (accounts.length === 0) {
      return [];
    }
    const code = accounts.length === 1 ? `?compte=${encodeURIComponent(accounts[0].code)}` : '';
    const statements = this.screen('tresorerie/releves');
    const transfers = this.screen('tresorerie/virements');
    return [
      ...(statements && journal.journal_type === 'bank'
        ? [{ id: 'statements', label: 'Relevés', icon: 'file' as const, route: statements + code }]
        : []),
      ...(transfers
        ? [{ id: 'transfers', label: 'Virements', icon: 'transfers' as const, route: transfers }]
        : []),
    ];
  }

  /** URL of a screen of Comptabilité, or `null` when the user may not open it. */
  private screen(path: string): string | null {
    const url = `${ACCOUNTING}/${path}`;
    return this.navigation.canOpenUrl(url) ? url : null;
  }
}
