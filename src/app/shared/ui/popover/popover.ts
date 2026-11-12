import { A11yModule } from '@angular/cdk/a11y';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { ChangeDetectionStrategy, Component, input, signal, viewChild } from '@angular/core';

import { AlcoButton } from '../button/button';
import { IconName } from '../icon/icons';

/**
 * A button that opens a small panel of choices richer than a menu's (Odoo's date filter of a
 * report: a period, its ◀ ▶, dates to type). The panel is a dialog: focus kept inside,
 * Escape and a click outside close it, the focus back on the button.
 */
@Component({
  selector: 'alco-popover',
  imports: [A11yModule, CdkConnectedOverlay, CdkOverlayOrigin, AlcoButton],
  template: `
    <button
      alcoButton
      type="button"
      [icon]="icon()"
      [truncate]="true"
      [class.active]="active()"
      cdkOverlayOrigin
      #origin="cdkOverlayOrigin"
      aria-haspopup="dialog"
      [attr.aria-expanded]="open()"
      (click)="toggle()"
    >
      {{ label() }}
    </button>
    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="origin"
      [cdkConnectedOverlayOpen]="open()"
      [cdkConnectedOverlayPositions]="positions"
      (overlayOutsideClick)="onOutsideClick($event)"
      (detach)="close()"
    >
      <div
        class="panel"
        role="dialog"
        [attr.aria-label]="panelLabel()"
        cdkTrapFocus
        [cdkTrapFocusAutoCapture]="true"
        (keydown.escape)="close(true)"
      >
        <ng-content />
      </div>
    </ng-template>
  `,
  styleUrl: './popover.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoPopover {
  readonly label = input.required<string>();
  readonly panelLabel = input.required<string>();
  readonly icon = input<IconName | undefined>(undefined);
  /** A choice is made (« Comparaison: Période précédente »): the button says it. */
  readonly active = input(false);

  protected readonly open = signal(false);
  private readonly origin = viewChild(CdkOverlayOrigin);
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
  ];

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  /** `restoreFocus`: back to the button (after Escape or a choice). */
  close(restoreFocus = false): void {
    this.open.set(false);
    if (restoreFocus) {
      (this.origin()?.elementRef.nativeElement as HTMLElement | undefined)?.focus();
    }
  }

  protected onOutsideClick(event: MouseEvent): void {
    const trigger = this.origin()?.elementRef.nativeElement as HTMLElement | undefined;
    if (!trigger?.contains(event.target as Node)) {
      this.close();
    }
  }
}
