import { DueItemStatus, DueRole } from '../data-access/due-models';

/**
 * What a panel of the due dates screen lists, from the URL: the partner and the account
 * already found by the server (public ids), the role, the state, the dates and the page.
 */
export interface DueScope {
  readonly partner: string | null;
  readonly account: string | null;
  readonly role: DueRole | null;
  readonly status: DueItemStatus | null;
  /** Installments: due dates; pending lines: entry dates. */
  readonly dateFrom: string | null;
  readonly dateTo: string | null;
  readonly page: number;
}

/** The scope without its page: a change of it drops the selection (another list). */
export function dueScopeKey(scope: DueScope): string {
  return JSON.stringify({ ...scope, page: 0 });
}
