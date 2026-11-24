import { generate } from '../../src/shared/generator';
import { toPostWire } from '../../src/shared/postdata';

export function harnessPuzzle(date: string) {
  const made = generate(date);
  const puzzle = { turns: made.turns, start: made.start, goal: made.goal, par: made.par };
  const post = toPostWire({
    kind: 'daily',
    date,
    day: 1,
    rev: made.rev,
    tier: made.tier,
    puzzle,
    source: made.source,
  });
  return { puzzle, post };
}
