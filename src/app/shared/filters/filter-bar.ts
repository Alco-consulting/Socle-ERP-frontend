import { A11yModule } from '@angular/cdk/a11y';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { AlcoButton } from '../ui/button/button';
import { AlcoDropdown, DropdownItem } from '../ui/dropdown/dropdown';

export interface GroupOption {
  readonly id: string;
  readonly label: string;
}

export interface FavoriteOption {
  readonly id: string;
  readonly label: string;
}

const NO_GROUP = '__none__';

/**
 * The three list controls, always in this order: Filtres, Regrouper, Favoris.
 * - Filtres opens a panel with the page's fields (projected `[alcoFilterFields]`) and
 *   « Appliquer » (`applied`) / « Réinitialiser » (`cleared`).
 * - Regrouper lists only the groupings that make sense for the list (never every field).
 * - Favoris lists saved searches.
 * Each control is hidden when the page gives it nothing to show.
 */
@Component({
  selector: 'alco-filter-bar',
  imports: [A11yModule, CdkConnectedOverlay, CdkOverlayOrigin, AlcoButton, AlcoDropdown],
  templateUrl: './filter-bar.html',
  styleUrl: './filter-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoFilterBar {
  readonly hasFilters = input(true);
  readonly activeFilterCount = input(0);
  readonly groupOptions = input<readonly GroupOption[]>([]);
  readonly groupBy = input<string | null>(null);
  readonly favorites = input<readonly FavoriteOption[]>([]);

  readonly applied = output<void>();
  readonly cleared = output<void>();
  readonly groupByChange = output<string | null>();
  readonly favoriteSelected = output<string>();

  protected readonly panelOpen = signal(false);
  private readonly origin = viewChild(CdkOverlayOrigin);
  protected readonly panelPositions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
  ];

  protected readonly groupItems = computed<readonly DropdownItem[]>(() => [
    ...this.groupOptions().map((option) => ({
      id: option.id,
      label: option.label,
      checked: option.id === this.groupBy(),
    })),
    {
      id: NO_GROUP,
      label: 'Aucun regroupement',
      checked: this.groupBy() === null,
      dividerBefore: true,
    },
  ]);

  protected readonly favoriteItems = computed<readonly DropdownItem[]>(() =>
    this.favorites().map((favorite) => ({ id: favorite.id, label: favorite.label, icon: 'star' })),
  );

  protected readonly filterLabel = computed(() =>
    this.activeFilterCount() > 0 ? `Filtres (${this.activeFilterCount()})` : 'Filtres',
  );

  protected togglePanel(): void {
    this.panelOpen.update((open) => !open);
  }

  /** `restoreFocus`: back to the « Filtres » button after Escape or « Appliquer ». */
  protected closePanel(restoreFocus = false): void {
    this.panelOpen.set(false);
    if (restoreFocus) {
      (this.origin()?.elementRef.nativeElement as HTMLElement | undefined)?.focus();
    }
  }

  /** A click on the « Filtres » button itself is handled by `togglePanel`. */
  protected onOutsideClick(event: MouseEvent): void {
    const trigger = this.origin()?.elementRef.nativeElement as HTMLElement | undefined;
    if (!trigger?.contains(event.target as Node)) {
      this.closePanel();
    }
  }

  protected apply(): void {
    this.applied.emit();
    this.closePanel(true);
  }

  protected onGroupSelected(item: DropdownItem): void {
    this.groupByChange.emit(item.id === NO_GROUP ? null : item.id);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.closePanel(true);
    }
  }
}
