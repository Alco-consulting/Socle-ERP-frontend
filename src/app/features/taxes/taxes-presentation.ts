import { ErrorCatalog } from '../../core/errors/user-error';
import { formatDecimal, trimDecimalZeros } from '../../shared/utils/decimal';
import { TaxUse } from './data-access/taxes-models';

export interface Choice<T extends string> {
  readonly id: T;
  readonly label: string;
}

/** « S'applique à », in this order (a VAT is used on both sides, the default). */
export const TAX_USES: readonly Choice<TaxUse>[] = [
  { id: 'both', label: 'Ventes et achats' },
  { id: 'sale', label: 'Ventes' },
  { id: 'purchase', label: 'Achats' },
];

export function taxUseLabel(use: string): string {
  return TAX_USES.find((choice) => choice.id === use)?.label ?? '';
}

export const appliesToSales = (use: TaxUse) => use !== 'purchase';
export const appliesToPurchases = (use: TaxUse) => use !== 'sale';

/** A tax named in a selection list: its name, unique in the company. */
export function taxOptionLabel(tax: { readonly name: string }): string {
  return tax.name;
}

/** « 18 % », « 2,5 % »: the server's exact decimals, trailing zeros dropped (no rounding). */
export function rateText(rate: string): string {
  return `${formatDecimal(trimDecimalZeros(rate, 0), 0)} %`;
}

export const TAX_ERRORS: ErrorCatalog = {
  tax_name_exists: {
    title: 'Une taxe de la société porte déjà ce nom.',
    message: 'Choisissez un autre nom.',
  },
  tax_code_exists: {
    title: 'Une taxe porte déjà ce nom.',
    message: 'Choisissez un autre nom.',
  },
  tax_template_not_found: {
    title: 'Aucune taxe usuelle n’est connue pour le pays de la société.',
    message: 'Créez les taxes une par une avec « Nouvelle taxe ».',
  },
  tax_inactive: {
    title: 'Cette taxe est inactive.',
    message: 'Activez-la pour l’utiliser.',
  },
};
