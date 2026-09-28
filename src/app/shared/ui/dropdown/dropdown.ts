import { CdkMenu, CdkMenuItem, CdkMenuItemRadio, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';

import { AlcoButton, ButtonSize, ButtonVariant } from '../button/button';
import { AlcoIcon } from '../icon/icon';
import { IconName } from '../icon/icons';

export interface DropdownItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly description?: string;
  /** Navigates on selection (in addition to emitting `selected`). */
  readonly route?: string;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  /** Used by `mode="single"` menus (group by, company switcher). */
  readonly checked?: boolean;
  readonly dividerBefore?: boolean;
}

export type DropdownTrigger = 'secondary' | 'ghost' | 'primary' | 'topbar' | 'nav';

/**
 * Menu of secondary actions or choices behind a single trigger (« Actions ▾ », « Plus ▾ »,
 * société, utilisateur). Keyboard: arrows, Home/End, Escape, typeahead (Angular CDK Menu).
 * The trigger's text is projected; menu entries come from `items`.
 */
@Component({
  selector: 'alco-dropdown',
  imports: [
    CdkMenu,
    CdkMenuItem,
    CdkMenuItemRadio,
    CdkMenuTrigger,
    NgTemplateOutlet,
    AlcoButton,
    AlcoIcon,
  ],
  templateUrl: './dropdown.html',
  styleUrl: './dropdown.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoDropdown {
  private readonly router = inject(Router);

  readonly items = input.required<readonly DropdownItem[]>();
  readonly trigger = input<DropdownTrigger>('secondary');
  readonly size = input<ButtonSize>('md');
  readonly icon = input<IconName | undefined>(undefined);
  readonly iconOnly = input(false);
  readonly showChevron = input(true);
  readonly mode = input<'action' | 'single'>('action');
  /** Optional header shown at the top of the open menu (e.g. user name). */
  readonly heading = input('');
  readonly subheading = input('');
  readonly align = input<'start' | 'end'>('start');
  /** Accessible name when the projected trigger text is not explicit enough. */
  readonly ariaLabel = input<string | undefined>(undefined);

  readonly selected = output<DropdownItem>();

  protected readonly buttonVariant = computed<ButtonVariant>(() => {
    const trigger = this.trigger();
    return trigger === 'topbar' || trigger === 'nav' ? 'ghost' : trigger;
  });

  protected readonly positionsStart: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];
  protected readonly positionsEnd: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
  ];

  protected choose(item: DropdownItem): void {
    this.selected.emit(item);
    if (item.route) {
      void this.router.navigateByUrl(item.route);
    }
  }
}
