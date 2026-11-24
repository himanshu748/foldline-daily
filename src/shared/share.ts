import { applyMove, type FoldAngle, type FoldMove } from './engine';
import { foldDistance, type Puzzle } from './puzzle';
import { formatTime } from './score';

export const CLOSER = '🟦';
export const FURTHER = '🟧';
const ROW = 8;

/**
 * One square per fold: blue when the fold moved the strip closer to the answer,
 * orange when it moved away. It never shows which hinge or which direction, so
 * it spoils nothing.
 */
export function shareGrid(puzzle: Pick<Puzzle, 'turns' | 'start' | 'goal'>, moves: readonly FoldMove[]): string {
  let angles: FoldAngle[] = [...puzzle.start];
  const squares: string[] = [];
  for (const move of moves) {
    const before = foldDistance(angles, puzzle.goal);
    angles = applyMove(puzzle, angles, move);
    squares.push(foldDistance(angles, puzzle.goal) < before ? CLOSER : FURTHER);
  }
  const rows: string[] = [];
  for (let i = 0; i < squares.length; i += ROW) rows.push(squares.slice(i, i + ROW).join(''));
  return rows.join('\n');
}

export interface ShareInput {
  label: string;
  folds: number;
  par: number;
  ms: number;
  grid: string;
  /** Set when the comment is posted by the app account on a player's behalf. */
  onBehalfOf?: string;
}

export function shareText(input: ShareInput): string {
  const headline = `${input.label} · ${input.folds} ${input.folds === 1 ? 'fold' : 'folds'} (par ${input.par}) · ${formatTime(input.ms)}`;
  const owner = input.onBehalfOf ? `u/${input.onBehalfOf}'s result\n\n` : '';
  // Two trailing spaces keep the line break in Reddit markdown.
  return `${owner}${headline}  \n${input.grid.split('\n').join('  \n')}`;
}
