import { Entry, EntryLine } from '../data-access/entry-models';

/** Test fixtures of the entries (the shapes of `AccountingEntry` and `AccountingLine`). */

export const page = <T>(results: readonly T[] = [], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});

export function testLine(
  sequence: number,
  account: string,
  debit: string,
  credit: string,
  extra: Partial<EntryLine> = {},
): EntryLine {
  return {
    public_id: `l-${sequence}`,
    sequence,
    account: { public_id: `a-${account}`, code: account },
    label: '',
    debit,
    credit,
    reference_debit: debit,
    reference_credit: credit,
    partner: null,
    tax: null,
    tax_rule: null,
    tax_base_amount: null,
    analytic_allocation: null,
    ...extra,
  };
}

export function testEntry(id: string, extra: Partial<Entry> = {}): Entry {
  return {
    public_id: id,
    entry_number: '',
    status: 'draft',
    kind: 'standard',
    journal: { public_id: 'j-ach', code: 'ACH' },
    fiscal_year: { public_id: 'fy-2026', code: '2026' },
    period: { public_id: 'p-2026-09', code: '2026-09' },
    entry_date: '2026-09-28',
    document_date: null,
    document_reference: 'FAF-0123',
    description: 'Achat de fournitures',
    currency: 'GNF',
    reference_currency: 'GNF',
    exchange_rate: '1.000000000000',
    rate_details: null,
    rounding: '',
    origin: 'manual',
    source_type: '',
    source_id: '',
    related_entry: null,
    reason: '',
    created_by: 'u-1',
    created_at: '2026-09-28T09:00:00Z',
    submitted_by: null,
    submitted_at: null,
    validated_by: null,
    validated_at: null,
    locked_by: null,
    locked_at: null,
    updated_at: '2026-09-28T09:00:00Z',
    lines: [
      testLine(1, '601100', '1150000.000000', '0.000000', { label: 'Fournitures' }),
      testLine(2, '401100', '0.000000', '1150000.000000', {
        partner: { public_id: 'pt-1', code: 'FRN-001' },
      }),
    ],
    ...extra,
  };
}
