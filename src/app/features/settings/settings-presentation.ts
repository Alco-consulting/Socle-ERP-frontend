import { ErrorCatalog } from '../../core/errors/user-error';
import { AppUser, DateFormat, NumberFormat } from './data-access/settings-api';

/** A permission a member may receive in a company, as the backend names it. */
export interface PermissionItem {
  readonly code: string;
  readonly label: string;
}

export interface PermissionGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly PermissionItem[];
}

const group = (id: string, label: string, items: [string, string][]): PermissionGroup => ({
  id,
  label,
  items: items.map(([action, text]) => ({ code: `${id}.${action}`, label: text })),
});

/**
 * The permissions granted in a company (backend `policies.py` of each domain), by
 * application. The global ones (`users.*`, `companies.create`, the currency catalogue's
 * `currencies.create` / `currencies.update`) are never granted here.
 */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  group('accounting', 'Comptabilité', [
    ['read', 'Consulter'],
    ['create', 'Saisir des écritures'],
    ['update', 'Modifier les brouillons'],
    ['submit', 'Soumettre'],
    ['validate', 'Valider'],
    ['lock', 'Verrouiller'],
    ['reverse', 'Contrepasser'],
    ['manage_accounts', 'Gérer le plan comptable'],
    ['manage_journals', 'Gérer les journaux'],
    ['manage_periods', 'Gérer les exercices et périodes'],
    ['letter', 'Lettrer'],
    ['unletter', 'Délettrer'],
    ['manage_due_dates', 'Gérer les échéances'],
  ]),
  group('invoicing', 'Facturation', [
    ['read', 'Consulter'],
    ['create', 'Créer des factures'],
    ['update', 'Modifier les brouillons'],
    ['post', 'Comptabiliser'],
    ['cancel', 'Annuler'],
    ['manage_products', 'Gérer les produits'],
  ]),
  group('treasury', 'Trésorerie', [
    ['read', 'Consulter'],
    ['create', 'Saisir des opérations'],
    ['update', 'Modifier'],
    ['confirm', 'Confirmer'],
    ['account', 'Comptabiliser'],
    ['reconcile', 'Rapprocher'],
    ['manage_accounts', 'Gérer les comptes de trésorerie'],
    ['manage_statements', 'Gérer les relevés'],
  ]),
  group('partners', 'Contacts', [
    ['read', 'Consulter'],
    ['create', 'Créer'],
    ['update', 'Modifier'],
    ['disable', 'Archiver'],
  ]),
  group('taxes', 'Taxes', [
    ['read', 'Consulter'],
    ['create', 'Créer'],
    ['update', 'Modifier'],
    ['manage_declarations', 'Préparer les déclarations'],
    ['validate_declaration', 'Valider les déclarations'],
  ]),
  group('currencies', 'Devises', [
    ['read', 'Consulter'],
    ['manage_rates', 'Gérer les taux de la société'],
  ]),
  group('assets', 'Immobilisations', [
    ['read', 'Consulter'],
    ['create', 'Créer'],
    ['update', 'Modifier'],
    ['activate', 'Mettre en service'],
    ['depreciate', 'Amortir'],
    ['impair', 'Déprécier'],
    ['dispose', 'Céder'],
    ['account', 'Comptabiliser'],
    ['manage_categories', 'Gérer les catégories'],
  ]),
  group('loans', 'Emprunts', [
    ['read', 'Consulter'],
    ['create', 'Créer'],
    ['update', 'Modifier'],
    ['activate', 'Activer'],
    ['schedule', 'Établir l’échéancier'],
    ['pay', 'Enregistrer les remboursements'],
    ['prepay', 'Rembourser par anticipation'],
    ['account', 'Comptabiliser'],
    ['manage_types', 'Gérer les types d’emprunt'],
  ]),
  group('analytics', 'Analytique', [
    ['read', 'Consulter'],
    ['create', 'Créer'],
    ['update', 'Modifier'],
    ['disable', 'Désactiver'],
    ['allocate', 'Ventiler'],
    ['manage_rules', 'Gérer les règles de ventilation'],
  ]),
  group('reporting', 'Rapports', [
    ['read', 'Consulter les rapports'],
    ['read_auxiliary', 'Balances et grands livres auxiliaires'],
    ['read_analytics', 'Rapports analytiques'],
    ['read_financial_statements', 'États financiers'],
    ['manage_layouts', 'Gérer les modèles de rapports'],
    ['manage_aging', 'Paramétrer la balance âgée'],
  ]),
  group('dashboards', 'Tableaux de bord', [
    ['read', 'Consulter'],
    ['read_financial', 'Indicateurs financiers'],
    ['read_treasury', 'Trésorerie'],
    ['read_auxiliary', 'Clients et fournisseurs'],
    ['read_assets', 'Immobilisations'],
    ['read_loans', 'Emprunts'],
    ['read_taxes', 'Taxes'],
  ]),
  group('closing', 'Clôture', [
    ['read', 'Consulter'],
    ['start', 'Démarrer une clôture'],
    ['execute', 'Exécuter les étapes'],
    ['validate', 'Valider'],
    ['close', 'Clôturer l’exercice'],
    ['reopen', 'Rouvrir'],
  ]),
  group('documents', 'Documents', [
    ['read', 'Consulter'],
    ['upload', 'Joindre des pièces'],
    ['download', 'Ouvrir les pièces'],
    ['replace', 'Remplacer'],
    ['delete', 'Supprimer'],
  ]),
  group('imports_exports', 'Imports et exports', [
    ['read', 'Consulter'],
    ['create', 'Préparer un import'],
    ['validate', 'Contrôler'],
    ['execute', 'Exécuter'],
    ['cancel', 'Annuler'],
    ['export', 'Exporter'],
    ['manage_mappings', 'Gérer les correspondances'],
  ]),
  group('audit', 'Audit', [
    ['read', 'Consulter l’historique'],
    ['read_sensitive', 'Voir les données sensibles'],
  ]),
  group('companies', 'Société', [
    ['read', 'Consulter la fiche'],
    ['update', 'Modifier la fiche'],
    ['manage_members', 'Gérer les membres'],
    ['grant_permissions', 'Accorder des droits'],
  ]),
];

export const DATE_FORMATS: readonly { id: DateFormat; label: string }[] = [
  { id: 'DD/MM/YYYY', label: 'JJ/MM/AAAA' },
  { id: 'YYYY-MM-DD', label: 'AAAA-MM-JJ' },
  { id: 'MM/DD/YYYY', label: 'MM/JJ/AAAA' },
];

export const NUMBER_FORMATS: readonly { id: NumberFormat; label: string }[] = [
  { id: 'space_comma', label: '1 234 567,89' },
  { id: 'dot_comma', label: '1.234.567,89' },
  { id: 'comma_dot', label: '1,234,567.89' },
];

/** « Mariam Test », else the address. */
export function personName(user: Pick<AppUser, 'first_name' | 'last_name' | 'email'>): string {
  return `${user.first_name} ${user.last_name}`.trim() || user.email;
}

/** « MT »: the initials of a person, for the avatar. */
export function initials(user: Pick<AppUser, 'first_name' | 'last_name' | 'email'>): string {
  const letters = [user.first_name, user.last_name].map((part) => part.trim().charAt(0)).join('');
  return (letters || user.email.charAt(0)).toUpperCase();
}

export const SETTINGS_ERRORS: ErrorCatalog = {
  already_member: {
    title: 'Cette personne est déjà membre de la société.',
    message: 'Retrouvez-la dans la liste pour changer ses droits.',
  },
  cannot_change_own_membership: {
    title: 'Vos propres droits ne se modifient pas ici.',
    message: 'Demandez à un autre administrateur de la société de les changer.',
  },
  membership_out_of_reach: {
    title: 'Ce membre a des droits que vous n’avez pas.',
    message: 'Seul un administrateur qui les détient peut modifier ses droits.',
  },
  permission_delegation_denied: {
    title: 'Vous ne pouvez accorder que des droits que vous détenez.',
    message: 'Décochez les droits que vous n’avez pas dans cette société.',
  },
};
