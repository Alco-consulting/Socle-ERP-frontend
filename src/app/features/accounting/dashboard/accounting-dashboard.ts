import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { Params, RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { toUserError } from '../../../core/errors/user-error';
import { ApiError } from '../../../core/http/api-error';
import { requestState } from '../../../core/http/request-state';
import { APP_ROOT } from '../../../core/navigation/applications';
import { NavigationService } from '../../../core/navigation/navigation.service';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoCard } from '../../../shared/ui/card/card';
import { AlcoDropdown, DropdownItem } from '../../../shared/ui/dropdown/dropdown';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoIcon } from '../../../shared/ui/icon/icon';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { localToday } from '../../../shared/utils/dates';
import {
  DashboardAlert,
  DashboardIndicator,
  JournalSummary,
} from '../../dashboards/data-access/dashboard-models';
import { DashboardsApi } from '../../dashboards/data-access/dashboards-api';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { CurrencyOption } from '../../partners/data-access/partner-models';
import { ACCOUNTING_REFERENTIAL_ERRORS, journalTypeLabel } from '../accounting-presentation';
import { AccountingApi } from '../data-access/accounting-api';
import {
  ALERT_LEVELS,
  ALERT_PATHS,
  INDICATORS,
  JOURNAL_COUNTERS,
  closingCheckLabel,
  indicatorLabel,
} from './dashboard-presentation';

/** A counter of a card: the server's count and the entry list it opens. */
interface Counter {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly query: Params;
}

interface JournalCard {
  readonly journal: JournalSummary;
  readonly counters: readonly Counter[];
  readonly actions: readonly DropdownItem[];
}

/** A line of « À surveiller »: label, count or level, and its screen when one opens. */
interface Watch {
  readonly key: string;
  readonly label: string;
  readonly detail: string;
  readonly count: number | null;
  readonly level: (typeof ALERT_LEVELS)[string] | null;
  readonly url: string | null;
}

const ACCOUNTING = `${APP_ROOT}/comptabilite`;

/**
 * Comptabilité › Tableau de bord: a work centre, one card per active journal.
 * - Journals: `GET dashboards/journals/?on=<today>` — one request for every journal (entry
 *   counts by status; treasury accounts with Treasury's balance of the day and their lines
 *   to reconcile, only when the API gives them: `treasury_accounts: null` shows nothing).
 * - « À surveiller »: `GET dashboards/alerts/` from the start of the open fiscal year that
 *   holds today to today (the API never implies a date); without such a year (no entry yet
 *   this year: the server opens it with the first one), said. The fiscal years themselves
 *   are never shown (note backend 0035).
 * Nothing is computed here: counts, balances and alerts are the server's.
 */
@Component({
  selector: 'alco-accounting-dashboard',
  imports: [
    DatePipe,
    RouterLink,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoButton,
    AlcoCard,
    AlcoDropdown,
    AlcoErrorState,
    AlcoIcon,
    AlcoLoading,
    AlcoPageHeader,
  ],
  templateUrl: './accounting-dashboard.html',
  styleUrl: './accounting-dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountingDashboardPage {
  private readonly api = inject(AccountingApi);
  private readonly dashboards = inject(DashboardsApi);
  private readonly navigation = inject(NavigationService);
  private readonly partners = inject(PartnersApi);
  protected readonly session = inject(SessionStore);

  protected readonly journalTypeLabel = journalTypeLabel;
  protected readonly accounting = ACCOUNTING;

  /** The day of the balances: Treasury's balance on it, no later operation. */
  protected readonly today = localToday();

  // ---- Journals (one request) ---------------------------------------------------------
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

  protected readonly cards = computed<readonly JournalCard[]>(() =>
    (this.journals.value()?.journals ?? []).map((journal) => ({
      journal,
      counters: JOURNAL_COUNTERS.map((counter) => ({
        key: counter.key,
        label: counter.label,
        count: journal.entries[counter.key],
        query: counter.status
          ? { journal: journal.public_id, etat: counter.status }
          : { journal: journal.public_id },
      })),
      actions: this.actionsOf(journal),
    })),
  );

  /** Whether the API gave at least one treasury account (never when `null`). */
  protected readonly showsTreasury = computed(() =>
    (this.journals.value()?.journals ?? []).some(
      (journal) => (journal.treasury_accounts?.length ?? 0) > 0,
    ),
  );

  // ---- The open fiscal year that holds today: the scope of the alerts -------------------
  private readonly years = requestState(() =>
    this.api.fiscalYears('open').pipe(map((page) => page.results)),
  );

  /** The alerts run from its start to today. */
  protected readonly alertYear = computed(() => {
    const today = this.today;
    return (
      this.years.value()?.find((year) => year.start_date <= today && today <= year.end_date) ?? null
    );
  });

  /** Known once the open fiscal years are read: an alert scope, or none to say. */
  protected readonly yearsRead = computed(() => this.years.value() !== null);

  // ---- Alerts and indicators ----------------------------------------------------------
  protected readonly alerts = requestState(
    () => this.dashboards.alerts(this.alertYear()?.start_date ?? this.today, this.today),
    { immediate: false },
  );

  protected readonly watches = computed<readonly Watch[]>(() => {
    const body = this.alerts.value();
    if (!body) {
      return [];
    }
    return [
      ...body.alerts.map((alert, index) => this.alertWatch(alert, index)),
      ...body.indicators
        .filter((indicator) => indicator.count > 0)
        .map((indicator) => this.indicatorWatch(indicator)),
    ];
  });

  protected readonly subtitle = computed(() => this.session.activeCompany()?.name ?? '');

  constructor() {
    // The alerts need a scope: asked once the open fiscal year holding today is known.
    effect(() => {
      if (this.alertYear()) {
        untracked(() => this.alerts.reload());
      }
    });
  }

  protected decimals(currency: string): number {
    // Unknown precision: no digit is ever dropped (the pipe only trims zeros).
    return this.currencies.value()?.find((item) => item.code === currency)?.decimal_places ?? 0;
  }

  /** The screen of reconciliation, when the user may open it. */
  protected readonly reconcileUrl = computed(() => this.screen('tresorerie/rapprochements'));

  protected failure(error: ApiError | null) {
    return error ? toUserError(error, ACCOUNTING_REFERENTIAL_ERRORS) : null;
  }

  /** « Nouvelle écriture »: a journal of miscellaneous operations, `accounting.create`. */
  protected canEnter(journal: JournalSummary): boolean {
    return journal.journal_type === 'general' && this.session.can('accounting.create');
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
      // An entry is entered by hand in miscellaneous operations only (note backend 0038).
      ...(this.canEnter(journal)
        ? [
            {
              id: 'new',
              label: 'Nouvelle écriture',
              icon: 'plus' as const,
              route: `${ACCOUNTING}/ecritures/nouvelle?journal=${id}`,
            },
          ]
        : []),
      {
        id: 'settings',
        label: 'Configuration du journal',
        icon: 'settings',
        route: `${ACCOUNTING}/journaux/${id}`,
      },
    ];
  }

  private alertWatch(alert: DashboardAlert, index: number): Watch {
    const target = typeof alert.details['target'] === 'string' ? alert.details['target'] : '';
    const path = ALERT_PATHS[alert.source];
    return {
      key: `alert-${index}`,
      label: closingCheckLabel(alert.code),
      detail: target ? `Clôture ${target}` : 'Clôture en cours',
      count: null,
      level: ALERT_LEVELS[alert.level] ?? null,
      url: path ? this.screen(path) : null,
    };
  }

  private indicatorWatch(indicator: DashboardIndicator): Watch {
    const path = INDICATORS[indicator.code]?.path;
    return {
      key: `indicator-${indicator.source}-${indicator.code}`,
      label: indicatorLabel(indicator.code),
      detail: '',
      count: indicator.count,
      level: null,
      url: path ? this.screen(path) : null,
    };
  }

  /** URL of a screen of Comptabilité, or `null` when the user may not open it. */
  private screen(path: string): string | null {
    const url = `${ACCOUNTING}/${path}`;
    return this.navigation.canOpenUrl(url) ? url : null;
  }
}
