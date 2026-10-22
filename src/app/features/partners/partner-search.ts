import { inject } from '@angular/core';
import { map } from 'rxjs';

import { GlobalSearchSource } from '../../core/search/global-search';
import { PartnersApi } from './data-access/partners-api';

/** The contacts in the global search (Ctrl+K), by the API's own search (code, name, NIF). */
export function partnerSearch(): GlobalSearchSource {
  const api = inject(PartnersApi);
  return {
    group: 'Contacts',
    icon: 'partners',
    permission: 'partners.read',
    search: (term) =>
      api.list({ search: term, pageSize: 5 }).pipe(
        map((page) =>
          page.results.map((partner) => ({
            id: partner.public_id,
            label: partner.name,
            detail: partner.code,
            url: `/app/contacts/liste/${partner.public_id}`,
          })),
        ),
      ),
  };
}
