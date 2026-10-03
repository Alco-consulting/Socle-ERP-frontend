/**
 * PROTOTYPE — shapes of the fictitious accounting data. They imitate the API's style
 * (public ids, decimal strings, stable status codes) but are NOT the API contract:
 * Module F5/F6 will type the real one from the OpenAPI schema.
 */

export type EntryStatus = 'draft' | 'submitted' | 'validated' | 'locked';

/** Commands the (simulated) server allows on an entry; the screen never decides. */
export type EntryAction = 'save' | 'validate' | 'delete' | 'reverse' | 'duplicate';

export interface Journal {
  readonly code: string;
  readonly name: string;
}

export interface Account {
  readonly code: string;
  readonly name: string;
}

export interface Partner {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly customer: boolean;
  readonly supplier: boolean;
  readonly country: string;
  readonly city: string;
}

export interface EntryLine {
  readonly account: string;
  readonly label: string;
  /** Decimal strings; an empty string means « no amount on this side ». */
  readonly debit: string;
  readonly credit: string;
}

export interface Entry {
  readonly id: string;
  readonly number: string;
  readonly date: string;
  readonly journal: string;
  readonly reference: string;
  readonly label: string;
  readonly partnerId: string | null;
  readonly currency: string;
  readonly status: EntryStatus;
  readonly total: string;
  readonly lines: readonly EntryLine[];
  readonly note: string;
  readonly actions: readonly EntryAction[];
  readonly reversedBy?: string;
}

export type EntrySummary = Omit<Entry, 'lines' | 'note' | 'actions'>;

export interface EntryQuery {
  readonly search: string;
  readonly status: EntryStatus | null;
  readonly journal: string | null;
  readonly partnerId: string | null;
  readonly dateFrom: string | null;
  readonly dateTo: string | null;
  readonly sort: { readonly key: string; readonly direction: 'asc' | 'desc' };
  readonly page: number;
  readonly pageSize: number;
}

export interface Page<T> {
  readonly count: number;
  readonly results: readonly T[];
}

export interface EntryDraft {
  readonly date: string;
  readonly journal: string;
  readonly reference: string;
  readonly label: string;
  readonly partnerId: string | null;
  readonly note: string;
  readonly lines: readonly EntryLine[];
}
