import { APP_ROOT } from '../navigation/applications';

/**
 * The page to open after login (`?retour=`), only if it is a page of the application's
 * authenticated area: `/app` or `/app/…`. Anything else — another site (`https://…`,
 * `//host`), a backslash trick, a `..` segment, control characters, `/login` itself — gives
 * `/app`. Never an open redirect.
 */
export function safeReturnUrl(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return APP_ROOT;
  }
  if (value.includes('\\') || [...value].some((char) => char.charCodeAt(0) < 0x20)) {
    return APP_ROOT;
  }
  const path = value.split(/[?#]/)[0];
  if (path.split('/').some((segment) => segment === '..' || segment === '.')) {
    return APP_ROOT;
  }
  return path === APP_ROOT || path.startsWith(`${APP_ROOT}/`) ? value : APP_ROOT;
}
