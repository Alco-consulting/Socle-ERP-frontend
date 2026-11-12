import { TestBed } from '@angular/core/testing';

import {
  REVEAL_DURATION_MS,
  REVEAL_EASING,
  THEME_KEY,
  ThemeService,
  readPreference,
  revealRadius,
} from './theme.service';

/** A `matchMedia` whose answers the test sets, and whose dark-scheme changes it can fire. */
function fakeMedia(options: { dark?: boolean; reducedMotion?: boolean } = {}) {
  const listeners: ((event: { matches: boolean }) => void)[] = [];
  const matchMedia = vi.fn((query: string) => ({
    matches: query.includes('prefers-color-scheme: dark')
      ? (options.dark ?? false)
      : query.includes('prefers-reduced-motion')
        ? (options.reducedMotion ?? false)
        : false,
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) =>
      listeners.push(listener),
  }));
  vi.stubGlobal('matchMedia', matchMedia);
  return { deviceChanges: (dark: boolean) => listeners.forEach((l) => l({ matches: dark })) };
}

/** `document.startViewTransition`, running its update at once; `ready` resolves after it. */
function fakeViewTransitions() {
  const start = vi.fn((update: () => void) => {
    update();
    return { ready: Promise.resolve() };
  });
  const animate = vi.fn();
  Object.assign(document, { startViewTransition: start });
  Object.assign(document.documentElement, { animate });
  return { start, animate };
}

const root = () => document.documentElement;

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    root().removeAttribute('data-theme');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (document as { startViewTransition?: unknown }).startViewTransition;
  });

  describe('the saved preference', () => {
    it('none saved, or not a theme: as the device', () => {
      expect(readPreference(localStorage)).toBe('system');
      localStorage.setItem(THEME_KEY, 'blue');
      expect(readPreference(localStorage)).toBe('system');
    });

    it('light or dark when saved', () => {
      localStorage.setItem(THEME_KEY, 'dark');
      expect(readPreference(localStorage)).toBe('dark');
      localStorage.setItem(THEME_KEY, 'light');
      expect(readPreference(localStorage)).toBe('light');
    });

    it('a storage that fails, or none: as the device, without an error', () => {
      const failing = {
        getItem: () => {
          throw new Error('blocked');
        },
      };
      expect(readPreference(failing)).toBe('system');
      expect(readPreference(null)).toBe('system');
    });

    it('applied on <html> from the start: data-theme when chosen, none for the device', () => {
      fakeMedia();
      localStorage.setItem(THEME_KEY, 'dark');
      const theme = TestBed.inject(ThemeService);
      expect(theme.preference()).toBe('dark');
      expect(root().getAttribute('data-theme')).toBe('dark');
    });
  });

  describe('toggle and set', () => {
    it('toggle: the other theme than the one shown, saved and applied', () => {
      fakeMedia({ dark: false });
      const theme = TestBed.inject(ThemeService);
      expect(theme.current()).toBe('light');

      theme.toggle();
      expect(theme.preference()).toBe('dark');
      expect(theme.isDark()).toBe(true);
      expect(localStorage.getItem(THEME_KEY)).toBe('dark');
      expect(root().getAttribute('data-theme')).toBe('dark');

      theme.toggle();
      expect(localStorage.getItem(THEME_KEY)).toBe('light');
      expect(root().getAttribute('data-theme')).toBe('light');
    });

    it('back to the device: no data-theme, the device decides', () => {
      fakeMedia({ dark: true });
      const theme = TestBed.inject(ThemeService);
      theme.set('light');
      theme.set('system');
      expect(root().hasAttribute('data-theme')).toBe(false);
      expect(localStorage.getItem(THEME_KEY)).toBe('system');
      expect(theme.current()).toBe('dark');
    });

    it('a storage that fails: the theme still changes, without an error', () => {
      fakeMedia();
      const theme = TestBed.inject(ThemeService);
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      expect(() => theme.set('dark')).not.toThrow();
      expect(theme.isDark()).toBe(true);
      expect(root().getAttribute('data-theme')).toBe('dark');
      vi.restoreAllMocks();
    });
  });

  describe('as the device', () => {
    it('follows the device live while the preference is system', () => {
      const media = fakeMedia({ dark: false });
      const theme = TestBed.inject(ThemeService);
      expect(theme.current()).toBe('light');
      media.deviceChanges(true);
      expect(theme.current()).toBe('dark');
      media.deviceChanges(false);
      expect(theme.current()).toBe('light');
    });

    it('a chosen theme no longer follows the device', () => {
      const media = fakeMedia({ dark: false });
      const theme = TestBed.inject(ThemeService);
      theme.set('light');
      media.deviceChanges(true);
      expect(theme.current()).toBe('light');
    });
  });

  describe('the circular reveal', () => {
    it('grows from the origin to the whole window, as asked (600 ms)', async () => {
      fakeMedia();
      const { start, animate } = fakeViewTransitions();
      vi.stubGlobal('innerWidth', 1000);
      vi.stubGlobal('innerHeight', 800);
      const theme = TestBed.inject(ThemeService);

      theme.toggle({ x: 100, y: 50 });
      expect(start).toHaveBeenCalledTimes(1);
      expect(root().getAttribute('data-theme')).toBe('dark');
      await Promise.resolve();

      const radius = revealRadius({ x: 100, y: 50 }, 1000, 800);
      expect(animate).toHaveBeenCalledWith(
        { clipPath: ['circle(0px at 100px 50px)', `circle(${radius}px at 100px 50px)`] },
        {
          duration: REVEAL_DURATION_MS,
          easing: REVEAL_EASING,
          pseudoElement: '::view-transition-new(root)',
        },
      );
      expect(REVEAL_DURATION_MS).toBe(600);
      expect(REVEAL_EASING).toBe('cubic-bezier(0.65, 0, 0.35, 1)');
    });

    it('at once when the user asks for less motion', () => {
      fakeMedia({ reducedMotion: true });
      const { start } = fakeViewTransitions();
      const theme = TestBed.inject(ThemeService);
      theme.toggle({ x: 10, y: 10 });
      expect(start).not.toHaveBeenCalled();
      expect(theme.isDark()).toBe(true);
    });

    it('at once when the browser has no View Transitions', () => {
      fakeMedia();
      const theme = TestBed.inject(ThemeService);
      expect(() => theme.toggle({ x: 10, y: 10 })).not.toThrow();
      expect(theme.isDark()).toBe(true);
    });

    it('none when the look does not change (system → its own theme)', () => {
      fakeMedia({ dark: true });
      const { start } = fakeViewTransitions();
      const theme = TestBed.inject(ThemeService);
      theme.set('dark');
      expect(start).not.toHaveBeenCalled();
      expect(theme.preference()).toBe('dark');
    });
  });
});

describe('revealRadius', () => {
  it('reaches the farthest corner of the window', () => {
    expect(revealRadius({ x: 0, y: 0 }, 800, 600)).toBe(1000);
    expect(revealRadius({ x: 800, y: 600 }, 800, 600)).toBe(1000);
    expect(revealRadius({ x: 400, y: 300 }, 800, 600)).toBe(500);
    expect(revealRadius({ x: 100, y: 500 }, 800, 600)).toBeCloseTo(Math.hypot(700, 500));
  });
});
