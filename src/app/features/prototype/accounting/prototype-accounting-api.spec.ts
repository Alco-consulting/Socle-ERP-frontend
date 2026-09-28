import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { toUserError } from '../../../core/errors/user-error';
import { ACCOUNTING_ERRORS } from './entry-presentation';
import { PrototypeAccountingApi } from './prototype-accounting-api';
import { EntryQuery } from './prototype-models';

const QUERY: EntryQuery = {
  search: '',
  status: null,
  journal: null,
  partnerId: null,
  dateFrom: null,
  dateTo: null,
  sort: { key: 'date', direction: 'desc' },
  page: 1,
  pageSize: 20,
};

describe('PrototypeAccountingApi (simulated server)', () => {
  let api: PrototypeAccountingApi;

  beforeEach(() => {
    api = TestBed.inject(PrototypeAccountingApi);
  });

  it('pages and filters on the server side', async () => {
    const page = await firstValueFrom(api.list(QUERY));
    expect(page.count).toBe(50);
    expect(page.results.length).toBe(20);
    const drafts = await firstValueFrom(api.list({ ...QUERY, status: 'draft' }));
    expect(drafts.results.every((entry) => entry.status === 'draft')).toBe(true);
  });

  it('only marks its data as fictitious (« démo »)', async () => {
    const page = await firstValueFrom(api.list({ ...QUERY, pageSize: 50 }));
    const partners = page.results
      .map((entry) => entry.label)
      .filter((label) => label.includes('—'));
    expect(partners.every((label) => label.includes('(démo)'))).toBe(true);
  });

  it('refuses to validate an unbalanced entry with the API code, shown as a human message', async () => {
    const failure = await firstValueFrom(api.validate('proto-050')).catch(
      (error: unknown) => error,
    );
    const message = toUserError(failure, ACCOUNTING_ERRORS);
    expect(message.code).toBe('accounting_entry_unbalanced');
    expect(message.message).toBe('Le total Débit ne correspond pas au total Crédit.');
  });

  it('decides the allowed actions: a validated entry can only be reversed', async () => {
    const validated = await firstValueFrom(api.validate('proto-049'));
    expect(validated.status).toBe('validated');
    expect(validated.actions).toEqual(['reverse', 'duplicate']);
    const refused = await firstValueFrom(
      api.update('proto-049', { ...validated, partnerId: null }),
    ).catch((error: unknown) => toUserError(error, ACCOUNTING_ERRORS).code);
    expect(refused).toBe('accounting_entry_not_editable');
  });
});
