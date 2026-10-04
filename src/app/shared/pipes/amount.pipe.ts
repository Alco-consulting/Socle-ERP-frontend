import { Pipe, PipeTransform } from '@angular/core';

import { formatDecimal, trimDecimalZeros } from '../utils/decimal';

/**
 * `{{ line.debit | alcoAmount: 2 }}` → « 1 250 000,50 ». Input is the API's decimal string;
 * `decimals` is the currency precision given by the API. Empty values render as an empty
 * string so that a blank debit/credit cell stays blank. The API's trailing zeros beyond
 * `decimals` (« 1250000.500000 ») are dropped; a significant digit is never rounded away.
 */
@Pipe({ name: 'alcoAmount' })
export class AlcoAmountPipe implements PipeTransform {
  transform(value: string | null | undefined, decimals = 2): string {
    return value ? formatDecimal(trimDecimalZeros(value, decimals), decimals) : '';
  }
}
