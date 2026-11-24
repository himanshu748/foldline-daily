// Ported from Foldline (WebXR), `src/game/edge-coverage.test.ts`. The original
// covered the campaign and the curated daily rotation; here it covers the
// campaign fixtures and the fallback bank that replaced the rotation.
import { expect, it } from 'vitest';
import { applyMove, FOLD_ANGLES, isSolved, solveLevel, type FoldAngle } from './engine';
import { LEVELS } from './__fixtures__/levels';
import { BANK } from './bank';
import { toLevel } from './puzzle';

it('gives a valid shortest hint path from every legal campaign and bank arrangement', () => {
  const levels = [
    ...LEVELS.map((level) => ({ id: level.id, level })),
    ...BANK.map((puzzle, index) => ({ id: `bank-${index}`, level: toLevel(puzzle) })),
  ];
  let arrangements = 0;
  for (const { id, level } of levels) {
    let states: FoldAngle[][] = [[0]];
    for (let i = 1; i < level.initial.length; i++) {
      states = states.flatMap((state) => FOLD_ANGLES.map((angle) => [...state, angle]));
    }
    const solutions = states.filter((state) => isSolved(level, state));
    expect(solutions.length, id).toBeGreaterThan(0);
    for (const state of states) {
      const original = [...state];
      const path = solveLevel(level, state);
      expect(path, `${id}: ${state}`).not.toBeNull();
      const shortest = Math.min(
        ...solutions.map((target) =>
          target.reduce<number>((sum, angle, i) => sum + Math.abs(angle - state[i]!) / 90, 0)
        )
      );
      expect(path!.length, `${id}: ${state}`).toBe(shortest);
      const final = path!.reduce((current, move) => applyMove(level, current, move), state);
      expect(isSolved(level, final)).toBe(true);
      expect(state).toEqual(original);
      arrangements++;
    }
  }
  expect(arrangements).toBe(levels.reduce((sum, { level }) => sum + 3 ** (level.initial.length - 1), 0));
});
