import { turnCount } from './difficulty';
import type { Puzzle } from './puzzle';

const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'] as const;
const word = (value: number): string => NUMBER_WORDS[value] ?? String(value);

/**
 * The hook after "Day N" in a post title. It is assembled from the puzzle's
 * own traits, so every title is true and no model writes text at runtime.
 */
export function puzzleHook(puzzle: Pick<Puzzle, 'turns' | 'par'>, author?: string): string {
  if (author) return `Community Route by u/${author} · par ${puzzle.par}`;
  const corners = turnCount(puzzle.turns);
  const shape =
    corners === 0
      ? 'a straight strip'
      : `${word(corners).toLowerCase()} ${corners === 1 ? 'corner' : 'corners'}`;
  return `${word(puzzle.turns.length)} panels, ${shape} · par ${puzzle.par}`;
}

export const postTitle = (day: number, hook: string): string => `Day ${day} · ${hook}`;

/** The title of a Community Route's own post. */
export const routeTitle = (puzzle: Pick<Puzzle, 'turns' | 'par'>, author: string): string =>
  `Community Route · ${word(puzzle.turns.length)} panels · par ${puzzle.par} · by u/${author}`;
