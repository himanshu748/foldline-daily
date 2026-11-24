import { isDateKey } from './dates';
import {
  decodeAngles,
  decodeTurns,
  encodeAngles,
  encodeTurns,
  MIN_PANELS,
  type Puzzle,
  type PuzzleSource,
} from './puzzle';

export type PostKind = 'daily' | 'route';

/** Everything a post knows about its puzzle. Stored in `postData` (2 KB limit). */
export interface PostInfo {
  kind: PostKind;
  /** Daily: the puzzle's date. Route: the day it was submitted. */
  date: string;
  /** Daily: "Day N". Route: 0. */
  day: number;
  rev: number;
  tier: number;
  puzzle: Puzzle;
  source: PuzzleSource;
  /** Community Route author, when there is one. */
  author?: string;
  /** For a Sunday puzzle: the route post it came from. */
  routePostId?: string;
}

/** The JSON shape stored in `postData` and sent by `/api/init`. */
export interface PostWire {
  [key: string]: string | number;
  v: number;
  k: PostKind;
  d: string;
  n: number;
  r: number;
  w: number;
  t: string;
  s: string;
  g: string;
  p: number;
  src: PuzzleSource;
}

export function toPostWire(info: PostInfo): PostWire {
  const wire: PostWire = {
    v: 1,
    k: info.kind,
    d: info.date,
    n: info.day,
    r: info.rev,
    w: info.tier,
    t: encodeTurns(info.puzzle.turns),
    s: encodeAngles(info.puzzle.start),
    g: encodeAngles(info.puzzle.goal),
    p: info.puzzle.par,
    src: info.source,
  };
  if (info.author) wire.a = info.author;
  if (info.routePostId) wire.rid = info.routePostId;
  return wire;
}

const isCount = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

export function parsePostWire(raw: unknown): PostInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const wire = raw as Record<string, unknown>;
  if (wire.v !== 1 || (wire.k !== 'daily' && wire.k !== 'route')) return null;
  if (!isDateKey(wire.d)) return null;
  if (!isCount(wire.n, 0, 1_000_000) || !isCount(wire.r, 0, 10_000) || !isCount(wire.w, 0, 6))
    return null;
  if (wire.src !== 'generated' && wire.src !== 'bank' && wire.src !== 'community') return null;
  const turns = decodeTurns(wire.t);
  const start = decodeAngles(wire.s);
  const goal = decodeAngles(wire.g);
  if (!turns || !start || !goal) return null;
  if (turns.length < MIN_PANELS || start.length !== turns.length || goal.length !== turns.length)
    return null;
  if (start[0] !== 0 || goal[0] !== 0 || !isCount(wire.p, 1, 2 * turns.length)) return null;
  const info: PostInfo = {
    kind: wire.k,
    date: wire.d,
    day: wire.n,
    rev: wire.r,
    tier: wire.w,
    puzzle: { turns, start, goal, par: wire.p },
    source: wire.src,
  };
  if (typeof wire.a === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(wire.a)) info.author = wire.a;
  if (typeof wire.rid === 'string' && /^t3_[a-z0-9]{1,16}$/.test(wire.rid)) info.routePostId = wire.rid;
  return info;
}
