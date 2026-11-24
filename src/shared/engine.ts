/**
 * Deterministic geometry for rigid, edge-hinged square panels. Angles are degrees.
 * Ported from Foldline (WebXR), `src/game/engine.ts`. The logic is unchanged; the
 * `Level` type lost its story fields and index reads were made strict-safe.
 */
export const PANEL_SIZE = 0.62;
export const FOLD_ANGLES = [-90, 0, 90] as const;
export type FoldAngle = (typeof FOLD_ANGLES)[number];
export type Turn = 'straight' | 'left' | 'right';
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export interface Pose {
  point: Vec3;
  direction: Vec3;
  normal: Vec3;
}
export interface Level {
  turns: Turn[];
  initial: FoldAngle[];
  target: Pose;
  par: number;
}
export interface Frame {
  index: number;
  start: Vec3;
  center: Vec3;
  end: Vec3;
  quaternion: Quat;
  normal: Vec3;
  /** Outward route tangent at this panel's exit (after its left/right turn). */
  direction: Vec3;
}
export interface Geometry {
  frames: Frame[];
  endpoint: Vec3;
  direction: Vec3;
  normal: Vec3;
}
export interface FoldMove {
  index: number;
  angle: FoldAngle;
}
type GeometryLevel = Pick<Level, 'turns'>;

const TOLERANCE = 1e-5;
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (v: Vec3) => Math.hypot(...v);
const yaw = (turn: Turn) =>
  turn === 'left' ? Math.PI / 2 : turn === 'right' ? -Math.PI / 2 : 0;
const rotationX = (angle: number): Quat => [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
const rotationY = (angle: number): Quat => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];

export const isFoldAngle = (value: unknown): value is FoldAngle =>
  value === -90 || value === 0 || value === 90;

export function multiplyQuaternions(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function rotateVector(v: Vec3, q: Quat): Vec3 {
  const u: Vec3 = [q[0], q[1], q[2]];
  const uv = cross(u, v);
  const uuv = cross(u, uv);
  return [
    v[0] + 2 * (q[3] * uv[0] + uuv[0]),
    v[1] + 2 * (q[3] * uv[1] + uuv[1]),
    v[2] + 2 * (q[3] * uv[2] + uuv[2]),
  ];
}

function validateShape(level: GeometryLevel, angles: readonly number[]): void {
  if (level.turns.length < 1) throw new RangeError('A level needs at least one panel.');
  if (angles.length !== level.turns.length)
    throw new RangeError('Provide one fold angle per panel, including the fixed root.');
  if (angles[0] !== 0) throw new RangeError('The root panel must stay at 0 degrees.');
  if (level.turns.some((t) => t !== 'left' && t !== 'right' && t !== 'straight'))
    throw new RangeError('Unknown panel turn.');
}

export function validateAngles(
  level: GeometryLevel,
  angles: readonly number[]
): asserts angles is readonly FoldAngle[] {
  validateShape(level, angles);
  if (angles.some((a) => !isFoldAngle(a)))
    throw new RangeError('Fold angles must be -90, 0, or 90 degrees.');
}

export function calculateFrames(level: GeometryLevel, angles: readonly number[]): Geometry {
  validateAngles(level, angles);
  return buildFrames(level, angles);
}

/** Render-only continuous folding. Puzzle state still uses the three discrete stops. */
export function interpolateFrames(
  level: GeometryLevel,
  angles: readonly number[],
  allowOvershoot = false
): Geometry {
  validateShape(level, angles);
  const limit = allowOvershoot ? 105 : 90;
  if (angles.some((a) => !Number.isFinite(a) || a < -limit || a > limit))
    throw new RangeError('Animated fold angles must be finite and between -90 and 90 degrees.');
  return buildFrames(level, angles);
}

function buildFrames(level: GeometryLevel, angles: readonly number[]): Geometry {
  const frames: Frame[] = [];
  let start: Vec3 = [0, 0, 0];
  let quaternion: Quat = [0, 0, 0, 1];
  for (let index = 0; index < level.turns.length; index++) {
    if (index > 0) {
      quaternion = multiplyQuaternions(
        multiplyQuaternions(quaternion, rotationY(yaw(level.turns[index - 1]!))),
        rotationX((angles[index]! * Math.PI) / 180)
      );
    }
    const turn = level.turns[index]!;
    const localEnd: Vec3 =
      turn === 'straight'
        ? [0, 0, -PANEL_SIZE]
        : [turn === 'left' ? -PANEL_SIZE / 2 : PANEL_SIZE / 2, 0, -PANEL_SIZE / 2];
    const end = add(start, rotateVector(localEnd, quaternion));
    const center = add(start, rotateVector([0, 0, -PANEL_SIZE / 2], quaternion));
    const normal = rotateVector([0, 1, 0], quaternion);
    const direction = rotateVector(
      [0, 0, -1],
      multiplyQuaternions(quaternion, rotationY(yaw(turn)))
    );
    frames.push({
      index,
      start: [...start],
      center,
      end,
      quaternion: [...quaternion],
      normal,
      direction,
    });
    start = end;
  }
  const last = frames[frames.length - 1]!;
  return {
    frames,
    endpoint: [...last.end],
    direction: [...last.direction],
    normal: [...last.normal],
  };
}
export const computeFrames = calculateFrames;

export function poseFromAngles(level: GeometryLevel, angles: readonly number[]): Pose {
  const { endpoint, direction, normal } = calculateFrames(level, angles);
  return { point: endpoint, direction, normal };
}

/** Tests the actual docking pose; no hidden target-angle comparison is involved. */
export function isSolved(
  level: Pick<Level, 'turns' | 'target'>,
  angles: readonly number[],
  tolerance = TOLERANCE
): boolean {
  const actual = poseFromAngles(level, angles);
  return (
    length(sub(actual.point, level.target.point)) <= tolerance &&
    length(sub(actual.direction, level.target.direction)) <= tolerance &&
    length(sub(actual.normal, level.target.normal)) <= tolerance
  );
}

/** Legal controls move a hinge one stop, so -90 -> +90 takes two moves. */
export function applyMove(
  level: GeometryLevel,
  angles: readonly number[],
  move: FoldMove
): FoldAngle[] {
  validateAngles(level, angles);
  if (!Number.isInteger(move.index) || move.index <= 0 || move.index >= angles.length)
    throw new RangeError('Choose a movable panel.');
  if (!isFoldAngle(move.angle) || Math.abs(move.angle - angles[move.index]!) !== 90)
    throw new RangeError('A move must turn one hinge by 90 degrees.');
  const next = [...angles];
  next[move.index] = move.angle;
  return next;
}

/** At most 3^(panelCount-1) states. BFS accepts every geometrically equivalent pose. */
export function solveLevel(
  level: Pick<Level, 'turns' | 'initial' | 'target'>,
  angles: readonly number[] = level.initial
): FoldMove[] | null {
  validateAngles(level, angles);
  const queue: Array<{ angles: FoldAngle[]; path: FoldMove[] }> = [
    { angles: [...angles], path: [] },
  ];
  const visited = new Set([angles.join(',')]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor]!;
    if (isSolved(level, current.angles)) return current.path;
    for (let index = 1; index < current.angles.length; index++) {
      for (const delta of [90, -90]) {
        const angle = current.angles[index]! + delta;
        if (!isFoldAngle(angle)) continue;
        const next = [...current.angles];
        next[index] = angle;
        const key = next.join(',');
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push({ angles: next, path: [...current.path, { index, angle }] });
      }
    }
  }
  return null;
}

export function countMoves(
  level: Pick<Level, 'turns' | 'initial' | 'target'>,
  angles: readonly number[] = level.initial
): number {
  return solveLevel(level, angles)?.length ?? -1;
}

/**
 * Advisory overlap check: a separating-axis test for the panel slabs (6 mm thick).
 * Adjacent panels are excluded because they share a hinge. Edge-only contact is
 * excluded by a small tolerance. This detects static overlaps, not swept motion.
 * It deliberately does not gate solving: folding is an abstract puzzle mechanic,
 * and a physical collision solver would otherwise make shortest paths misleading.
 */
export function findPanelOverlaps(
  level: GeometryLevel,
  angles: readonly number[]
): Array<[number, number]> {
  const { frames } = calculateFrames(level, angles);
  const half: Vec3 = [PANEL_SIZE / 2, 0.003, PANEL_SIZE / 2];
  const units: Vec3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const axes = (frame: Frame): Vec3[] => units.map((v) => rotateVector(v, frame.quaternion));
  const overlaps: Array<[number, number]> = [];
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 2; j < frames.length; j++) {
      const a = axes(frames[i]!);
      const b = axes(frames[j]!);
      const between = sub(frames[j]!.center, frames[i]!.center);
      const candidates = [...a, ...b, ...a.flatMap((x) => b.map((y) => cross(x, y)))];
      const separated = candidates.some((axis) => {
        const size = length(axis);
        if (size < TOLERANCE) return false;
        const unit: Vec3 = [axis[0] / size, axis[1] / size, axis[2] / size];
        const radiusA = a.reduce((sum, v, k) => sum + half[k]! * Math.abs(dot(v, unit)), 0);
        const radiusB = b.reduce((sum, v, k) => sum + half[k]! * Math.abs(dot(v, unit)), 0);
        return Math.abs(dot(between, unit)) >= radiusA + radiusB - TOLERANCE;
      });
      if (!separated) overlaps.push([i, j]);
    }
  }
  return overlaps;
}
