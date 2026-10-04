import {
  formatDecimal,
  isZeroDecimal,
  normalizeDecimalInput,
  subtractDecimals,
  sumDecimals,
  trimDecimalZeros,
} from './decimal';

const NNBSP = ' ';

describe('decimal helpers', () => {
  describe('formatDecimal', () => {
    it('groups thousands and uses a comma, padded to the currency precision', () => {
      expect(formatDecimal('1250000.5', 2)).toBe(`1${NNBSP}250${NNBSP}000,50`);
      expect(formatDecimal('1250000', 0)).toBe(`1${NNBSP}250${NNBSP}000`);
    });

    it('never rounds: a longer fraction is shown in full', () => {
      expect(formatDecimal('10.125', 2)).toBe('10,125');
    });

    it('keeps the sign and avoids « -0 »', () => {
      expect(formatDecimal('-1500', 0)).toBe(`-1${NNBSP}500`);
      expect(formatDecimal('-0.00', 2)).toBe('0,00');
    });

    it('returns anything that is not a decimal string unchanged', () => {
      expect(formatDecimal('abc', 2)).toBe('abc');
    });
  });

  describe('normalizeDecimalInput', () => {
    it('accepts what users type', () => {
      expect(normalizeDecimalInput('1 250 000,5')).toBe('1250000.5');
      expect(normalizeDecimalInput(`1${NNBSP}250`)).toBe('1250');
      expect(normalizeDecimalInput('1250.75')).toBe('1250.75');
    });

    it('rejects text and malformed numbers', () => {
      expect(normalizeDecimalInput('12a')).toBeNull();
      expect(normalizeDecimalInput('1,2,3')).toBeNull();
      expect(normalizeDecimalInput('')).toBeNull();
    });
  });

  describe('sumDecimals / subtractDecimals', () => {
    it('adds exactly where floating point would not', () => {
      expect(sumDecimals(['0.1', '0.2'])).toBe('0.3');
      expect(0.1 + 0.2).not.toBe(0.3);
    });

    it('aligns scales and ignores empty cells', () => {
      expect(sumDecimals(['1250000', '0.5', ''])).toBe('1250000.5');
      expect(sumDecimals([])).toBe('0');
    });

    it('handles very large amounts without precision loss', () => {
      expect(sumDecimals(['9007199254740993', '1'])).toBe('9007199254740994');
    });

    it('subtracts, including negative results', () => {
      expect(subtractDecimals('1150000', '1180000')).toBe('-30000');
      expect(isZeroDecimal(subtractDecimals('10.50', '10.5'))).toBe(true);
    });
  });
});

describe('trimDecimalZeros (display of the API’s 6 decimals)', () => {
  it('drops trailing zeros beyond the precision kept, never a significant digit', () => {
    expect(trimDecimalZeros('1250000.500000', 2)).toBe('1250000.50');
    expect(trimDecimalZeros('1250000.000000', 0)).toBe('1250000');
    expect(trimDecimalZeros('0.000100', 2)).toBe('0.0001');
    expect(trimDecimalZeros('15', 2)).toBe('15');
  });
});
