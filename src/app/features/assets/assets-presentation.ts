import { ErrorCatalog } from '../../core/errors/user-error';
import { BadgeTone } from '../../shared/ui/badge/badge';
import { IconName } from '../../shared/ui/icon/icons';
import { AssetStatus, DisposalKind, LineStatus } from './data-access/assets-models';

/** Words and look of the assets API's values: no state is decided here. */

export interface Look {
  readonly label: string;
  readonly tone: BadgeTone;
  readonly icon: IconName;
}

export const ASSET_STATUS: Readonly<Record<AssetStatus, Look>> = {
  draft: { label: 'Brouillon', tone: 'neutral', icon: 'edit' },
  acquired: { label: 'Acquise', tone: 'info', icon: 'check' },
  in_service: { label: 'En service', tone: 'primary', icon: 'check' },
  disposed: { label: 'Cédée', tone: 'success', icon: 'upload' },
  cancelled: { label: 'Annulée', tone: 'neutral', icon: 'close' },
};

export const LINE_STATUS: Readonly<Record<LineStatus, string>> = {
  planned: 'À comptabiliser',
  recorded: 'À comptabiliser',
  accounted: 'Comptabilisée',
  superseded: 'Remplacée',
  cancelled: 'Annulée',
};

export const DISPOSAL_KINDS: readonly { id: DisposalKind; label: string }[] = [
  { id: 'sale', label: 'Vente' },
  { id: 'scrapping', label: 'Mise au rebut' },
];

/** « 5 ans », « 3 ans et 6 mois », « 18 mois ». */
export function durationText(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) {
    return `${rest} mois`;
  }
  const yearText = `${years} an${years > 1 ? 's' : ''}`;
  return rest === 0 ? yearText : `${yearText} et ${rest} mois`;
}

/** The last day of the month before `today` (`YYYY-MM-DD`): the usual « jusqu'au ». */
export function lastMonthEnd(today: string): string {
  const [year, month] = today.split('-').map(Number);
  const end = new Date(Date.UTC(year, month - 1, 0));
  return end.toISOString().slice(0, 10);
}

/** The last day of a month (`2026-03` → `2026-03-31`). */
export function monthEnd(month: string): string {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

export const ASSET_ERRORS: ErrorCatalog = {
  assets_category_code_exists: {
    title: 'Ce code de catégorie existe déjà.',
    message: 'Choisissez un autre code.',
  },
  assets_category_inactive: {
    title: 'La catégorie est désactivée.',
    message: 'Choisissez une catégorie active.',
  },
  assets_value_invalid: {
    title: 'La valeur n’est pas valable.',
    message: 'La valeur doit être positive, avec les décimales de la devise.',
  },
  assets_invalid_transition: {
    title: 'Cette action n’est plus possible.',
    message: 'L’immobilisation a changé entre-temps : la page est rechargée.',
  },
  assets_asset_not_editable: {
    title: 'L’immobilisation est confirmée.',
    message: 'Seule une immobilisation en brouillon se modifie.',
  },
  assets_account_missing: {
    title: 'Un compte manque dans la catégorie.',
    message: 'Renseignez les comptes de la catégorie, puis recommencez.',
  },
  assets_journal_missing: {
    title: 'La catégorie n’a pas de journal.',
    message: 'Choisissez un journal pour la catégorie, puis recommencez.',
  },
  assets_category_template_not_found: {
    title: 'Pas de catégories usuelles pour ce pays.',
    message: 'Créez vos catégories une à une.',
  },
  assets_depreciation_pending: {
    title: 'Des dotations restent à comptabiliser.',
    message: 'Comptabilisez les dotations jusqu’à la date de cession, puis recommencez.',
  },
};

/** The reason an asset was refused by « Comptabiliser les dotations », in words. */
export function refusalText(code: string): string {
  return ASSET_ERRORS[code]?.title ?? 'Refusée par le serveur.';
}
