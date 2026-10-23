import { ErrorCatalog } from '../../../core/errors/user-error';
import { ReportWarning } from '../data-access/reporting-models';
import {
  PERIOD_PARAM,
  Period,
  PeriodKind,
  iso,
  lastDay,
  parts,
  periodOf,
  shifted,
} from '../report-period/report-period';

/** URL of the balance, as Odoo's filters: readable and shareable. */
export const BALANCE_PARAM = {
  ...PERIOD_PARAM,
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

export type ComparisonKind = 'precedente' | 'exercice' | 'perso';

export const COMPARISONS: readonly { readonly id: ComparisonKind; readonly title: string }[] = [
  { id: 'precedente', title: 'Période précédente' },
  { id: 'exercice', title: 'Même période que l’exercice passé' },
  { id: 'perso', title: 'Dates personnalisées' },
];
export const MAX_COMPARED = 12;

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
