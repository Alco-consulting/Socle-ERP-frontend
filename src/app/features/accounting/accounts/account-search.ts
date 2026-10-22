import { inject } from '@angular/core';
import { map } from 'rxjs';

import { GlobalSearchSource } from '../../../core/search/global-search';
import { AccountingApi } from '../data-access/accounting-api';

/** The chart of accounts in the global search (Ctrl+K), by the API's search (code, name). */
export function accountSearch(): GlobalSearchSource {
  const api = inject(AccountingApi);
  return {
    group: 'Comptes',
    icon: 'book',
    permission: 'accounting.read',
    search: (term) =>
      api.accounts({ search: term }).pipe(
        map((page) =>
          page.results.map((account) => ({
            id: account.public_id,
            label: `${account.code} ${account.name}`,
            detail: 'Plan comptable',
            url: `/app/comptabilite/plan-comptable/${account.public_id}`,
          })),
        ),
      ),
  };
}
