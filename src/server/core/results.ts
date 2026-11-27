import { reddit, redis } from '@devvit/web/server';
import type {
  CompleteResponse,
  FieldView,
  FlairStatus,
  LeaderboardResponse,
  LeaderboardRow,
  ResultView,
} from '../../shared/api';
import { decodeMoves, encodeMoves, parseMoves, replay } from '../../shared/moves';
import type { PostInfo } from '../../shared/postdata';
import {
  bucketFor,
  decodeScore,
  DIST_BUCKETS,
  encodeScore,
  standingText,
  TIME_CAP_MS,
} from '../../shared/score';
import { shareGrid } from '../../shared/share';
import { flairTier, type StreakState } from '../../shared/streak';
import { loadSkips, type AppConfig } from './config';
import { ApiError } from './errors';
import { applyFlair } from './flair';
import { K } from './keys';
import { countEvent } from './track';
import { extendStreak, loadUser, streakView, type Player } from './users';

export interface StoredResult {
  folds: number;
  ms: number;
  /** Encoded fold list (see `encodeMoves`). */
  moves: string;
}

const LEADERBOARD_ROWS = 10;
/** Used only when the server never saw the first fold: nobody folds faster than this. */
const MIN_MS_PER_FOLD = 300;

export const packResult = (result: StoredResult): string =>
  `${result.folds}|${result.ms}|${result.moves}`;

export function unpackResult(raw: string | null | undefined): StoredResult | null {
  if (!raw) return null;
  const [folds, ms, moves] = raw.split('|');
  const foldCount = Number(folds);
  const time = Number(ms);
  if (!Number.isInteger(foldCount) || foldCount < 1 || !Number.isFinite(time) || moves === undefined)
    return null;
  return { folds: foldCount, ms: time, moves };
}

export const loadResult = async (board: string, userId: string): Promise<StoredResult | null> =>
  unpackResult(await redis.hGet(K.result(board), userId));

export function resultView(info: PostInfo, stored: StoredResult): ResultView {
  let grid = '';
  try {
    grid = shareGrid(info.puzzle, decodeMoves(stored.moves));
  } catch {
    // A stored list always replays; an empty grid is the safe answer if it ever does not.
  }
  return { folds: stored.folds, ms: stored.ms, par: info.puzzle.par, moves: stored.moves, grid };
}

/** The first fold starts the clock, once. Reloading the post never restarts it. */
export async function startAttempt(board: string, userId: string, now: number): Promise<number> {
  await redis.hSetNX(K.start(board), userId, String(now));
  const stored = Number(await redis.hGet(K.start(board), userId));
  return Number.isFinite(stored) && stored > 0 ? stored : now;
}

export async function fieldView(board: string, scoredName: string | null): Promise<FieldView | null> {
  const stats = await Promise.all([
    redis.zCard(K.lb(board)),
    redis.hGetAll(K.dist(board)),
    scoredName ? redis.zRank(K.lb(board), scoredName) : Promise.resolve(undefined),
  ]).catch((error: unknown) => {
    console.warn('Leaderboard comparison could not be loaded:', error);
    return null;
  });
  if (!stats) return null;
  const [total, rawDist, rank] = stats;
  const dist: number[] = [];
  for (let bucket = 0; bucket < DIST_BUCKETS; bucket++)
    dist.push(Math.max(0, Number(rawDist?.[String(bucket)] ?? 0) || 0));
  const place = typeof rank === 'number' ? rank : null;
  return {
    total,
    rank: place,
    dist,
    standing: place === null ? null : standingText(place, Math.max(total, place + 1)),
  };
}

export interface CompleteInput {
  info: PostInfo;
  board: string;
  player: Player;
  today: string;
  now: number;
  config: AppConfig;
}

/**
 * Scores a finished attempt. The fold list is replayed with the same engine the
 * client uses, the fold count is the server's own, and the first completion per
 * player wins an HSETNX; every later one is practice.
 */
export async function completeAttempt(input: CompleteInput, body: unknown): Promise<CompleteResponse> {
  const { info, board, player, today, now, config } = input;
  const request = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (request.rev !== info.rev)
    throw new ApiError(409, 'stale', 'This puzzle was replaced. Reload the post to play the new one.');
  const moves = parseMoves(request.moves);
  if (!moves) throw new ApiError(400, 'invalid-moves', 'That fold list could not be read.');
  let solved: boolean;
  try {
    solved = replay(info.puzzle, moves).solved;
  } catch {
    throw new ApiError(400, 'invalid-moves', 'That fold list contains a fold the paper cannot make.');
  }
  if (!solved) throw new ApiError(400, 'unsolved', 'Those folds do not fill the silhouette.');

  const folds = moves.length;
  const startedAt = Number(await redis.hGet(K.start(board), player.id));
  const clientMs = typeof request.clientMs === 'number' && Number.isFinite(request.clientMs) ? request.clientMs : 0;
  const elapsed =
    Number.isFinite(startedAt) && startedAt > 0
      ? now - startedAt
      : Math.max(clientMs, folds * MIN_MS_PER_FOLD);
  const ms = Math.max(0, Math.min(TIME_CAP_MS, Math.round(elapsed)));
  const attempt: StoredResult = { folds, ms, moves: encodeMoves(moves) };

  const skips = await loadSkips();
  const practiceOnly = info.kind === 'daily' && skips.has(info.date);
  const won =
    !practiceOnly && (await redis.hSetNX(K.result(board), player.id, packResult(attempt))) === 1;

  if (won) {
    await Promise.all([
      redis.zAdd(K.lb(board), { member: player.name, score: encodeScore(folds, ms) }),
      redis.hIncrBy(K.dist(board), String(bucketFor(folds, info.puzzle.par)), 1),
      countEvent(today, 'attempt_complete').catch((error: unknown) =>
        console.warn('Solve analytics could not be recorded:', error)
      ),
    ]);
  }

  let streakExtended = false;
  let newTier: string | null = null;
  let flairStatus: FlairStatus = 'unchanged';
  let streak: StreakState | null = null;
  try {
    // Streaks are secondary to the saved result and its leaderboard entry.
    if (won && info.kind === 'daily' && info.date === today) {
      const { before, after } = await extendStreak(player, info.date, skips);
      streak = after;
      streakExtended = after.last === info.date && before.last !== info.date;
      const tier = flairTier(after.best);
      if (tier && tier.id !== flairTier(before.best)?.id) newTier = tier.name;
      flairStatus = await applyFlair(player, after.best, config).catch((error: unknown) => {
        console.warn('Streak flair could not be loaded:', error);
        return 'unavailable' as const;
      });
    } else streak = (await loadUser(player.id)).streak;
  } catch (error) {
    console.warn('Streak could not be confirmed:', error);
  }

  const stored = won ? attempt : ((await loadResult(board, player.id)) ?? attempt);
  const response: CompleteResponse = {
    type: 'complete',
    scored: won,
    result: resultView(info, stored),
    attempt: { folds, ms },
    streak: streak ? streakView(streak, today, skips) : null,
    field: await fieldView(board, practiceOnly ? null : player.name),
    streakExtended,
    newTier,
    flairStatus,
  };
  if (!won) response.reason = practiceOnly ? 'skipped' : 'practice';
  return response;
}

async function avatarsFor(names: string[]): Promise<Map<string, string>> {
  const avatars = new Map<string, string>();
  if (names.length === 0) return avatars;
  const cached = await redis.hMGet(K.avatars, names);
  const missing: string[] = [];
  names.forEach((name, index) => {
    const url = cached[index];
    if (typeof url === 'string') avatars.set(name, url);
    else missing.push(name);
  });
  if (missing.length > 0) {
    const fetched = await Promise.all(
      missing.map(async (name) => {
        try {
          return (await reddit.getSnoovatarUrl(name)) ?? '';
        } catch {
          return '';
        }
      })
    );
    const update: Record<string, string> = {};
    missing.forEach((name, index) => {
      const url = fetched[index] ?? '';
      avatars.set(name, url);
      update[name] = url;
    });
    await redis.hSet(K.avatars, update).catch(() => undefined);
  }
  return avatars;
}

export async function leaderboard(board: string, player: Player | null): Promise<LeaderboardResponse> {
  const [top, total] = await Promise.all([
    redis.zRange(K.lb(board), 0, LEADERBOARD_ROWS - 1, { by: 'rank' }),
    redis.zCard(K.lb(board)),
  ]);
  const avatars = await avatarsFor(top.map((entry) => entry.member));
  const rows: LeaderboardRow[] = top.map((entry, index) => ({
    rank: index + 1,
    name: entry.member,
    ...decodeScore(entry.score),
    avatar: avatars.get(entry.member) || null,
    me: entry.member === player?.name,
  }));
  let me: LeaderboardRow | null = null;
  if (player && !rows.some((row) => row.me)) {
    const [rank, score] = await Promise.all([
      redis.zRank(K.lb(board), player.name),
      redis.zScore(K.lb(board), player.name),
    ]);
    if (typeof rank === 'number' && typeof score === 'number')
      me = { rank: rank + 1, name: player.name, ...decodeScore(score), avatar: null, me: true };
  }
  return { type: 'leaderboard', total, rows, me };
}
