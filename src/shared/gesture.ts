/**
 * Gesture preview is continuous; only a deliberate release commits one legal stop.
 * Ported from Foldline (WebXR), `src/game/fold-gesture.ts`. The original measured
 * hand travel in metres; here `distance` is drag travel in panel lengths on screen,
 * so the defaults were retuned for thumbs.
 */
export const FOLD_SPAN = 0.9;
export const FOLD_THRESHOLD = 0.3;
export const FOLD_ARM = 0.34;
export const FOLD_RELEASE = 0.22;

export type FoldIntent = -1 | 0 | 1;

const canMove = (start: number, direction: number) =>
  start + direction * 90 >= -90 && start + direction * 90 <= 90;

export function foldPreview(start: number, distance: number, span = FOLD_SPAN): number {
  if (!Number.isFinite(distance)) return start;
  // A single release commits one stop, so its preview must never promise two.
  return Math.max(-90, Math.min(90, start + Math.max(-1, Math.min(1, distance / span)) * 90));
}

export function releasedFold(start: number, distance: number, threshold = FOLD_THRESHOLD): FoldIntent {
  if (!Number.isFinite(distance) || Math.abs(distance) < threshold) return 0;
  const direction = distance > 0 ? 1 : -1;
  return canMove(start, direction) ? direction : 0;
}

/**
 * A deliberate drag arms a fold; a shorter one releases it. Hysteresis prevents
 * finger jitter from flickering between ready and cancel at the boundary.
 */
export function foldIntent(start: number, distance: number, previous: FoldIntent = 0): FoldIntent {
  if (!Number.isFinite(distance)) return 0;
  if (previous && distance * previous >= FOLD_RELEASE && canMove(start, previous)) return previous;
  return releasedFold(start, distance, FOLD_ARM);
}
