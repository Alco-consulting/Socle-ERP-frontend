import { ErrorCatalog } from '../../core/errors/user-error';
import { formatDecimal, isDecimalString, trimDecimalZeros } from '../../shared/utils/decimal';
import { SymbolPosition } from './data-access/currencies-models';

export interface Choice<T extends string> {
  readonly id: T;
  readonly label: string;
}

/** « Position du symbole », Odoo's words. */
export const SYMBOL_POSITIONS: readonly Choice<SymbolPosition>[] = [
  { id: 'after', label: 'Après le montant' },
  { id: 'before', label: 'Avant le montant' },
];

/** Significant digits of « Unité par GNF » (1 ÷ the rate): a display aid only. */
const INVERSE_DIGITS = 6;
/** Exact digits computed before rounding: far more than a rate of the API can need. */
const EXTRA_DIGITS = 40;

/** « 02/03/2026 » from an ISO date of the API (no date arithmetic). */
export function dayText(iso: string): string {
  return iso.split('-').reverse().join('/');
}

/** « 8 650,125 »: a rate as the server keeps it, trailing zeros dropped (never rounded). */
export function rateText(rate: string): string {
  return formatDecimal(trimDecimalZeros(rate, 0), 0);
}

/**
 * 1 ÷ `rate` to `significant` significant digits, half up, as a decimal string (« 8650 » →
 * « 0.000115607 »). Exact (integers only, no floating point); '' for a rate that is not a
 * positive decimal. It only shows « Unité par GNF »: the server keeps and uses the rate.
 */
export function inverseRate(rate: string, significant = INVERSE_DIGITS): string {
  if (!isDecimalString(rate) || rate.startsWith('-') || /^0*(\.0*)?$/.test(rate)) {
    return '';
  }
  const [integerPart, fractionPart = ''] = rate.split('.');
  // rate = denominator ÷ 10^fraction, so 1 ÷ rate × 10^extra = 10^(fraction + extra) ÷ denominator.
  const denominator = BigInt(integerPart + fractionPart);
  const digits = (10n ** BigInt(fractionPart.length + EXTRA_DIGITS) / denominator).toString();
  let integerDigits = digits.length - EXTRA_DIGITS;
  let kept = BigInt(digits.slice(0, significant).padEnd(significant, '0'));
  if ((digits[significant] ?? '0') >= '5') {
    kept += 1n;
  }
  let keptText = kept.toString();
  if (keptText.length > significant) {
    // 999999.5 → 1000000: one more integer digit, the last zero goes.
    keptText = keptText.slice(0, significant);
    integerDigits += 1;
  }
  const decimals = significant - integerDigits;
  if (decimals <= 0) {
    return keptText + '0'.repeat(-decimals);
  }
  const padded = keptText.padStart(decimals + 1, '0');
  const value = `${padded.slice(0, padded.length - decimals)}.${padded.slice(-decimals)}`;
  return trimDecimalZeros(value, 0);
}

/** « 0,000115607 »: « Unité par GNF », French display. */
export function inverseRateText(rate: string): string {
  const inverse = inverseRate(rate);
  return inverse ? formatDecimal(inverse, 0) : '';
}

export const CURRENCY_ERRORS: ErrorCatalog = {
  reference_currency_in_use: {
    title: 'Cette devise est la devise d’une société.',
    message: 'Elle reste active : les comptes de la société sont tenus dans cette devise.',
  },
  currency_inactive: {
    title: 'Cette devise est inactive.',
    message: 'Activez-la pour saisir ses taux.',
  },
  exchange_rate_exists: {
    title: 'Un taux existe déjà pour cette devise à cette date.',
    message: 'Retirez-le d’abord s’il est faux, puis saisissez le bon taux.',
  },
  exchange_rate_withdrawn: {
    title: 'Ce taux a déjà été retiré.',
    message: 'Rechargez la page pour voir les taux à jour.',
  },
  reference_currency_unavailable: {
    title: 'La devise de la société n’est pas active.',
    message: 'Activez-la dans la liste des devises, puis réessayez.',
  },
};
