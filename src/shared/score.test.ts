import { describe, expect, it } from 'vitest';
import type { FoldMove } from './engine';
import { bucketFor, decodeScore, encodeScore, formatTime, ordinal, standingText, TIME_CAP_MS } from './score';
import { CLOSER, FURTHER, shareGrid, shareText } from './share';
import { validatePuzzle } from './validate';

describe('leaderboard score', () => {
  it('orders by folds first, then by time', () => {
    expect(encodeScore(5, 9_000_000)).toBeLessThan(encodeScore(6, 1));
    expect(encodeScore(5, 41_000)).toBeLessThan(encodeScore(5, 42_000));
    expect(decodeScore(encodeScore(7, 12_345))).toEqual({ folds: 7, ms: 12_345 });
  });

  it('caps time so it can never spill into the fold count', () => {
    expect(decodeScore(encodeScore(3, 99_999_999))).toEqual({ folds: 3, ms: TIME_CAP_MS });
    expect(decodeScore(encodeScore(3, -5))).toEqual({ folds: 3, ms: 0 });
    expect(decodeScore(encodeScore(3, NaN))).toEqual({ folds: 3, ms: TIME_CAP_MS });
  });

  it('rejects impossible fold counts', () => {
    for (const folds of [0, -1, 1.5, 401]) expect(() => encodeScore(folds, 1000)).toThrow(RangeError);
  });

  it('buckets folds over par with a final open bucket', () => {
    expect(bucketFor(5, 5)).toBe(0);
    expect(bucketFor(7, 5)).toBe(2);
    expect(bucketFor(40, 5)).toBe(6);
    expect(bucketFor(4, 5)).toBe(0);
  });

  it('describes a standing without overstating a small field', () => {
    expect(standingText(0, 1)).toBe('First to finish today');
    expect(standingText(1, 3)).toBe('2nd of 3 so far');
    expect(standingText(10, 19)).toBe('11th of 19 so far');
    expect(standingText(0, 200)).toBe('Top 1% of 200');
    expect(standingText(49, 200)).toBe('Top 25% of 200');
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(23)).toBe('23rd');
    expect(formatTime(42_900)).toBe('0:42');
    expect(formatTime(125_000)).toBe('2:05');
  });
});

describe('share grid', () => {
  const puzzle = {
    turns: ['straight', 'left', 'straight', 'straight'] as const,
    start: [0, 0, 0, 0] as const,
    goal: [0, 90, -90, 90] as const,
  };
  const mutable = { turns: [...puzzle.turns], start: [...puzzle.start], goal: [...puzzle.goal] };

  it('marks each fold as closer or further and nothing else', () => {
    expect(validatePuzzle(mutable).ok).toBe(true);
    const moves: FoldMove[] = [
      { index: 1, angle: 90 },
      { index: 2, angle: 90 },
      { index: 2, angle: 0 },
      { index: 2, angle: -90 },
      { index: 3, angle: 90 },
    ];
    const grid = shareGrid(mutable, moves);
    expect(grid).toBe(`${CLOSER}${FURTHER}${CLOSER}${CLOSER}${CLOSER}`);
    expect(grid).not.toMatch(/[0-9A-Za-z]/);
  });

  it('wraps long attempts into rows of eight', () => {
    const moves: FoldMove[] = [];
    for (let i = 0; i < 5; i++) moves.push({ index: 1, angle: 90 }, { index: 1, angle: 0 });
    expect(shareGrid(mutable, moves).split('\n').map((row) => [...row].length)).toEqual([8, 2]);
  });

  it('writes a headline without hinge numbers or directions', () => {
    const text = shareText({ label: 'Foldline Day 12', folds: 6, par: 5, ms: 42_000, grid: `${CLOSER}${FURTHER}` });
    expect(text.startsWith('Foldline Day 12 · 6 folds (par 5) · 0:42')).toBe(true);
    expect(text).toContain(`${CLOSER}${FURTHER}`);
    const proxied = shareText({ label: 'Foldline Day 12', folds: 1, par: 1, ms: 1000, grid: CLOSER, onBehalfOf: 'someone' });
    expect(proxied.startsWith("u/someone's result")).toBe(true);
    expect(proxied).toContain('1 fold (par 1)');
  });
});
