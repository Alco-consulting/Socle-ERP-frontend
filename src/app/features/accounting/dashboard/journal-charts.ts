import { formatDate } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  inject,
  input,
} from '@angular/core';

import { formatDecimal, trimDecimalZeros } from '../../../shared/utils/decimal';
import { BalancePoint, DueWeek } from '../../dashboards/data-access/dashboard-models';

const DAY = 86_400_000;

function amountText(value: string, decimals: number, currency: string): string {
  return `${formatDecimal(trimDecimalZeros(value, decimals), decimals)} ${currency}`;
}

/** Odoo's balance curve of a bank or cash card: the server's points, over 30 days. */
@Component({
  selector: 'alco-balance-curve',
  template: `
    <div class="curve" role="img" [attr.aria-label]="label()" [style.height.px]="height()">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path class="area" [attr.d]="area()" />
        <path class="line" [attr.d]="line()" vector-effect="non-scaling-stroke" />
      </svg>
      @for (point of dots(); track point.key) {
        <span
          class="dot"
          aria-hidden="true"
          [style.left.%]="point.x"
          [style.top.%]="point.y"
          [attr.title]="point.title"
        ></span>
      }
    </div>
    @if (ends(); as days) {
      <div class="axis" aria-hidden="true">
        <span>{{ days.first }}</span>
        <span>{{ days.last }}</span>
      </div>
    }
  `,
  styles: `
    .curve {
      position: relative;
      height: 120px;
      margin-top: var(--space-2);
    }
    .axis {
      display: flex;
      justify-content: space-between;
      margin-top: var(--space-1);
      color: var(--color-text-muted);
      font-size: var(--font-size-caption);
    }
    svg {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .area {
      fill: var(--chart-area);
    }
    .line {
      fill: none;
      stroke: var(--chart-1);
      stroke-width: 2;
    }
    .dot {
      position: absolute;
      width: 8px;
      height: 8px;
      margin: -4px 0 0 -4px;
      border: 2px solid var(--chart-1);
      border-radius: 50%;
      background: var(--color-surface);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoBalanceCurve {
  private readonly locale = inject(LOCALE_ID);

  readonly points = input.required<readonly BalancePoint[]>();
  readonly decimals = input(0);
  readonly currency = input('');
  /** Its height in pixels: a full card, or a line of the treasury. */
  readonly height = input(120);

  private readonly placed = computed(() => {
    const points = this.points();
    if (points.length === 0) {
      return [];
    }
    const first = Date.parse(points[0].date);
    const span = Math.max(Date.parse(points[points.length - 1].date) - first, DAY);
    const values = points.map((point) => Number(point.balance));
    const low = Math.min(0, ...values);
    const high = Math.max(...values, low + 1);
    // A margin above the highest point, as Odoo's.
    const top = high + (high - low) * 0.1;
    return points.map((point, index) => ({
      point,
      x: ((Date.parse(point.date) - first) / span) * 100,
      y: ((top - values[index]) / (top - low)) * 100,
    }));
  });

  protected readonly line = computed(() =>
    this.placed()
      .map((item, index) => `${index === 0 ? 'M' : 'L'}${item.x},${item.y}`)
      .join(' '),
  );

  protected readonly area = computed(() => {
    const placed = this.placed();
    if (placed.length === 0) {
      return '';
    }
    return `${this.line()} L${placed[placed.length - 1].x},100 L${placed[0].x},100 Z`;
  });

  protected readonly dots = computed(() =>
    this.placed().map((item) => ({
      key: item.point.date,
      x: item.x,
      y: item.y,
      title: `${this.day(item.point.date)} : Solde ${amountText(item.point.balance, this.decimals(), this.currency())}`,
    })),
  );

  /** The first and last days of the curve, under it. */
  protected readonly ends = computed(() => {
    const points = this.points();
    return points.length < 2
      ? null
      : { first: this.day(points[0].date), last: this.day(points[points.length - 1].date) };
  });

  protected readonly label = computed(() => {
    const points = this.points();
    if (points.length === 0) {
      return 'Solde sur 30 jours';
    }
    const first = points[0];
    const last = points[points.length - 1];
    return (
      `Solde sur 30 jours : ${amountText(first.balance, this.decimals(), this.currency())} ` +
      `le ${this.day(first.date)}, ${amountText(last.balance, this.decimals(), this.currency())} ` +
      `le ${this.day(last.date)}`
    );
  });

  private day(value: string): string {
    return formatDate(value, 'd MMM', this.locale);
  }
}

/** Odoo's due bars of a sales or purchase card: overdue, four weeks, not due yet. */
@Component({
  selector: 'alco-due-bars',
  template: `
    @if (nothing()) {
      <p class="nothing">Aucun montant dû ces prochaines semaines.</p>
    } @else {
      <ul class="bars" role="list" [attr.aria-label]="label()">
        @for (bar of bars(); track bar.label) {
          <li class="bar" [attr.title]="bar.label + ' : ' + bar.amount">
            <span class="bar-value" aria-hidden="true">{{ bar.short }}</span>
            <span class="track" aria-hidden="true">
              <span class="fill" [class.fill--past]="bar.past" [style.height.%]="bar.height"></span>
            </span>
            <span class="bar-label">{{ bar.label }}</span>
            <span class="alco-sr-only">{{ bar.amount }}</span>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    .bars {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: var(--space-2);
      margin: var(--space-2) 0 0;
      padding: 0;
      list-style: none;
    }
    .bar {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      min-width: 0;
    }
    .track {
      display: flex;
      align-items: flex-end;
      height: 96px;
      border-bottom: var(--border-width) solid var(--chart-grid);
    }
    .fill {
      width: 100%;
      min-height: 0;
      border-radius: var(--radius-sm) var(--radius-sm) 0 0;
      background: var(--chart-1);
    }
    .fill--past {
      background: var(--chart-4);
    }
    .bar-value {
      min-height: 1rem;
      color: var(--color-text);
      font-size: var(--font-size-caption);
      font-weight: var(--font-weight-semibold);
      font-variant-numeric: tabular-nums;
      text-align: center;
      white-space: nowrap;
    }
    /* Straight, on two lines at most: a week's dates stay readable. */
    .bar-label {
      min-height: 2rem;
      color: var(--color-text-muted);
      font-size: var(--font-size-caption);
      line-height: var(--line-height-tight);
      text-align: center;
    }
    .nothing {
      margin: var(--space-2) 0 0;
      padding: var(--space-4);
      border-radius: var(--radius-md);
      background: var(--color-surface-muted);
      color: var(--color-text-muted);
      text-align: center;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoDueBars {
  private readonly locale = inject(LOCALE_ID);

  readonly weeks = input.required<readonly DueWeek[]>();
  /** The day the weeks are counted from: its week is « Cette semaine ». */
  readonly today = input.required<string>();
  readonly decimals = input(0);
  readonly currency = input('');
  readonly label = input('Montants dus par semaine');

  private readonly compact = new Intl.NumberFormat('fr-FR', {
    notation: 'compact',
    maximumFractionDigits: 1,
  });

  /** Nothing due, nothing late: a sentence instead of empty bars. */
  protected readonly nothing = computed(() =>
    this.weeks().every((week) => Number(week.amount) === 0),
  );

  protected readonly bars = computed(() => {
    const weeks = this.weeks();
    const highest = Math.max(0, ...weeks.map((week) => Number(week.amount)));
    return weeks.map((week) => ({
      label: this.labelOf(week),
      amount: amountText(week.amount, this.decimals(), this.currency()),
      short: Number(week.amount) > 0 ? this.compact.format(Number(week.amount)) : '',
      height: highest > 0 ? (Math.max(0, Number(week.amount)) / highest) * 100 : 0,
      past: week.date_to !== null && week.date_to < this.today(),
    }));
  });

  private labelOf(week: DueWeek): string {
    if (week.date_from === null) {
      return 'Dû';
    }
    if (week.date_to === null) {
      return 'Pas dû';
    }
    if (week.date_from <= this.today() && this.today() <= week.date_to) {
      return 'Cette semaine';
    }
    const sameMonth = week.date_from.slice(0, 7) === week.date_to.slice(0, 7);
    const start = formatDate(week.date_from, sameMonth ? 'd' : 'd MMM', this.locale);
    return `${start} - ${formatDate(week.date_to, 'd MMM', this.locale)}`;
  }
}
