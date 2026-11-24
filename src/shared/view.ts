import { PANEL_SIZE, rotateVector, type Frame, type Vec3 } from './engine';

/**
 * The game's fixed orthographic camera. The 3D scene, the feed preview and the
 * look-alike check all use this one projection, so they always agree.
 */
export interface ViewBasis {
  right: Vec3;
  up: Vec3;
  toCamera: Vec3;
}

export const VIEW_AZIMUTH_DEG = 38;
export const VIEW_ELEVATION_DEG = 30;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function viewBasis(
  azimuthDeg = VIEW_AZIMUTH_DEG,
  elevationDeg = VIEW_ELEVATION_DEG
): ViewBasis {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const toCamera: Vec3 = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  const right: Vec3 = [Math.cos(az), 0, -Math.sin(az)];
  const up: Vec3 = [
    toCamera[1] * right[2] - toCamera[2] * right[1],
    toCamera[2] * right[0] - toCamera[0] * right[2],
    toCamera[0] * right[1] - toCamera[1] * right[0],
  ];
  return { right, up, toCamera };
}

export const DEFAULT_VIEW: ViewBasis = viewBasis();

export interface ScreenPoint {
  x: number;
  y: number;
  depth: number;
}

/** `y` grows upward; larger `depth` is nearer the camera. */
export const projectPoint = (point: Vec3, basis: ViewBasis = DEFAULT_VIEW): ScreenPoint => ({
  x: dot(point, basis.right),
  y: dot(point, basis.up),
  depth: dot(point, basis.toCamera),
});

/** The four corners of a panel in world space. `scale` shrinks it about its centre. */
export function panelCorners(frame: Frame, scale = 1): Vec3[] {
  const half = (PANEL_SIZE / 2) * scale;
  const corners: Vec3[] = [
    [-half, 0, half],
    [half, 0, half],
    [half, 0, -half],
    [-half, 0, -half],
  ];
  return corners.map((corner) => {
    const rotated = rotateVector(corner, frame.quaternion);
    return [
      frame.center[0] + rotated[0],
      frame.center[1] + rotated[1],
      frame.center[2] + rotated[2],
    ];
  });
}

export interface ProjectedPanel {
  index: number;
  points: ScreenPoint[];
  depth: number;
  /** True when the coloured face (not the back of the paper) faces the camera. */
  facing: boolean;
}

/** Panels projected and ordered far to near, ready for painter's drawing. */
export function projectPanels(
  frames: readonly Frame[],
  basis: ViewBasis = DEFAULT_VIEW,
  scale = 1
): ProjectedPanel[] {
  return frames
    .map((frame) => ({
      index: frame.index,
      points: panelCorners(frame, scale).map((corner) => projectPoint(corner, basis)),
      depth: dot(frame.center, basis.toCamera),
      facing: dot(frame.normal, basis.toCamera) > 0,
    }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index);
}

/** Raster cells per panel edge used by the silhouette signature. */
export const SIGNATURE_CELLS = 8;

/**
 * A coarse bitmap of the strip's outline under the fixed camera. The grid is
 * anchored to the root panel, so two fold states of the same strip can be
 * compared cell by cell.
 */
export function silhouetteSignature(
  frames: readonly Frame[],
  basis: ViewBasis = DEFAULT_VIEW
): Uint32Array {
  const extent = (frames.length + 0.5) * PANEL_SIZE;
  const cell = PANEL_SIZE / SIGNATURE_CELLS;
  const size = Math.ceil((2 * extent) / cell);
  const bits = new Uint32Array(Math.ceil((size * size) / 32));
  for (const frame of frames) {
    const quad = panelCorners(frame).map((corner) => {
      const p = projectPoint(corner, basis);
      return [(p.x + extent) / cell, (p.y + extent) / cell] as const;
    });
    const xs = quad.map((p) => p[0]);
    const ys = quad.map((p) => p[1]);
    const minX = Math.max(0, Math.floor(Math.min(...xs)));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(...xs)));
    const minY = Math.max(0, Math.floor(Math.min(...ys)));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(...ys)));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let positive = 0;
        let negative = 0;
        for (let k = 0; k < 4; k++) {
          const a = quad[k]!;
          const b = quad[(k + 1) % 4]!;
          const side = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
          if (side > 0) positive++;
          else if (side < 0) negative++;
        }
        if (positive === 0 || negative === 0) {
          const bit = y * size + x;
          bits[bit >>> 5]! |= 1 << (bit & 31);
        }
      }
    }
  }
  return bits;
}

function popCount(value: number): number {
  let v = value - ((value >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function signatureArea(signature: Uint32Array): number {
  let total = 0;
  for (const word of signature) total += popCount(word);
  return total;
}

/** Cells covered by exactly one of the two outlines. */
export function signatureDifference(a: Uint32Array, b: Uint32Array): number {
  if (a.length !== b.length) throw new RangeError('Signatures must come from equal strips.');
  let total = 0;
  for (let i = 0; i < a.length; i++) total += popCount(a[i]! ^ b[i]!);
  return total;
}
