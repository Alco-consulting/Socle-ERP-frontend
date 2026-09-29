import { safeReturnUrl } from './return-url';

describe('safeReturnUrl (never an open redirect)', () => {
  it.each([
    ['/app', '/app'],
    ['/app/comptabilite/ecritures', '/app/comptabilite/ecritures'],
    [
      '/app/comptabilite/ecritures?etat=draft&groupe=journal',
      '/app/comptabilite/ecritures?etat=draft&groupe=journal',
    ],
  ])('keeps a page of the application: %s', (value, expected) => {
    expect(safeReturnUrl(value)).toBe(expected);
  });

  it.each([
    [null],
    [''],
    ['https://evil.example/app'],
    ['http://evil.example'],
    ['//evil.example/app'],
    ['/\\evil.example'],
    ['javascript:alert(1)'],
    ['/app/../login'],
    ['/app/./x'],
    ['/login'],
    ['/design-system'],
    ['/application'],
    ['/app\u0000/x'],
    ['app/comptabilite'],
  ])('refuses anything else: %s → /app', (value) => {
    expect(safeReturnUrl(value)).toBe('/app');
  });
});
