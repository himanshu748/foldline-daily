import type { PostInfo } from '../../shared/postdata';

/** A solve kept on the device until Reddit can store it. */
export interface PendingSolve {
  rev: number;
  moves: unknown;
  clientMs: number;
  folds: number;
}

export function isPendingSolve(value: unknown): value is PendingSolve {
  if (typeof value !== 'object' || value === null) return false;
  const pending = value as PendingSolve;
  return Number.isInteger(pending.rev) && pending.rev >= 0 && Array.isArray(pending.moves) && Number.isFinite(pending.clientMs);
}

/**
 * The server copy is the puzzle to play. Cached post data only fills in when
 * the server has not answered, and a different revision means the cached copy
 * was replaced.
 */
export function puzzleForPlay(cached: PostInfo | null, server: PostInfo | null): { info: PostInfo | null; replaced: boolean } {
  if (!server) return { info: cached, replaced: false };
  const replaced = Boolean(cached && (cached.kind !== server.kind || cached.date !== server.date || cached.rev !== server.rev));
  return { info: server, replaced };
}

/** A saved solve can be sent again after a network or server failure. */
export function keepsPendingSolve(code: string | null): boolean {
  return code !== 'invalid-moves' && code !== 'unsolved' && code !== 'stale';
}

export type PendingAction = 'submit' | 'restore' | 'drop' | 'keep';

/**
 * What to do with a solve that was stored on the device.
 * A mismatched revision is dropped so an old solve is never shown on a new puzzle.
 */
export function pendingAction(input: {
  pending: { rev: number } | null;
  rev: number;
  loggedIn: boolean;
  hasServerResult: boolean;
  folded: boolean;
}): PendingAction {
  const { pending, rev, loggedIn, hasServerResult, folded } = input;
  if (!pending) return 'keep';
  if (hasServerResult || pending.rev !== rev) return 'drop';
  if (folded) return 'keep';
  return loggedIn ? 'submit' : 'restore';
}
