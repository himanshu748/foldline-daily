import { applyMove, isFoldAngle, isSolved, type FoldAngle, type FoldMove } from './engine';
import { toLevel, type Puzzle } from './puzzle';
import { MAX_FOLDS } from './score';

/** A fold on the wire: `[hinge index, new angle]`. */
export type MoveWire = [index: number, angle: number];

export function parseMoves(raw: unknown): FoldMove[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_FOLDS) return null;
  const moves: FoldMove[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [index, angle] = entry as unknown[];
    if (typeof index !== 'number' || !Number.isInteger(index) || !isFoldAngle(angle)) return null;
    moves.push({ index, angle });
  }
  return moves;
}

export const movesToWire = (moves: readonly FoldMove[]): MoveWire[] =>
  moves.map((move) => [move.index, move.angle]);

const ANGLE_CHAR: Record<FoldAngle, string> = { [-90]: '-', [0]: '0', [90]: '+' };

/** Compact storage form, e.g. `1+2-3+`. Hinge indices are single digits. */
export const encodeMoves = (moves: readonly FoldMove[]): string =>
  moves.map((move) => `${move.index}${ANGLE_CHAR[move.angle]}`).join('');

export function decodeMoves(code: string): FoldMove[] {
  const moves: FoldMove[] = [];
  for (let i = 0; i + 1 < code.length; i += 2) {
    const index = Number(code[i]);
    const char = code[i + 1];
    const angle = char === '+' ? 90 : char === '-' ? -90 : 0;
    if (Number.isInteger(index)) moves.push({ index, angle });
  }
  return moves;
}

/**
 * Replays an attempt with the same rules the client used. Throws `RangeError`
 * on any illegal move, so a forged list can never be scored.
 */
export function replay(
  puzzle: Pick<Puzzle, 'turns' | 'start' | 'goal'>,
  moves: readonly FoldMove[]
): { angles: FoldAngle[]; solved: boolean } {
  const level = toLevel(puzzle);
  let angles: FoldAngle[] = [...puzzle.start];
  for (const move of moves) angles = applyMove(level, angles, move);
  return { angles, solved: isSolved(level, angles) };
}
