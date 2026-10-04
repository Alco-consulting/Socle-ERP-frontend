import { EntryStatus } from '../data-access/accounting-models';

/**
 * Words of the accounting dashboard. Alerts and indicators are named by their stable `code`
 * (the server's `message` is neither stable nor translated: never shown); an unknown code
 * still shows, with a generic label.
 */

/** A counter of a journal card: its label and the entry list's `etat` (none: every entry). */
export interface CounterLook {
  readonly key: 'total' | EntryStatus;
  readonly label: string;
  readonly status: EntryStatus | null;
}

export const JOURNAL_COUNTERS: readonly CounterLook[] = [
  { key: 'total', label: 'Écritures', status: null },
  { key: 'draft', label: 'Brouillons', status: 'draft' },
  { key: 'submitted', label: 'Soumises', status: 'submitted' },
  { key: 'validated', label: 'Validées', status: 'validated' },
  { key: 'locked', label: 'Verrouillées', status: 'locked' },
];

/**
 * Indicators of `dashboards/alerts/` (facts of a domain, counted): label, and the screen of
 * Comptabilité where they are dealt with (a path of the catalogue), if any.
 */
export const INDICATORS: Readonly<Record<string, { label: string; path?: string }>> = {
  statement_lines_unreconciled: {
    label: 'Lignes de relevé à rapprocher',
    path: 'tresorerie/rapprochements',
  },
  installments_overdue: { label: 'Échéances d’emprunt en retard', path: 'emprunts/echeanciers' },
  declarations_not_validated: {
    label: 'Déclarations de taxes non validées',
    path: 'taxes/declarations',
  },
  imports_failed: { label: 'Imports en échec' },
};

/** Screen of the alerts' source (closing checks): Comptabilité › Clôture. */
export const ALERT_PATHS: Readonly<Record<string, string>> = { closing: 'cloture' };

/** Checks of a closing in progress (Closing's codes). */
export const CLOSING_CHECKS: Readonly<Record<string, string>> = {
  company_inactive: 'La société est désactivée',
  scope_closed: 'La période est déjà clôturée',
  pending_entries: 'Écritures non validées',
  unbalanced_entries: 'Écritures déséquilibrées',
  numbering_gaps: 'Trous dans la numérotation',
  earlier_periods_open: 'Périodes antérieures encore ouvertes',
  unclassified_accounts: 'Comptes non classés',
  fx_rate_missing: 'Taux de clôture manquant',
  treasury_unposted_operations: 'Opérations de trésorerie non comptabilisées',
  treasury_draft_operations: 'Opérations de trésorerie en brouillon',
  treasury_unreconciled_lines: 'Lignes de relevé non rapprochées',
  treasury_open_statements: 'Relevés bancaires encore ouverts',
  loans_unposted_events: 'Événements d’emprunt non comptabilisés',
  loans_overdue_installments: 'Échéances d’emprunt en retard',
  loans_schedule_inconsistent: 'Échéancier d’emprunt incohérent',
  loans_accrued_interest: 'Intérêts courus à déterminer',
  assets_depreciation_due: 'Dotations aux amortissements à enregistrer',
  assets_depreciation_unposted: 'Dotations non comptabilisées',
  assets_acquisitions_unposted: 'Acquisitions d’immobilisations non comptabilisées',
  assets_impairments_draft: 'Dépréciations en brouillon',
  tax_declarations_open: 'Déclarations de taxes non clôturées',
};

export const ALERT_LEVELS: Readonly<
  Record<
    string,
    { label: string; tone: 'danger' | 'warning'; icon: 'alert-circle' | 'alert-triangle' }
  >
> = {
  blocking: { label: 'Bloquant', tone: 'danger', icon: 'alert-circle' },
  warning: { label: 'À vérifier', tone: 'warning', icon: 'alert-triangle' },
};

export function closingCheckLabel(code: string): string {
  return CLOSING_CHECKS[code] ?? `Contrôle de clôture « ${code} »`;
}

export function indicatorLabel(code: string): string {
  return INDICATORS[code]?.label ?? `Indicateur « ${code} »`;
}
