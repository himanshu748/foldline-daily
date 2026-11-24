import { describe, expect, it } from 'vitest';
import { separateHinges } from './stage-hinges';

describe('separateHinges', () => {
  it('places badges in index order and separates coincident points', () => {
    const result = separateHinges([
      { index: 2, x: 50, y: 50 },
      { index: 1, x: 50, y: 50 },
      { index: 3, x: 50, y: 50 },
    ], 200, 200);
    expect(result).toEqual([
      { index: 1, x: 50, y: 50 },
      { index: 2, x: 50, y: 78 },
      { index: 3, x: 50, y: 106 },
    ]);
  });

  it('clamps badges and resolves collisions at an edge', () => {
    const result = separateHinges([
      { index: 1, x: 99, y: 99 },
      { index: 2, x: 99, y: 99 },
      { index: 3, x: -20, y: 200 },
    ], 100, 100);
    for (const point of result) {
      expect(point.x).toBeGreaterThanOrEqual(14);
      expect(point.x).toBeLessThanOrEqual(86);
      expect(point.y).toBeGreaterThanOrEqual(14);
      expect(point.y).toBeLessThanOrEqual(86);
    }
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        expect(Math.hypot(result[i]!.x - result[j]!.x, result[i]!.y - result[j]!.y)).toBeGreaterThanOrEqual(26);
      }
    }
  });
});
