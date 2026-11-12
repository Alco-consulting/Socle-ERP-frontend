import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { AlcoInput } from '../../forms/input';
import { AlcoButton } from '../button/button';

/**
 * Le pied d'une liste paginée par le serveur : « Lignes par page [20 ▾] · 1–20 sur 145 ·
 * « ‹ Page 2 sur 8 › » ». Le composant ne fait qu'émettre la page ou la taille demandée ; la
 * liste les met dans son adresse. Le choix de la taille n'apparaît que si la liste fournit
 * `sizes`.
 */
@Component({
  selector: 'alco-pagination',
  imports: [AlcoButton, AlcoInput],
  template: `
    @if (sizes(); as options) {
      <label class="size">
        <span class="size-label">Lignes par page</span>
        <select
          alcoSelect
          class="size-select"
          aria-label="Lignes par page"
          [value]="pageSize()"
          (change)="chooseSize($event)"
        >
          @for (option of options; track option) {
            <option [value]="option" [selected]="option === pageSize()">{{ option }}</option>
          }
        </select>
      </label>
    }

    <span class="range" aria-live="polite">
      @if (total() === 0) {
        0 résultat
      } @else {
        <span class="alco-num">{{ first() }}–{{ last() }}</span> sur
        <span class="alco-num">{{ total() }}</span>
      }
    </span>

    @if (pageCount() > 1) {
      <span class="nav">
        <button
          alcoButton
          class="edge"
          type="button"
          variant="ghost"
          size="sm"
          icon="chevrons-left"
          [iconOnly]="true"
          [disabled]="page() <= 1"
          (click)="pageChange.emit(1)"
        >
          Première page
        </button>
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
        <span class="position">
          Page <span class="alco-num">{{ page() }}</span> sur
          <span class="alco-num">{{ pageCount() }}</span>
        </span>
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
        <button
          alcoButton
          class="edge"
          type="button"
          variant="ghost"
          size="sm"
          icon="chevrons-right"
          [iconOnly]="true"
          [disabled]="page() >= pageCount()"
          (click)="pageChange.emit(pageCount())"
        >
          Dernière page
        </button>
      </span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: var(--space-2) var(--space-5);
      color: var(--color-text-muted);
      white-space: nowrap;
    }
    .size {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
    }
    .size-select {
      width: auto;
      height: var(--control-height-sm);
      padding-left: var(--space-3);
      font-size: var(--font-size-body);
    }
    .nav {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
    }
    .position {
      padding: 0 var(--space-2);
      color: var(--color-text);
    }
    /* Sur un téléphone : l'essentiel, sans le libellé de la taille ni les pages extrêmes. */
    @media (max-width: 767.98px) {
      :host {
        gap: var(--space-2) var(--space-3);
      }
      .size-label,
      .edge {
        display: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'navigation', 'aria-label': 'Pagination' },
})
export class AlcoPagination {
  readonly page = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly total = input.required<number>();
  /** Les tailles proposées ; sans elles, la taille de la liste est fixe. */
  readonly sizes = input<readonly number[] | null>(null);

  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();

  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.pageSize())),
  );
  protected readonly first = computed(() => (this.page() - 1) * this.pageSize() + 1);
  protected readonly last = computed(() => Math.min(this.page() * this.pageSize(), this.total()));

  protected chooseSize(event: Event): void {
    this.pageSizeChange.emit(Number((event.target as HTMLSelectElement).value));
  }
}
