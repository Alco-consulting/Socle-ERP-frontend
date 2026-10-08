import { ErrorCatalog } from '../../core/errors/user-error';
import { ImportMessageDto } from './transfers-api';

/** Errors of the import and export commands, by their stable code. */
export const TRANSFER_ERRORS: ErrorCatalog = {
  imports_file_rejected: {
    title: 'Ce fichier n’est pas accepté.',
    message: 'Envoyez un fichier CSV (texte, 5 Mo au plus).',
  },
  imports_file_already_imported: {
    title: 'Ce fichier a déjà été importé.',
    message: 'Un même fichier n’est jamais importé deux fois.',
  },
  imports_parse_failed: {
    title: 'Le fichier n’a pas pu être lu.',
    message: 'Vérifiez l’encodage et le séparateur choisis, puis réessayez.',
  },
  imports_encoding_undetermined: {
    title: 'Impossible de déterminer automatiquement l’encodage du fichier.',
    message:
      'Enregistrez-le en CSV UTF-8, ou choisissez l’encodage dans les options avancées, puis renvoyez-le.',
  },
  imports_delimiter_undetermined: {
    title: 'Impossible de déterminer automatiquement le séparateur des colonnes.',
    message:
      'Vérifiez que chaque ligne a le même nombre de colonnes, ou choisissez le séparateur dans les options avancées.',
  },
  imports_encoding_invalid: {
    title: 'Le fichier n’est pas dans l’encodage choisi.',
    message: 'Laissez l’encodage en détection automatique, ou choisissez-en un autre.',
  },
  imports_mapping_invalid: {
    title: 'La correspondance des colonnes ne convient pas.',
    message: 'Associez une colonne du fichier à chaque champ obligatoire.',
  },
  imports_rows_invalid: {
    title: 'Des lignes sont refusées.',
    message: 'Rien n’est importé tant qu’une ligne est refusée : corrigez le fichier.',
  },
  imports_invalid_transition: {
    title: 'Cette étape n’est plus possible.',
    message: 'L’import a changé d’état entre-temps : recommencez avec le fichier.',
  },
  exports_parameters_invalid: {
    title: 'Les critères de l’export ne sont pas valides.',
    message: 'Modifiez les filtres de la liste puis réessayez.',
  },
  exports_file_unavailable: {
    title: 'Le fichier n’est pas disponible.',
    message: 'Il n’est pas prêt, a échoué ou a expiré : lancez un nouvel export.',
  },
};

/** Messages of a checked row, by their stable code (the server's text is not shown). */
const ROW_MESSAGES: Readonly<Record<string, string>> = {
  required: 'Valeur obligatoire manquante.',
  invalid: 'Valeur invalide.',
  invalid_format: 'Format non reconnu.',
  duplicate_in_file: 'Cette valeur apparaît plus haut dans le fichier.',
  // Bank statements (treasury.statements, V2.1 A6).
  unknown_account: 'Compte de trésorerie inconnu dans cette société.',
  statement_header_mismatch:
    'Les lignes d’un même relevé doivent avoir la même date, la même période et les mêmes soldes.',
  zero_amount: 'Une ligne de relevé a un montant non nul.',
  line_already_imported: 'Cette transaction est déjà dans un relevé de ce compte.',
  possible_duplicate:
    'Une ligne du compte a déjà la même date, le même montant et la même référence : vérifiez qu’il ne s’agit pas d’un doublon.',
  statement_unbalanced:
    'Le solde d’ouverture plus les lignes diffère du solde de clôture : le relevé sera importé tel quel, à vérifier.',
  // Chart of accounts (accounting.accounts): the server's labels only, never guessed.
  unknown_account_type: 'Type inconnu : seuls les libellés validés du plan sont acceptés.',
  accounting_account_code_exists: 'Ce code de compte existe déjà dans la société.',
  unknown_currency: 'Devise inconnue.',
  currency_inactive: 'Devise inactive.',
  validation_error: 'Valeur refusée par le serveur.',
};

export function rowMessage(message: ImportMessageDto): string {
  const text = ROW_MESSAGES[message.code];
  if (
    message.code === 'statement_unbalanced' &&
    typeof message.details['difference'] === 'string'
  ) {
    // The server's figure, shown as given (never recomputed).
    return `${text} Écart : ${message.details['difference']}.`;
  }
  if (message.code === 'unknown_account_type' && typeof message.details['value'] === 'string') {
    return `${text} Valeur lue : « ${message.details['value']} ».`;
  }
  return text ?? (message.level === 'warning' ? 'À vérifier.' : 'Refusé par le serveur.');
}
