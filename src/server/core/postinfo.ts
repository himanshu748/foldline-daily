import { reddit, redis } from '@devvit/web/server';
import { puzzleHook, postTitle, routeTitle } from '../../shared/hooks';
import { parsePostWire, toPostWire, type PostInfo } from '../../shared/postdata';
import { BG_DARK, BG_LIGHT } from '../../shared/theme';
import { K } from './keys';

export type PostId = `t3_${string}`;

export const isPostId = (value: unknown): value is PostId =>
  typeof value === 'string' && /^t3_[a-z0-9]+$/.test(value);

/** Reddit's own URL for a post id. */
export const postUrl = (subreddit: string, postId: string): string =>
  `https://www.reddit.com/r/${subreddit}/comments/${postId.replace(/^t3_/, '')}`;

/**
 * A post's puzzle. Redis holds the authoritative copy; `postData` (sent to the
 * client by the platform) is the fallback for posts older than this record.
 */
export async function loadPostInfo(postId: string, fallback?: unknown): Promise<PostInfo | null> {
  const raw = await redis.get(K.post(postId));
  if (raw) {
    try {
      const info = parsePostWire(JSON.parse(raw));
      if (info) return info;
    } catch {
      // Fall through to postData.
    }
  }
  return parsePostWire(fallback);
}

export async function savePostInfo(postId: string, info: PostInfo): Promise<void> {
  await redis.set(K.post(postId), JSON.stringify(toPostWire(info)));
}

export const titleFor = (info: PostInfo): string =>
  info.kind === 'daily'
    ? postTitle(info.day, puzzleHook(info.puzzle, info.author))
    : routeTitle(info.puzzle, info.author ?? 'a player');

/** Shown on old Reddit, in search and anywhere the interactive post cannot run. */
export function fallbackText(info: PostInfo): string {
  const how =
    'Fold the paper strip until it fills the silhouette, in as few folds as you can. Open this post in the Reddit app or on new Reddit to play.';
  return `Foldline: ${titleFor(info)}.\n\n${how}`;
}

export async function publishPost(
  info: PostInfo,
  asUser?: { text: string }
): Promise<{ id: PostId; authorName: string; permalink: string }> {
  const post = await reddit.submitCustomPost({
    title: titleFor(info),
    entry: 'default',
    postData: toPostWire(info),
    textFallback: { text: fallbackText(info) },
    styles: {
      backgroundColor: `${BG_LIGHT}FF`,
      backgroundColorDark: `${BG_DARK}FF`,
    },
    ...(asUser ? { runAs: 'USER' as const, userGeneratedContent: { text: asUser.text } } : {}),
  });
  await savePostInfo(post.id, info);
  return { id: post.id, authorName: post.authorName, permalink: post.permalink };
}

const THREAD_TEXT =
  'Results thread. Finished the fold? Tap "Share result" on the end card and your spoiler-free grid is posted here as a reply.';

/**
 * The stickied app comment that shared results reply to (the pattern Reddit
 * requires for score comments). Returns null if it cannot be created; callers
 * then fall back to a top-level comment.
 */
export async function ensureThread(postId: PostId): Promise<`t1_${string}` | null> {
  const existing = await redis.hGet(K.threads, postId);
  if (existing?.startsWith('t1_')) return existing as `t1_${string}`;
  if (existing) return null;
  if ((await redis.hSetNX(K.threads, postId, 'pending')) !== 1) return null;
  let comment: Awaited<ReturnType<typeof reddit.submitComment>>;
  try {
    comment = await reddit.submitComment({ id: postId, text: THREAD_TEXT });
  } catch (error) {
    console.warn('Results thread could not be created:', error);
    await redis.hDel(K.threads, [postId]);
    return null;
  }
  await redis.hSet(K.threads, { [postId]: comment.id }).catch((error: unknown) => {
    // Reddit already created the comment. Keep the claim so a retry cannot create another.
    console.warn('Results thread receipt could not be saved:', error);
  });
  await comment.distinguish(true).catch((error: unknown) => {
    console.warn('Results thread could not be stickied:', error);
  });
  return comment.id;
}
