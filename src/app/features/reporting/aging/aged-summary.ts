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
      <!-- Les tranches, sur une ligne ; une tranche en retard qui porte un montant en ambre. -->
      <dl class="figures buckets">
        @for (bucket of buckets(); track bucket.code) {
          <div
            class="figure"
            [class.figure--due]="bucket.first_day !== null && hasAmount(bucket.code)"
          >
            <dt [attr.title]="describe(bucket)">{{ label(bucket) }}</dt>
            <dd>{{ amountOf(bucket.code) | alcoAmount: decimals() }}</dd>
          </div>
        }
      </dl>
      <!-- Puis les totaux, le solde mis en avant. -->
      <dl class="figures totals">
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
        <div class="figure figure--balance">
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
      grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
      gap: var(--space-2);
      margin: 0;
    }
    .totals {
      padding-top: var(--space-3);
      border-top: var(--border-width) solid var(--color-border-soft);
    }
    .figure {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      padding: var(--space-3);
      border: var(--border-width) solid var(--color-border-soft);
      border-radius: var(--radius-md);
      background: var(--color-surface-muted);
    }
    .figure dt {
      color: var(--color-text-muted);
      font-size: var(--font-size-caption);
      font-weight: var(--font-weight-medium);
    }
    .figure dd {
      margin: 0;
      font-size: var(--font-size-section-title);
      font-weight: var(--font-weight-semibold);
      font-variant-numeric: tabular-nums;
      overflow-wrap: anywhere;
    }
    /* Une tranche en retard qui porte un montant : un filet ambre, le reste sobre. */
    .figure--due {
      border-left: 3px solid var(--color-warning);
    }
    .figure--due dt {
      color: var(--color-warning-text);
    }
    .figure--key dd {
      font-weight: var(--font-weight-bold);
    }
    /* Le solde : la marine pâle, le chiffre en grand. */
    .figure--balance {
      border-color: var(--color-primary-soft);
      background: var(--color-primary-soft);
    }
    .figure--balance dt {
      color: var(--color-primary-text);
    }
    .figure--balance dd {
      font-size: var(--font-size-figure);
      font-weight: var(--font-weight-bold);
      letter-spacing: var(--letter-spacing-title);
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

  /** La tranche porte un montant (autre que zéro). */
  protected hasAmount(code: string): boolean {
    return Number(this.amountOf(code)) !== 0;
  }

  /** The amount the API gave for this bucket (by its code). */
  protected amountOf(code: string): string {
    return this.amounts().buckets.find((bucket) => bucket.code === code)?.amount ?? '0';
  }
}
