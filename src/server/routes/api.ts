import { Hono } from 'hono';
import { context, reddit, redis } from '@devvit/web/server';
import type {
  ErrorResponse,
  FlairResponse,
  InitResponse,
  StartResponse,
  SubscribeResponse,
} from '../../shared/api';
import { addDays, msUntilNextDate, weekKey } from '../../shared/dates';
import { toPostWire } from '../../shared/postdata';
import { listRoutes, submitRoute, targetSunday } from '../core/community';
import { loadConfig, loadSkips, todayKey } from '../core/config';
import { ApiError } from '../core/errors';
import { setFlairOptIn } from '../core/flair';
import { boardFor, K } from '../core/keys';
import { loadPostInfo } from '../core/postinfo';
import {
  completeAttempt,
  fieldView,
  leaderboard,
  loadResult,
  resultView,
  startAttempt,
} from '../core/results';
import { shareResult } from '../core/share';
import { countOnce, track } from '../core/track';
import { EMPTY_USER, loadUser, streakView, type Player } from '../core/users';

export const api = new Hono();

api.onError((error, c) => {
  if (error instanceof ApiError)
    return c.json<ErrorResponse>(
      { status: 'error', code: error.code, message: error.message },
      error.status
    );
  console.error('API error:', error);
  return c.json<ErrorResponse>(
    { status: 'error', code: 'server', message: 'Something went wrong. Please try again.' },
    500
  );
});

async function currentPlayer(): Promise<Player | null> {
  const id = context.userId;
  if (!id) return null;
  const name = context.username ?? (await reddit.getCurrentUsername());
  return name ? { id, name } : null;
}

async function requirePlayer(): Promise<Player> {
  const player = await currentPlayer();
  if (!player) throw new ApiError(401, 'login', 'Log in to Reddit to save your result.');
  return player;
}

/** Everything a request needs to know about the post it came from. */
async function session() {
  const postId = context.postId;
  if (!postId) throw new ApiError(400, 'no-post', 'This game only runs inside a Reddit post.');
  const [config, info] = await Promise.all([
    loadConfig(),
    loadPostInfo(postId, context.postData),
  ]);
  if (!info) throw new ApiError(404, 'no-puzzle', 'This post has no puzzle.');
  const now = Date.now();
  return { postId, config, info, now, today: todayKey(config, now), board: boardFor(info, postId) };
}

const readBody = async (request: { json: () => Promise<unknown> }): Promise<unknown> =>
  request.json().catch(() => null);

api.get('/init', async (c) => {
  const s = await session();
  const player = await currentPlayer();
  const isToday = s.info.kind === 'daily' && s.info.date === s.today;
  const routeWeek = weekKey(targetSunday(s.today));

  const [user, stored, startRaw, skips, shared, route] = await Promise.all([
    player ? loadUser(player.id) : EMPTY_USER,
    player ? loadResult(s.board, player.id) : null,
    player ? redis.hGet(K.start(s.board), player.id) : undefined,
    loadSkips(),
    player ? redis.hGet(K.shared(s.board), player.id) : undefined,
    player ? redis.hGet(K.routesBy(routeWeek), player.id) : undefined,
  ]);
  const field = await fieldView(s.board, player && stored ? player.name : null);

  // A player who solved yesterday and opens today's puzzle has come back.
  if (player && isToday && user.streak.last === addDays(s.today, -1))
    await countOnce(s.today, player.id, 'return_next_day');

  const startedAt = Number(startRaw);
  return c.json<InitResponse>({
    type: 'init',
    post: toPostWire(s.info),
    postId: s.postId,
    subreddit: context.subredditName,
    user: { loggedIn: Boolean(player), name: player?.name ?? null },
    today: s.today,
    now: s.now,
    isToday,
    skipped: s.info.kind === 'daily' && skips.has(s.info.date),
    nextPuzzleInMs: msUntilNextDate(s.now, s.config.timeZone),
    startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : null,
    result: stored ? resultView(s.info, stored) : null,
    streak: streakView(user.streak, s.today, skips),
    field,
    flair: { enabled: s.config.flairEnabled, optedIn: user.flairOptIn },
    routes: { enabled: s.config.routesEnabled, submitted: Boolean(route) },
    subscribed: user.subscribed,
    shared: Boolean(shared),
  });
});

api.post('/attempt/start', async (c) => {
  const s = await session();
  const player = await currentPlayer();
  // Logged-out players can still play; their clock simply is not kept on the server.
  const startedAt = player ? await startAttempt(s.board, player.id, s.now) : s.now;
  return c.json<StartResponse>({ type: 'start', startedAt });
});

api.post('/attempt/complete', async (c) => {
  const s = await session();
  const player = await requirePlayer();
  const body = await readBody(c.req);
  return c.json(
    await completeAttempt(
      { info: s.info, board: s.board, player, today: s.today, now: s.now, config: s.config },
      body
    )
  );
});

api.get('/leaderboard', async (c) => {
  const s = await session();
  return c.json(await leaderboard(s.board, await currentPlayer()));
});

api.post('/share', async (c) => {
  const s = await session();
  const player = await requirePlayer();
  return c.json(await shareResult(s.info, s.postId, s.board, player, s.today));
});

api.post('/subscribe', async (c) => {
  const player = await requirePlayer();
  try {
    await reddit.subscribeToCurrentSubreddit();
  } catch (error) {
    console.error('Subscribe failed:', error);
    throw new ApiError(502, 'subscribe-failed', 'Reddit could not add you to the community.');
  }
  // Reddit has no API to read subscription state, so remember it for the end card.
  await redis.hSet(K.user(player.id), { subscribed: '1', name: player.name });
  return c.json<SubscribeResponse>({ type: 'subscribe', subscribed: true });
});

api.post('/flair', async (c) => {
  const player = await requirePlayer();
  const body = (await readBody(c.req)) as { optIn?: unknown } | null;
  const result = await setFlairOptIn(player, body?.optIn === true, await loadConfig());
  return c.json<FlairResponse>({ type: 'flair', ...result });
});

api.post('/track', async (c) => {
  const body = await readBody(c.req);
  const config = await loadConfig();
  return c.json(await track(body, context.userId, todayKey(config, Date.now())));
});

api.post('/route/submit', async (c) => {
  const s = await session();
  const player = await requirePlayer();
  if (!s.config.routesEnabled)
    throw new ApiError(403, 'routes-off', 'Community Routes are turned off in this community.');
  // The editor unlocks on the end card, so a route always comes from someone who has solved a puzzle.
  if (!(await loadResult(s.board, player.id)))
    throw new ApiError(403, 'solve-first', 'Solve this puzzle first, then build a route.');
  return c.json(await submitRoute(player, await readBody(c.req), s.today, s.now));
});

api.get('/routes', async (c) => {
  const config = await loadConfig();
  return c.json(await listRoutes(todayKey(config, Date.now()), context.userId));
});
