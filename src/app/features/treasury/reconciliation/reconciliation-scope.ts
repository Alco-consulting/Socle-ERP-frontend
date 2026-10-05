import { ReconciliationView } from './reconciliation-presentation';

/**
 * What a panel of the reconciliation screen lists, from the URL: the treasury account found
 * by the server (public id and currency, from the code of the URL), the statement chosen, the
 * view and the page. A new scope is a new query of the server; nothing is filtered here.
 */
export interface ReconciliationScope {
  readonly account: string;
  readonly accountCode: string;
  readonly currency: string;
  readonly statement: string | null;
  readonly view: ReconciliationView;
  readonly page: number;
}
