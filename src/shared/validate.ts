import {
  calculateFrames,
  findPanelOverlaps,
  isSolved,
  solveLevel,
  type FoldAngle,
  type FoldMove,
  type Turn,
} from './engine';
import {
  foldDistance,
  isAngleList,
  isTurnList,
  MAX_PANELS,
  MIN_PANELS,
  toLevel,
  encodeTurns,
} from './puzzle';
import { signatureArea, signatureDifference, silhouetteSignature } from './view';

export type ValidationReason =
  | 'shape'
  | 'already-solved'
  | 'unsolvable'
  | 'par-mismatch'
  | 'multiple-answers'
  | 'overlap-start'
  | 'overlap-goal'
  | 'overlap-path'
  | 'look-alike'
  | 'par-range';

/**
 * Smallest share of the target outline by which every other fold state must
 * differ under the fixed camera. Frozen by `validate.test.ts`.
 */
export const LOOKALIKE_MIN_MARGIN = 0.1;

export interface PuzzleRules {
  minPanels?: number;
  maxPanels?: number;
  minPar?: number;
  maxPar?: number;
}

export interface Validation {
  ok: boolean;
  par: number;
  /** A shortest solution that never passes through an overlapping state. */
  path: FoldMove[];
  reasons: ValidationReason[];
  /** Look-alike margin of the goal (0 when it was not computed). */
  margin: number;
}

/** Everything about one strip layout that does not depend on start or goal. */
export interface TurnAnalysis {
  turns: Turn[];
  hinges: number;
  size: number;
  /** Docking-pose key per state. */
  poseKeys: string[];
  poseCounts: Map<string, number>;
  /** 1 when the state has no overlapping panels. */
  clean: Uint8Array;
  margin(index: number): number;
}

export function stateAngles(index: number, hinges: number): FoldAngle[] {
  const angles: FoldAngle[] = [0];
  let rest = index;
  for (let hinge = 0; hinge < hinges; hinge++) {
    const digit = rest % 3;
    angles.push(digit === 0 ? -90 : digit === 1 ? 0 : 90);
    rest = (rest - digit) / 3;
  }
  return angles;
}

export function stateIndex(angles: readonly number[]): number {
  let index = 0;
  for (let hinge = angles.length - 1; hinge >= 1; hinge--)
    index = index * 3 + (angles[hinge]! / 90 + 1);
  return index;
}

/** One-stop moves between two state indices. */
export function indexDistance(a: number, b: number, hinges: number): number {
  let total = 0;
  let x = a;
  let y = b;
  for (let hinge = 0; hinge < hinges; hinge++) {
    total += Math.abs((x % 3) - (y % 3));
    x = Math.floor(x / 3);
    y = Math.floor(y / 3);
  }
  return total;
}

const round = (value: number) => (Math.round(value * 1e4) / 1e4 + 0).toFixed(4);

const analysisCache = new Map<string, TurnAnalysis>();
const CACHE_LIMIT = 48;

export function analyzeTurns(turns: readonly Turn[]): TurnAnalysis {
  const key = encodeTurns(turns);
  const cached = analysisCache.get(key);
  if (cached) return cached;

  const level = { turns: [...turns] };
  const hinges = turns.length - 1;
  const size = 3 ** hinges;
  const poseKeys: string[] = [];
  const poseCounts = new Map<string, number>();
  const clean = new Uint8Array(size);
  for (let index = 0; index < size; index++) {
    const angles = stateAngles(index, hinges);
    const { endpoint, direction, normal } = calculateFrames(level, angles);
    const poseKey = [...endpoint, ...direction, ...normal].map(round).join(',');
    poseKeys.push(poseKey);
    poseCounts.set(poseKey, (poseCounts.get(poseKey) ?? 0) + 1);
    clean[index] = findPanelOverlaps(level, angles).length === 0 ? 1 : 0;
  }

  let signatures: Uint32Array[] | null = null;
  const margin = (index: number): number => {
    if (!signatures) {
      signatures = [];
      for (let i = 0; i < size; i++)
        signatures.push(silhouetteSignature(calculateFrames(level, stateAngles(i, hinges)).frames));
    }
    const own = signatures[index]!;
    const area = signatureArea(own);
    if (area === 0) return 0;
    let smallest = Infinity;
    for (let i = 0; i < size; i++) {
      if (i === index) continue;
      const difference = signatureDifference(own, signatures[i]!);
      if (difference < smallest) smallest = difference;
    }
    return smallest === Infinity ? 1 : smallest / area;
  };

  const analysis: TurnAnalysis = { turns: [...turns], hinges, size, poseKeys, poseCounts, clean, margin };
  if (analysisCache.size >= CACHE_LIMIT) {
    const oldest = analysisCache.keys().next().value;
    if (oldest !== undefined) analysisCache.delete(oldest);
  }
  analysisCache.set(key, analysis);
  return analysis;
}

/** Breadth-first search that only steps through overlap-free states. */
export function cleanPath(analysis: TurnAnalysis, from: number, to: number): FoldMove[] | null {
  if (!analysis.clean[from] || !analysis.clean[to]) return null;
  const previous = new Int32Array(analysis.size).fill(-1);
  const queue = [from];
  previous[from] = from;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor]!;
    if (current === to) break;
    let place = 1;
    for (let hinge = 0; hinge < analysis.hinges; hinge++, place *= 3) {
      const digit = Math.floor(current / place) % 3;
      for (const delta of [1, -1]) {
        const next = digit + delta;
        if (next < 0 || next > 2) continue;
        const neighbour = current + delta * place;
        if (previous[neighbour] !== -1 || !analysis.clean[neighbour]) continue;
        previous[neighbour] = current;
        queue.push(neighbour);
      }
    }
  }
  if (previous[to] === -1) return null;
  const path: FoldMove[] = [];
  for (let node = to; node !== from; node = previous[node]!) {
    const parent = previous[node]!;
    const angles = stateAngles(node, analysis.hinges);
    const before = stateAngles(parent, analysis.hinges);
    const index = angles.findIndex((angle, i) => angle !== before[i]);
    path.unshift({ index, angle: angles[index]! });
  }
  return path;
}

const failure = (reason: ValidationReason): Validation => ({
  ok: false,
  par: -1,
  path: [],
  reasons: [reason],
  margin: 0,
});

/**
 * The single gate for every puzzle, generated or player-made. A puzzle passes
 * only if it is solvable, its par is proven two independent ways, exactly one
 * fold state docks, nothing overlaps on the way, and no other state's outline
 * could be mistaken for the target.
 */
export function validatePuzzle(
  input: { turns: unknown; start: unknown; goal: unknown },
  rules: PuzzleRules = {}
): Validation {
  const { turns, start, goal } = input;
  const minPanels = rules.minPanels ?? MIN_PANELS;
  const maxPanels = rules.maxPanels ?? MAX_PANELS;
  if (!isTurnList(turns) || !isAngleList(start) || !isAngleList(goal)) return failure('shape');
  if (turns.length < minPanels || turns.length > maxPanels) return failure('shape');
  if (start.length !== turns.length || goal.length !== turns.length) return failure('shape');
  if (start[0] !== 0 || goal[0] !== 0) return failure('shape');

  const level = toLevel({ turns, start, goal });
  if (isSolved(level, start)) return failure('already-solved');
  const solved = solveLevel(level);
  if (!solved) return failure('unsolvable');

  const reasons: ValidationReason[] = [];
  const par = solved.length;
  const analysis = analyzeTurns(turns);
  const goalIndex = stateIndex(goal);
  const startIndex = stateIndex(start);
  const goalPose = analysis.poseKeys[goalIndex]!;

  // Independent proof of par: every one-stop move changes one hinge by one stop
  // and no state is forbidden, so the nearest docking state bounds the solver.
  let bound = Infinity;
  for (let index = 0; index < analysis.size; index++) {
    if (analysis.poseKeys[index] !== goalPose) continue;
    bound = Math.min(bound, foldDistance(start, stateAngles(index, analysis.hinges)));
  }
  if (bound !== par) reasons.push('par-mismatch');
  if (analysis.poseCounts.get(goalPose) !== 1) reasons.push('multiple-answers');
  if (!analysis.clean[startIndex]) reasons.push('overlap-start');
  if (!analysis.clean[goalIndex]) reasons.push('overlap-goal');

  let path = solved;
  if (analysis.clean[startIndex] && analysis.clean[goalIndex]) {
    const clean = cleanPath(analysis, startIndex, goalIndex);
    if (!clean || clean.length !== par) reasons.push('overlap-path');
    else path = clean;
  }

  const margin = analysis.margin(goalIndex);
  if (margin < LOOKALIKE_MIN_MARGIN) reasons.push('look-alike');
  if (par < (rules.minPar ?? 1) || par > (rules.maxPar ?? Infinity)) reasons.push('par-range');

  return { ok: reasons.length === 0, par, path, reasons, margin };
}
