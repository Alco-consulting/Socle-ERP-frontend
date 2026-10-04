import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { isoDay } from '../../accounting/entries/entry-presentation';
import { AgedAmounts, AgingBucket } from '../data-access/aging-models';
import { bucketDescription, bucketLabel } from './aging-presentation';

/**
 * The summary of an aged balance (or of one partner): the reference date, the currency, one
 * figure per bucket the API returned, then the total, the invoices without due dates, the
 * unapplied payments and credit notes, and the balance — every figure the server's.
 */
@Component({
  selector: 'alco-aged-summary',
  imports: [AlcoAmountPipe],
  template: `
    <section class="summary" [attr.aria-labelledby]="titleId">
      <h2 class="alco-section-title" [id]="titleId">
        Situation au {{ day(asOf()) }}
        <span class="currency">Devise : {{ currency() }}</span>
      </h2>
      <dl class="figures">
        @for (bucket of buckets(); track bucket.code) {
          <div class="figure" [class.figure--due]="bucket.first_day !== null">
            <dt [attr.title]="describe(bucket)">{{ label(bucket) }}</dt>
            <dd>{{ amountOf(bucket.code) | alcoAmount: decimals() }}</dd>
          </div>
        }
        <div class="figure figure--key">
          <dt>Total des échéances</dt>
          <dd>{{ amounts().total | alcoAmount: decimals() }}</dd>
        </div>
        <div class="figure">
          <dt>Factures sans échéancier</dt>
          <dd>{{ amounts().unscheduled | alcoAmount: decimals() }}</dd>
        </div>
        <div class="figure">
          <dt>Non affecté (règlements, avoirs)</dt>
          <dd>{{ amounts().unapplied | alcoAmount: decimals() }}</dd>
        </div>
        <div class="figure figure--key">
          <dt>Solde</dt>
          <dd>{{ amounts().balance | alcoAmount: decimals() }} {{ currency() }}</dd>
        </div>
      </dl>
    </section>
  `,
  styles: `
    .summary {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      padding: var(--space-4);
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
    }
    h2 {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-4);
      align-items: baseline;
      margin: 0;
    }
    .currency {
      color: var(--color-text-muted);
      font-size: var(--font-size-caption);
      font-weight: var(--font-weight-regular);
    }
    .figures {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
      gap: var(--space-2) var(--space-3);
      margin: 0;
    }
    .figure {
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-md);
      background: var(--color-surface-muted);
    }
    .figure dt {
      color: var(--color-text-muted);
      font-size: var(--font-size-caption);
    }
    .figure dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
      overflow-wrap: anywhere;
    }
    .figure--due {
      background: var(--color-warning-soft);
    }
    .figure--key dd {
      font-weight: var(--font-weight-semibold);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoAgedSummary {
  private static nextId = 0;

  readonly asOf = input.required<string>();
  readonly currency = input.required<string>();
  readonly buckets = input.required<readonly AgingBucket[]>();
  readonly amounts = input.required<AgedAmounts>();
  readonly decimals = input(0);

  protected readonly titleId = `alco-aged-summary-${AlcoAgedSummary.nextId++}`;
  protected readonly day = isoDay;
  protected readonly label = bucketLabel;
  protected readonly describe = bucketDescription;

  /** The amount the API gave for this bucket (by its code). */
  protected amountOf(code: string): string {
    return this.amounts().buckets.find((bucket) => bucket.code === code)?.amount ?? '0';
  }
}
