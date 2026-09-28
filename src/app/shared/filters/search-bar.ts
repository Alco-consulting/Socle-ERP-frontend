import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';

import { AlcoIcon } from '../ui/icon/icon';
import { IconName } from '../ui/icon/icons';

/** An active criterion displayed as a removable chip inside the search box. */
export interface SearchFacet {
  readonly id: string;
  readonly kind: 'filter' | 'group' | 'favorite';
  /** « État », « Regroupé par », « Favori » */
  readonly label: string;
  /** « Brouillon », « Journal » */
  readonly value: string;
}

const FACET_ICONS: Record<SearchFacet['kind'], IconName> = {
  filter: 'filter',
  group: 'group',
  favorite: 'star',
};

/**
 * The single search box of a list: free text + active criteria as chips.
 * Backspace in an empty box removes the last chip. The page owns the query and the facets.
 */
@Component({
  selector: 'alco-search-bar',
  imports: [AlcoIcon],
  templateUrl: './search-bar.html',
  styleUrl: './search-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoSearchBar {
  readonly query = model('');
  readonly facets = input<readonly SearchFacet[]>([]);
  readonly placeholder = input('Rechercher…');
  /** Accessible name of the box, e.g. « Rechercher une écriture ». */
  readonly label = input('Rechercher');

  readonly facetRemoved = output<SearchFacet>();
  readonly submitted = output<string>();

  protected readonly icons = FACET_ICONS;

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.submitted.emit(this.query());
    } else if (event.key === 'Backspace' && this.query() === '') {
      const last = this.facets().at(-1);
      if (last) {
        this.facetRemoved.emit(last);
      }
    }
  }

  protected clear(input: HTMLInputElement): void {
    this.query.set('');
    input.focus();
  }
}
