import { readFileSync } from 'node:fs';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { reddit, redis } from '@devvit/web/server';
import { describe, expect, vi } from 'vitest';
import type { FoldMove } from '../../shared/engine';
import { generate } from '../../shared/generator';
import { movesToWire } from '../../shared/moves';
import { parsePostWire, type PostInfo } from '../../shared/postdata';
import { encodeAngles, encodeTurns, puzzleSignature } from '../../shared/puzzle';
import { validatePuzzle } from '../../shared/validate';
import { app } from '../app';
import { forgetRoute, listRoutes, pickRoute, submitRoute, targetSunday } from './community';
import { DEFAULT_CONFIG, setSkipped } from './config';
import { ApiError } from './errors';
import { setFlairOptIn } from './flair';
import { boardFor, dayBoard, K } from './keys';
import { ensureDailyPost, regenerateToday } from './posts';
import { loadPostInfo } from './postinfo';
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

  test('a stale claim from a dead run is taken over once', async () => {
    await redis.hSet(K.posts, { [TODAY]: `pending:${NOW - 600_000}` });
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => ensureDailyPost(NOW)));
    expect(outcomes.filter((outcome) => outcome.status === 'created')).toHaveLength(1);
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
    expect(field.total).toBe(30);
    expect(field.dist).toEqual([20, 0, 10, 0, 0, 0, 0]);
    // player1 solved at par with the shortest time among par solvers.
    expect(field.rank).toBe(0);
    expect(field.standing).toBe('Top 4% of 30');
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

  test('regenerate without a post reports it', async () => {
    expect(await regenerateToday(NOW)).toEqual({ status: 'no-post' });
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

  test('the funnel counts completions on the server, where they are verified', async () => {
    const { info, board } = await todaysPost();
    await complete(info, board, alice, solution(info));
    await complete(info, board, alice, solution(info));
    expect((await redis.hGetAll(K.funnel(TODAY))).attempt_complete).toBe('1');
  });
});
