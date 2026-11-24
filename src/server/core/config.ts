import { redis, settings } from '@devvit/web/server';
import { dateKeyInZone, isDateKey, isValidTimeZone } from '../../shared/dates';
import { K } from './keys';

export interface AppConfig {
  /** IANA zone that decides when a date's puzzle is released. */
  timeZone: string;
  /** Day 1, or '' to use the install date. */
  startDate: string;
  routesEnabled: boolean;
  flairEnabled: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  timeZone: 'UTC',
  startDate: '',
  routesEnabled: true,
  flairEnabled: true,
};

export async function loadConfig(): Promise<AppConfig> {
  let raw: Record<string, unknown> = {};
  try {
    raw = (await settings.getAll()) as Record<string, unknown>;
  } catch (error) {
    console.warn('Settings unavailable, using defaults:', error);
  }
  const zone = typeof raw.timezone === 'string' ? raw.timezone.trim() : '';
  const start = typeof raw.startDate === 'string' ? raw.startDate.trim() : '';
  return {
    timeZone: isValidTimeZone(zone) ? zone : DEFAULT_CONFIG.timeZone,
    startDate: isDateKey(start) ? start : '',
    routesEnabled: raw.communityRoutes !== false,
    flairEnabled: raw.streakFlair !== false,
  };
}

export const todayKey = (config: AppConfig, now: number): string =>
  dateKeyInZone(now, config.timeZone);

/** Day 1: the moderator's start date, or the date the app was installed. */
export async function startDateFor(config: AppConfig, today: string): Promise<string> {
  if (config.startDate) return config.startDate;
  const stored = await redis.hGet(K.config, 'installDate');
  if (isDateKey(stored)) return stored;
  await redis.hSetNX(K.config, 'installDate', today);
  const winner = await redis.hGet(K.config, 'installDate');
  return isDateKey(winner) ? winner : today;
}

export async function loadSkips(): Promise<Set<string>> {
  const all = await redis.hGetAll(K.skip);
  return new Set(Object.keys(all ?? {}));
}

export const isSkipped = async (date: string): Promise<boolean> =>
  Boolean(await redis.hGet(K.skip, date));

export async function setSkipped(date: string, skipped: boolean): Promise<void> {
  if (skipped) await redis.hSet(K.skip, { [date]: '1' });
  else await redis.hDel(K.skip, [date]);
}
