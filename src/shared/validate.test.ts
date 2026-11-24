import { describe, expect, it } from 'vitest';
import { applyMove, isSolved, type FoldAngle, type Turn } from './engine';
import { BANK } from './bank';
import { ROUTE_RULES } from './difficulty';
import { toLevel } from './puzzle';
import { analyzeTurns, LOOKALIKE_MIN_MARGIN, stateAngles, stateIndex, validatePuzzle } from './validate';

const S: Turn = 'straight';
const L: Turn = 'left';
const R: Turn = 'right';

describe('state indexing', () => {
  it('round-trips every state of a five-panel strip', () => {
    for (let index = 0; index < 81; index++) expect(stateIndex(stateAngles(index, 4))).toBe(index);
  });
});

describe('validatePuzzle', () => {
  const good = { turns: [S, L, S, S], start: [0, 0, 0, 0] as FoldAngle[], goal: [0, 90, -90, 90] as FoldAngle[] };

  it('accepts a sound puzzle and returns a replayable shortest path', () => {
    const result = validatePuzzle(good);
    expect(result).toMatchObject({ ok: true, par: 3, reasons: [] });
    expect(result.margin).toBeGreaterThanOrEqual(LOOKALIKE_MIN_MARGIN);
    const level = toLevel(good);
    const end = result.path.reduce((angles, move) => applyMove(level, angles, move), good.start);
    expect(isSolved(level, end)).toBe(true);
    expect(result.path).toHaveLength(3);
  });

  it('rejects malformed input without throwing', () => {
    const cases: Array<{ turns: unknown; start: unknown; goal: unknown }> = [
      { turns: 'SLS', start: [0, 0, 0], goal: [0, 90, 0] },
      { turns: [S, S], start: [0, 0], goal: [0, 90] },
      { turns: new Array(8).fill(S), start: new Array(8).fill(0), goal: new Array(8).fill(0) },
      { turns: [S, S, S], start: [0, 0], goal: [0, 90, 0] },
      { turns: [S, S, S], start: [0, 45, 0], goal: [0, 90, 0] },
      { turns: [S, S, S], start: [90, 0, 0], goal: [0, 90, 0] },
      { turns: [S, 'up', S], start: [0, 0, 0], goal: [0, 90, 0] },
      { turns: null, start: null, goal: null },
    ];
    for (const input of cases) expect(validatePuzzle(input)).toMatchObject({ ok: false, reasons: ['shape'] });
  });

  it('rejects a puzzle that starts solved', () => {
    expect(validatePuzzle({ ...good, start: good.goal }).reasons).toEqual(['already-solved']);
  });

  it('rejects a target that more than one fold state reaches', () => {
    // From the ported engine tests: two different fold states share this docking pose.
    const result = validatePuzzle({
      turns: [S, S, S, S, S],
      start: [0, 0, 0, 0, 0],
      goal: [0, -90, -90, 90, -90],
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('multiple-answers');
  });

  it('rejects overlapping start and goal shapes', () => {
    const turns = [S, S, S, S, S];
    const folded: FoldAngle[] = [0, 90, 90, 90, 90];
    expect(validatePuzzle({ turns, start: folded, goal: [0, 90, 0, 0, 0] }).reasons).toContain('overlap-start');
    expect(validatePuzzle({ turns, start: [0, 0, 0, 0, 0], goal: folded }).reasons).toContain('overlap-goal');
  });

  it('rejects a goal whose outline could be mistaken for another state', () => {
    let found: { turns: Turn[]; goal: FoldAngle[] } | null = null;
    outer: for (const a of [S, L, R]) for (const b of [S, L, R]) for (const c of [S, L, R]) for (const d of [S, L, R]) {
      const turns = [a, b, c, d, S];
      const analysis = analyzeTurns(turns);
      for (let index = 0; index < analysis.size; index++) {
        const unique = analysis.poseCounts.get(analysis.poseKeys[index]!) === 1;
        if (unique && analysis.clean[index] && analysis.margin(index) < LOOKALIKE_MIN_MARGIN) {
          found = { turns, goal: stateAngles(index, analysis.hinges) };
          break outer;
        }
      }
    }
    expect(found).not.toBeNull();
    const result = validatePuzzle({ turns: found!.turns, start: [0, 0, 0, 0, 0], goal: found!.goal });
    expect(result.reasons).toContain('look-alike');
  });

  it('applies par and panel rules for Community Routes', () => {
    expect(validatePuzzle(good, ROUTE_RULES).reasons).toEqual(['shape']);
    const turns = [S, L, S, R, S, S];
    const start: FoldAngle[] = [0, -90, 0, -90, 0, -90];
    const goal: FoldAngle[] = [0, 90, 0, 90, 0, 90];
    const base = validatePuzzle({ turns, start, goal });
    expect(base.par).toBe(6);
    expect(validatePuzzle({ turns, start, goal }, ROUTE_RULES).reasons).toContain('par-range');
  });

  it('keeps the look-alike threshold frozen', () => {
    expect(LOOKALIKE_MIN_MARGIN).toBe(0.1);
  });

  it.each(BANK.map((puzzle, index) => ({ index, puzzle })))('fallback bank entry $index is valid', ({ puzzle }) => {
    const result = validatePuzzle(puzzle);
    expect(result.reasons).toEqual([]);
    expect(result.par).toBe(puzzle.par);
  });
});
