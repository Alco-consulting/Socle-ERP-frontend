import { ErrorCatalog } from '../../../core/errors/user-error';
import { ReportWarning } from '../data-access/reporting-models';

/** URL of the balance, as Odoo's filters: readable and shareable. */
export const BALANCE_PARAM = {
  period: 'periode',
  /** A day of the period shown, moved by ◀ ▶. */
  day: 'date',
  from: 'du',
  to: 'au',
  comparison: 'comparaison',
  count: 'nombre',
  compareFrom: 'comparer_du',
  compareTo: 'comparer_au',
  journal: 'journal',
  unposted: 'brouillons',
  hierarchy: 'hierarchie',
  search: 'q',
  page: 'page',
} as const;

export type PeriodKind = 'mois' | 'trimestre' | 'annee' | 'perso';
export type ComparisonKind = 'precedente' | 'exercice' | 'perso';

/** Odoo's date filter: a month, a quarter, a year, each moved by ◀ ▶; or dates. */
export const STEPPED: readonly {
  readonly id: Exclude<PeriodKind, 'perso'>;
  readonly title: string;
}[] = [
  { id: 'mois', title: 'Mois' },
  { id: 'trimestre', title: 'Trimestre' },
  { id: 'annee', title: 'Année' },
];
export const COMPARISONS: readonly { readonly id: ComparisonKind; readonly title: string }[] = [
  { id: 'precedente', title: 'Période précédente' },
  { id: 'exercice', title: 'Même période que l’exercice passé' },
  { id: 'perso', title: 'Dates personnalisées' },
];
export const MAX_COMPARED = 12;

export interface Period {
  readonly from: string;
  readonly to: string;
}

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];
const SHORT = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const pad = (value: number) => String(value).padStart(2, '0');
const iso = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;
const lastDay = (year: number, month: number) => new Date(year, month, 0).getDate();
const parts = (value: string) => value.split('-').map(Number) as [number, number, number];

/** « 28/09/2026 » from an ISO date. */
export const day = (value: string) => value.split('-').reverse().join('/');
export const isIsoDate = (value: string | null): value is string => !!value && ISO.test(value);

/** The month, quarter or year that holds `anchor`. */
export function periodOf(kind: Exclude<PeriodKind, 'perso'>, anchor: string): Period {
  const [year, month] = parts(anchor);
  if (kind === 'mois') {
    return { from: iso(year, month, 1), to: iso(year, month, lastDay(year, month)) };
  }
  if (kind === 'trimestre') {
    const first = Math.floor((month - 1) / 3) * 3 + 1;
    return { from: iso(year, first, 1), to: iso(year, first + 2, lastDay(year, first + 2)) };
  }
  return { from: iso(year, 1, 1), to: iso(year, 12, 31) };
}

/** `anchor` moved by `steps` months, quarters or years (◀ ▶), on the first of its month. */
export function shifted(kind: Exclude<PeriodKind, 'perso'>, anchor: string, steps: number): string {
  const [year, month] = parts(anchor);
  const months = steps * (kind === 'mois' ? 1 : kind === 'trimestre' ? 3 : 12);
  const index = year * 12 + (month - 1) + months;
  return iso(Math.floor(index / 12), (index % 12) + 1, 1);
}

/** As Odoo writes a period: « oct. 2026 », « oct. - déc. 2026 », « 2026 », else its dates. */
export function periodLabel(period: Period, long = false): string {
  const [year, month, first] = parts(period.from);
  const [endYear, endMonth, end] = parts(period.to);
  if (first === 1 && endYear === year && end === lastDay(endYear, endMonth)) {
    if (endMonth === month) {
      return `${(long ? MONTHS : SHORT)[month - 1]} ${year}`;
    }
    if (month === 1 && endMonth === 12) {
      return String(year);
    }
    if ((month - 1) % 3 === 0 && endMonth === month + 2) {
      return `${SHORT[month - 1]} - ${SHORT[endMonth - 1]} ${year}`;
    }
  }
  return `Du ${day(period.from)} au ${day(period.to)}`;
}

/** The same dates `years` years before (29 February: the 28th). */
function yearsBefore(value: string, years: number): string {
  const [year, month, date] = parts(value);
  return iso(year - years, month, Math.min(date, lastDay(year - years, month)));
}

const DAY = 24 * 60 * 60 * 1000;
const time = (value: string) => {
  const [year, month, date] = parts(value);
  return Date.UTC(year, month - 1, date);
};
const fromTime = (value: number) => new Date(value).toISOString().slice(0, 10);

/**
 * Odoo's comparison: the periods before `period`, oldest first. « Période précédente »: the
 * `count` months, quarters or years before (dates: as many days before); « Même période que
 * l'exercice passé »: the same dates, `count` years before; « Dates personnalisées »: those.
 */
export function earlierPeriods(
  comparison: ComparisonKind | null,
  count: number,
  kind: PeriodKind,
  period: Period,
  custom: Period | null,
): readonly Period[] {
  if (comparison === null) {
    return [];
  }
  if (comparison === 'perso') {
    return custom ? [custom] : [];
  }
  const steps = Array.from({ length: count }, (_, index) => count - index);
  if (comparison === 'exercice') {
    return steps.map((years) => ({
      from: yearsBefore(period.from, years),
      to: yearsBefore(period.to, years),
    }));
  }
  if (kind === 'perso') {
    const length = (time(period.to) - time(period.from)) / DAY + 1;
    return steps.map((back) => ({
      from: fromTime(time(period.from) - back * length * DAY),
      to: fromTime(time(period.to) - back * length * DAY),
    }));
  }
  return steps.map((back) => periodOf(kind, shifted(kind, period.from, -back)));
}

/** The server's warnings of a balance, in words; an unknown code is not shown. */
export function warningText(warning: ReportWarning): string | null {
  return warning.code === 'opening_entry_missing'
    ? 'Les soldes de l’exercice précédent ne sont pas reportés : son écriture d’à-nouveaux n’est pas encore passée (Clôture).'
    : null;
}

/** Reporting's errors of the balance, by code. */
export const BALANCE_ERRORS: ErrorCatalog = {
  reporting_scope_required: {
    title: 'Choisissez une période.',
    message: 'La balance se lit sur une période d’un exercice.',
  },
  reporting_scope_invalid: {
    title: 'Ces dates ne conviennent pas à la balance.',
    message:
      'La période doit tenir dans un exercice, et chaque période comparée doit la précéder. Un exercice s’ouvre à la première écriture de son année.',
  },
};
