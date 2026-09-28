import { Injectable, signal } from '@angular/core';

export type ToastTone = 'success' | 'info' | 'warning' | 'danger';

export interface Toast {
  readonly id: number;
  readonly tone: ToastTone;
  readonly message: string;
  /** Optional follow-up action (« Voir l'écriture »). */
  readonly actionLabel?: string;
  readonly action?: () => void;
}

const DEFAULT_DURATION_MS = 5000;

/**
 * Short feedback after an action. Success and info disappear after 5 s; warnings and
 * errors stay until dismissed. Rendered by `<alco-toast-outlet>` in the application root.
 */
@Injectable({ providedIn: 'root' })
export class AlcoToastService {
  private nextId = 1;
  private readonly items = signal<readonly Toast[]>([]);
  readonly toasts = this.items.asReadonly();

  show(
    tone: ToastTone,
    message: string,
    options: Pick<Toast, 'action' | 'actionLabel'> = {},
  ): number {
    const toast: Toast = { id: this.nextId++, tone, message, ...options };
    this.items.update((list) => [...list, toast]);
    if (tone === 'success' || tone === 'info') {
      setTimeout(() => this.dismiss(toast.id), DEFAULT_DURATION_MS);
    }
    return toast.id;
  }

  success(message: string, options?: Pick<Toast, 'action' | 'actionLabel'>): number {
    return this.show('success', message, options);
  }

  info(message: string): number {
    return this.show('info', message);
  }

  error(message: string): number {
    return this.show('danger', message);
  }

  dismiss(id: number): void {
    this.items.update((list) => list.filter((toast) => toast.id !== id));
  }
}
