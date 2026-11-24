import type { FoldAngle, Turn } from './engine';
import { epochDay } from './dates';
import { foldDistance, type Puzzle } from './puzzle';

/**
 * Last-resort puzzles, used only if the seeded generator fails every attempt.
 * They are the six route families of the original Foldline daily rotation,
 * each with one of its original starting folds. Tests prove that every entry
 * passes the validator and that 120 generated days never need the bank.
 */
const FAMILIES: ReadonlyArray<{ turns: Turn[]; start: FoldAngle[]; goal: FoldAngle[] }> = [
  { turns: ['straight', 'straight', 'straight'], start: [0, 0, 0], goal: [0, 90, -90] },
  { turns: ['straight', 'left', 'straight'], start: [0, 0, -90], goal: [0, 90, 0] },
  { turns: ['right', 'left', 'straight'], start: [0, 0, -90], goal: [0, 90, 0] },
  { turns: ['straight', 'straight', 'right', 'straight'], start: [0, 0, 0, 90], goal: [0, 90, -90, 0] },
  { turns: ['left', 'straight', 'right', 'straight'], start: [0, -90, 0, 0], goal: [0, 90, -90, 90] },
  { turns: ['straight', 'right', 'straight', 'straight'], start: [0, 0, -90, -90], goal: [0, 90, -90, 0] },
];

export const BANK: readonly Puzzle[] = FAMILIES.map((family) => ({
  turns: [...family.turns],
  start: [...family.start],
  goal: [...family.goal],
  par: foldDistance(family.start, family.goal),
}));

export function bankPuzzle(date: string): Puzzle {
  const entry = BANK[((epochDay(date) % BANK.length) + BANK.length) % BANK.length]!;
  return { turns: [...entry.turns], start: [...entry.start], goal: [...entry.goal], par: entry.par };
}
