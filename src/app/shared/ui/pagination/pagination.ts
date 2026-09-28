import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { AlcoButton } from '../button/button';

/**
 * Compact pager « 1–20 sur 145  ‹ › », as in list control panels. Pages are server-side:
 * this component only emits the requested page.
 */
@Component({
  selector: 'alco-pagination',
  imports: [AlcoButton],
  template: `
    <span class="range" aria-live="polite">
      @if (total() === 0) {
        0 résultat
      } @else {
        <span class="alco-num">{{ first() }}–{{ last() }}</span> sur
        <span class="alco-num">{{ total() }}</span>
      }
    </span>
    <button
      alcoButton
      type="button"
      variant="ghost"
      size="sm"
      icon="chevron-left"
      [iconOnly]="true"
      [disabled]="page() <= 1"
      (click)="pageChange.emit(page() - 1)"
    >
      Page précédente
    </button>
    <button
      alcoButton
      type="button"
      variant="ghost"
      size="sm"
      icon="chevron-right"
      [iconOnly]="true"
      [disabled]="page() >= pageCount()"
      (click)="pageChange.emit(page() + 1)"
    >
      Page suivante
    </button>
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      color: var(--color-text-muted);
      white-space: nowrap;
    }
    .range {
      margin-right: var(--space-1);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'navigation', 'aria-label': 'Pagination' },
})
export class AlcoPagination {
  readonly page = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly total = input.required<number>();

  readonly pageChange = output<number>();

  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.pageSize())),
  );
  protected readonly first = computed(() => (this.page() - 1) * this.pageSize() + 1);
  protected readonly last = computed(() => Math.min(this.page() * this.pageSize(), this.total()));
}
