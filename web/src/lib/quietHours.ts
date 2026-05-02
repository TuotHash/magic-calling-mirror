/**
 * "Quiet hours" window math. Times are "HH:MM" strings in the local
 * timezone; the window may wrap past midnight (e.g. 22:00 → 08:00 means
 * 22:00–23:59 OR 00:00–07:59 are quiet).
 *
 * The end is exclusive — a window of 22:00 → 22:00 means "never quiet"
 * rather than "always quiet" (zero-length, easier to reason about than
 * the alternative).
 */

function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function inQuietHours(now: Date, from: string, until: string): boolean {
  const f = parseHHMM(from);
  const u = parseHHMM(until);
  if (f === null || u === null || f === u) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  // Non-wrapping window (e.g. 09:00 → 17:00).
  if (f < u) return cur >= f && cur < u;
  // Wrapping window (e.g. 22:00 → 08:00).
  return cur >= f || cur < u;
}
