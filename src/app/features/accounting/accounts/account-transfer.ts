import { ContextualTransfer } from '../../transfers/contextual-transfer';

/**
 * Import of a chart of accounts, contextual to Comptabilité › Plan comptable (API type
 * `accounting.accounts`). Flat, as the server imports it: no parent column, no hierarchy;
 * the type labels are translated by the server, never here.
 */
export const ACCOUNT_TRANSFER: ContextualTransfer = {
  importType: 'accounting.accounts',
  exportType: null, // the API has no export of the chart
  importPermission: 'accounting.manage_accounts',
  exportPermission: 'accounting.read',
  importLabel: 'Importer des comptes',
  exportLabel: 'Exporter le plan comptable',
  importTitle: 'Import du plan comptable',
  importEffect:
    'Crée les comptes à partir d’un fichier CSV (code, nom, type), sans hiérarchie ; un code déjà présent est ignoré, jamais modifié.',
  creationKey: 'accounts',
  countLabel: (count) => `${count} compte${count > 1 ? 's' : ''}`,
  backLabel: 'Retour au plan comptable',
  fieldLabels: {
    code: 'Code',
    name: 'Nom du compte',
    account_type: 'Type',
  },
};
