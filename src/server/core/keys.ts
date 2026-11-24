import type { PostInfo } from '../../shared/postdata';

/** Day keys are kept for 400 days so storage stays bounded. */
export const DAY_TTL_SECONDS = 400 * 86_400;

/**
 * A board is one puzzle's set of results. Daily boards include the revision,
 * so regenerating a day starts a clean board. Route posts have their own.
 */
export const boardFor = (info: Pick<PostInfo, 'kind' | 'date' | 'rev'>, postId: string): string =>
  info.kind === 'daily' ? `day:${info.date}:r${info.rev}` : `route:${postId}`;

export const dayBoard = (date: string, rev: number): string => `day:${date}:r${rev}`;

/** Every Redis key the app uses. Devvit Redis cannot list keys, so related records share hashes. */
export const K = {
  /** hash: date -> postId, or `pending:<ms>` while a run is creating the post. */
  posts: 'fl:posts',
  /** hash: one-shot takeover markers for stale claims. */
  claims: 'fl:claims',
  /** hash: postId, rev, day. */
  day: (date: string) => `fl:day:${date}`,
  /** string: the post's puzzle as JSON (the authoritative copy of postData). */
  post: (postId: string) => `fl:post:${postId}`,
  /** hash: postId -> id of the stickied results comment. */
  threads: 'fl:threads',
  /** hash: userId -> server time of the first fold. */
  start: (board: string) => `fl:${board}:start`,
  /** hash: userId -> `folds|ms|moves`. Written once with HSETNX. */
  result: (board: string) => `fl:${board}:result`,
  /** sorted set: username -> encoded score (lower is better). */
  lb: (board: string) => `fl:${board}:lb`,
  /** hash: folds-over-par bucket -> players. */
  dist: (board: string) => `fl:${board}:dist`,
  /** hash: userId -> comment id of the shared result. */
  shared: (board: string) => `fl:${board}:shared`,
  /** hash: funnel event -> count. */
  funnel: (date: string) => `fl:funnel:${date}`,
  /** hash: `userId:event` -> 1, for once-per-day events. */
  seen: (date: string) => `fl:seen:${date}`,
  /** hash: cur, best, last, grace, flairOptIn, flairTier, subscribed, name. */
  user: (userId: string) => `fl:user:${userId}`,
  /** hash: username -> snoovatar URL ('' when the player has none). */
  avatars: 'fl:avatars',
  /** hash: route postId -> route record JSON. `week` is the Monday of the target Sunday's week. */
  routes: (week: string) => `fl:routes:${week}`,
  /** hash: authorId -> route postId. One route per player per week. */
  routesBy: (week: string) => `fl:routes:${week}:by`,
  /** hash: puzzle signature -> route postId. No duplicate puzzles. */
  routeSig: 'fl:routes:sig',
  /** hash: route postId -> week. */
  routePost: 'fl:routes:post',
  /** hash: date -> 1 for days a moderator skipped. */
  skip: 'fl:skip',
  /** hash: installDate. */
  config: 'fl:config',
} as const;

export const boardKeys = (board: string): string[] => [
  K.start(board),
  K.result(board),
  K.lb(board),
  K.dist(board),
  K.shared(board),
];
