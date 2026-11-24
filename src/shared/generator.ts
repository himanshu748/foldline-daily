import type { FoldAngle, Turn } from './engine';
import { bankPuzzle } from './bank';
import { epochDay, isDateKey, weekdayIndex } from './dates';
import { TIERS, turnCount, type Tier } from './difficulty';
import { GENERATOR_VERSION, type DailyPuzzle, type Puzzle } from './puzzle';
import { fnv1a, mulberry32, randomInt, shuffle, type Rng } from './rng';
import {
  analyzeTurns,
  indexDistance,
  LOOKALIKE_MIN_MARGIN,
  stateAngles,
  stateIndex,
  validatePuzzle,
  type TurnAnalysis,
} from './validate';

const LAYOUT_ATTEMPTS = 48;
const GOALS_PER_LAYOUT = 10;

const seedFor = (label: string): Rng => mulberry32(fnv1a(`foldline:v${GENERATOR_VERSION}:${label}`));

function drawTurns(rng: Rng, tier: Tier): Turn[] {
  const turns: Turn[] = new Array<Turn>(tier.panels).fill('straight');
  const corners = randomInt(rng, tier.turnsMin, tier.turnsMax);
  const positions = shuffle(
    rng,
    Array.from({ length: tier.panels - 1 }, (_, index) => index)
  ).slice(0, corners);
  for (const position of positions) turns[position] = rng() < 0.5 ? 'left' : 'right';
  return turns;
}

function usableGoals(analysis: TurnAnalysis): number[] {
  const goals: number[] = [];
  for (let index = 0; index < analysis.size; index++) {
    if (analysis.clean[index] && analysis.poseCounts.get(analysis.poseKeys[index]!) === 1)
      goals.push(index);
  }
  return goals;
}

function startsFor(analysis: TurnAnalysis, goal: number, tier: Tier): number[] {
  const flat = stateIndex(new Array<number>(analysis.hinges + 1).fill(0));
  const inBand = (index: number) => {
    const distance = indexDistance(index, goal, analysis.hinges);
    return distance >= tier.parMin && distance <= tier.parMax;
  };
  if (tier.flatStart) return inBand(flat) ? [flat] : [];
  const starts: number[] = [];
  for (let index = 0; index < analysis.size; index++) {
    if (index !== goal && analysis.clean[index] && inBand(index)) starts.push(index);
  }
  return starts;
}

function build(turns: Turn[], start: FoldAngle[], goal: FoldAngle[], tier: Tier): Puzzle | null {
  const result = validatePuzzle({ turns, start, goal }, { minPar: tier.parMin, maxPar: tier.parMax });
  return result.ok ? { turns, start, goal, par: result.par } : null;
}

function sample(rng: Rng, tier: Tier): Puzzle | null {
  for (let attempt = 0; attempt < LAYOUT_ATTEMPTS; attempt++) {
    const turns = drawTurns(rng, tier);
    const analysis = analyzeTurns(turns);
    const goals = shuffle(rng, usableGoals(analysis)).slice(0, GOALS_PER_LAYOUT);
    for (const goal of goals) {
      if (analysis.margin(goal) < LOOKALIKE_MIN_MARGIN) continue;
      const starts = shuffle(rng, startsFor(analysis, goal, tier)).slice(0, 4);
      for (const start of starts) {
        const puzzle = build(
          turns,
          stateAngles(start, analysis.hinges),
          stateAngles(goal, analysis.hinges),
          tier
        );
        if (puzzle) return puzzle;
      }
    }
  }
  return null;
}

const enumerated = new Map<number, Puzzle[]>();

/**
 * Every valid puzzle of a flat-start tier, shuffled once with a fixed seed.
 * These tiers have only a few dozen puzzles, so they are dealt like a deck (one
 * per week, repeating only after the whole deck) instead of being drawn at
 * random, which would repeat within weeks.
 */
function enumerateTier(tierIndex: number): Puzzle[] {
  const cached = enumerated.get(tierIndex);
  if (cached) return cached;
  const tier = TIERS[tierIndex]!;
  let layouts: Turn[][] = [[]];
  for (let i = 0; i < tier.panels - 1; i++)
    layouts = layouts.flatMap((layout) =>
      (['straight', 'left', 'right'] as const).map((turn) => [...layout, turn])
    );
  const puzzles: Puzzle[] = [];
  for (const layout of layouts) {
    const turns: Turn[] = [...layout, 'straight'];
    const corners = turnCount(turns);
    if (corners < tier.turnsMin || corners > tier.turnsMax) continue;
    const analysis = analyzeTurns(turns);
    for (const goal of usableGoals(analysis)) {
      for (const start of startsFor(analysis, goal, tier)) {
        const puzzle = build(
          [...turns],
          stateAngles(start, analysis.hinges),
          stateAngles(goal, analysis.hinges),
          tier
        );
        if (puzzle) puzzles.push(puzzle);
      }
    }
  }
  const deck = shuffle(seedFor(`deck:${tierIndex}`), puzzles);
  enumerated.set(tierIndex, deck);
  return deck;
}

function deal(date: string, tierIndex: number): Puzzle | null {
  const deck = enumerateTier(tierIndex);
  if (deck.length === 0) return null;
  const week = Math.floor(epochDay(date) / 7);
  const card = deck[((week % deck.length) + deck.length) % deck.length]!;
  return { turns: [...card.turns], start: [...card.start], goal: [...card.goal], par: card.par };
}

/**
 * The puzzle for a UTC date. Pure and deterministic: the same date and revision
 * always give the same puzzle on every machine. `rev` is bumped only when a
 * moderator regenerates a day.
 */
export function generate(dateUTC: string, rev = 0): DailyPuzzle {
  if (!isDateKey(dateUTC)) throw new RangeError('Use a real calendar date in YYYY-MM-DD format.');
  if (!Number.isInteger(rev) || rev < 0) throw new RangeError('Revision must be a whole number.');
  const tierIndex = weekdayIndex(dateUTC);
  const tier = TIERS[tierIndex]!;
  const generated =
    (tier.flatStart && rev === 0 ? deal(dateUTC, tierIndex) : null) ??
    sample(seedFor(`${dateUTC}:${rev}`), tier);
  const puzzle = generated ?? bankPuzzle(dateUTC);
  return { ...puzzle, date: dateUTC, rev, tier: tierIndex, source: generated ? 'generated' : 'bank' };
}
