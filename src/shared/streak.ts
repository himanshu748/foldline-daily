import { addDays, diffDays, isDateKey } from './dates';

/** Stored per player. Empty strings mean "never". */
export interface StreakState {
  cur: number;
  best: number;
  /** Date of the last solve that counted. */
  last: string;
  /** The missed day most recently forgiven by the grace rule. */
  grace: string;
}

export const EMPTY_STREAK: StreakState = { cur: 0, best: 0, last: '', grace: '' };

/** A forgiven day blocks further forgiveness for this many following days. */
export const GRACE_WINDOW_DAYS = 6;
const MAX_GAP_DAYS = 60;

export type SkipCheck = (date: string) => boolean;

/** Days strictly between two dates that had a puzzle (moderator-skipped days never count). */
function missedDays(last: string, date: string, isSkipped: SkipCheck): string[] {
  const missed: string[] = [];
  const gap = diffDays(last, date);
  if (gap > MAX_GAP_DAYS) return [last, last];
  for (let offset = 1; offset < gap; offset++) {
    const day = addDays(last, offset);
    if (!isSkipped(day)) missed.push(day);
  }
  return missed;
}

const graceAvailable = (grace: string, missedDay: string): boolean =>
  !grace || diffDays(grace, missedDay) > GRACE_WINDOW_DAYS;

/**
 * The streak after solving `date`'s puzzle on its own day.
 *
 * Grace rule: one missed day is forgiven, as long as no other missed day was
 * forgiven in the six days before it. Two missed days in a row, or a second
 * miss inside that window, reset the streak to 1.
 */
export function recordSolve(
  state: StreakState,
  date: string,
  isSkipped: SkipCheck = () => false
): StreakState {
  if (!isDateKey(date)) throw new RangeError('Use a real calendar date in YYYY-MM-DD format.');
  if (state.last && diffDays(state.last, date) <= 0) return state;
  let cur = 1;
  let grace = state.grace;
  if (state.last) {
    const missed = missedDays(state.last, date, isSkipped);
    if (missed.length === 0) cur = state.cur + 1;
    else if (missed.length === 1 && graceAvailable(state.grace, missed[0]!)) {
      cur = state.cur + 1;
      grace = missed[0]!;
    }
  }
  return { cur, best: Math.max(state.best, cur), last: date, grace };
}

/** The streak to show today: still alive if today can extend it, otherwise 0. */
export function liveStreak(
  state: StreakState,
  today: string,
  isSkipped: SkipCheck = () => false
): number {
  if (!state.last || !isDateKey(today)) return 0;
  if (diffDays(state.last, today) <= 0) return state.cur;
  const missed = missedDays(state.last, today, isSkipped);
  if (missed.length === 0) return state.cur;
  if (missed.length === 1 && graceAvailable(state.grace, missed[0]!)) return state.cur;
  return 0;
}

export interface FlairTier {
  id: 'crease' | 'pleat' | 'origami';
  name: string;
  days: number;
}

export const FLAIR_TIERS: readonly FlairTier[] = [
  { id: 'crease', name: 'Crease', days: 3 },
  { id: 'pleat', name: 'Pleat', days: 7 },
  { id: 'origami', name: 'Origami', days: 30 },
];

/** Tiers follow the best streak ever reached, so they never go down. */
export function flairTier(best: number): FlairTier | null {
  let earned: FlairTier | null = null;
  for (const tier of FLAIR_TIERS) if (best >= tier.days) earned = tier;
  return earned;
}

export const nextFlairTier = (best: number): FlairTier | null =>
  FLAIR_TIERS.find((tier) => best < tier.days) ?? null;
