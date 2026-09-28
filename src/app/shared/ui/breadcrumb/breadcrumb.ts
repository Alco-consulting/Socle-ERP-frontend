import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AlcoIcon } from '../icon/icon';

export interface BreadcrumbItem {
  readonly label: string;
  /** Absent on the last item (current page). */
  readonly url?: string;
}

/** « Comptabilité / Écritures / EC-2026-000145 »: where am I, and one click back up. */
@Component({
  selector: 'alco-breadcrumb',
  imports: [RouterLink, AlcoIcon],
  template: `
    <nav aria-label="Fil d’Ariane">
      <ol role="list">
        @for (item of items(); track $index; let last = $last) {
          <li>
            @if (!last && item.url) {
              <a [routerLink]="item.url">{{ item.label }}</a>
              <alco-icon name="chevron-right" [size]="14" />
            } @else {
              <span [attr.aria-current]="last ? 'page' : null">{{ item.label }}</span>
              @if (!last) {
                <alco-icon name="chevron-right" [size]="14" />
              }
            }
          </li>
        }
      </ol>
    </nav>
  `,
  styles: `
    ol {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-1);
      font-size: var(--font-size-body);
      color: var(--color-text-muted);
    }
    li {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      min-width: 0;
    }
    a {
      color: var(--color-primary-text);
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    [aria-current='page'] {
      color: var(--color-text);
      font-weight: var(--font-weight-semibold);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoBreadcrumb {
  readonly items = input.required<readonly BreadcrumbItem[]>();
}
