import { Injectable, signal } from '@angular/core';

export type ToastTone = 'success' | 'info' | 'warning' | 'danger';

export interface Toast {
  readonly id: number;
  readonly tone: ToastTone;
  readonly message: string;
  /** Optional follow-up action (« Voir l'écriture », « Annuler »). */
  readonly actionLabel?: string;
  readonly action?: () => void;
}

type ToastOptions = Pick<Toast, 'action' | 'actionLabel'>;

const DEFAULT_DURATION_MS = 5000;

/** A toast closing by itself: the time left, the timer running (none while paused). */
interface Countdown {
  remaining: number;
  started: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Short feedback after an action. Success and info disappear after 5 s, paused while the
 * pointer or the focus is on them; warnings and errors stay until dismissed. Rendered by
 * `<alco-toast-outlet>` in the application root.
 */
@Injectable({ providedIn: 'root' })
export class AlcoToastService {
  private nextId = 1;
  private readonly items = signal<readonly Toast[]>([]);
  private readonly countdowns = new Map<number, Countdown>();
  readonly toasts = this.items.asReadonly();

  show(tone: ToastTone, message: string, options: ToastOptions = {}): number {
    const toast: Toast = { id: this.nextId++, tone, message, ...options };
    this.items.update((list) => [...list, toast]);
    if (tone === 'success' || tone === 'info') {
      this.countdowns.set(toast.id, { remaining: DEFAULT_DURATION_MS, started: 0, timer: null });
      this.resume(toast.id);
    }
    return toast.id;
  }

  success(message: string, options?: ToastOptions): number {
    return this.show('success', message, options);
  }

  info(message: string, options?: ToastOptions): number {
    return this.show('info', message, options);
  }

  error(message: string): number {
    return this.show('danger', message);
  }

  /** The pointer or the focus on the toast: it waits. */
  pause(id: number): void {
    const countdown = this.countdowns.get(id);
    if (countdown?.timer) {
      clearTimeout(countdown.timer);
      countdown.timer = null;
      countdown.remaining -= Date.now() - countdown.started;
    }
  }

  resume(id: number): void {
    const countdown = this.countdowns.get(id);
    if (countdown && !countdown.timer) {
      countdown.started = Date.now();
      countdown.timer = setTimeout(() => this.dismiss(id), Math.max(countdown.remaining, 1000));
    }
  }

  dismiss(id: number): void {
    const countdown = this.countdowns.get(id);
    if (countdown?.timer) {
      clearTimeout(countdown.timer);
    }
    this.countdowns.delete(id);
    this.items.update((list) => list.filter((toast) => toast.id !== id));
  }
}
