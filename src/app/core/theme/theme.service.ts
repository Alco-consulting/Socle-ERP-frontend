import { DOCUMENT, Injectable, computed, effect, inject, signal } from '@angular/core';

/** The device's setting, or a theme chosen with the top bar's switch. */
export type ThemeChoice = 'system' | 'light' | 'dark';

/** The theme actually shown. */
export type Theme = 'light' | 'dark';

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

  /** The device's own setting, followed while it changes. */
  private readonly deviceDark = signal(this.watchDevice());

  /** The theme shown: the choice, or the device's while nothing is chosen. */
  readonly current = computed<Theme>(() => {
    const choice = this.choice();
    if (choice !== 'system') {
      return choice;
    }
    return this.deviceDark() ? 'dark' : 'light';
  });

  constructor() {
    effect(() => this.apply(this.choice()));
  }

  /** The top bar's switch: the other theme than the one shown, kept as the choice. */
  toggle(): void {
    this.choose(this.current() === 'dark' ? 'light' : 'dark');
  }

  choose(choice: ThemeChoice): void {
    this.choice.set(choice);
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      // Private window or blocked storage: the choice lasts until the page is closed.
    }
  }

  private watchDevice(): boolean {
    const query = this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) {
      return false;
    }
    query.addEventListener?.('change', (event) => this.deviceDark.set(event.matches));
    return query.matches;
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
