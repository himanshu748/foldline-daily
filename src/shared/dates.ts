/**
 * Calendar-date helpers. A date key is always `yyyy-mm-dd`. Puzzle content,
 * weekday tiers and streak arithmetic treat keys as UTC dates. The only place a
 * timezone appears is in deciding which key is "today" for a community.
 */
export const DAY_MS = 86_400_000;

/** Ported from Foldline (WebXR), `src/game/progress.ts` (`isCalendarDay`). */
export function isDateKey(key: unknown): key is string {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const time = Date.parse(`${key}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === key;
}

export function dateKeyToMs(key: string): number {
  if (!isDateKey(key)) throw new RangeError('Use a real calendar date in YYYY-MM-DD format.');
  return Date.parse(`${key}T00:00:00Z`);
}

export const msToDateKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export const addDays = (key: string, days: number): string =>
  msToDateKey(dateKeyToMs(key) + days * DAY_MS);

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export const diffDays = (from: string, to: string): number =>
  Math.round((dateKeyToMs(to) - dateKeyToMs(from)) / DAY_MS);

export const epochDay = (key: string): number => Math.floor(dateKeyToMs(key) / DAY_MS);

/** 0 is Monday, 6 is Sunday. */
export const weekdayIndex = (key: string): number =>
  (new Date(dateKeyToMs(key)).getUTCDay() + 6) % 7;

/** The Monday that starts the key's week. Used as the week identifier. */
export const weekKey = (key: string): string => addDays(key, -weekdayIndex(key));

/** Day 1 is the start date itself. */
export const dayNumber = (startKey: string, key: string): number => diffDays(startKey, key) + 1;

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function zoneParts(nowMs: number, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(nowMs));
  const result: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') result[part.type] = Number(part.value);
  }
  return result;
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** The calendar date at `nowMs` in the given IANA zone. */
export function dateKeyInZone(nowMs: number, timeZone = 'UTC'): string {
  if (!Number.isFinite(nowMs)) throw new RangeError('Daily puzzles need a valid time.');
  if (timeZone === 'UTC') return msToDateKey(nowMs);
  const p = zoneParts(nowMs, timeZone);
  return `${pad(p.year ?? 0, 4)}-${pad(p.month ?? 0)}-${pad(p.day ?? 0)}`;
}

/** Milliseconds until the date changes in the zone (the next puzzle release). */
export function msUntilNextDate(nowMs: number, timeZone = 'UTC'): number {
  if (timeZone === 'UTC') return DAY_MS - (((nowMs % DAY_MS) + DAY_MS) % DAY_MS);
  const p = zoneParts(nowMs, timeZone);
  const elapsed =
    ((p.hour ?? 0) * 3600 + (p.minute ?? 0) * 60 + (p.second ?? 0)) * 1000 + (nowMs % 1000);
  let remaining = DAY_MS - elapsed;
  const today = dateKeyInZone(nowMs, timeZone);
  // Daylight-saving days are 23 or 25 hours long, so correct by the hour if needed.
  if (dateKeyInZone(nowMs + remaining, timeZone) === today) remaining += 3_600_000;
  else if (remaining > 3_600_000 && dateKeyInZone(nowMs + remaining - 3_600_000, timeZone) !== today)
    remaining -= 3_600_000;
  return Math.max(1000, remaining);
}
