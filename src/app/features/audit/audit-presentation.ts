import { AUDIT_ACTIONS } from './object-history';

const ACCOUNTING = '/app/comptabilite';

interface ObjectKind {
  readonly label: string;
  /** The record's page, when the application has one. */
  readonly page?: string;
}

/** The objects the journal speaks of (model labels of the backend), in words. */
export const AUDIT_OBJECTS: Readonly<Record<string, ObjectKind>> = {
  'accounting.journalentry': { label: 'Écriture', page: `${ACCOUNTING}/ecritures` },
  'accounting.journal': { label: 'Journal', page: `${ACCOUNTING}/journaux` },
  'accounting.account': { label: 'Compte', page: `${ACCOUNTING}/plan-comptable` },
  'accounting.lettering': { label: 'Lettrage', page: `${ACCOUNTING}/lettrage` },
  'accounting.dueschedule': { label: 'Échéancier', page: `${ACCOUNTING}/echeances/echeanciers` },
  'accounting.fiscalyear': { label: 'Exercice' },
  'accounting.accountingperiod': { label: 'Période' },
  'accounting.accountingsettings': { label: 'Paramètres comptables' },
  'partners.partner': { label: 'Contact', page: `${ACCOUNTING}/contacts` },
  'invoicing.invoice': { label: 'Facture ou avoir' },
  'invoicing.product': { label: 'Produit', page: `${ACCOUNTING}/produits` },
  'taxes.tax': { label: 'Taxe', page: `${ACCOUNTING}/taxes/liste` },
  'taxes.taxdeclaration': { label: 'Déclaration de TVA', page: `${ACCOUNTING}/taxes/declarations` },
  'taxes.taxsettings': { label: 'Paramètres fiscaux' },
  'treasury.treasuryoperation': {
    label: 'Opération de trésorerie',
    page: `${ACCOUNTING}/tresorerie/operations`,
  },
  'treasury.treasurytransfer': {
    label: 'Virement interne',
    page: `${ACCOUNTING}/tresorerie/virements`,
  },
  'treasury.bankstatement': { label: 'Relevé bancaire', page: `${ACCOUNTING}/tresorerie/releves` },
  'treasury.reconciliation': { label: 'Rapprochement bancaire' },
  'closing.closingrun': { label: 'Clôture', page: `${ACCOUNTING}/cloture` },
  'currencies.currencyrate': { label: 'Taux de change' },
  'documents.document': { label: 'Pièce jointe' },
  'companies.company': { label: 'Société' },
  'companies.companymembership': { label: 'Membre de la société' },
  'users.user': { label: 'Utilisateur' },
};

/** The types offered by the filter, by name. */
export const OBJECT_FILTERS: readonly { id: string; label: string }[] = Object.entries(
  AUDIT_OBJECTS,
)
  .map(([id, kind]) => ({ id, label: kind.label }))
  .sort((a, b) => a.label.localeCompare(b.label, 'fr'));

export const ACTION_FILTERS: readonly { id: string; label: string }[] = Object.entries(
  AUDIT_ACTIONS,
)
  .map(([id, label]) => ({ id, label }))
  .sort((a, b) => a.label.localeCompare(b.label, 'fr'));

export const AUDIT_ORIGINS: Readonly<Record<string, string>> = {
  http: 'Un utilisateur, depuis l’application',
  task: 'Une tâche automatique',
  system: 'Le système',
  import: 'Un import de fichier',
};

export function actionText(action: string): string {
  return AUDIT_ACTIONS[action] ?? action;
}

export function objectText(type: string): string {
  return AUDIT_OBJECTS[type]?.label ?? type;
}

/** The record's page, or `null` when it has none here. */
export function objectLink(type: string, id: string): string | null {
  const page = AUDIT_OBJECTS[type]?.page;
  return page && id ? `${page}/${id}` : null;
}

/** A value of `before` / `after`, as read: nothing is a dash, a structure its JSON. */
export function valueText(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  if (typeof value === 'boolean') {
    return value ? 'Oui' : 'Non';
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
