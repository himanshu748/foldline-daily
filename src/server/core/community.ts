import { reddit, redis } from '@devvit/web/server';
import type { RouteRow, RoutesResponse, RouteSubmitResponse } from '../../shared/api';
import { addDays, weekdayIndex, weekKey } from '../../shared/dates';
import { ROUTE_RULES } from '../../shared/difficulty';
import type { PostInfo } from '../../shared/postdata';
import {
  decodeAngles,
  decodeTurns,
  encodeAngles,
  encodeTurns,
  puzzleSignature,
  type Puzzle,
} from '../../shared/puzzle';
import { validatePuzzle, type ValidationReason } from '../../shared/validate';
import { ApiError } from './errors';
import { K } from './keys';
import { isPostId, publishPost, type PostId } from './postinfo';
import type { Player } from './users';

/** Routes considered when Sunday's post is created (newest first). */
const MAX_CANDIDATES = 100;
const MAX_LISTED = 50;

interface RouteRecord {
  /** Author name and id. */
  a: string;
  u: string;
  t: string;
  s: string;
  g: string;
  p: number;
  /** Submission time (ms) and permalink. */
  at: number;
  l: string;
}

/**
 * The Sunday a route submitted on `today` competes for. Sunday's puzzle is
 * chosen when that day starts, so routes made on a Sunday go to the next one.
 */
export const targetSunday = (today: string): string =>
  addDays(weekKey(weekdayIndex(today) === 6 ? addDays(today, 1) : today), 6);

const weekOf = (sunday: string): string => weekKey(sunday);

const REASON_TEXT: Record<ValidationReason, string> = {
  shape: 'That is not a valid strip.',
  'already-solved': 'The start already matches the target.',
  unsolvable: 'The target cannot be reached from the start.',
  'par-mismatch': 'Par could not be proven for this route.',
  'multiple-answers': 'More than one fold fills this target.',
  'overlap-start': 'Panels overlap in the start shape.',
  'overlap-goal': 'Panels overlap in the target shape.',
  'overlap-path': 'The shortest solution passes through overlapping panels.',
  'look-alike': 'Another fold looks too much like this target.',
  'par-range': `Par must be ${ROUTE_RULES.minPar} or more.`,
};

function parseRecord(raw: string | undefined): RouteRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<RouteRecord>;
    if (
      typeof value.a !== 'string' ||
      typeof value.u !== 'string' ||
      typeof value.t !== 'string' ||
      typeof value.s !== 'string' ||
      typeof value.g !== 'string' ||
      typeof value.p !== 'number' ||
      typeof value.at !== 'number'
    )
      return null;
    return { ...(value as RouteRecord), l: typeof value.l === 'string' ? value.l : '' };
  } catch {
    return null;
  }
}

function recordPuzzle(record: RouteRecord): Puzzle | null {
  const turns = decodeTurns(record.t);
  const start = decodeAngles(record.s);
  const goal = decodeAngles(record.g);
  if (!turns || !start || !goal) return null;
  const check = validatePuzzle({ turns, start, goal }, ROUTE_RULES);
  return check.ok ? { turns, start, goal, par: check.par } : null;
}

export async function submitRoute(
  player: Player,
  body: unknown,
  today: string,
  now: number
): Promise<RouteSubmitResponse> {
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const turns = decodeTurns(raw.t);
  const start = decodeAngles(raw.s);
  const goal = decodeAngles(raw.g);
  if (!turns || !start || !goal)
    throw new ApiError(400, 'route-invalid', REASON_TEXT.shape);
  const check = validatePuzzle({ turns, start, goal }, ROUTE_RULES);
  if (!check.ok) {
    const reason = check.reasons[0] ?? 'shape';
    throw new ApiError(400, 'route-invalid', REASON_TEXT[reason]);
  }
  const puzzle: Puzzle = { turns, start, goal, par: check.par };
  const signature = puzzleSignature(puzzle);
  const week = weekOf(targetSunday(today));

  if ((await redis.hSetNX(K.routesBy(week), player.id, 'pending')) !== 1)
    throw new ApiError(409, 'route-limit', 'You already have a route in the running for this Sunday.');
  if ((await redis.hSetNX(K.routeSig, signature, 'pending')) !== 1) {
    await redis.hDel(K.routesBy(week), [player.id]);
    throw new ApiError(409, 'route-duplicate', 'Someone has already submitted this exact route.');
  }

  const info: PostInfo = {
    kind: 'route',
    date: today,
    day: 0,
    rev: 0,
    tier: 6,
    puzzle,
    source: 'community',
    author: player.name,
  };
  try {
    const post = await publishPost(info, {
      text: `A Foldline Community Route by u/${player.name}: ${turns.length} panels, par ${puzzle.par}.`,
    });
    const record: RouteRecord = {
      a: player.name,
      u: player.id,
      t: encodeTurns(turns),
      s: encodeAngles(start),
      g: encodeAngles(goal),
      p: puzzle.par,
      at: now,
      l: post.permalink,
    };
    await Promise.all([
      redis.hSet(K.routes(week), { [post.id]: JSON.stringify(record) }),
      redis.hSet(K.routesBy(week), { [player.id]: post.id }),
      redis.hSet(K.routeSig, { [signature]: post.id }),
      redis.hSet(K.routePost, { [post.id]: week }),
    ]);
    return {
      type: 'route',
      postId: post.id,
      url: `https://www.reddit.com${post.permalink}`,
      par: puzzle.par,
      // Until the app is approved, Reddit posts from the app account for everyone but its owner.
      asUser: post.authorName === player.name,
    };
  } catch (error) {
    await Promise.all([
      redis.hDel(K.routesBy(week), [player.id]),
      redis.hDel(K.routeSig, [signature]),
    ]);
    if (error instanceof ApiError) throw error;
    console.error('Community Route could not be posted:', error);
    throw new ApiError(502, 'route-failed', 'Reddit did not accept the post. Please try again.');
  }
}

export async function listRoutes(today: string, userId: string | undefined): Promise<RoutesResponse> {
  const sunday = targetSunday(today);
  const all = (await redis.hGetAll(K.routes(weekOf(sunday)))) ?? {};
  const routes: Array<RouteRow & { at: number }> = [];
  for (const [postId, raw] of Object.entries(all)) {
    const record = parseRecord(raw);
    if (!record) continue;
    routes.push({
      postId,
      author: record.a,
      par: record.p,
      panels: record.t.length,
      url: record.l ? `https://www.reddit.com${record.l}` : '',
      mine: record.u === userId,
      at: record.at,
    });
  }
  routes.sort((a, b) => b.at - a.at);
  return {
    type: 'routes',
    sunday,
    routes: routes.slice(0, MAX_LISTED).map(({ at: _at, ...row }) => row),
  };
}

export interface RoutePick {
  puzzle: Puzzle;
  author: string;
  postId: PostId;
}

/**
 * Sunday's Community Route: the week's most-upvoted route that still exists and
 * still validates. Ties go to the earliest submission. The app only reads the
 * score; it never votes.
 */
export async function pickRoute(sunday: string): Promise<RoutePick | null> {
  const all = (await redis.hGetAll(K.routes(weekOf(sunday)))) ?? {};
  const records = Object.entries(all)
    .map(([postId, raw]) => ({ postId, record: parseRecord(raw) }))
    .filter((entry): entry is { postId: PostId; record: RouteRecord } =>
      Boolean(entry.record) && isPostId(entry.postId)
    )
    .sort((a, b) => b.record.at - a.record.at)
    .slice(0, MAX_CANDIDATES);

  const scored = await Promise.all(
    records.map(async ({ postId, record }) => {
      const puzzle = recordPuzzle(record);
      if (!puzzle) return null;
      try {
        const post = await reddit.getPostById(postId);
        if (post.removed || post.spam || post.isRemoved() || post.isSpam()) return null;
        return { postId, puzzle, author: record.a, at: record.at, score: post.score };
      } catch (error) {
        console.warn(`Route ${postId} could not be read:`, error);
        return null;
      }
    })
  );
  const best = scored
    .filter((entry) => entry !== null)
    .sort((a, b) => b.score - a.score || a.at - b.at)[0];
  return best ? { puzzle: best.puzzle, author: best.author, postId: best.postId } : null;
}

/** Removes a deleted route from every index, so deleted content is never reused. */
export async function forgetRoute(postId: string): Promise<boolean> {
  const week = await redis.hGet(K.routePost, postId);
  if (!week) return false;
  const record = parseRecord(await redis.hGet(K.routes(week), postId));
  const cleanup: Array<Promise<unknown>> = [
    redis.hDel(K.routes(week), [postId]),
    redis.hDel(K.routePost, [postId]),
  ];
  if (record) {
    cleanup.push(redis.hDel(K.routesBy(week), [record.u]));
    cleanup.push(redis.hDel(K.routeSig, [`${record.t}|${record.s}|${record.g}`]));
  }
  await Promise.all(cleanup);
  return true;
}
