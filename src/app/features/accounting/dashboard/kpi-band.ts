import { NgTemplateOutlet, formatDate } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { requestState } from '../../../core/http/request-state';
import { APP_ROOT } from '../../../core/navigation/applications';
import { NavigationService } from '../../../core/navigation/navigation.service';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoIcon } from '../../../shared/ui/icon/icon';
import { IconName } from '../../../shared/ui/icon/icons';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { localToday } from '../../../shared/utils/dates';
import { formatDecimal, trimDecimalZeros } from '../../../shared/utils/decimal';
import { DashboardScope } from '../../dashboards/data-access/dashboard-models';
import { DashboardsApi } from '../../dashboards/data-access/dashboards-api';
import { AccountingApi } from '../data-access/accounting-api';
import { FiscalYear } from '../data-access/accounting-models';

const ACCOUNTING = `${APP_ROOT}/comptabilite`;

/** The six headline figures: where the server gives them, and the screen that details them. */
const KPIS = [
  {
    key: 'cash',
    icon: 'treasury',
    mark: 'primary',
    section: 'cash',
    code: 'booked_balance',
    label: 'Trésorerie',
    caption: 'Banques et caisses',
    screen: null,
  },
  {
    key: 'income',
    icon: 'arrow-up',
    mark: 'success',
    section: 'financial',
    code: 'total_income',
    label: 'Produits',
    caption: 'Ventes et autres produits',
    screen: 'analyse/resultat',
  },
  {
    key: 'expense',
    icon: 'arrow-down',
    mark: 'warning',
    section: 'financial',
    code: 'total_expense',
    label: 'Charges',
    caption: 'Achats et autres charges',
    screen: 'analyse/resultat',
  },
  {
    key: 'result',
    icon: 'analytics',
    mark: 'info',
    section: 'financial',
    code: 'result',
    label: 'Résultat',
    caption: '',
    screen: 'analyse/resultat',
  },
  {
    key: 'receivables',
    icon: 'partners',
    mark: 'primary',
    section: 'receivables',
    code: 'balance',
    label: 'Créances clients',
    caption: 'À encaisser',
    screen: 'analyse/balance-clients',
  },
  {
    key: 'payables',
    icon: 'company',
    mark: 'neutral',
    section: 'payables',
    code: 'balance',
    label: 'Dettes fournisseurs',
    caption: 'À payer',
    screen: 'analyse/balance-fournisseurs',
  },
] as const;

interface Period {
  readonly id: string;
  readonly label: string;
  readonly scope: DashboardScope;
}

interface Kpi {
  readonly key: string;
  readonly label: string;
  /** Its mark: an icon on a soft disc of one tone (decorative). */
  readonly icon: IconName;
  readonly mark: 'primary' | 'success' | 'warning' | 'info' | 'neutral';
  /** The figure, formatted; `null` when the reader may not see it or it is unknown. */
  readonly value: string | null;
  readonly currency: string;
  readonly caption: string;
  readonly tone: 'positive' | 'negative' | null;
  readonly url: string | null;
}

/** First day of the month or quarter of `day`, never before the fiscal year. */
function startOf(day: string, months: number, year: FiscalYear | undefined): string {
  const [y, m] = day.split('-').map(Number);
  const month = Math.floor((m - 1) / months) * months + 1;
  const start = `${y}-${String(month).padStart(2, '0')}-01`;
  return year && year.start_date > start ? year.start_date : start;
}

/**
 * The dashboard's headline figures (DESIGN_AUDIT.md, decision 2): cash, income, expenses,
 * result, receivables and payables over a period chosen above them, from
 * `GET dashboards/overview/`. Each figure is the server's; each leads to its report.
 */
@Component({
  selector: 'alco-kpi-band',
  imports: [NgTemplateOutlet, RouterLink, AlcoErrorState, AlcoIcon, AlcoInput, AlcoLoading],
  templateUrl: './kpi-band.html',
  styleUrl: './kpi-band.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoKpiBand {
  private readonly dashboards = inject(DashboardsApi);
  private readonly accounting = inject(AccountingApi);
  private readonly navigation = inject(NavigationService);
  private readonly locale = inject(LOCALE_ID);

  /** Decimals of the company's currency (display only: the amounts are exact). */
  readonly decimals = input(0);

  private readonly today = localToday();
  private readonly years = requestState(() =>
    this.accounting.fiscalYears().pipe(
      map((page) => page.results),
      catchError(() => of([] as FiscalYear[])),
    ),
  );

  /** The current fiscal year, the previous one, this month and this quarter. */
  protected readonly periods = computed<readonly Period[]>(() => {
    const known = this.years.value();
    if (!known) {
      return []; // The fiscal years first: the default period is the current one.
    }
    const years = [...known].sort((a, b) => b.start_date.localeCompare(a.start_date));
    const current = years.find(
      (year) => year.start_date <= this.today && this.today <= year.end_date,
    );
    const previous = years.find((year) => year.end_date < (current?.start_date ?? this.today));
    // The year's own label (« Exercice 2026 »), else its code.
    const name = (year: FiscalYear) => year.label || `Exercice ${year.code}`;
    return [
      ...(current
        ? [{ id: 'exercice', label: name(current), scope: { fiscal_year: current.public_id } }]
        : []),
      {
        id: 'trimestre',
        label: 'Ce trimestre',
        scope: { date_from: startOf(this.today, 3, current), date_to: this.today },
      },
      {
        id: 'mois',
        label: 'Ce mois-ci',
        scope: { date_from: startOf(this.today, 1, current), date_to: this.today },
      },
      ...(previous
        ? [{ id: 'precedent', label: name(previous), scope: { fiscal_year: previous.public_id } }]
        : []),
    ];
  });

  protected readonly chosen = signal<string | null>(null);
  protected readonly period = computed(() => {
    const periods = this.periods();
    return periods.find((item) => item.id === this.chosen()) ?? periods[0];
  });

  protected readonly overview = requestState(
    () => this.dashboards.overview(untracked(this.period).scope),
    { immediate: false },
  );

  /** « du 1 janv. au 17 oct. 2026 », the server's scope. */
  protected readonly range = computed(() => {
    const scope = this.overview.value()?.scope;
    if (!scope) {
      return '';
    }
    const day = (value: string) => formatDate(value, 'd MMM y', this.locale);
    return `du ${day(scope.date_from)} au ${day(scope.date_to)}`;
  });

  protected readonly kpis = computed<readonly Kpi[]>(() => {
    const overview = this.overview.value();
    if (!overview) {
      return [];
    }
    return KPIS.map((kpi) => {
      const metric = overview.sections
        .find((section) => section.section === kpi.section)
        ?.metrics.find((item) => item.code === kpi.code);
      const raw =
        metric?.value === null || metric?.value === undefined ? null : String(metric.value);
      const sign = raw === null ? 0 : Math.sign(Number(raw));
      const url = kpi.screen ? `${ACCOUNTING}/${kpi.screen}` : null;
      return {
        key: kpi.key,
        label: kpi.label,
        icon: kpi.icon,
        mark: kpi.mark,
        value:
          raw === null
            ? null
            : formatDecimal(trimDecimalZeros(raw, this.decimals()), this.decimals()),
        currency: metric?.currency ?? '',
        caption:
          raw === null
            ? overview.restricted.includes(kpi.section)
              ? 'Accès restreint'
              : 'Non disponible'
            : kpi.key === 'result'
              ? sign > 0
                ? 'Bénéfice'
                : sign < 0
                  ? 'Perte'
                  : 'À l’équilibre'
              : kpi.caption,
        tone: kpi.key === 'result' && sign !== 0 ? (sign > 0 ? 'positive' : 'negative') : null,
        url: url && raw !== null && this.navigation.canOpenUrl(url) ? url : null,
      };
    });
  });

  constructor() {
    // A period known or changed: its figures.
    effect(() => {
      if (this.period()) {
        untracked(() => this.overview.reload());
      }
    });
  }

  protected choose(id: string): void {
    this.chosen.set(id);
  }
}
