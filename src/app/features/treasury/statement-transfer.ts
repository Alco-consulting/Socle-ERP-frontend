import { ContextualTransfer } from '../transfers/contextual-transfer';

/** Import of bank statements, contextual to Trésorerie › Relevés (API type `treasury.statements`, A6). */
export const STATEMENT_TRANSFER: ContextualTransfer = {
  importType: 'treasury.statements',
  exportType: null, // the API has no export of statements
  importPermission: 'treasury.manage_statements',
  exportPermission: 'treasury.read',
  importLabel: 'Importer des relevés',
  exportLabel: 'Exporter les relevés',
  importTitle: 'Import de relevés bancaires',
  importEffect:
    'Crée les relevés et leurs lignes à partir d’un fichier CSV ; un relevé déjà présent est ignoré, rien n’est corrigé.',
  creationKey: 'statements',
  countLabel: (count) => `${count} relevé${count > 1 ? 's' : ''}`,
  backLabel: 'Retour aux relevés',
  fieldLabels: {
    account: 'Compte de trésorerie (code)',
    statement_reference: 'Référence du relevé',
    statement_date: 'Date du relevé',
    period_start: 'Début de période',
    period_end: 'Fin de période',
    opening_balance: 'Solde d’ouverture',
    closing_balance: 'Solde de clôture',
    line_date: 'Date de la ligne',
    amount: 'Montant (positif : entrée, négatif : sortie)',
    value_date: 'Date de valeur',
    description: 'Libellé',
    bank_reference: 'Référence de la banque',
    external_id: 'Identifiant de la transaction',
    running_balance: 'Solde après la ligne',
  },
};
