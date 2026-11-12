// The theme chosen on this device, applied before the first paint: no flash of the other
// theme while the application loads. A file, not an inline script, so that a strict
// Content-Security-Policy (script-src 'self') allows it. Loaded synchronously in <head>,
// before the styles. Same key and rule as ThemeService (src/app/core/theme/theme.service.ts):
// 'light' or 'dark' sets data-theme; anything else, or a storage that fails, leaves the
// device's setting.
(function () {
  try {
    var preference = window.localStorage.getItem('alco.theme');
    if (preference === 'light' || preference === 'dark') {
      document.documentElement.setAttribute('data-theme', preference);
    }
  } catch (error) {
    // Private window or blocked storage: the device's setting.
  }
})();
