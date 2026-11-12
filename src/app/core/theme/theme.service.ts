import { ApplicationRef, DOCUMENT, Injectable, computed, inject, signal } from '@angular/core';

/** The device's setting, or a theme chosen with the top bar's switch. */
export type ThemePreference = 'system' | 'light' | 'dark';

/** The theme actually shown. */
export type Theme = 'light' | 'dark';

/** A point of the window, in CSS pixels: where the reveal starts. */
export interface RevealOrigin {
  readonly x: number;
  readonly y: number;
}

/** Same key as public/theme-init.js, which applies it before the first paint. */
export const THEME_KEY = 'alco.theme';

/** The circular reveal of the new theme (as Telegram's). */
export const REVEAL_DURATION_MS = 600;
export const REVEAL_EASING = 'cubic-bezier(0.65, 0, 0.35, 1)';

/**
 * The radius that covers the whole window from `origin`: the distance to its farthest corner.
 */
export function revealRadius(origin: RevealOrigin, width: number, height: number): number {
  return Math.hypot(Math.max(origin.x, width - origin.x), Math.max(origin.y, height - origin.y));
}

/** A saved value, or `'system'` when there is none, it is not a theme, or storage fails. */
export function readPreference(storage: Pick<Storage, 'getItem'> | null): ThemePreference {
  try {
    const saved = storage?.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

/** `document.startViewTransition`, where the browser has it. */
type TransitionStarter = (update: () => void) => { readonly ready: Promise<void> };

/**
 * Light or dark theme, one service started with the application:
 * - the preference (`system` by default) is kept on this device (localStorage, `alco.theme`);
 *   a storage that fails leaves `system`, without an error;
 * - the effective theme follows the device while the preference is `system`, live;
 * - `data-theme` on `<html>` when the user chose, none for `system` (styles/_tokens.scss).
 *   public/theme-init.js already set it before the first paint: no flash of the other theme;
 * - a change reveals the new theme in a circle growing from where it was asked
 *   (View Transitions); at once when the user asks for less motion, when the browser has no
 *   View Transitions, or when the look does not change.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly appRef = inject(ApplicationRef);
  private readonly window = this.document.defaultView;

  private readonly preferenceState = signal<ThemePreference>(readPreference(this.storage()));
  /** What the user chose: light, dark, or as the device. */
  readonly preference = this.preferenceState.asReadonly();

  /** The device's own setting, followed while it changes. */
  private readonly deviceDark = signal(this.watchDevice());

  /** The theme shown: the preference, or the device's while it is `system`. */
  readonly current = computed<Theme>(() => this.effectiveOf(this.preferenceState()));

  readonly isDark = computed(() => this.current() === 'dark');

  constructor() {
    this.apply(this.preferenceState());
  }

  /** The top bar's switch: the other theme than the one shown, kept as the preference. */
  toggle(origin?: RevealOrigin): void {
    this.set(this.isDark() ? 'light' : 'dark', origin);
  }

  /**
   * Keeps and applies `preference`; the new look is revealed from `origin` (the window's
   * centre without one).
   */
  set(preference: ThemePreference, origin?: RevealOrigin): void {
    const before = this.current();
    const update = () => this.commit(preference);
    const start = this.transitionStarter();
    if (!start || this.reducedMotion() || this.effectiveOf(preference) === before) {
      update();
      return;
    }
    const width = this.window?.innerWidth ?? 0;
    const height = this.window?.innerHeight ?? 0;
    const from = origin ?? { x: width / 2, y: height / 2 };
    const transition = start(() => {
      update();
      // Drawn now, inside the capture: the switch's icon changes with the rest of the page.
      this.appRef.tick();
    });
    transition.ready
      .then(() => this.reveal(from, revealRadius(from, width, height)))
      .catch(() => undefined);
  }

  private commit(preference: ThemePreference): void {
    this.preferenceState.set(preference);
    this.apply(preference);
    try {
      this.window?.localStorage.setItem(THEME_KEY, preference);
    } catch {
      // Private window or blocked storage: the preference lasts until the page is closed.
    }
  }

  private reveal(origin: RevealOrigin, radius: number): void {
    const at = `at ${origin.x}px ${origin.y}px`;
    this.document.documentElement.animate(
      { clipPath: [`circle(0px ${at})`, `circle(${radius}px ${at})`] },
      {
        duration: REVEAL_DURATION_MS,
        easing: REVEAL_EASING,
        pseudoElement: '::view-transition-new(root)',
      },
    );
  }

  private effectiveOf(preference: ThemePreference): Theme {
    if (preference !== 'system') {
      return preference;
    }
    return this.deviceDark() ? 'dark' : 'light';
  }

  private transitionStarter(): TransitionStarter | null {
    const document = this.document as Document & { startViewTransition?: TransitionStarter };
    return typeof document.startViewTransition === 'function'
      ? document.startViewTransition.bind(document)
      : null;
  }

  private reducedMotion(): boolean {
    return this.window?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  private storage(): Storage | null {
    try {
      return this.window?.localStorage ?? null;
    } catch {
      return null;
    }
  }

  private watchDevice(): boolean {
    const query = this.window?.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) {
      return false;
    }
    query.addEventListener?.('change', (event) => this.deviceDark.set(event.matches));
    return query.matches;
  }

  private apply(preference: ThemePreference): void {
    const root = this.document.documentElement;
    if (preference === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', preference);
    }
  }
}
