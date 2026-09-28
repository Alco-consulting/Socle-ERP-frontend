/**
 * Amounts travel as decimal strings ("1250000.50"), exactly as the API sends them.
 * These helpers format and add them WITHOUT floating point (BigInt on scaled integers)
 * and never round: rounding is an accounting rule, decided by the backend.
 */

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;
const NARROW_NO_BREAK_SPACE = ' ';

export function isDecimalString(value: string): boolean {
  return DECIMAL_PATTERN.test(value);
}

/**
 * French display: thousands separated by a narrow no-break space, comma as decimal mark,
 * fraction padded to `decimals` digits. A longer fraction is shown in full, never rounded.
 */
export function formatDecimal(value: string, decimals: number): string {
  if (!isDecimalString(value)) {
    return value;
  }
  const negative = value.startsWith('-');
  const [integerPart, fractionPart = ''] = (negative ? value.slice(1) : value).split('.');
  const grouped = integerPart
    .replace(/^0+(?=\d)/, '')
    .replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_NO_BREAK_SPACE);
  const fraction = fractionPart.padEnd(decimals, '0');
  const isZero = /^0*$/.test(integerPart + fractionPart);
  const sign = negative && !isZero ? '-' : '';
  return fraction ? `${sign}${grouped},${fraction}` : `${sign}${grouped}`;
}

/** Accepts what a user types (« 1 250 000,5 », « 1250000.5 ») and returns "1250000.5", or null. */
export function normalizeDecimalInput(input: string): string | null {
  const compact = input.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  return isDecimalString(compact) ? compact : null;
}

/** Exact sum of decimal strings, for display aids only (the server recomputes). */
export function sumDecimals(values: readonly string[]): string {
  const valid = values.filter(isDecimalString);
  const scale = Math.max(0, ...valid.map((value) => value.split('.')[1]?.length ?? 0));
  const total = valid.reduce((sum, value) => sum + toScaledInteger(value, scale), 0n);
  return fromScaledInteger(total, scale);
}

/** Exact difference a - b of two decimal strings. */
export function subtractDecimals(a: string, b: string): string {
  return sumDecimals([a, negate(b)]);
}

export function isZeroDecimal(value: string): boolean {
  return isDecimalString(value) && /^-?0+(\.0+)?$/.test(value);
}

function negate(value: string): string {
  return value.startsWith('-') ? value.slice(1) : `-${value}`;
}

function toScaledInteger(value: string, scale: number): bigint {
  const negative = value.startsWith('-');
  const [integerPart, fractionPart = ''] = (negative ? value.slice(1) : value).split('.');
  const scaled = BigInt(integerPart + fractionPart.padEnd(scale, '0'));
  return negative ? -scaled : scaled;
}

function fromScaledInteger(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const integerPart = digits.slice(0, digits.length - scale);
  const fractionPart = digits.slice(digits.length - scale);
  const sign = negative ? '-' : '';
  return scale > 0 ? `${sign}${integerPart}.${fractionPart}` : `${sign}${integerPart}`;
}
