import { InjectionToken, Provider } from '@angular/core';
import { Observable } from 'rxjs';

import { IconName } from '../../shared/ui/icon/icons';

/** A record found by the global search (Ctrl+K): where it opens. */
export interface SearchHit {
  readonly id: string;
  /** « CLI-001 », « 401 » */
  readonly label: string;
  /** « Dupont SARL », « Fournisseurs » */
  readonly detail?: string;
  readonly url: string;
}

/**
 * Records a domain lets the global search find, on its own API. Declared by the features
 * (`provideGlobalSearch`), never known by the core.
 */
export interface GlobalSearchSource {
  /** Title of its results (« Contacts »). */
  readonly group: string;
  readonly icon: IconName;
  /** The permission without which it is not asked. */
  readonly permission: string;
  search(term: string): Observable<readonly SearchHit[]>;
}

export const GLOBAL_SEARCH_SOURCES = new InjectionToken<readonly GlobalSearchSource[]>(
  'GLOBAL_SEARCH_SOURCES',
);

/** One more source for the global search (`app.config.ts`); built in an injection context. */
export function provideGlobalSearch(source: () => GlobalSearchSource): Provider {
  return { provide: GLOBAL_SEARCH_SOURCES, multi: true, useFactory: source };
}

/** « Écriture », « ecriture » and « ÉCRITURE » are the same word to the search. */
export function searchKey(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Every typed word is in the text (in any order). */
export function matchesAll(text: string, term: string): boolean {
  const haystack = searchKey(text);
  return searchKey(term)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}
