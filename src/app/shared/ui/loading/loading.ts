import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Local, non-blocking loading placeholder (skeleton) shaped like the content to come.
 * Never a full-page spinner. Announced once to screen readers through `label`.
 */
@Component({
  selector: 'alco-loading',
  template: `
    <span class="alco-sr-only">{{ label() }}</span>
    @switch (variant()) {
      @case ('table') {
        <div class="skeleton-table">
          <div class="skeleton-row skeleton-row--head" aria-hidden="true">
            @for (c of columnList(); track $index) {
              <span class="bone"></span>
            }
          </div>
          @for (r of rowList(); track $index) {
            <div class="skeleton-row" aria-hidden="true">
              @for (c of columnList(); track $index) {
                <span class="bone"></span>
              }
            </div>
          }
        </div>
      }
      @case ('cards') {
        <div class="skeleton-cards" aria-hidden="true">
          @for (r of rowList(); track $index) {
            <div class="skeleton-card">
              <span class="bone bone--title"></span>
              <span class="bone"></span>
              <span class="bone"></span>
              <span class="bone bone--short"></span>
            </div>
          }
        </div>
      }
      @default {
        @for (r of rowList(); track $index) {
          <span class="bone" [class.bone--short]="$last" aria-hidden="true"></span>
        }
      }
    }
  `,
  styleUrl: './loading.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', 'aria-live': 'polite' },
})
export class AlcoLoading {
  readonly variant = input<'text' | 'table' | 'cards'>('text');
  readonly rows = input(3);
  readonly columns = input(5);
  readonly label = input('Chargement en cours…');

  protected readonly rowList = computed(() => Array.from({ length: this.rows() }));
  protected readonly columnList = computed(() => Array.from({ length: this.columns() }));
}
