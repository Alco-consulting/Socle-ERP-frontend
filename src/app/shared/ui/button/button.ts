import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { AlcoIcon } from '../icon/icon';
import { IconName } from '../icon/icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

/**
 * One button for every action of the application, applied on a native `<button>` or `<a>`.
 * Hierarchy: one `primary` per screen, `secondary` for other actions, `ghost` for tertiary
 * or toolbar actions, `danger` only inside a confirmation.
 * `loading` disables the button and swaps the label for `loadingLabel`.
 */
@Component({
  // An attribute on the native element keeps its semantics (focus, Enter/Space, forms, links).
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'button[alcoButton], a[alcoButton]',
  imports: [AlcoIcon],
  template: `
    @if (loading()) {
      <span class="spinner" aria-hidden="true"></span>
    } @else if (icon()) {
      <alco-icon [name]="icon()!" [size]="size() === 'sm' ? 16 : 18" />
    }
    @if (loading() && loadingLabel()) {
      <span>{{ loadingLabel() }}</span>
    } @else {
      <span class="label" [class.alco-sr-only]="iconOnly()"><ng-content /></span>
    }
    @if (trailingIcon() && !loading()) {
      <alco-icon [name]="trailingIcon()!" [size]="16" />
    }
  `,
  styleUrl: './button.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'classes()',
    '[attr.disabled]': 'isDisabled() ? "" : null',
    '[attr.aria-disabled]': 'isDisabled() ? "true" : null',
    '[attr.aria-busy]': 'loading() ? "true" : null',
  },
})
export class AlcoButton {
  readonly variant = input<ButtonVariant>('secondary');
  readonly size = input<ButtonSize>('md');
  readonly icon = input<IconName | undefined>(undefined);
  readonly trailingIcon = input<IconName | undefined>(undefined);
  /** Hides the text visually (kept for screen readers); requires an icon. */
  readonly iconOnly = input(false);
  readonly loading = input(false);
  /**
   * Un libellé long (le résumé d'un filtre) finit par « … » au lieu d'élargir la page : pour
   * les déclencheurs de menu et de filtre, jamais pour un bouton d'action.
   */
  readonly truncate = input(false);
  readonly loadingLabel = input('');
  readonly disabled = input(false);

  protected readonly isDisabled = computed(() => this.disabled() || this.loading());
  protected readonly classes = computed(
    () =>
      `alco-button alco-button--${this.variant()} alco-button--${this.size()}` +
      (this.iconOnly() ? ' alco-button--icon-only' : '') +
      (this.truncate() ? ' alco-button--truncate' : ''),
  );
}
