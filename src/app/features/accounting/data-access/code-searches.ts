import { map } from 'rxjs';

import { AutocompleteOption, AutocompleteSearch } from '../../../shared/forms/autocomplete';
import { AccountingApi } from './accounting-api';
import { EntriesApi } from './entries-api';

/** The accounts of a list filter's selection field: its value is the code, as in the URL. */
export function accountCodeSearch(api: AccountingApi): AutocompleteSearch {
  return (term) =>
    api.accounts({ search: term, status: 'active' }).pipe(
      map((page) =>
        page.results.map((account) => ({
          id: account.code,
          label: account.code,
          detail: account.name,
        })),
      ),
    );
}

/** The partners of a list filter's selection field: its value is the code, as in the URL. */
export function partnerCodeSearch(api: EntriesApi): AutocompleteSearch {
  return (term) =>
    api.partners(term).pipe(
      map((partners) =>
        partners.map((partner) => ({
          id: partner.code,
          label: partner.code,
          detail: partner.name,
        })),
      ),
    );
}

/** The choice of a code read from the URL. */
export function codeOption(code: string | null): AutocompleteOption | null {
  return code ? { id: code, label: code } : null;
}
