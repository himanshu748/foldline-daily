import { redis } from '@devvit/web/server';
import type { StreakView } from '../../shared/api';
import {
  EMPTY_STREAK,
  flairTier,
  liveStreak,
  nextFlairTier,
  recordSolve,
  type StreakState,
} from '../../shared/streak';
import { isDateKey } from '../../shared/dates';
import { K } from './keys';

export interface Player {
  id: string;
  name: string;
}

export interface UserRecord {
  streak: StreakState;
  flairOptIn: boolean;
  /** Id of the flair tier this app last set for the player, or ''. */
  flairTier: string;
  subscribed: boolean;
}

const count = (value: string | undefined): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
};

export async function loadUser(userId: string): Promise<UserRecord> {
  const raw = (await redis.hGetAll(K.user(userId))) ?? {};
  return {
    streak: {
      cur: count(raw.cur),
      best: count(raw.best),
      last: isDateKey(raw.last) ? raw.last : '',
      grace: isDateKey(raw.grace) ? raw.grace : '',
    },
    flairOptIn: raw.flairOptIn === '1',
    flairTier: raw.flairTier ?? '',
    subscribed: raw.subscribed === '1',
  };
}

export const EMPTY_USER: UserRecord = {
  streak: EMPTY_STREAK,
  flairOptIn: false,
  flairTier: '',
  subscribed: false,
};

export function streakView(streak: StreakState, today: string, skips: Set<string>): StreakView {
  const next = nextFlairTier(streak.best);
  return {
    current: liveStreak(streak, today, (date) => skips.has(date)),
    best: streak.best,
    tier: flairTier(streak.best)?.name ?? null,
    nextTier: next ? { name: next.name, days: next.days } : null,
  };
}

/**
 * Applies a solve of `date` to the player's streak. Only the request that won
 * the player's HSETNX for that day calls this, so the hash has one writer.
 */
export async function extendStreak(
  player: Player,
  date: string,
  skips: Set<string>
): Promise<{ before: StreakState; after: StreakState }> {
  const before = (await loadUser(player.id)).streak;
  const after = recordSolve(before, date, (day) => skips.has(day));
  if (after !== before) {
    await redis.hSet(K.user(player.id), {
      cur: String(after.cur),
      best: String(after.best),
      last: after.last,
      grace: after.grace,
      name: player.name,
    });
  }
  return { before, after };
}
