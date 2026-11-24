// Ported from Foldline (WebXR), `src/game/engine.test.ts`.
import { describe, expect, it } from 'vitest';
import {
  applyMove, calculateFrames, computeFrames, countMoves, findPanelOverlaps,
  FOLD_ANGLES, interpolateFrames, isSolved, PANEL_SIZE, poseFromAngles, rotateVector, solveLevel,
  type FoldAngle, type Level, type Turn, type Vec3,
} from './engine';
import { LEVELS } from './__fixtures__/levels';

function close(actual: readonly number[], expected: readonly number[]) {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 8));
}

function states(count: number): FoldAngle[][] {
  let result: FoldAngle[][] = [[0]];
  for (let i = 1; i < count; i++) result = result.flatMap(prefix => FOLD_ANGLES.map(angle => [...prefix, angle]));
  return result;
}

function fixture(turns: Turn[], solution: FoldAngle[], initial: FoldAngle[]): Level {
  return { turns, initial, target: poseFromAngles({ turns }, solution), par: 0 };
}

describe('hinged geometry', () => {
  it('keeps a flat straight chain at its exact expected coordinates', () => {
    const result = calculateFrames({ turns: ['straight', 'straight', 'straight'] }, [0, 0, 0]);
    close(result.endpoint, [0, 0, -3 * PANEL_SIZE]);
    close(result.frames[1]!.center, [0, 0, -1.5 * PANEL_SIZE]);
    close(result.direction, [0, 0, -1]);
    close(result.normal, [0, 1, 0]);
    expect(computeFrames).toBe(calculateFrames);
  });

  it('folds the child about the shared edge, without translating its hinge', () => {
    const result = calculateFrames({ turns: ['straight', 'straight'] }, [0, 90]);
    close(result.frames[1]!.start, [0, 0, -PANEL_SIZE]);
    close(result.endpoint, [0, PANEL_SIZE, -PANEL_SIZE]);
    close(result.normal, [0, 0, 1]);
    close(result.direction, [0, 1, 0]);
  });

  it('interpolates render geometry while keeping puzzle state discrete', () => {
    const level = { turns: ['straight', 'straight'] as Turn[] };
    const result = interpolateFrames(level, [0, 45]);
    close(result.endpoint, [0, PANEL_SIZE / Math.sqrt(2), -PANEL_SIZE - PANEL_SIZE / Math.sqrt(2)]);
    close(result.frames[1]!.start, [0, 0, -PANEL_SIZE]);
    expect(() => calculateFrames(level, [0, 45])).toThrow(RangeError);
    expect(() => interpolateFrames(level, [0, 96], true)).not.toThrow();
    expect(() => interpolateFrames(level, [0, 106], true)).toThrow(RangeError);
    for (const angles of [[0, 91], [0, -91], [0, NaN], [0, Infinity], [1, 45], [0]]) {
      expect(() => interpolateFrames(level, angles)).toThrow(RangeError);
    }
  });

  it('conserves both endpoints of every shared hinge through turns and folds', () => {
    const level = { turns: ['left', 'right', 'straight', 'left', 'straight'] as Turn[] };
    for (const angles of states(level.turns.length)) {
      const { frames } = calculateFrames(level, angles);
      for (let i = 1; i < frames.length; i++) {
        const parent = frames[i - 1]!;
        const child = frames[i]!;
        close(child.start, parent.end);
        const exitTangent: Vec3 = level.turns[i - 1] === 'left' ? [0, 0, -1]
          : level.turns[i - 1] === 'right' ? [0, 0, 1] : [1, 0, 0];
        const parentTangent = rotateVector(exitTangent, parent.quaternion);
        const childTangent = rotateVector([1, 0, 0], child.quaternion);
        for (const sign of [-1, 1]) {
          close(parent.end.map((v, k) => v + sign * parentTangent[k]! * PANEL_SIZE / 2),
            child.start.map((v, k) => v + sign * childTangent[k]! * PANEL_SIZE / 2));
        }
        expect(Math.hypot(...child.quaternion)).toBeCloseTo(1, 10);
        close(rotateVector([0, 0, -PANEL_SIZE / 2], child.quaternion),
          child.center.map((v, k) => v - child.start[k]!));
      }
    }
  });

  it('rejects invalid root, angle values, shape and unknown turns', () => {
    const level = { turns: ['straight', 'left'] as Turn[] };
    for (const angles of [[90, 0], [0], [0, 0, 0], [0, 45], [0, NaN], [0, Infinity]]) {
      expect(() => calculateFrames(level, angles)).toThrow(RangeError);
    }
    expect(() => calculateFrames({ turns: [] }, [])).toThrow(RangeError);
    expect(() => calculateFrames({ turns: ['unknown' as Turn] }, [0])).toThrow(RangeError);
  });
});

describe('geometric docking and shortest hints', () => {
  it.each(LEVELS)('$id has a nontrivial, valid shortest path to a clear elevated target', level => {
    expect(isSolved(level, level.initial)).toBe(false);
    expect(level.target.point[1]).toBeGreaterThan(0);
    expect(findPanelOverlaps(level, level.initial)).toEqual([]);
    const path = solveLevel(level);
    expect(path).not.toBeNull();
    let angles = [...level.initial];
    for (const move of path!) {
      expect(Math.abs(move.angle - angles[move.index]!)).toBe(90);
      angles = applyMove(level, angles, move);
    }
    expect(isSolved(level, angles)).toBe(true);
    expect(findPanelOverlaps(level, angles)).toEqual([]);
    expect(solveLevel(level, angles)).toEqual([]);
    expect(countMoves(level, angles)).toBe(0);
    expect(path!.length).toBe(level.par);
    // Independent lower bound: each one-stop move changes one coordinate by one.
    // The finite state grid has no collision barriers, so Manhattan distance is exact.
    const minimum = Math.min(...states(level.turns.length).filter(state => isSolved(level, state))
      .map(state => state.reduce<number>((total, angle, index) => total + Math.abs(angle - level.initial[index]!) / 90, 0)));
    expect(path!.length).toBe(minimum);
  });

  it('accepts distinct fold arrangements with an identical physical docking pose', () => {
    const level = fixture(['straight', 'straight', 'straight', 'straight', 'straight'],
      [0, -90, -90, 90, -90], [0, 0, 0, 0, 0]);
    const alternative: FoldAngle[] = [0, -90, 0, -90, 0];
    expect(isSolved(level, alternative)).toBe(true);
    expect(solveLevel(level, alternative)).toEqual([]);
  });

  it('requires matching direction and face, not just reaching a point', () => {
    const level = fixture(['straight', 'straight'], [0, 90], [0, 0]);
    expect(isSolved({ ...level, target: { ...level.target, direction: [0, -1, 0] } }, [0, 90])).toBe(false);
    expect(isSolved({ ...level, target: { ...level.target, normal: [0, 0, -1] } }, [0, 90])).toBe(false);
  });

  it('reports an unreachable target without looping', () => {
    const level = fixture(['straight', 'straight'], [0, 90], [0, 0]);
    level.target.point = [100, 100, 100];
    expect(solveLevel(level)).toBeNull();
    expect(countMoves(level)).toBe(-1);
  });

  it('makes hints deterministic and leaves inputs unchanged', () => {
    const level = LEVELS[7]!;
    const initial = [...level.initial];
    expect(solveLevel(level)).toEqual(solveLevel(level));
    expect(level.initial).toEqual(initial);
    const next = applyMove(level, initial, { index: 1, angle: 90 });
    expect(next).not.toBe(initial);
    expect(initial).toEqual(level.initial);
  });

  it('prevents root movement, duplicate positions and skipped hinge stops', () => {
    const level = LEVELS[1]!;
    expect(() => applyMove(level, level.initial, { index: 0, angle: 90 })).toThrow(RangeError);
    expect(() => applyMove(level, level.initial, { index: 1, angle: 90 })).toThrow(RangeError);
    expect(() => applyMove(level, level.initial, { index: 1, angle: -90 })).toThrow(RangeError);
    expect(() => applyMove(level, level.initial, { index: 2, angle: 0 })).toThrow(RangeError);
  });
});

describe('advisory static overlap detection', () => {
  it('detects a chain folded back through a nonadjacent panel', () => {
    const level = { turns: ['straight', 'straight', 'straight', 'straight', 'straight'] as Turn[] };
    expect(findPanelOverlaps(level, [0, 0, 0, 0, 0])).toEqual([]);
    expect(findPanelOverlaps(level, [0, 90, 90, 90, 90])).toContainEqual([0, 4]);
  });
});
