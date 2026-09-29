import { Injectable, inject } from '@angular/core';
import { Observable, delay, of, throwError } from 'rxjs';

import { ApiErrorBody } from '../../../core/errors/user-error';
import { SessionStore } from '../../../core/session/session.store';
import { subtractDecimals, isZeroDecimal } from '../../../shared/utils/decimal';
import {
  CURRENCY,
  JOURNALS,
  actionsFor,
  buildEntries,
  journalName,
  partnerName,
  totalDebit,
} from './prototype-data';
import {
  AccountingDashboard,
  Entry,
  EntryDraft,
  EntryQuery,
  EntryStatus,
  EntrySummary,
  Page,
} from './prototype-models';

/** Simulated network latency, so that loading states are visible. */
const LATENCY_MS = 350;

function apiError(code: string, message: string): ApiErrorBody {
  return {
    error: { code, message, details: null, correlation_id: `proto-${Date.now().toString(36)}` },
  };
}

/** The fictitious books of one company. */
interface Books {
  entries: Entry[];
  nextNumber: number;
}

/**
 * PROTOTYPE — in-memory stand-in for the accounting API. It plays the SERVER's role:
 * it owns the data, computes the dashboard, decides the allowed actions and refuses
 * invalid transitions with the real API error codes. No HTTP call is made. Like the server
 * with `X-Company-ID`, every call works on the books of the active company only.
 * Replaced by a typed HTTP service in Module F5/F6.
 */
@Injectable({ providedIn: 'root' })
export class PrototypeAccountingApi {
  private readonly session = inject(SessionStore);
  private readonly books = new Map<string, Books>();

  /** Books of the active company (the same fictitious start for each company). */
  private get current(): Books {
    const company = this.session.activeCompany()?.id ?? '';
    let books = this.books.get(company);
    if (!books) {
      books = { entries: buildEntries(), nextNumber: 146 };
      this.books.set(company, books);
    }
    return books;
  }

  private get entries(): Entry[] {
    return this.current.entries;
  }

  private set entries(entries: Entry[]) {
    this.current.entries = entries;
  }

  list(query: EntryQuery): Observable<Page<EntrySummary>> {
    const search = query.search.trim().toLowerCase();
    const matches = this.entries.filter(
      (entry) =>
        (!search ||
          [entry.number, entry.reference, entry.label, partnerName(entry.partnerId)].some((text) =>
            text.toLowerCase().includes(search),
          )) &&
        (!query.status || entry.status === query.status) &&
        (!query.journal || entry.journal === query.journal) &&
        (!query.partnerId || entry.partnerId === query.partnerId) &&
        (!query.dateFrom || entry.date >= query.dateFrom) &&
        (!query.dateTo || entry.date <= query.dateTo),
    );
    const { key, direction } = query.sort;
    const factor = direction === 'asc' ? 1 : -1;
    const sorted = [...matches].sort((a, b) => {
      const left = key === 'total' ? Number(a.total) : String(a[key as keyof Entry] ?? '');
      const right = key === 'total' ? Number(b.total) : String(b[key as keyof Entry] ?? '');
      return (
        (left < right ? -1 : left > right ? 1 : 0) * factor ||
        a.number.localeCompare(b.number) * factor
      );
    });
    const start = (query.page - 1) * query.pageSize;
    const results = sorted.slice(start, start + query.pageSize).map((entry) => this.summary(entry));
    return of({ count: matches.length, results }).pipe(delay(LATENCY_MS));
  }

  get(id: string): Observable<Entry> {
    const entry = this.entries.find((item) => item.id === id);
    return entry
      ? of(entry).pipe(delay(LATENCY_MS))
      : throwError(() => apiError('not_found', 'Not found.'));
  }

  /** Synchronous lookup for the breadcrumb resolver. */
  numberOf(id: string): string | null {
    return this.entries.find((item) => item.id === id)?.number ?? null;
  }

  create(draft: EntryDraft): Observable<Entry> {
    const entry: Entry = {
      ...draft,
      id: `proto-new-${this.current.nextNumber}`,
      number: `EC-2026-${String(this.current.nextNumber++).padStart(6, '0')}`,
      currency: CURRENCY,
      status: 'draft',
      total: totalDebit(draft.lines),
      actions: actionsFor('draft'),
    };
    this.entries = [...this.entries, entry];
    return of(entry).pipe(delay(LATENCY_MS));
  }

  update(id: string, draft: EntryDraft): Observable<Entry> {
    const current = this.entries.find((item) => item.id === id);
    if (!current || current.status !== 'draft') {
      return throwError(() =>
        apiError('accounting_entry_not_editable', 'Only a draft entry can be modified.'),
      );
    }
    return this.replace({ ...current, ...draft, total: totalDebit(draft.lines) });
  }

  remove(id: string): Observable<true> {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry?.actions.includes('delete')) {
      return throwError(() =>
        apiError('accounting_entry_not_editable', 'Only a draft entry can be deleted.'),
      );
    }
    this.entries = this.entries.filter((item) => item.id !== id);
    return of(true as const).pipe(delay(LATENCY_MS));
  }

  /** Server-side rules: a balanced entry with lines, in an open period. */
  validate(id: string): Observable<Entry> {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry || !entry.actions.includes('validate')) {
      return throwError(() => apiError('accounting_invalid_transition', 'Invalid transition.'));
    }
    if (entry.lines.length === 0) {
      return throwError(() => apiError('accounting_entry_lines_required', 'Lines are required.'));
    }
    const gap = subtractDecimals(totalDebit(entry.lines), totalCredit(entry));
    if (!isZeroDecimal(gap)) {
      return throwError(() => apiError('accounting_entry_unbalanced', 'Entry is not balanced.'));
    }
    return this.replace(this.withStatus(entry, 'validated'));
  }

  reverse(id: string): Observable<Entry> {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry || !entry.actions.includes('reverse')) {
      return throwError(() =>
        apiError('accounting_entry_not_reversible', 'This entry cannot be reversed.'),
      );
    }
    const reversal: Entry = {
      ...entry,
      id: `proto-new-${this.current.nextNumber}`,
      number: `EC-2026-${String(this.current.nextNumber++).padStart(6, '0')}`,
      date: '2026-09-28',
      reference: `EXT-${entry.number}`,
      label: `Contrepassation de ${entry.number}`,
      lines: entry.lines.map((item) => ({ ...item, debit: item.credit, credit: item.debit })),
      status: 'validated',
      actions: ['duplicate'],
    };
    this.entries = [
      ...this.entries.map((item) =>
        item.id === id
          ? { ...item, reversedBy: reversal.number, actions: ['duplicate' as const] }
          : item,
      ),
      reversal,
    ];
    return of(reversal).pipe(delay(LATENCY_MS));
  }

  dashboard(): Observable<AccountingDashboard> {
    const count = (status: EntryStatus) => this.entries.filter((e) => e.status === status).length;
    const september = this.entries.filter((entry) => entry.date.startsWith('2026-09'));
    return of({
      fiscalYear: 'Exercice 2026',
      period: 'Septembre 2026',
      periodOpen: true,
      closingChecksPending: 3,
      entries: {
        draft: count('draft'),
        submitted: count('submitted'),
        validatedThisMonth: september.filter((entry) => entry.status === 'validated').length,
      },
      journals: JOURNALS.map((journal) => {
        const own = this.entries.filter((entry) => entry.journal === journal.code);
        return {
          journal,
          toValidate: own.filter(
            (entry) => entry.status === 'draft' || entry.status === 'submitted',
          ).length,
          lastEntryDate:
            own
              .map((entry) => entry.date)
              .sort()
              .at(-1) ?? null,
        };
      }),
      treasury: { bank: '184250000', cash: '3420000', inflows: '46800000', outflows: '31275000' },
      vat: { collected: '8964000', deductible: '5238000', due: '3726000' },
      currency: CURRENCY,
    }).pipe(delay(LATENCY_MS));
  }

  journalLabel(code: string): string {
    return journalName(code);
  }

  private summary(entry: Entry): EntrySummary {
    return {
      id: entry.id,
      number: entry.number,
      date: entry.date,
      journal: entry.journal,
      reference: entry.reference,
      label: entry.label,
      partnerId: entry.partnerId,
      currency: entry.currency,
      status: entry.status,
      total: entry.total,
      reversedBy: entry.reversedBy,
    };
  }

  private withStatus(entry: Entry, status: EntryStatus): Entry {
    return { ...entry, status, actions: actionsFor(status) };
  }

  private replace(entry: Entry): Observable<Entry> {
    this.entries = this.entries.map((item) => (item.id === entry.id ? entry : item));
    return of(entry).pipe(delay(LATENCY_MS));
  }
}

function totalCredit(entry: Entry): string {
  return totalDebit(entry.lines.map((item) => ({ ...item, debit: item.credit })));
}
