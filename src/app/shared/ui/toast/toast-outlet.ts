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

/** Renders the toasts of `AlcoToastService`, bottom right, announced politely. */
@Component({
  selector: 'alco-toast-outlet',
  imports: [AlcoIcon],
  template: `
    <div class="stack" aria-live="polite" aria-relevant="additions">
      @for (toast of service.toasts(); track toast.id) {
        <div [class]="'toast toast--' + toast.tone">
          <alco-icon [name]="icons[toast.tone]" [size]="20" />
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
