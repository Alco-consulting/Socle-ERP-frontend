import { ErrorCatalog } from '../../../core/errors/user-error';
import { FiscalYear } from '../../accounting/data-access/accounting-models';
import { ReportWarning } from '../data-access/reporting-models';

/** URL of the balance, as Odoo's filters: readable and shareable. */
export const BALANCE_PARAM = {
  period: 'periode',
  from: 'du',
  to: 'au',
  journal: 'journal',
  unposted: 'brouillons',
  hierarchy: 'hierarchie',
  search: 'q',
  page: 'page',
} as const;

export type PeriodKind = 'mois' | 'trimestre' | 'annee' | 'annee-precedente' | 'perso';

/** Odoo's date filter of a report. */
export const PERIODS: readonly { readonly id: PeriodKind; readonly label: string }[] = [
  { id: 'mois', label: 'Ce mois' },
  { id: 'trimestre', label: 'Ce trimestre' },
  { id: 'annee', label: 'Cette année' },
  { id: 'annee-precedente', label: 'L’année dernière' },
  { id: 'perso', label: 'Personnalisée' },
];

export interface Period {
  readonly from: string;
  readonly to: string;
  /** The heading of the period's columns, as Odoo's (« 2026 », « octobre 2026 »). */
  readonly label: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const pad = (value: number) => String(value).padStart(2, '0');
const lastDay = (year: number, month: number) => new Date(year, month, 0).getDate();
/** « 28/09/2026 » from an ISO date. */
export const day = (iso: string) => iso.split('-').reverse().join('/');

/**
 * The dates of a period of the filter, on today's date: a month and a quarter of the calendar;
 * a year is the fiscal year that holds today (or the one before), else the calendar year.
 * « Personnalisée »: the dates of the URL, else this year's.
 */
export function periodOf(
  kind: PeriodKind,
  today: string,
  years: readonly FiscalYear[],
  custom: { readonly from: string | null; readonly to: string | null },
): Period {
  const [year, month] = today.split('-').map(Number);
  const current = years.find((item) => item.start_date <= today && today <= item.end_date);
  const thisYear: Period = current
    ? { from: current.start_date, to: current.end_date, label: current.label || current.code }
    : { from: `${year}-01-01`, to: `${year}-12-31`, label: String(year) };
  switch (kind) {
    case 'mois': {
      const label = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(
        new Date(year, month - 1, 1),
      );
      return {
        from: `${year}-${pad(month)}-01`,
        to: `${year}-${pad(month)}-${pad(lastDay(year, month))}`,
        label,
      };
    }
    case 'trimestre': {
      const first = Math.floor((month - 1) / 3) * 3 + 1;
      const last = first + 2;
      return {
        from: `${year}-${pad(first)}-01`,
        to: `${year}-${pad(last)}-${pad(lastDay(year, last))}`,
        label: `T${(first + 2) / 3} ${year}`,
      };
    }
    case 'annee-precedente': {
      const before = years
        .filter((item) => item.end_date < thisYear.from)
        .sort((a, b) => b.end_date.localeCompare(a.end_date))[0];
      return before
        ? { from: before.start_date, to: before.end_date, label: before.label || before.code }
        : { from: `${year - 1}-01-01`, to: `${year - 1}-12-31`, label: String(year - 1) };
    }
    case 'perso': {
      const from = custom.from && ISO.test(custom.from) ? custom.from : thisYear.from;
      const to = custom.to && ISO.test(custom.to) ? custom.to : thisYear.to;
      return { from, to, label: `Du ${day(from)} au ${day(to)}` };
    }
    default:
      return thisYear;
  }
}

/** The server's warnings of a balance, in words; an unknown code is not shown. */
export function warningText(warning: ReportWarning): string | null {
  switch (warning.code) {
    case 'unposted_entries': {
      const count = Number(warning.details?.['count'] ?? 0);
      return count > 1
        ? `Il y a ${count} écritures non comptabilisées dans cette période.`
        : 'Il y a une écriture non comptabilisée dans cette période.';
    }
    case 'opening_entry_missing':
      return 'Les soldes de l’exercice précédent ne sont pas reportés : son écriture d’à-nouveaux n’est pas encore passée (Clôture).';
    default:
      return null;
  }
}

/** Reporting's errors of the balance, by code. */
export const BALANCE_ERRORS: ErrorCatalog = {
  reporting_scope_required: {
    title: 'Choisissez une période.',
    message: 'La balance se lit sur une période d’un exercice.',
  },
  reporting_scope_invalid: {
    title: 'Aucun exercice ne couvre toute cette période.',
    message:
      'Choisissez des dates d’un même exercice. Un exercice s’ouvre à la première écriture de son année.',
  },
};
