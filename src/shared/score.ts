/** Leaderboard score: fewest folds first, then fastest time. Lower is better. */
export const TIME_CAP_MS = 9_999_999;
const FOLD_FACTOR = 10_000_000;
export const MAX_FOLDS = 400;

export function encodeScore(folds: number, ms: number): number {
  if (!Number.isInteger(folds) || folds < 1 || folds > MAX_FOLDS) throw new RangeError('Fold count is out of range.');
  const time = Math.max(0, Math.min(TIME_CAP_MS, Math.round(Number.isFinite(ms) ? ms : TIME_CAP_MS)));
  return folds * FOLD_FACTOR + time;
}

export const decodeScore = (score: number): { folds: number; ms: number } => ({
  folds: Math.floor(score / FOLD_FACTOR),
  ms: score % FOLD_FACTOR,
});

/** Distribution buckets are "folds over par": 0, 1, … and a final "6 or more". */
export const DIST_BUCKETS = 7;
export const bucketFor = (folds: number, par: number): number => Math.max(0, Math.min(DIST_BUCKETS - 1, folds - par));

export function formatTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th';
  return `${value}${suffix}`;
}

/** Below this many finishers a percentile would be noise, so a plain rank is shown. */
export const PERCENTILE_MIN_PLAYERS = 20;

/**
 * The sentence under a finished score. Someone with no rank is not "first"
 * unless the leaderboard is actually empty.
 */
export function resultNote(standing: string | null, total: number): string | null {
  if (standing) return `${standing.replace(/[.!?]+$/, '')}.`;
  if (total <= 0) return 'Be the first on the leaderboard.';
  return null;
}

/** How a player stands in the field. `rank` is 0-based; `total` includes the player. */
export function standingText(rank: number, total: number): string {
  if (total <= 1) return 'First to finish today';
  if (total < PERCENTILE_MIN_PLAYERS) return `${ordinal(rank + 1)} of ${total} so far`;
  const percent = Math.max(1, Math.ceil(((rank + 1) / total) * 100));
  return `Top ${percent}% of ${total}`;
}
