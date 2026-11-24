import type { Turn } from './engine';
import type { Puzzle } from './puzzle';

/** One weekday's puzzle shape. Index 0 is Monday, 6 is Sunday. */
export interface Tier {
  panels: number;
  parMin: number;
  parMax: number;
  /** Corners in the strip (panels whose exit turns left or right). */
  turnsMin: number;
  turnsMax: number;
  /** Early-week puzzles start from a flat strip, which is the easiest to read. */
  flatStart: boolean;
}

export const TIERS: readonly Tier[] = [
  { panels: 3, parMin: 2, parMax: 2, turnsMin: 0, turnsMax: 2, flatStart: true },
  { panels: 4, parMin: 3, parMax: 3, turnsMin: 0, turnsMax: 1, flatStart: true },
  { panels: 4, parMin: 4, parMax: 4, turnsMin: 1, turnsMax: 2, flatStart: false },
  { panels: 5, parMin: 5, parMax: 5, turnsMin: 1, turnsMax: 2, flatStart: false },
  { panels: 5, parMin: 6, parMax: 6, turnsMin: 2, turnsMax: 3, flatStart: false },
  { panels: 6, parMin: 7, parMax: 7, turnsMin: 2, turnsMax: 4, flatStart: false },
  { panels: 7, parMin: 9, parMax: 10, turnsMin: 3, turnsMax: 5, flatStart: false },
];

/**
 * Community Routes replace Sunday's puzzle, so they must be harder than any
 * Saturday puzzle can be (see `difficultyScore`).
 */
export const ROUTE_RULES = { minPanels: 6, maxPanels: 7, minPar: 8 } as const;

export const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

/** The last panel's turn changes nothing visible, so it is not counted. */
export const turnCount = (turns: readonly Turn[]): number =>
  turns.slice(0, -1).filter((turn) => turn !== 'straight').length;

/**
 * One number for "how hard is this". Par dominates; strip length, corners and
 * a folded start add a little. The tier bands never overlap, which is what the
 * 120-day test asserts.
 */
export function difficultyScore(puzzle: Pick<Puzzle, 'turns' | 'start' | 'par'>): number {
  const flat = puzzle.start.every((angle) => angle === 0);
  return puzzle.par * 10 + puzzle.turns.length * 2 + turnCount(puzzle.turns) + (flat ? 0 : 2);
}
