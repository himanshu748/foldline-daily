import { reddit, redis } from '@devvit/web/server';
import { addDays, dayNumber, isDateKey, weekdayIndex } from '../../shared/dates';
import { generate } from '../../shared/generator';
import { puzzleHook } from '../../shared/hooks';
import { toPostWire, type PostInfo } from '../../shared/postdata';
import { puzzleSignature } from '../../shared/puzzle';
import { pickRoute } from './community';
import { isSkipped, loadConfig, startDateFor, todayKey, type AppConfig } from './config';
import { boardKeys, dayBoard, DAY_TTL_SECONDS, K } from './keys';
import { ensureThread, fallbackText, isPostId, loadPostInfo, publishPost, savePostInfo, type PostId } from './postinfo';

const PENDING = 'pending:';
/** A claim older than this belongs to a run that died; another run may take over. */
const CLAIM_TTL_MS = 120_000;
/** How many revisions to try when looking for a replacement that keeps the post title true. */
const REGENERATE_TRIES = 24;
/** Old revisions' boards are kept briefly after a regenerate, then dropped. */
const OLD_BOARD_TTL_SECONDS = 30 * 86_400;

export type PostOutcome =
  { status: 'created' | 'exists'; date: string; postId: PostId } | { status: 'skipped' | 'busy' | 'before-start'; date: string };

async function buildInfo(date: string, day: number, rev: number, config: AppConfig): Promise<PostInfo> {
  if (weekdayIndex(date) === 6 && config.routesEnabled && rev === 0) {
    const pick = await pickRoute(date).catch((error: unknown) => {
      console.warn('Community Route selection failed, using the generated puzzle:', error);
      return null;
    });
    if (pick)
      return {
        kind: 'daily',
        date,
        day,
        rev,
        tier: 6,
        puzzle: pick.puzzle,
        source: 'community',
        author: pick.author,
        routePostId: pick.postId,
      };
  }
  return generatedInfo(date, day, rev);
}

function generatedInfo(date: string, day: number, rev: number): PostInfo {
  const made = generate(date, rev);
  return {
    kind: 'daily',
    date,
    day,
    rev,
    tier: made.tier,
    puzzle: {
      turns: made.turns,
      start: made.start,
      goal: made.goal,
      par: made.par,
    },
    source: made.source,
  };
}

async function expireDay(date: string, seconds: number): Promise<void> {
  const rev = Number((await redis.hGet(K.day(date), 'rev')) ?? 0);
  const keys = [K.day(date), K.funnel(date), K.seen(date)];
  for (let r = 0; r <= rev; r++) keys.push(...boardKeys(dayBoard(date, r)));
  await Promise.all(keys.map((key) => redis.expire(key, seconds)));
}

async function setupResultsThread(postId: PostId): Promise<void> {
  try {
    await ensureThread(postId);
  } catch (error) {
    // A thread is optional once Reddit confirms the puzzle post.
    console.warn('Results thread setup failed for puzzle post:', error);
  }
}

/**
 * Creates the post for a date unless it exists or the day is skipped. Safe to
 * call from overlapping runs: only the run that wins the HSETNX claim posts.
 */
export async function ensureDailyPost(now = Date.now(), forDate?: string): Promise<PostOutcome> {
  const config = await loadConfig();
  const today = todayKey(config, now);
  const date = forDate ?? today;
  if (!isDateKey(date)) throw new RangeError('Use a real calendar date in YYYY-MM-DD format.');
  if (await isSkipped(date)) return { status: 'skipped', date };

  const current = await redis.hGet(K.posts, date);
  if (isPostId(current)) return { status: 'exists', date, postId: current };

  const claim = `${PENDING}${now}`;
  if (current) {
    const claimedAt = Number(current.slice(PENDING.length));
    if (Number.isFinite(claimedAt) && now - claimedAt < CLAIM_TTL_MS) return { status: 'busy', date };
    // Exactly one run may take over a given stale claim.
    if ((await redis.hSetNX(K.claims, `${date}:${current}`, String(now))) !== 1) return { status: 'busy', date };
    await redis.hSet(K.posts, { [date]: claim });
  } else if ((await redis.hSetNX(K.posts, date, claim)) !== 1) {
    return { status: 'busy', date };
  }

  const release = async () => {
    if ((await redis.hGet(K.posts, date)) === claim) await redis.hDel(K.posts, [date]);
  };
  try {
    const day = dayNumber(await startDateFor(config, today), date);
    if (day < 1) {
      await release();
      return { status: 'before-start', date };
    }
    const rev = Number((await redis.hGet(K.day(date), 'rev')) ?? 0);
    const info = await buildInfo(date, day, rev, config);
    const post = await publishPost(info);
    await redis.hSet(K.posts, { [date]: post.id });
    await redis.hSet(K.day(date), {
      postId: post.id,
      rev: String(rev),
      day: String(day),
    });
    await setupResultsThread(post.id);
    await expireDay(addDays(date, -1), DAY_TTL_SECONDS).catch((error: unknown) =>
      console.warn('Could not set expiry on the previous day:', error)
    );
    return { status: 'created', date, postId: post.id };
  } catch (error) {
    await release();
    throw error;
  }
}

export type RegenerateOutcome = { status: 'done'; postId: PostId; rev: number; reposted: boolean } | { status: 'no-post' };

/**
 * The next generated puzzle for a day. Skips a revision that would republish
 * the same paper. `hook` limits the search to puzzles whose title line matches,
 * because a Reddit post title cannot be edited.
 */
export function replacementFor(date: string, day: number, rev: number, signature: string, hook: string | null): PostInfo | null {
  for (let step = 1; step <= REGENERATE_TRIES; step++) {
    const candidate = generatedInfo(date, day, rev + step);
    if (puzzleSignature(candidate.puzzle) === signature) continue;
    if (hook !== null && puzzleHook(candidate.puzzle) !== hook) continue;
    return candidate;
  }
  return null;
}

/**
 * Replaces today's puzzle. The new revision gets a clean board; streak credit
 * already earned is untouched. Post titles cannot be edited, so the post is
 * kept only when a replacement fits its title; otherwise it is replaced.
 */
export async function regenerateToday(now = Date.now()): Promise<RegenerateOutcome> {
  const config = await loadConfig();
  const date = todayKey(config, now);
  const postId = await redis.hGet(K.posts, date);
  if (!isPostId(postId)) return { status: 'no-post' };
  const old = await loadPostInfo(postId);
  if (!old || old.kind !== 'daily') return { status: 'no-post' };

  const oldHook = puzzleHook(old.puzzle, old.author);
  const oldSignature = puzzleSignature(old.puzzle);
  const inPlace = old.source === 'community' ? null : replacementFor(date, old.day, old.rev, oldSignature, oldHook);
  const next =
    inPlace ?? replacementFor(date, old.day, old.rev, oldSignature, null) ?? generatedInfo(date, old.day, old.rev + REGENERATE_TRIES + 1);

  let newPostId = postId;
  const reposted = !inPlace;
  if (inPlace) {
    const post = await reddit.getPostById(postId);
    await post.setPostData(toPostWire(next));
    await post.setTextFallback({ text: fallbackText(next) }).catch((error: unknown) =>
      console.warn('The regenerated post fallback text could not be refreshed:', error)
    );
    await savePostInfo(postId, next);
  } else {
    const post = await publishPost(next);
    newPostId = post.id;
    await redis.hSet(K.posts, { [date]: post.id });
    await setupResultsThread(post.id);
    try {
      await (await reddit.getPostById(postId)).delete();
    } catch (error) {
      console.warn('The replaced post could not be deleted:', error);
    }
  }
  await redis.hSet(K.day(date), {
    postId: newPostId,
    rev: String(next.rev),
    day: String(next.day),
  });
  await Promise.all(boardKeys(dayBoard(date, old.rev)).map((key) => redis.expire(key, OLD_BOARD_TTL_SECONDS))).catch((error: unknown) =>
    console.warn('Could not expire the old board:', error)
  );
  return { status: 'done', postId: newPostId, rev: next.rev, reposted };
}

/** Players who have a scored result on today's puzzle (shown before a regenerate). */
export async function finishersToday(now = Date.now()): Promise<{ date: string; count: number; posted: boolean }> {
  const config = await loadConfig();
  const date = todayKey(config, now);
  const record = (await redis.hGetAll(K.day(date))) ?? {};
  if (!record.postId) return { date, count: 0, posted: false };
  const count = await redis.zCard(K.lb(dayBoard(date, Number(record.rev ?? 0))));
  return { date, count, posted: true };
}
