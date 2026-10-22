import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { AlcoIcon } from '../icon/icon';
import { IconName } from '../icon/icons';
import { AlcoToastService, ToastTone } from './toast.service';

const TONE_ICONS: Record<ToastTone, IconName> = {
  success: 'check-circle',
  info: 'info',
  warning: 'alert-triangle',
  danger: 'alert-circle',
};

/** Renders the toasts of `AlcoToastService`, bottom right; errors announced at once. */
@Component({
  selector: 'alco-toast-outlet',
  imports: [AlcoIcon],
  template: `
    <div class="stack">
      @for (toast of service.toasts(); track toast.id) {
        <!-- An error or a warning is announced at once; a confirmation politely. -->
        <div
          [class]="'toast toast--' + toast.tone"
          [attr.role]="toast.tone === 'danger' || toast.tone === 'warning' ? 'alert' : 'status'"
          (mouseenter)="service.pause(toast.id)"
          (mouseleave)="service.resume(toast.id)"
          (focusin)="service.pause(toast.id)"
          (focusout)="service.resume(toast.id)"
        >
          <span class="tone" aria-hidden="true">
            <alco-icon [name]="icons[toast.tone]" [size]="18" />
          </span>
          <p class="message">{{ toast.message }}</p>
          @if (toast.actionLabel && toast.action) {
            <button type="button" class="action" (click)="run(toast.id, toast.action)">
              {{ toast.actionLabel }}
            </button>
          }
          <button
            type="button"
            class="close"
            aria-label="Fermer la notification"
            (click)="service.dismiss(toast.id)"
          >
            <alco-icon name="close" [size]="16" />
          </button>
        </div>
      }
    </div>
  `,
  styleUrl: './toast-outlet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoToastOutlet {
  protected readonly service = inject(AlcoToastService);
  protected readonly icons = TONE_ICONS;

  protected run(id: number, action: () => void): void {
    action();
    this.service.dismiss(id);
  }
}
