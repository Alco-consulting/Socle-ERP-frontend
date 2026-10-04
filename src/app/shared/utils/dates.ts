/**
 * « 2026-10-04 »: the browser's day (local time, never UTC), as the API writes a date. A date
 * the user would see as theirs: an entry's date, a reversal's, the dashboard's balances.
 */
export function localToday(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
