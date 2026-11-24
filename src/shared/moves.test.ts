import { describe, expect, it } from 'vitest';
import { solveLevel } from './engine';
import { generate } from './generator';
import { decodeMoves, encodeMoves, movesToWire, parseMoves, replay } from './moves';
import { toLevel } from './puzzle';

const puzzle = generate('2026-03-04');
const solution = solveLevel(toLevel(puzzle));
if (!solution) throw new Error('fixture puzzle must be solvable');

describe('parseMoves', () => {
  it('accepts a legal wire list', () => {
    expect(
      parseMoves([
        [1, 90],
        [2, -90],
      ])
    ).toEqual([
      { index: 1, angle: 90 },
      { index: 2, angle: -90 },
    ]);
  });

  it.each([
    ['not an array', 'x'],
    ['an empty list', []],
    ['a bad angle', [[1, 45]]],
    ['a non-integer index', [[1.5, 90]]],
    ['a short entry', [[1]]],
    ['a long entry', [[1, 90, 3]]],
  ])('rejects %s', (_name, raw) => {
    expect(parseMoves(raw)).toBeNull();
  });

  it('rejects lists longer than the fold cap', () => {
    expect(parseMoves(Array.from({ length: 401 }, () => [1, 90]))).toBeNull();
  });
});

describe('move encoding', () => {
  it('round-trips the compact string form', () => {
    const moves = [
      { index: 1, angle: 90 as const },
      { index: 2, angle: -90 as const },
      { index: 1, angle: 0 as const },
    ];
    expect(encodeMoves(moves)).toBe('1+2-10');
    expect(decodeMoves(encodeMoves(moves))).toEqual(moves);
  });

  it('round-trips the wire form', () => {
    expect(parseMoves(movesToWire(solution))).toEqual(solution);
  });
});

describe('replay', () => {
  it('replays a real solution to a solve', () => {
    expect(replay(puzzle, solution).solved).toBe(true);
  });

  it('reports an honest unsolved attempt', () => {
    expect(replay(puzzle, [solution[0]!]).solved).toBe(false);
  });

  it('throws on the fixed root hinge', () => {
    expect(() => replay(puzzle, [{ index: 0, angle: 90 }])).toThrow(RangeError);
  });

  it('throws on a hinge past the strip', () => {
    expect(() => replay(puzzle, [{ index: puzzle.turns.length, angle: 90 }])).toThrow(RangeError);
  });

  it('throws on a two-stop jump', () => {
    // Any hinge sitting at 0 can be jumped straight from -90 or to +90... use -90 -> 90 style.
    const flat = puzzle.start.findIndex((angle, i) => i > 0 && angle === 0);
    if (flat > 0) {
      expect(() => replay(puzzle, [{ index: flat, angle: 90 }, { index: flat, angle: -90 }])).not.toThrow();
      expect(() => replay(puzzle, [{ index: flat, angle: 90 }, { index: flat, angle: -90 }, { index: flat, angle: 90 }])).toThrow(RangeError);
    } else {
      // No flat hinge: from -90 a direct +90 is a two-stop jump.
      const low = puzzle.start.findIndex((angle, i) => i > 0 && angle === -90);
      expect(low).toBeGreaterThan(0);
      expect(() => replay(puzzle, [{ index: low, angle: 90 }])).toThrow(RangeError);
    }
  });
});
