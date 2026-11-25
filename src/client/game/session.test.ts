import { describe, expect, it } from 'vitest';
import type { PostInfo } from '../../shared/postdata';
import { isPendingSolve, pendingAction, puzzleForPlay } from './session';

const puzzle = {
  turns: ['straight', 'straight', 'straight'] as const,
  start: [0, 0, 0] as const,
  goal: [0, 90, 0] as const,
  par: 1,
};

function info(rev: number, date = '2026-11-18'): PostInfo {
  return {
    kind: 'daily',
    date,
    day: 3,
    rev,
    tier: 2,
    puzzle: {
      turns: [...puzzle.turns],
      start: [...puzzle.start],
      goal: [...puzzle.goal],
      par: puzzle.par,
    },
    source: 'generated',
  };
}

describe('puzzleForPlay', () => {
  it('plays the cached puzzle before the server answers', () => {
    const cached = info(0);
    expect(puzzleForPlay(cached, null)).toEqual({
      info: cached,
      replaced: false,
    });
  });

  it('plays the server puzzle when a moderator regenerated the post', () => {
    const cached = info(0);
    const server = info(2);
    expect(puzzleForPlay(cached, server)).toEqual({
      info: server,
      replaced: true,
    });
  });

  it('keeps the server puzzle when the cache already matches', () => {
    const cached = info(1);
    const server = info(1);
    expect(puzzleForPlay(cached, server)).toEqual({
      info: server,
      replaced: false,
    });
  });
});

describe('pendingAction', () => {
  const pending = { rev: 1 };

  it('restores a logged-out solve for the puzzle on screen', () => {
    expect(
      pendingAction({
        pending,
        rev: 1,
        loggedIn: false,
        hasServerResult: false,
        folded: false,
      })
    ).toBe('restore');
  });

  it('submits that solve once the player is logged in', () => {
    expect(
      pendingAction({
        pending,
        rev: 1,
        loggedIn: true,
        hasServerResult: false,
        folded: false,
      })
    ).toBe('submit');
  });

  it('drops a solve from a puzzle that was regenerated', () => {
    expect(
      pendingAction({
        pending,
        rev: 2,
        loggedIn: false,
        hasServerResult: false,
        folded: false,
      })
    ).toBe('drop');
  });

  it('leaves the solve alone once this visit has already folded', () => {
    expect(
      pendingAction({
        pending,
        rev: 1,
        loggedIn: true,
        hasServerResult: false,
        folded: true,
      })
    ).toBe('keep');
  });

  it('drops a stored solve when the server already has a score', () => {
    expect(
      pendingAction({
        pending,
        rev: 1,
        loggedIn: true,
        hasServerResult: true,
        folded: false,
      })
    ).toBe('drop');
  });
});

describe('isPendingSolve', () => {
  it('accepts a stored solve and rejects a partial one', () => {
    expect(isPendingSolve({ rev: 1, moves: [[1, 90]], clientMs: 1200, folds: 1 })).toBe(true);
    expect(isPendingSolve({ rev: 1, moves: [], clientMs: 0, folds: 0 })).toBe(true);
    expect(isPendingSolve({ rev: 1, clientMs: 10 })).toBe(false);
    expect(isPendingSolve(null)).toBe(false);
  });
});
