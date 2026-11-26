import { Routes } from '@angular/router';

import { permissionGuard } from '../../core/navigation/app-access.guard';
import { unsavedChangesGuard } from '../../core/navigation/unsaved-changes';

const ruleForm = () => import('./rule-form').then((m) => m.AnalyticRuleFormPage);

/**
 * Comptabilité › Analytique (note backend 0063): plans and their accounts, distribution
 * models, the report. Paths start with the section's (`analytique/…`), whose guard checks
 * `analytics.read`.
 */
export const ANALYTICS_ROUTES: Routes = [
  {
    path: 'analytique/plans',
    data: { breadcrumb: 'Plans analytiques' },
    children: [
      {
        path: '',
        loadComponent: () => import('./plan-list').then((m) => m.AnalyticPlanListPage),
      },
      {
        path: ':id',
        // Named after the plan once loaded (BreadcrumbService.nameCurrent).
        data: { breadcrumb: 'Plan' },
        loadComponent: () => import('./plan-detail').then((m) => m.AnalyticPlanDetailPage),
      },
    ],
  },
  {
    path: 'analytique/regles',
    data: { breadcrumb: 'Modèles de répartition' },
    children: [
      {
        path: '',
        loadComponent: () => import('./rule-list').then((m) => m.AnalyticRuleListPage),
      },
      {
        path: 'nouveau',
        data: { breadcrumb: 'Nouveau modèle' },
        canActivate: [permissionGuard('analytics.manage_rules')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: ruleForm,
      },
      {
        path: ':id',
        data: { breadcrumb: 'Modèle' },
        canDeactivate: [unsavedChangesGuard],
        loadComponent: ruleForm,
      },
    ],
  },
  {
    path: 'analytique/rapports',
    data: { breadcrumb: 'Analytique' },
    canActivate: [permissionGuard('reporting.read_analytics')],
    loadComponent: () => import('./analytic-report').then((m) => m.AnalyticReportPage),
  },
];
