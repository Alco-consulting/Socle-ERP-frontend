import { Injectable, computed, signal } from '@angular/core';

export interface AppNotification {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly url?: string;
  readonly read: boolean;
}

/** Notifications of the top bar (bell). Filled by the prototype; by the API later. */
@Injectable({ providedIn: 'root' })
export class NotificationCenter {
  private readonly items = signal<readonly AppNotification[]>([]);

  readonly notifications = this.items.asReadonly();
  readonly unreadCount = computed(() => this.items().filter((item) => !item.read).length);

  load(items: readonly AppNotification[]): void {
    this.items.set(items);
  }

  markRead(id: string): void {
    this.items.update((list) =>
      list.map((item) => (item.id === id ? { ...item, read: true } : item)),
    );
  }
}
