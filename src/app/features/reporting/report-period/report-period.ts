import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  untracked,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ParamMap } from '@angular/router';

import { AlcoInput } from '../../../shared/forms/input';
import { AlcoIcon } from '../../../shared/ui/icon/icon';
import { AlcoPopover } from '../../../shared/ui/popover/popover';

/** The URL of a report's period, as Odoo's date filter. */
export const PERIOD_PARAM = {
  period: 'periode',
  /** A day of the period shown, moved by ◀ ▶. */
  day: 'date',
  from: 'du',
  to: 'au',
} as const;

export type PeriodKind = 'mois' | 'trimestre' | 'annee' | 'perso';
export type SteppedKind = Exclude<PeriodKind, 'perso'>;

export interface Period {
  readonly from: string;
  readonly to: string;
}

/** A choice of the date menu: a month, a quarter, a year (moved by `steps`), or dates. */
export type PeriodChoice =
  | { readonly kind: SteppedKind; readonly steps: number }
  | { readonly kind: 'perso'; readonly dates: Period | null };

/** Odoo's date filter: a month, a quarter, a year, each moved by ◀ ▶; or dates. */
export const STEPPED: readonly { readonly id: SteppedKind; readonly title: string }[] = [
  { id: 'mois', title: 'Mois' },
  { id: 'trimestre', title: 'Trimestre' },
  { id: 'annee', title: 'Année' },
];

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
export const iso = (year: number, month: number, date: number) =>
  `${year}-${pad(month)}-${pad(date)}`;
export const lastDay = (year: number, month: number) => new Date(year, month, 0).getDate();
export const parts = (value: string) => value.split('-').map(Number) as [number, number, number];

/** « 28/09/2026 » from an ISO date. */
export const day = (value: string) => value.split('-').reverse().join('/');
export const isIsoDate = (value: string | null): value is string => !!value && ISO.test(value);

/** The month, quarter or year that holds `anchor`. */
export function periodOf(kind: SteppedKind, anchor: string): Period {
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
export function shifted(kind: SteppedKind, anchor: string, steps: number): string {
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

/** The period of a report's URL: this month by default, as Odoo opens a report. */
export function periodFromUrl(
  params: ParamMap,
  today: string,
): { readonly kind: PeriodKind; readonly anchor: string; readonly period: Period } {
  const wanted = params.get(PERIOD_PARAM.period);
  const kind: PeriodKind =
    wanted === 'trimestre' || wanted === 'annee' || wanted === 'perso' ? wanted : 'mois';
  const given = params.get(PERIOD_PARAM.day);
  const anchor = isIsoDate(given) ? given : today;
  if (kind !== 'perso') {
    return { kind, anchor, period: periodOf(kind, anchor) };
  }
  const year = periodOf('annee', anchor);
  const from = params.get(PERIOD_PARAM.from);
  const to = params.get(PERIOD_PARAM.to);
  return {
    kind,
    anchor,
    period: { from: isIsoDate(from) ? from : year.from, to: isIsoDate(to) ? to : year.to },
  };
}

/** The URL of a choice of the date menu, from the period on screen. */
export function periodParams(
  choice: PeriodChoice,
  anchor: string,
  period: Period,
): Record<string, string | null> {
  if (choice.kind === 'perso') {
    // Personal dates start from the period on screen.
    const dates = choice.dates ?? period;
    return {
      [PERIOD_PARAM.period]: 'perso',
      [PERIOD_PARAM.day]: null,
      [PERIOD_PARAM.from]: dates.from,
      [PERIOD_PARAM.to]: dates.to,
    };
  }
  return {
    [PERIOD_PARAM.period]: choice.kind === 'mois' ? null : choice.kind,
    [PERIOD_PARAM.day]: shifted(choice.kind, anchor, choice.steps),
    [PERIOD_PARAM.from]: null,
    [PERIOD_PARAM.to]: null,
  };
}

/**
 * Odoo's date filter of a report: Mois, Trimestre, Année, each with ◀ ▶ around the day
 * shown, then « Dates personnalisées »; the page turns each choice into its URL.
 */
@Component({
  selector: 'alco-report-period',
  imports: [ReactiveFormsModule, AlcoIcon, AlcoInput, AlcoPopover],
  templateUrl: './report-period.html',
  styleUrl: './report-period.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoReportPeriod {
  readonly kind = input.required<PeriodKind>();
  readonly anchor = input.required<string>();
  readonly period = input.required<Period>();

  readonly chosen = output<PeriodChoice>();

  protected readonly stepped = computed(() =>
    STEPPED.map((item) => ({
      ...item,
      value: periodLabel(periodOf(item.id, this.anchor()), true),
    })),
  );
  protected readonly label = computed(() => periodLabel(this.period()));
  protected readonly fromControl = new FormControl('', { nonNullable: true });
  protected readonly toControl = new FormControl('', { nonNullable: true });

  constructor() {
    effect(() => {
      const period = this.period();
      untracked(() => {
        this.fromControl.setValue(period.from, { emitEvent: false });
        this.toControl.setValue(period.to, { emitEvent: false });
      });
    });
  }

  protected step(kind: SteppedKind, steps: number): void {
    this.chosen.emit({ kind, steps });
  }

  protected custom(): void {
    this.chosen.emit({ kind: 'perso', dates: null });
  }

  protected setDates(): void {
    const from = this.fromControl.value;
    const to = this.toControl.value;
    if (from && to) {
      this.chosen.emit({ kind: 'perso', dates: { from, to } });
    }
  }
}
