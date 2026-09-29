import { Injectable, computed, signal } from '@angular/core';

/**
 * Number of API calls in progress, for the discreet activity bar at the top of the page.
 * Never blocks the screen: each screen shows its own local loading state (skeletons,
 * busy buttons) from the design system.
 */
@Injectable({ providedIn: 'root' })
export class LoadingService {
  private readonly pending = signal(0);

  readonly busy = computed(() => this.pending() > 0);
  readonly count = this.pending.asReadonly();

  start(): void {
    this.pending.update((count) => count + 1);
  }

  stop(): void {
    this.pending.update((count) => Math.max(0, count - 1));
  }
}
