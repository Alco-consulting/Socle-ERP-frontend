/**
 * Development proxy (`ng serve`): the browser only talks to http://localhost:4200, which
 * forwards `/api/…` to the API. Same origin for the browser, so the Django session cookie
 * and the `XSRF-TOKEN` cookie work exactly as in production behind the reverse proxy — no
 * CORS needed.
 *
 * - Target: `ALCO_API_TARGET` (default: the deployed API). A local backend:
 *   `ALCO_API_TARGET=http://localhost:8000 npm run start:api`.
 * - The server still checks the CSRF Origin: http://localhost:4200 must be in its
 *   `DJANGO_CSRF_TRUSTED_ORIGINS` (done on the deployed API, default in `config.settings.local`).
 * - Development only: it never relaxes a protection of the server.
 */
const target = process.env['ALCO_API_TARGET'] ?? 'https://api.alcoconsulting.tech';

export default {
  '/api': {
    target,
    secure: true,
    changeOrigin: true,
    logLevel: 'warn',
  },
};
