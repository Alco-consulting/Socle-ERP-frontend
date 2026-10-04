import { LetteringStatus } from '../data-access/lettering-models';
import { LineView } from './lettering-presentation';

/**
 * What a panel of the lettering screen lists, from the URL: the account and the partner
 * already found by the server (public ids, from the codes of the URL), the dates, the state
 * and the page. A new scope is a new query of the server; nothing is filtered here.
 */
export interface LetteringScope {
  readonly account: string | null;
  readonly partner: string | null;
  readonly dateFrom: string | null;
  readonly dateTo: string | null;
  /** Lines: open (default), lettered or all. */
  readonly lineView: LineView;
  /** Letterings: active, cancelled, or all (`null`). */
  readonly letteringStatus: LetteringStatus | null;
  readonly reference: string | null;
  readonly page: number;
}

/** The scope without its page: a change of it drops the selection (another list). */
export function scopeKey(scope: LetteringScope): string {
  return JSON.stringify({ ...scope, page: 0 });
}
