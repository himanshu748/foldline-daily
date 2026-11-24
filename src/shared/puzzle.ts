import { isFoldAngle, poseFromAngles, type FoldAngle, type Level, type Turn } from './engine';

/** Part of every seed and stored with every post, so old posts never change. */
export const GENERATOR_VERSION = 1;
export const MIN_PANELS = 3;
export const MAX_PANELS = 7;

/**
 * A fold puzzle. `goal` is the folded shape drawn as the target silhouette.
 * Winning is still decided by the ported docking test on the last panel's pose;
 * the validator guarantees that `goal` is the only fold state that docks.
 */
export interface Puzzle {
  turns: Turn[];
  start: FoldAngle[];
  goal: FoldAngle[];
  par: number;
}

export type PuzzleSource = 'generated' | 'bank' | 'community';

export interface DailyPuzzle extends Puzzle {
  date: string;
  rev: number;
  /** 0 is Monday's tier, 6 is Sunday's. */
  tier: number;
  source: PuzzleSource;
  author?: string;
  routePostId?: string;
}

const TURN_CODES: Record<Turn, string> = { straight: 'S', left: 'L', right: 'R' };
const CODE_TURNS: Record<string, Turn> = { S: 'straight', L: 'left', R: 'right' };
const ANGLE_CODES: Record<FoldAngle, string> = { [-90]: '-', [0]: '0', [90]: '+' };
const CODE_ANGLES: Record<string, FoldAngle> = { '-': -90, '0': 0, '+': 90 };

export const encodeTurns = (turns: readonly Turn[]): string =>
  turns.map((turn) => TURN_CODES[turn]).join('');

export function decodeTurns(code: unknown): Turn[] | null {
  if (typeof code !== 'string' || code.length < 1 || code.length > MAX_PANELS) return null;
  const turns: Turn[] = [];
  for (const char of code) {
    const turn = CODE_TURNS[char];
    if (!turn) return null;
    turns.push(turn);
  }
  return turns;
}

export const encodeAngles = (angles: readonly FoldAngle[]): string =>
  angles.map((angle) => ANGLE_CODES[angle]).join('');

export function decodeAngles(code: unknown): FoldAngle[] | null {
  if (typeof code !== 'string' || code.length < 1 || code.length > MAX_PANELS) return null;
  const angles: FoldAngle[] = [];
  for (const char of code) {
    const angle = CODE_ANGLES[char];
    if (angle === undefined) return null;
    angles.push(angle);
  }
  return angles;
}

export const puzzleSignature = (puzzle: Pick<Puzzle, 'turns' | 'start' | 'goal'>): string =>
  `${encodeTurns(puzzle.turns)}|${encodeAngles(puzzle.start)}|${encodeAngles(puzzle.goal)}`;

export function toLevel(puzzle: Pick<Puzzle, 'turns' | 'start' | 'goal'> & { par?: number }): Level {
  return {
    turns: [...puzzle.turns],
    initial: [...puzzle.start],
    target: poseFromAngles({ turns: puzzle.turns }, puzzle.goal),
    par: puzzle.par ?? 0,
  };
}

/** One-stop moves between two fold states (Manhattan distance on the stop grid). */
export function foldDistance(a: readonly number[], b: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    total += Math.abs((a[i] ?? 0) - (b[i] ?? 0)) / 90;
  return total;
}

export const isAngleList = (value: unknown): value is FoldAngle[] =>
  Array.isArray(value) && value.every(isFoldAngle);

export const isTurnList = (value: unknown): value is Turn[] =>
  Array.isArray(value) &&
  value.every((turn) => turn === 'straight' || turn === 'left' || turn === 'right');
