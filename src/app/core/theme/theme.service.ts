import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';

/** The device's setting, or a theme chosen in the account menu. */
export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'alco.theme';

/**
 * Light or dark theme: `data-theme` on `<html>` overrides `prefers-color-scheme`
 * (styles/_tokens.scss). The choice is a convenience of this browser only: kept in
 * localStorage, and the device's setting when storage is unavailable.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  readonly choice = signal<ThemeChoice>(this.read());

  constructor() {
    effect(() => this.apply(this.choice()));
  }

  choose(choice: ThemeChoice): void {
    this.choice.set(choice);
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      // Private window or blocked storage: the choice lasts until the page is closed.
    }
  }

  private read(): ThemeChoice {
    try {
      const saved = localStorage.getItem(KEY);
      return saved === 'light' || saved === 'dark' ? saved : 'system';
    } catch {
      return 'system';
    }
  }

  private apply(choice: ThemeChoice): void {
    const root = this.document.documentElement;
    if (choice === 'system') {
      delete root.dataset['theme'];
    } else {
      root.dataset['theme'] = choice;
    }
  }
}
