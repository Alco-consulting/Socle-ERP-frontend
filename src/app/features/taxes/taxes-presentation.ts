import { toApiError } from '../../core/http/api-error';
import { formatDecimal, trimDecimalZeros } from '../../shared/utils/decimal';
import { ErrorCatalog } from '../../core/errors/user-error';
import {
  AmountType,
  PriceInclusion,
  RepartitionLine,
  RepartitionType,
  TaxScope,
  TaxUse,
} from './data-access/taxes-models';

export interface Choice<T extends string> {
  readonly id: T;
  readonly label: string;
}

/** Odoo's words, in Odoo's order. */
export const TAX_USES: readonly Choice<TaxUse>[] = [
  { id: 'sale', label: 'Ventes' },
  { id: 'purchase', label: 'Achats' },
  { id: 'none', label: 'Aucun' },
];
export const TAX_SCOPES: readonly Choice<Exclude<TaxScope, ''>>[] = [
  { id: 'service', label: 'Services' },
  { id: 'consu', label: 'Biens' },
];
export const AMOUNT_TYPES: readonly Choice<AmountType>[] = [
  { id: 'percent', label: 'Pourcentage' },
];
export const PRICE_INCLUSIONS: readonly Choice<Exclude<PriceInclusion, ''>>[] = [
  { id: 'tax_included', label: 'Taxes incluses' },
  { id: 'tax_excluded', label: 'Taxes excluses' },
];
export const REPARTITION_TYPES: readonly Choice<RepartitionType>[] = [
  { id: 'base', label: 'Base' },
  { id: 'tax', label: 'de la taxe' },
];
/** Odoo's « Code de catégorie fiscale » (UN/CEFACT 5305, e-invoices). */
export const TAX_CATEGORY_CODES: readonly Choice<string>[] = [
  { id: 'AE', label: 'AE - Autoliquidation de la TVA' },
  { id: 'E', label: 'E - Exonéré de taxe' },
  { id: 'G', label: 'G - Article d’exportation, taxe non facturée' },
  { id: 'K', label: 'K - Livraison intracommunautaire exonérée' },
  { id: 'L', label: 'L - Impôt indirect général des îles Canaries' },
  { id: 'M', label: 'M - Taxe de Ceuta et Melilla' },
  { id: 'O', label: 'O - Services hors du champ de la taxe' },
  { id: 'S', label: 'S - Taux standard' },
  { id: 'Z', label: 'Z - Taux zéro' },
];

function labelOf<T extends string>(choices: readonly Choice<T>[], id: string): string {
  return choices.find((choice) => choice.id === id)?.label ?? '';
}

export const taxUseLabel = (use: string) => labelOf(TAX_USES, use);
export const taxScopeLabel = (scope: string) => labelOf(TAX_SCOPES, scope);
export const amountTypeLabel = (type: string) => labelOf(AMOUNT_TYPES, type);
export const repartitionTypeLabel = (type: string) => labelOf(REPARTITION_TYPES, type);
export const taxCategoryCodeLabel = (code: string) => labelOf(TAX_CATEGORY_CODES, code);
/** « Par défaut » when the tax keeps the default (a price without tax). */
export const priceInclusionLabel = (value: string) =>
  labelOf(PRICE_INCLUSIONS, value) || 'Par défaut';

/** A tax named as in a selection list: « 18% G (Achats) ». */
export function taxOptionLabel(tax: {
  readonly name: string;
  readonly type_tax_use: string;
}): string {
  const use = taxUseLabel(tax.type_tax_use);
  return use ? `${tax.name} (${use})` : tax.name;
}

/** « 18,0000 »: Odoo's decimals, French writing, never rounded (exact strings). */
export function percentText(value: string, decimals = 4): string {
  return formatDecimal(trimDecimalZeros(value, decimals), decimals);
}

/** Odoo's lines of a new tax: the base, then 100 % of the tax. */
export function defaultLines(): readonly RepartitionLine[] {
  return [
    { repartition_type: 'base', factor_percent: '100', account_code: '', grids: [] },
    { repartition_type: 'tax', factor_percent: '100', account_code: '', grids: [] },
  ];
}

const SIDES: Readonly<Record<string, string>> = {
  invoice: 'La répartition pour les factures',
  refund: 'La répartition pour les notes de crédit',
};
const REASONS: Readonly<Record<string, string>> = {
  one_base: 'doit avoir exactement une ligne « Base ».',
  tax_line: 'doit avoir au moins une ligne « de la taxe ».',
  total: 'doit avoir des % positifs qui font 100 (et des négatifs qui font -100 s’il y en a).',
  mirror: 'doit reprendre les lignes des factures : mêmes « Basé sur » et mêmes %, dans l’ordre.',
};

/** The precise reason of `tax_repartition_invalid` (the server's `details`), else `null`. */
export function repartitionProblem(failure: unknown): string | null {
  const error = toApiError(failure);
  if (error.code !== 'tax_repartition_invalid' || !error.details) {
    return null;
  }
  const { side, reason } = error.details as { side?: string; reason?: string };
  const where = SIDES[side ?? ''];
  const what = REASONS[reason ?? ''];
  return where && what ? `${where} ${what}` : null;
}

export const TAX_ERRORS: ErrorCatalog = {
  tax_name_exists: {
    title: 'Une taxe de ce type porte déjà ce nom.',
    message: 'Choisissez un autre nom, ou un autre type, portée ou pays.',
  },
  tax_code_exists: {
    title: 'Une taxe porte déjà ce nom.',
    message: 'Choisissez un autre nom.',
  },
  tax_repartition_invalid: {
    title: 'La répartition de la taxe n’est pas valable.',
    message:
      'Chaque répartition a une ligne « Base » et des lignes « de la taxe » qui font 100 % ; ' +
      'les notes de crédit reprennent les lignes des factures.',
  },
  tax_inactive: {
    title: 'Cette taxe est inactive.',
    message: 'Activez-la pour l’utiliser.',
  },
};
