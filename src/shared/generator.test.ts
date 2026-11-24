import { describe, expect, it } from 'vitest';
import { applyMove, isSolved, solveLevel } from './engine';
import { addDays, weekdayIndex } from './dates';
import { difficultyScore, ROUTE_RULES, TIERS, turnCount } from './difficulty';
import { generate } from './generator';
import { puzzleHook, postTitle } from './hooks';
import { puzzleSignature, toLevel, type DailyPuzzle } from './puzzle';
import { validatePuzzle } from './validate';

const START = '2026-11-16'; // a Monday
const DAYS = 120;
const days: DailyPuzzle[] = Array.from({ length: DAYS }, (_, i) => generate(addDays(START, i)));

describe('120 consecutive days', () => {
  it('starts on a Monday so whole weeks can be compared', () => {
    expect(weekdayIndex(START)).toBe(0);
  });

  it.each(days.map((puzzle) => ({ date: puzzle.date, puzzle })))('$date is solvable at its stored par', ({ puzzle }) => {
    const tier = TIERS[weekdayIndex(puzzle.date)]!;
    expect(puzzle.source).toBe('generated');
    expect(puzzle.tier).toBe(weekdayIndex(puzzle.date));
    expect(puzzle.turns).toHaveLength(tier.panels);

    const validation = validatePuzzle(puzzle);
    expect(validation.reasons).toEqual([]);
    expect(validation.par).toBe(puzzle.par);

    // The ported solver agrees with the stored par, and its path really solves it.
    const level = toLevel(puzzle);
    const path = solveLevel(level);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(puzzle.par);
    const end = path!.reduce((angles, move) => applyMove(level, angles, move), puzzle.start);
    expect(isSolved(level, end)).toBe(true);
    const cleanEnd = validation.path.reduce((angles, move) => applyMove(level, angles, move), puzzle.start);
    expect(cleanEnd).toEqual(puzzle.goal);

    expect(puzzle.par).toBeGreaterThanOrEqual(tier.parMin);
    expect(puzzle.par).toBeLessThanOrEqual(tier.parMax);
    expect(turnCount(puzzle.turns)).toBeGreaterThanOrEqual(tier.turnsMin);
    expect(turnCount(puzzle.turns)).toBeLessThanOrEqual(tier.turnsMax);
    if (tier.flatStart) expect(puzzle.start.every((angle) => angle === 0)).toBe(true);
  });

  it('never gets easier from Monday to Sunday within a week', () => {
    for (let week = 0; week + 7 <= DAYS; week += 7) {
      const scores = days.slice(week, week + 7).map(difficultyScore);
      for (let i = 1; i < scores.length; i++)
        expect(scores[i]!, `${days[week + i]!.date}`).toBeGreaterThan(scores[i - 1]!);
    }
  });

  it('has strictly rising average difficulty by weekday', () => {
    const means = Array.from({ length: 7 }, (_, weekday) => {
      const scores = days.filter((puzzle) => puzzle.tier === weekday).map(difficultyScore);
      return scores.reduce((sum, score) => sum + score, 0) / scores.length;
    });
    for (let i = 1; i < 7; i++) expect(means[i]!).toBeGreaterThan(means[i - 1]!);
  });

  it('never repeats a puzzle', () => {
    expect(new Set(days.map(puzzleSignature)).size).toBe(DAYS);
  });

  it('keeps every Community Route harder than any Saturday', () => {
    const hardestSaturday = TIERS[5]!.parMax * 10 + TIERS[5]!.panels * 2 + TIERS[5]!.turnsMax + 2;
    const easiestRoute = ROUTE_RULES.minPar * 10 + ROUTE_RULES.minPanels * 2;
    expect(easiestRoute).toBeGreaterThan(hardestSaturday);
  });
});

describe('determinism', () => {
  it('returns a deep-equal puzzle for the same date and revision', () => {
    for (const date of ['2026-11-16', '2026-11-19', '2026-11-22', '2027-02-28']) {
      expect(generate(date)).toEqual(generate(date));
      expect(generate(date, 2)).toEqual(generate(date, 2));
    }
  });

  it('returns a different valid puzzle for a new revision', () => {
    for (const date of ['2026-11-16', '2026-11-18', '2026-11-21', '2026-11-22']) {
      const first = generate(date);
      const second = generate(date, 1);
      expect(puzzleSignature(second)).not.toBe(puzzleSignature(first));
      expect(second.rev).toBe(1);
      expect(second.tier).toBe(first.tier);
      expect(validatePuzzle(second).ok).toBe(true);
    }
  });

  it('does not depend on the machine timezone or clock', () => {
    // Shared code is compiled without Node typings, so reach the environment through globalThis.
    const { env } = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
      .process;
    const before = env.TZ;
    env.TZ = 'Pacific/Kiritimati';
    const far = generate('2026-11-20');
    env.TZ = 'America/Anchorage';
    const near = generate('2026-11-20');
    if (before === undefined) delete env.TZ;
    else env.TZ = before;
    expect(far).toEqual(near);
  });

  it('rejects dates that are not real', () => {
    for (const bad of ['2026-02-30', 'today', '']) expect(() => generate(bad)).toThrow(RangeError);
    expect(() => generate('2026-11-16', -1)).toThrow(RangeError);
  });

  it('matches golden puzzles, so generator changes are deliberate', () => {
    const golden = ['2026-11-16', '2026-11-18', '2026-11-20', '2026-11-22'].map((date) => {
      const puzzle = generate(date);
      return `${date} ${puzzleSignature(puzzle)} par ${puzzle.par}`;
    });
    expect(golden).toMatchInlineSnapshot(`
      [
        "2026-11-16 SSS|000|0-- par 2",
        "2026-11-18 SLSS|00-0|0-++ par 4",
        "2026-11-20 LLSSS|0-+--|0+00+ par 6",
        "2026-11-22 LSRSRLS|0--++00|0++--0- par 9",
      ]
    `);
  });
});

describe('post titles', () => {
  it('describes the puzzle truthfully', () => {
    expect(postTitle(12, puzzleHook({ turns: ['straight', 'left', 'straight', 'right', 'straight'], par: 5 }))).toBe(
      'Day 12 · Five panels, two corners · par 5'
    );
    expect(puzzleHook({ turns: ['straight', 'straight', 'straight'], par: 2 })).toBe('Three panels, a straight strip · par 2');
    expect(puzzleHook({ turns: ['left', 'straight', 'straight'], par: 2 })).toBe('Three panels, one corner · par 2');
    expect(puzzleHook({ turns: ['left', 'straight', 'straight', 'left', 'right', 'straight'], par: 9 }, 'maker')).toBe(
      'Community Route by u/maker · par 9'
    );
  });
});
