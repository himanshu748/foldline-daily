import { readFileSync } from 'node:fs';
import { Context, runWithContext } from '@devvit/server';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { reddit, redis } from '@devvit/web/server';
import { Header } from '@devvit/shared-types/Header.js';
import { describe, expect, vi } from 'vitest';
import type { FoldMove } from '../../shared/engine';
import { generate } from '../../shared/generator';
import { puzzleHook } from '../../shared/hooks';
import { movesToWire } from '../../shared/moves';
import { parsePostWire, toPostWire, type PostInfo } from '../../shared/postdata';
import { encodeAngles, encodeTurns, puzzleSignature } from '../../shared/puzzle';
import { validatePuzzle } from '../../shared/validate';
import { app } from '../app';
import { forgetRoute, listRoutes, pickRoute, submitRoute, targetSunday } from './community';
import { DEFAULT_CONFIG, setSkipped } from './config';
import { ApiError } from './errors';
import { setFlairOptIn } from './flair';
import { boardFor, dayBoard, K } from './keys';
import { ensureDailyPost, regenerateToday, replacementFor } from './posts';
import { ensureThread, loadPostInfo } from './postinfo';
import { completeAttempt, fieldView, leaderboard, loadResult, startAttempt } from './results';
import { shareResult } from './share';
import { track } from './track';
import { loadUser, type Player } from './users';

const START = '2026-11-16';
const test = createDevvitTest({ settings: { timezone: 'UTC', startDate: START } });

/** Wednesday 18 Nov 2026, noon UTC: Day 3. */
const NOW = Date.UTC(2026, 10, 18, 12);
const TODAY = '2026-11-18';
const config = { ...DEFAULT_CONFIG, startDate: START };
const alice: Player = { id: 't2_alice', name: 'alice' };

const solution = (info: PostInfo): FoldMove[] => validatePuzzle(info.puzzle).path;

/** A legal solution that wastes two folds: wiggle one hinge, then solve. */
function slowSolution(info: PostInfo): FoldMove[] {
  const first = info.puzzle.start[1] ?? 0;
  const away = first === 90 ? 0 : first + 90;
  return [
    { index: 1, angle: away as FoldMove['angle'] },
    { index: 1, angle: first },
    ...solution(info),
  ];
}

async function todaysPost(now = NOW) {
  const outcome = await ensureDailyPost(now);
  if (outcome.status !== 'created' && outcome.status !== 'exists') throw new Error(outcome.status);
  const info = await loadPostInfo(outcome.postId);
  if (!info) throw new Error('no post info');
  return { postId: outcome.postId, info, board: boardFor(info, outcome.postId) };
}

const complete = (
  info: PostInfo,
  board: string,
  player: Player,
  moves: FoldMove[],
  now = NOW,
  today = TODAY
) =>
  completeAttempt(
    { info, board, player, today, now, config },
    { rev: info.rev, moves: movesToWire(moves), clientMs: 4000 }
  );

describe('daily post job', () => {
  test('creates one post with a Day N title and the puzzle in postData', async ({ mocks }) => {
    const outcome = await ensureDailyPost(NOW);
    expect(outcome.status).toBe('created');
    if (outcome.status !== 'created') return;
    const post = await reddit.getPostById(outcome.postId);
    const expected = generate(TODAY);
    expect(post.title).toMatch(/^Day 3 · Four panels, .* · par 4$/);
    const info = parsePostWire(mocks.reddit.linksAndComments.getPostData(outcome.postId));
    expect(info?.puzzle).toEqual({
      turns: expected.turns,
      start: expected.start,
      goal: expected.goal,
      par: expected.par,
    });
    expect(info).toMatchObject({ kind: 'daily', date: TODAY, day: 3, rev: 0, tier: 2 });
    expect(await ensureDailyPost(NOW + 60_000)).toEqual({ ...outcome, status: 'exists' });
  });

  test('overlapping runs create exactly one post', async () => {
    const outcomes = await Promise.all(Array.from({ length: 20 }, () => ensureDailyPost(NOW)));
    expect(outcomes.filter((outcome) => outcome.status === 'created')).toHaveLength(1);
    expect(outcomes.every((outcome) => ['created', 'busy', 'exists'].includes(outcome.status))).toBe(true);
    expect(Object.keys(await redis.hGetAll(K.posts))).toEqual([TODAY]);
  });

  test('a failed post releases the claim so the next run retries', async () => {
    const spy = vi.spyOn(reddit, 'submitCustomPost').mockRejectedValueOnce(new Error('reddit down'));
    await expect(ensureDailyPost(NOW)).rejects.toThrow('reddit down');
    expect(await redis.hGet(K.posts, TODAY)).toBeUndefined();
    spy.mockRestore();
    expect((await ensureDailyPost(NOW + 1)).status).toBe('created');
  });

  test('keeps a confirmed daily post and recovers its puzzle when caching fails', async () => {
    const write = redis.set.bind(redis);
    const cache = vi.spyOn(redis, 'set').mockImplementation((key, value, options) =>
      key.startsWith('fl:post:') ? Promise.reject(new Error('cache unavailable')) : write(key, value, options)
    );
    const submit = vi.spyOn(reddit, 'submitCustomPost');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const outcome = await ensureDailyPost(NOW);
      expect(outcome.status).toBe('created');
      if (outcome.status !== 'created') throw new Error('Expected a confirmed daily post');
      expect(await redis.get(K.post(outcome.postId))).toBeUndefined();
      expect(await redis.hGet(K.posts, TODAY)).toBe(outcome.postId);
      expect(await loadPostInfo(outcome.postId)).toMatchObject({ date: TODAY, day: 3, rev: 0 });
      expect(await ensureDailyPost(NOW + 180_000)).toEqual({ ...outcome, status: 'exists' });
      expect(submit).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith('Published puzzle could not be cached:', expect.any(Error));
    } finally {
      warn.mockRestore();
      submit.mockRestore();
      cache.mockRestore();
    }
  });

  test('recovers a confirmed daily post when updating the post index fails', async () => {
    const write = redis.hSet.bind(redis);
    const index = vi.spyOn(redis, 'hSet').mockImplementation((key, fields) =>
      key === K.posts ? Promise.reject(new Error('post index unavailable')) : write(key, fields)
    );
    const submit = vi.spyOn(reddit, 'submitCustomPost');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const outcome = await ensureDailyPost(NOW);
      if (outcome.status !== 'created') throw new Error('Expected a confirmed daily post');
      expect(await redis.hGet(K.day(TODAY), 'postId')).toBe(outcome.postId);
      expect(await ensureDailyPost(NOW + 180_000)).toEqual({ ...outcome, status: 'exists' });
      index.mockRestore();
      expect(await ensureDailyPost(NOW + 360_000)).toEqual({ ...outcome, status: 'exists' });
      expect(submit).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
      submit.mockRestore();
      index.mockRestore();
    }
  });

  test('recovers the current Reddit puzzle when the cache read fails', async () => {
    const before = await todaysPost();
    const regenerated = await regenerateToday(NOW + 1000);
    expect(regenerated).toMatchObject({ status: 'done', postId: before.postId, reposted: false });
    if (regenerated.status !== 'done') throw new Error('Expected regeneration to succeed');
    const cache = vi.spyOn(redis, 'get').mockRejectedValue(new Error('cache unavailable'));
    try {
      const stale = toPostWire(before.info);
      expect((await loadPostInfo(before.postId, stale))?.rev).toBe(regenerated.rev);

      const redditRead = vi.spyOn(reddit, 'getPostById').mockRejectedValueOnce(new Error('Reddit unavailable'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await expect(loadPostInfo(before.postId, stale)).rejects.toThrow('cache unavailable');
      } finally {
        warn.mockRestore();
        redditRead.mockRestore();
      }
    } finally {
      cache.mockRestore();
    }
  });

  test('keeps a confirmed puzzle post when the results thread lookup fails', async () => {
    const read = redis.hGet.bind(redis);
    const thread = vi.spyOn(redis, 'hGet').mockImplementation((key, field) =>
      key === K.threads ? Promise.reject(new Error('thread lookup unavailable')) : read(key, field)
    );
    const submit = vi.spyOn(reddit, 'submitCustomPost');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const outcome = await ensureDailyPost(NOW);
      expect(outcome.status).toBe('created');
      if (outcome.status !== 'created') throw new Error('Expected a confirmed daily post');
      expect(await redis.hGet(K.posts, TODAY)).toBe(outcome.postId);
      expect(await ensureDailyPost(NOW + 180_000)).toEqual({ ...outcome, status: 'exists' });
      expect(submit).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith('Results thread setup failed for puzzle post:', expect.any(Error));
    } finally {
      warn.mockRestore();
      submit.mockRestore();
      thread.mockRestore();
    }
  });

  test('a stale claim from a dead run is taken over once', async () => {
    await redis.hSet(K.posts, { [TODAY]: `pending:${NOW - 600_000}` });
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => ensureDailyPost(NOW)));
    expect(outcomes.filter((outcome) => outcome.status === 'created')).toHaveLength(1);
  });

  test('does not create a second results thread after Reddit confirms the first', async () => {
    const postId = 't3_thread';
    const original = vi.spyOn(reddit, 'submitComment').mockResolvedValue({
      id: 't1_first',
      distinguish: async () => {},
    } as unknown as Awaited<ReturnType<typeof reddit.submitComment>>);
    const save = vi.spyOn(redis, 'hSet').mockRejectedValueOnce(new Error('receipt write failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await ensureThread(postId)).toBe('t1_first');
      expect(await redis.hGet(K.threads, postId)).toBe('pending');
      expect(await ensureThread(postId)).toBeNull();
      expect(original).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith('Results thread receipt could not be saved:', expect.any(Error));
    } finally {
      original.mockRestore();
      save.mockRestore();
      warn.mockRestore();
    }
  });

  test('skipped days and days before the start date get no post', async () => {
    await setSkipped(TODAY, true);
    expect(await ensureDailyPost(NOW)).toEqual({ status: 'skipped', date: TODAY });
    expect(await ensureDailyPost(NOW, '2026-11-10')).toEqual({ status: 'before-start', date: '2026-11-10' });
    await setSkipped(TODAY, false);
    expect((await ensureDailyPost(NOW)).status).toBe('created');
  });
});

describe('scored attempts', () => {
  test('one scored attempt under 50 concurrent completions by one player', async () => {
    const { info, board } = await todaysPost();
    await startAttempt(board, alice.id, NOW - 30_000);
    const responses = await Promise.all(
      Array.from({ length: 50 }, () => complete(info, board, alice, solution(info)))
    );
    expect(responses.filter((response) => response.scored)).toHaveLength(1);
    expect(responses.filter((response) => response.reason === 'practice')).toHaveLength(49);
    expect(await redis.zCard(K.lb(board))).toBe(1);
    expect(await redis.hGetAll(K.dist(board))).toEqual({ '0': '1' });
    expect(await loadResult(board, alice.id)).toMatchObject({ folds: info.puzzle.par, ms: 30_000 });
    expect((await loadUser(alice.id)).streak).toMatchObject({ cur: 1, best: 1, last: TODAY });
  });

  test('the first result is kept; a better practice run never replaces it', async () => {
    const { info, board } = await todaysPost();
    const first = await complete(info, board, alice, slowSolution(info));
    expect(first).toMatchObject({ scored: true, result: { folds: info.puzzle.par + 2 } });
    const second = await complete(info, board, alice, solution(info));
    expect(second).toMatchObject({
      scored: false,
      reason: 'practice',
      result: { folds: info.puzzle.par + 2 },
      attempt: { folds: info.puzzle.par },
    });
  });

  test('ranks by fewest folds, then by time, and counts the distribution', async () => {
    const { info, board } = await todaysPost();
    const players = Array.from({ length: 30 }, (_, i) => ({ id: `t2_p${i}`, name: `player${i}` }));
    await Promise.all(players.map((player, i) => startAttempt(board, player.id, NOW - 10_000 - i * 1000)));
    await Promise.all(
      players.map((player, i) =>
        complete(info, board, player, i % 3 === 0 ? slowSolution(info) : solution(info))
      )
    );
    const field = await fieldView(board, 'player1');
    // player1 solved at par with the shortest time among par solvers.
    expect(field).toEqual({
      total: 30,
      dist: [20, 0, 10, 0, 0, 0, 0],
      rank: 0,
      standing: 'Top 4% of 30',
    });
    const board10 = await leaderboard(board, players[0]!);
    expect(board10.rows).toHaveLength(10);
    expect(board10.rows[0]).toMatchObject({ rank: 1, name: 'player1', folds: info.puzzle.par, ms: 11_000 });
    expect(board10.rows.every((row) => row.folds === info.puzzle.par)).toBe(true);
    expect(board10.rows.map((row) => row.ms)).toEqual([...board10.rows.map((row) => row.ms)].sort((a, b) => a - b));
    // player0 wasted folds, so they sit below every par solver and get their own row.
    expect(board10.me).toMatchObject({ rank: 21, name: 'player0', folds: info.puzzle.par + 2, me: true });
  });

  test('forged, illegal, unsolved and stale fold lists are rejected and store nothing', async () => {
    const { info, board } = await todaysPost();
    const attempt = (body: unknown) =>
      completeAttempt({ info, board, player: alice, today: TODAY, now: NOW, config }, body);
    const good = movesToWire(solution(info));
    const cases: Array<[unknown, string]> = [
      [{ rev: info.rev, moves: [] }, 'invalid-moves'],
      [{ rev: info.rev, moves: 'nope' }, 'invalid-moves'],
      [{ rev: info.rev, moves: [[0, 90]] }, 'invalid-moves'],
      [{ rev: info.rev, moves: [[1, 45]] }, 'invalid-moves'],
      [{ rev: info.rev, moves: [[99, 90]] }, 'invalid-moves'],
      [{ rev: info.rev, moves: good.slice(0, -1) }, 'unsolved'],
      [{ rev: info.rev + 1, moves: good }, 'stale'],
      [null, 'stale'],
    ];
    // Jumping a hinge two stops at once is not a legal fold.
    const jump = info.puzzle.start.findIndex((angle, i) => i > 0 && angle !== 0);
    if (jump > 0) cases.push([{ rev: info.rev, moves: [[jump, -info.puzzle.start[jump]!]] }, 'invalid-moves']);
    for (const [body, code] of cases) {
      const error = await attempt(body).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe(code);
    }
    expect(await redis.zCard(K.lb(board))).toBe(0);
    expect(await loadResult(board, alice.id)).toBeNull();
  });

  test('without a server start time the clock falls back to a bounded client time', async () => {
    const { info, board } = await todaysPost();
    const response = await completeAttempt(
      { info, board, player: alice, today: TODAY, now: NOW, config },
      { rev: info.rev, moves: movesToWire(solution(info)), clientMs: 1 }
    );
    expect(response.result.ms).toBe(info.puzzle.par * 300);
  });

  test("only today's puzzle extends the streak; yesterday's post is still scored", async () => {
    const yesterday = await todaysPost(NOW - 86_400_000);
    const today = await todaysPost();
    const late = await complete(yesterday.info, yesterday.board, alice, solution(yesterday.info));
    expect(late).toMatchObject({ scored: true, streakExtended: false, streak: { current: 0, best: 0 } });
    const onTime = await complete(today.info, today.board, alice, solution(today.info));
    expect(onTime).toMatchObject({ scored: true, streakExtended: true, streak: { current: 1, best: 1 } });
  });

  test('a streak reaches the Crease tier on day 3 and survives one missed day', async () => {
    const days = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-20'];
    let last;
    for (const [i, date] of days.entries()) {
      const now = Date.parse(`${date}T12:00:00Z`);
      const { info, board } = await todaysPost(now);
      last = await complete(info, board, alice, solution(info), now, date);
      if (i === 2) expect(last).toMatchObject({ newTier: 'Crease', streak: { current: 3, tier: 'Crease' } });
    }
    expect(last).toMatchObject({ streakExtended: true, streak: { current: 4, best: 4 }, newTier: null });
  });

  test('a skipped day is practice only', async () => {
    const { info, board } = await todaysPost();
    await setSkipped(TODAY, true);
    const response = await complete(info, board, alice, solution(info));
    expect(response).toMatchObject({ scored: false, reason: 'skipped' });
    expect(await redis.zCard(K.lb(board))).toBe(0);
  });
});

describe('moderator tools', () => {
  test('regenerate gives a new valid puzzle, a clean board, and keeps streak credit', async ({ mocks }) => {
    const before = await todaysPost();
    await complete(before.info, before.board, alice, solution(before.info));
    const outcome = await regenerateToday(NOW + 1000);
    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done') return;
    const info = await loadPostInfo(outcome.postId);
    expect(info).not.toBeNull();
    if (!info) return;
    expect(info.rev).toBeGreaterThan(before.info.rev);
    expect(puzzleSignature(info.puzzle)).not.toBe(puzzleSignature(before.info.puzzle));
    expect(validatePuzzle(info.puzzle).ok).toBe(true);
    expect(parsePostWire(mocks.reddit.linksAndComments.getPostData(outcome.postId))?.rev).toBe(info.rev);
    const board = boardFor(info, outcome.postId);
    expect(board).toBe(dayBoard(TODAY, info.rev));
    expect(await redis.zCard(K.lb(board))).toBe(0);
    expect((await loadUser(alice.id)).streak.cur).toBe(1);
    // A client still holding the old puzzle is told to reload.
    const stale = await completeAttempt(
      { info, board, player: alice, today: TODAY, now: NOW + 2000, config },
      { rev: before.info.rev, moves: movesToWire(solution(before.info)), clientMs: 2000 }
    ).catch((e: unknown) => e);
    expect((stale as ApiError).code).toBe('stale');
    const again = await completeAttempt(
      { info, board, player: alice, today: TODAY, now: NOW + 5000, config },
      { rev: info.rev, moves: movesToWire(solution(info)), clientMs: 2000 }
    );
    expect(again).toMatchObject({ scored: true, streakExtended: false });
  });

  test('regenerate commits the new revision even when the fallback refresh fails', async ({ mocks }) => {
    const before = await todaysPost();
    const post = await reddit.getPostById(before.postId);
    const lookup = vi.spyOn(reddit, 'getPostById').mockResolvedValueOnce(post);
    const fallback = vi.spyOn(post, 'setTextFallback').mockRejectedValueOnce(new Error('fallback unavailable'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const outcome = await regenerateToday(NOW + 1000);
      expect(outcome).toMatchObject({ status: 'done', postId: before.postId, reposted: false });
      if (outcome.status !== 'done') throw new Error('puzzle was not regenerated');
      expect(fallback).toHaveBeenCalledOnce();
      expect(parsePostWire(mocks.reddit.linksAndComments.getPostData(before.postId))?.rev).toBe(outcome.rev);
      expect((await loadPostInfo(before.postId))?.rev).toBe(outcome.rev);
      expect(await redis.hGet(K.day(TODAY), 'rev')).toBe(String(outcome.rev));
    } finally {
      warning.mockRestore();
      fallback.mockRestore();
      lookup.mockRestore();
    }
  });

  test('regenerate without a post reports it', async () => {
    expect(await regenerateToday(NOW)).toEqual({ status: 'no-post' });
  });

  test('regenerate skips a revision that would repeat the same puzzle', () => {
    const current = generate(TODAY, 1);
    const signature = puzzleSignature(current);
    const next = replacementFor(TODAY, 3, 0, signature, null);
    expect(next).not.toBeNull();
    if (!next) return;
    expect(puzzleSignature(next.puzzle)).not.toBe(signature);
    expect(next.rev).toBeGreaterThan(1);
  });

  test('an in-place replacement keeps the title line and changes the paper', () => {
    const current = generate(TODAY);
    const hook = puzzleHook(current);
    const next = replacementFor(TODAY, 3, 0, puzzleSignature(current), hook);
    if (!next) return;
    expect(puzzleHook(next.puzzle)).toBe(hook);
    expect(puzzleSignature(next.puzzle)).not.toBe(puzzleSignature(current));
  });

  test('the regenerate form keeps the puzzle until the box is checked', async () => {
    const outcome = await ensureDailyPost(Date.now());
    if (outcome.status !== 'created' && outcome.status !== 'exists') throw new Error(outcome.status);
    const before = await loadPostInfo(outcome.postId);
    if (!before) throw new Error('no post info');
    const send = (confirm: unknown) =>
      app.request('/internal/form/regenerate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm }),
      });
    expect(await (await send(false)).json()).toEqual({ showToast: "Nothing changed. Today's puzzle was kept." });
    expect(await (await send('false')).json()).toEqual({ showToast: "Nothing changed. Today's puzzle was kept." });
    expect((await loadPostInfo(outcome.postId))?.rev).toBe(before.rev);

    const replaced = await send('true');
    const body = (await replaced.json()) as { showToast?: { text?: string } | string };
    expect(replaced.status).toBe(200);
    const toast = typeof body.showToast === 'string' ? body.showToast : body.showToast?.text;
    expect(toast).toMatch(/replaced/);
    const posted = await redis.hGet(K.posts, before.date);
    const after = posted ? await loadPostInfo(posted) : null;
    expect(after?.rev).toBeGreaterThan(before.rev);
    expect(puzzleSignature(after!.puzzle)).not.toBe(puzzleSignature(before.puzzle));
  });

  test('a failed return counter does not block the daily puzzle', async ({ headers }) => {
    const yesterdayNow = NOW - 86_400_000;
    const yesterday = await todaysPost(yesterdayNow);
    await complete(
      yesterday.info,
      yesterday.board,
      alice,
      solution(yesterday.info),
      yesterdayNow,
      yesterday.info.date
    );
    const { postId } = await todaysPost();
    const ctx = Context({
      ...headers,
      [Header.User]: alice.id,
      [Header.Username]: alice.name,
      [Header.Post]: postId,
    });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const counter = vi.spyOn(redis, 'hIncrBy').mockRejectedValueOnce(new Error('counter unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const response = await runWithContext(ctx, async () => app.request('/api/init'));
      expect(counter).toHaveBeenCalledWith(K.funnel(TODAY), 'return_next_day', 1);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        postId,
        isToday: true,
        streak: { current: 1, best: 1 },
      });
      expect(warn).toHaveBeenCalledWith('Return analytics could not be recorded:', expect.any(Error));
    } finally {
      warn.mockRestore();
      counter.mockRestore();
      clock.mockRestore();
    }
  });

  test('a failed field read does not block opening or scoring the daily puzzle', async ({ headers }) => {
    const { info, postId, board } = await todaysPost();
    const ctx = Context({
      ...headers,
      [Header.User]: alice.id,
      [Header.Username]: alice.name,
      [Header.Post]: postId,
    });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const field = vi.spyOn(redis, 'zCard').mockRejectedValue(new Error('field unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const init = await runWithContext(ctx, async () => app.request('/api/init'));
      expect(init.status).toBe(200);
      expect(await init.json()).toMatchObject({ postId, field: null });

      const result = await complete(info, board, alice, solution(info));
      expect(result).toMatchObject({ scored: true, field: null, streakExtended: true });
      expect(await loadResult(board, alice.id)).toMatchObject({ folds: solution(info).length });
    } finally {
      warn.mockRestore();
      field.mockRestore();
      clock.mockRestore();
    }
  });

  test('a logged-out player can read the leaderboard but cannot store a score', async ({ headers }) => {
    const { info, postId, board } = await todaysPost();
    await complete(info, board, alice, solution(info));
    const ctx = Context({
      ...headers,
      [Header.User]: '',
      [Header.Username]: '',
      [Header.AppUser]: '',
      [Header.Post]: postId,
    });
    await runWithContext(ctx, async () => {
      const init = (await (await app.request('/api/init')).json()) as {
        user: { loggedIn: boolean; name: string | null };
        result: unknown;
      };
      expect(init.user).toEqual({ loggedIn: false, name: null });
      expect(init.result).toBeNull();
      const denied = await app.request('/api/attempt/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rev: info.rev, moves: [], clientMs: 1 }),
      });
      expect(denied.status).toBe(401);
      expect(await denied.json()).toMatchObject({ code: 'login' });
      const leaders = (await (await app.request('/api/leaderboard')).json()) as {
        total: number;
        me: unknown;
        rows: Array<{ name: string; me: boolean; rank: number }>;
      };
      expect(leaders.total).toBe(1);
      expect(leaders.me).toBeNull();
      expect(leaders.rows[0]).toMatchObject({ name: 'alice', me: false, rank: 1 });
    });
  });

  test('settings validation accepts good values and explains bad ones', async () => {
    const check = async (path: string, value: string) =>
      (
        await app.request(`/internal/settings/${path}`, {
          method: 'POST',
          body: JSON.stringify({ value, isEditing: true }),
          headers: { 'content-type': 'application/json' },
        })
      ).json();
    expect(await check('validate-start-date', '2026-11-16')).toEqual({ success: true });
    expect(await check('validate-start-date', '')).toEqual({ success: true });
    expect(await check('validate-start-date', '2026-02-30')).toMatchObject({ success: false });
    expect(await check('validate-timezone', 'Asia/Kolkata')).toEqual({ success: true });
    expect(await check('validate-timezone', 'Mars/Olympus')).toMatchObject({ success: false });
  });
});

describe('community routes', () => {
  const routeBody = (date: string) => {
    const puzzle = generate(date);
    return { t: encodeTurns(puzzle.turns), s: encodeAngles(puzzle.start), g: encodeAngles(puzzle.goal) };
  };
  const SUNDAY = '2026-11-22';
  const players = ['bea', 'cal', 'dee'].map((name) => ({ id: `t2_${name}`, name }));

  /**
   * The harness has no devvit.json, so it refuses `runAs: 'USER'`. This checks
   * that routes ask to post as the player with reportable content, then lets
   * the mock create the post.
   */
  const allowUserPosts = () => {
    const submit = reddit.submitCustomPost.bind(reddit);
    return vi.spyOn(reddit, 'submitCustomPost').mockImplementation((options) => {
      expect(options.runAs).toBe('USER');
      expect(options.userGeneratedContent?.text).toMatch(/Community Route by u\//);
      const { runAs: _runAs, userGeneratedContent: _content, ...rest } = options;
      return submit(rest);
    });
  };

  test('devvit.json grants the user actions the app uses', () => {
    const file = JSON.parse(readFileSync(new URL('../../../devvit.json', import.meta.url), 'utf8')) as {
      permissions: { reddit: { asUser: string[] }; redis: boolean; journeys: boolean };
    };
    expect(file.permissions.reddit.asUser.sort()).toEqual([
      'SUBMIT_COMMENT',
      'SUBMIT_POST',
      'SUBSCRIBE_TO_SUBREDDIT',
    ]);
    expect(file.permissions).toMatchObject({ redis: true, journeys: true });
  });

  test('routes submitted Monday to Saturday compete for that Sunday; Sunday ones for the next', () => {
    expect(targetSunday('2026-11-16')).toBe(SUNDAY);
    expect(targetSunday('2026-11-21')).toBe(SUNDAY);
    expect(targetSunday(SUNDAY)).toBe('2026-11-29');
  });

  test('a valid route becomes its own post; limits and duplicates are enforced', async () => {
    allowUserPosts();
    const first = await submitRoute(players[0]!, routeBody('2026-11-22'), TODAY, NOW);
    expect(first.par).toBeGreaterThanOrEqual(8);
    const info = await loadPostInfo(first.postId);
    expect(info).toMatchObject({ kind: 'route', source: 'community', author: 'bea' });
    expect((await reddit.getPostById(first.postId as `t3_${string}`)).title).toMatch(
      /^Community Route · Seven panels · par \d+ · by u\/bea$/
    );

    const again = await submitRoute(players[0]!, routeBody('2026-11-29'), TODAY, NOW).catch((e: unknown) => e);
    expect((again as ApiError).code).toBe('route-limit');
    const copy = await submitRoute(players[1]!, routeBody('2026-11-22'), TODAY, NOW).catch((e: unknown) => e);
    expect((copy as ApiError).code).toBe('route-duplicate');
    // The failed duplicate must not use up the second player's weekly slot.
    const second = await submitRoute(players[1]!, routeBody('2026-11-29'), TODAY, NOW + 1);
    expect(second.postId).not.toBe(first.postId);

    const listed = await listRoutes(TODAY, players[0]!.id);
    expect(listed.sunday).toBe(SUNDAY);
    expect(listed.routes.map((route) => [route.author, route.mine])).toEqual([
      ['cal', false],
      ['bea', true],
    ]);
  });

  test('routes that are too easy or malformed are rejected', async () => {
    for (const body of [routeBody('2026-11-18'), { t: 'SSS', s: '000', g: '0+' }, null, { t: 'XYZ' }]) {
      const error = await submitRoute(players[0]!, body, TODAY, NOW).catch((e: unknown) => e);
      expect((error as ApiError).code).toBe('route-invalid');
    }
    expect((await listRoutes(TODAY, undefined)).routes).toEqual([]);
  });

  test("Sunday takes the week's top-voted valid route, earliest first on ties, never a removed one", async () => {
    allowUserPosts();
    const posts = [];
    for (const [i, date] of ['2026-11-22', '2026-11-29', '2026-12-06'].entries())
      posts.push(await submitRoute(players[i]!, routeBody(date), TODAY, NOW + i));
    const scores = new Map([
      [posts[0]!.postId, { score: 5, removed: false }],
      [posts[1]!.postId, { score: 9, removed: true }],
      [posts[2]!.postId, { score: 5, removed: false }],
    ]);
    vi.spyOn(reddit, 'getPostById').mockImplementation(async (id) => {
      const entry = scores.get(id);
      if (!entry) throw new Error('missing');
      return {
        score: entry.score,
        removed: entry.removed,
        spam: false,
        isRemoved: () => entry.removed,
        isSpam: () => false,
      } as unknown as Awaited<ReturnType<typeof reddit.getPostById>>;
    });
    expect(await pickRoute(SUNDAY)).toMatchObject({ author: 'bea', postId: posts[0]!.postId });
    scores.get(posts[2]!.postId)!.score = 6;
    expect(await pickRoute(SUNDAY)).toMatchObject({ author: 'dee' });

    // Sunday's own post is made by the app account, not as a player.
    vi.mocked(reddit.submitCustomPost).mockRestore();
    const sundayNoon = Date.parse(`${SUNDAY}T12:00:00Z`);
    const outcome = await ensureDailyPost(sundayNoon);
    expect(outcome.status).toBe('created');
    if (outcome.status !== 'created') return;
    const info = await loadPostInfo(outcome.postId);
    expect(info).toMatchObject({ kind: 'daily', source: 'community', author: 'dee', routePostId: posts[2]!.postId, day: 7 });
  });

  test('with no routes Sunday falls back to the generated puzzle', async () => {
    expect(await pickRoute(SUNDAY)).toBeNull();
    const outcome = await ensureDailyPost(Date.parse(`${SUNDAY}T12:00:00Z`));
    if (outcome.status !== 'created') throw new Error(outcome.status);
    expect(await loadPostInfo(outcome.postId)).toMatchObject({ source: 'generated', tier: 6 });
  });

  test('a deleted route leaves every index and frees the author and the puzzle', async () => {
    allowUserPosts();
    const body = routeBody('2026-11-22');
    const first = await submitRoute(players[0]!, body, TODAY, NOW);
    expect(await forgetRoute(first.postId)).toBe(true);
    expect(await forgetRoute(first.postId)).toBe(false);
    expect((await listRoutes(TODAY, undefined)).routes).toEqual([]);
    expect(await pickRoute(SUNDAY)).toBeNull();
    expect((await submitRoute(players[0]!, body, TODAY, NOW)).postId).not.toBe(first.postId);
  });
});

describe('flair, sharing and tracking', () => {
  test('a flair failure never fails the game', async () => {
    const { info, board } = await todaysPost();
    await redis.hSet(K.user(alice.id), { cur: '2', best: '2', last: '2026-11-17', flairOptIn: '1' });
    const response = await complete(info, board, alice, solution(info));
    expect(response).toMatchObject({ scored: true, newTier: 'Crease', flairStatus: 'unavailable' });
    expect(await setFlairOptIn(alice, true, config)).toEqual({ optedIn: true, status: 'unavailable' });
  });

  test('flair is set only for players who opted in, and removed only if the app set it', async () => {
    const set = vi.spyOn(reddit, 'setUserFlair').mockResolvedValue(undefined);
    const remove = vi.spyOn(reddit, 'removeUserFlair').mockResolvedValue(undefined);
    await redis.hSet(K.user(alice.id), { cur: '7', best: '7', last: '2026-11-17' });
    const { info, board } = await todaysPost();
    expect((await complete(info, board, alice, solution(info))).flairStatus).toBe('off');
    expect(set).not.toHaveBeenCalled();
    expect(await setFlairOptIn(alice, true, config)).toEqual({ optedIn: true, status: 'set' });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ subredditName: 'testsub', username: 'alice', text: 'Pleat' })
    );
    expect(await setFlairOptIn(alice, false, config)).toEqual({ optedIn: false, status: 'off' });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(await setFlairOptIn(alice, false, config)).toEqual({ optedIn: false, status: 'off' });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(await setFlairOptIn(alice, true, { ...config, flairEnabled: false })).toEqual({ optedIn: false, status: 'off' });
  });

  test('a result is shared once, as a spoiler-safe grid, and only after finishing', async () => {
    const { info, board, postId } = await todaysPost();
    const none = await shareResult(info, postId, board, alice, TODAY).catch((e: unknown) => e);
    expect((none as ApiError).code).toBe('no-result');

    await startAttempt(board, alice.id, NOW - 42_000);
    await complete(info, board, alice, slowSolution(info));
    const edit = vi.fn().mockResolvedValue(undefined);
    const submit = vi
      .spyOn(reddit, 'submitComment')
      .mockResolvedValue({ id: 't1_shared', authorName: 'foldline-app', edit } as unknown as Awaited<
        ReturnType<typeof reddit.submitComment>
      >);
    const shared = await shareResult(info, postId, board, alice, TODAY);
    expect(shared).toEqual({ type: 'share', status: 'posted', asUser: false });
    const sent = submit.mock.calls.at(-1)![0];
    expect(sent.runAs).toBe('USER');
    const sentText = 'text' in sent ? sent.text : '';
    const [headline, grid] = sentText.split('  \n');
    expect(headline).toBe(`Foldline Day 3 · ${info.puzzle.par + 2} folds (par ${info.puzzle.par}) · 0:42`);
    // One wasted fold moved away from the answer; every other fold moved closer.
    expect([...grid!].sort().join('')).toBe(`${'🟦'.repeat(info.puzzle.par + 1)}🟧`);
    // Nothing in the comment names a hinge or a direction.
    expect(sentText).not.toMatch(/[1-9][+-]|hinge|up|down/);
    // The app account posted it (unapproved app), so the comment names the player.
    expect(edit).toHaveBeenCalledWith({ text: expect.stringMatching(/^u\/alice's result\n\nFoldline Day 3/) });
    const calls = submit.mock.calls.length;
    expect(await shareResult(info, postId, board, alice, TODAY)).toMatchObject({ status: 'already' });
    expect(submit.mock.calls.length).toBe(calls);
    expect((await redis.hGetAll(K.funnel(TODAY))).share_comment).toBe('1');
  });

  test('a failed share can be retried', async () => {
    const { info, board, postId } = await todaysPost();
    await complete(info, board, alice, solution(info));
    const submit = vi.spyOn(reddit, 'submitComment').mockRejectedValue(new Error('nope'));
    const failed = await shareResult(info, postId, board, alice, TODAY).catch((e: unknown) => e);
    expect((failed as ApiError).code).toBe('share-failed');
    submit.mockResolvedValue({ id: 't1_ok', authorName: 'alice' } as unknown as Awaited<
      ReturnType<typeof reddit.submitComment>
    >);
    expect(await shareResult(info, postId, board, alice, TODAY)).toMatchObject({ status: 'posted', asUser: true });
  });

  test('track() forwards to Journeys and counts each funnel step once per player per day', async ({ mocks }) => {
    for (let i = 0; i < 3; i++) await track({ event: 'post_view' }, alice.id, TODAY);
    await track({ event: 'post_view' }, 't2_bob', TODAY);
    await track({ event: 'post_view' }, undefined, TODAY);
    await track({ event: 'first_interaction' }, alice.id, TODAY);
    const started = await track({ event: 'attempt_start' }, alice.id, TODAY);
    expect(started.journeyId).toBeTruthy();
    await track({ event: 'attempt_progress', journeyId: started.journeyId, progress: 0.5 }, alice.id, TODAY);
    await track({ event: 'attempt_complete', journeyId: started.journeyId, score: 4 }, alice.id, TODAY);
    await track({ event: 'made_up' }, alice.id, TODAY);

    expect(await redis.hGetAll(K.funnel(TODAY))).toEqual({
      post_view: '2',
      post_view_logged_out: '1',
      first_interaction: '1',
      attempt_start: '1',
    });
    expect(mocks.telemetry.getAppReadyEvents()).toHaveLength(5);
    const journey = mocks.telemetry.getJourney(started.journeyId!);
    expect(journey?.progressEvents).toHaveLength(1);
    expect(journey?.endRequest).toMatchObject({ complete: true, game: { win: true, score: 4 } });
  });

  test('a failed solve counter does not hide the score or streak credit', async () => {
    const { info, board } = await todaysPost();
    const increment = redis.hIncrBy.bind(redis);
    const counter = vi.spyOn(redis, 'hIncrBy').mockImplementation((key, field, amount) =>
      key === K.funnel(TODAY) && field === 'attempt_complete'
        ? Promise.reject(new Error('counter unavailable'))
        : increment(key, field, amount)
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await complete(info, board, alice, solution(info));
      expect(result).toMatchObject({ scored: true, streakExtended: true });
      expect(await redis.zCard(K.lb(board))).toBe(1);
      expect(warn).toHaveBeenCalledWith('Solve analytics could not be recorded:', expect.any(Error));
    } finally {
      warn.mockRestore();
      counter.mockRestore();
    }
  });

  test('a failed share counter preserves the comment receipt', async () => {
    const { info, board, postId } = await todaysPost();
    await complete(info, board, alice, solution(info));
    await redis.hSet(K.threads, { [postId]: 't1_thread' });
    const submit = vi.spyOn(reddit, 'submitComment').mockResolvedValue({
      id: 't1_shared', authorName: 'alice',
    } as unknown as Awaited<ReturnType<typeof reddit.submitComment>>);
    const counter = vi.spyOn(redis, 'hIncrBy').mockRejectedValueOnce(new Error('counter unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await shareResult(info, postId, board, alice, TODAY)).toMatchObject({ status: 'posted' });
      expect(await redis.hGet(K.shared(board), alice.id)).toBe('t1_shared');
      expect(await shareResult(info, postId, board, alice, TODAY)).toMatchObject({ status: 'already' });
      expect(submit).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith('Share analytics could not be recorded:', expect.any(Error));
    } finally {
      warn.mockRestore();
      counter.mockRestore();
      submit.mockRestore();
    }
  });

  test('a failed receipt write does not let a confirmed share post twice', async () => {
    const { info, board, postId } = await todaysPost();
    await complete(info, board, alice, solution(info));
    await redis.hSet(K.threads, { [postId]: 't1_thread' });
    const submit = vi.spyOn(reddit, 'submitComment').mockResolvedValue({
      id: 't1_shared', authorName: 'alice',
    } as unknown as Awaited<ReturnType<typeof reddit.submitComment>>);
    const save = vi.spyOn(redis, 'hSet').mockRejectedValueOnce(new Error('receipt write failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await shareResult(info, postId, board, alice, TODAY)).toMatchObject({ status: 'posted' });
      expect(await redis.hGet(K.shared(board), alice.id)).toBe('pending');
      expect(await shareResult(info, postId, board, alice, TODAY)).toMatchObject({ status: 'already' });
      expect(submit).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith('Share receipt could not be saved:', expect.any(Error));
    } finally {
      warn.mockRestore();
      save.mockRestore();
      submit.mockRestore();
    }
  });

  test('the funnel counts completions on the server, where they are verified', async () => {
    const { info, board } = await todaysPost();
    await complete(info, board, alice, solution(info));
    await complete(info, board, alice, solution(info));
    expect((await redis.hGetAll(K.funnel(TODAY))).attempt_complete).toBe('1');
  });
});
