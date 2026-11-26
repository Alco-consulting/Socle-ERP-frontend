import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { toUserError } from '../../core/errors/user-error';
import { requestState } from '../../core/http/request-state';
import { SessionStore } from '../../core/session/session.store';
import { AlcoCell, AlcoTable, TableColumn } from '../../shared/tables/table';
import { AlcoBadge } from '../../shared/ui/badge/badge';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoEmptyState } from '../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { ANALYTIC_ERRORS, percentText } from './analytics-presentation';
import { AnalyticsApi } from './data-access/analytics-api';
import { AnalyticRule } from './data-access/analytics-models';

/** Comptabilité › Configuration › Analytique › Modèles de répartition, as Odoo's. */
@Component({
  selector: 'alco-analytic-rule-list',
  imports: [
    RouterLink,
    AlcoBadge,
    AlcoButton,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoLoading,
    AlcoPageHeader,
    AlcoTable,
  ],
  templateUrl: './rule-list.html',
  styleUrl: './analytics-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticRuleListPage {
  private readonly api = inject(AnalyticsApi);
  private readonly session = inject(SessionStore);

  protected readonly canManage = computed(() => this.session.can('analytics.manage_rules'));
  protected readonly rules = requestState(() => this.api.rules());
  protected readonly columns: readonly TableColumn[] = [
    { key: 'name', label: 'Modèle' },
    { key: 'accounts', label: 'Comptes', width: '9rem' },
    { key: 'shares', label: 'Répartition', hideBelow: 'tablet' },
    { key: 'status', label: 'État', width: '8rem' },
  ];
  protected readonly rowId = (row: AnalyticRule) => row.public_id;
  protected readonly loadError = computed(() => {
    const error = this.rules.error();
    return error ? toUserError(error, ANALYTIC_ERRORS) : null;
  });

  protected sharesOf(rule: AnalyticRule): string {
    return rule.lines
      .map((line) => `${line.value.code} ${percentText(line.percentage)}`)
      .join(', ');
  }
}
