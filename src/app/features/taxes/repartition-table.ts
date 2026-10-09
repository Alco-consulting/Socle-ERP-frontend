import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { RepartitionLine } from './data-access/taxes-models';
import { percentText, repartitionTypeLabel } from './taxes-presentation';

/**
 * One of Odoo's « Répartition pour les factures / pour les notes de crédit », read only:
 * %, Basé sur, Compte (code and name when the chart knows it), Grilles de taxes.
 */
@Component({
  selector: 'alco-repartition-table',
  template: `
    <h3 class="title" [id]="titleId()">{{ title() }}</h3>
    <div class="scroll">
      <table class="lines" [attr.aria-labelledby]="titleId()">
        <thead>
          <tr>
            <th scope="col" class="factor">%</th>
            <th scope="col">Basé sur</th>
            <th scope="col">Compte</th>
            <th scope="col">Grilles de taxes</th>
          </tr>
        </thead>
        <tbody>
          @for (line of lines(); track $index) {
            <tr>
              <td class="factor">
                {{ line.repartition_type === 'tax' ? percent(line.factor_percent) : '' }}
              </td>
              <td>{{ typeLabel(line.repartition_type) }}</td>
              <td>
                @if (line.account_code) {
                  {{ line.account_code }} {{ accountNames().get(line.account_code) ?? '' }}
                }
              </td>
              <td>
                <ul class="grids">
                  @for (grid of line.grids; track grid) {
                    <li class="grid">{{ grid }}</li>
                  }
                </ul>
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="4" class="empty">Aucune ligne.</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      min-width: 0;
    }
    .title {
      margin: 0;
      padding-bottom: var(--space-2);
      border-bottom: var(--border-width) solid var(--color-border);
      font-size: var(--font-size-caption);
      font-weight: var(--font-weight-semibold);
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .scroll {
      position: relative;
      overflow-x: auto;
    }
    .lines {
      width: 100%;
      border-collapse: collapse;
    }
    th,
    td {
      padding: var(--space-2);
      border-bottom: var(--border-width) solid var(--color-border);
      text-align: left;
      vertical-align: middle;
    }
    th {
      font-weight: var(--font-weight-semibold);
      white-space: nowrap;
    }
    .factor {
      width: 6rem;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .grids {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .grid {
      padding: 2px var(--space-2);
      border-radius: var(--radius-pill);
      background: var(--color-neutral-soft);
      color: var(--color-neutral-text);
      font-size: var(--font-size-caption);
    }
    .empty {
      color: var(--color-text-muted);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoRepartitionTable {
  readonly title = input.required<string>();
  readonly titleId = input.required<string>();
  readonly lines = input.required<readonly RepartitionLine[]>();
  readonly accountNames = input<ReadonlyMap<string, string>>(new Map());

  protected readonly typeLabel = repartitionTypeLabel;

  protected percent(value: string): string {
    return percentText(value, 2);
  }
}
