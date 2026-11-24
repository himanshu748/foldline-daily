import type { Frame } from '../../shared/engine';
import { MAT, MAT_LINE, MAT_MAJOR } from '../../shared/theme';
import { projectPanels, type ProjectedPanel } from '../../shared/view';

export function drawMat(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.save();
  ctx.fillStyle = MAT;
  ctx.fillRect(0, 0, width, height);
  for (let x = 0; x <= width; x += 24) {
    ctx.strokeStyle = x % 120 === 0 ? MAT_MAJOR : MAT_LINE;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += 24) {
    ctx.strokeStyle = y % 120 === 0 ? MAT_MAJOR : MAT_LINE;
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

export interface StripColors {
  paper: string;
  back: string;
  ink: string;
}

export interface Fit {
  scale: number;
  ox: number;
  oy: number;
}

/** Scale and offset that fit every given pose inside a box, keeping one framing for all of them. */
export function fitPoses(poses: ReadonlyArray<readonly Frame[]>, width: number, height: number, pad: number): Fit {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const frames of poses) {
    for (const panel of projectPanels(frames)) {
      for (const point of panel.points) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
    }
  }
  const scale = Math.min(
    (width - 2 * pad) / Math.max(0.001, maxX - minX),
    (height - 2 * pad) / Math.max(0.001, maxY - minY)
  );
  return {
    scale,
    ox: width / 2 - ((minX + maxX) / 2) * scale,
    oy: height / 2 + ((minY + maxY) / 2) * scale,
  };
}

function trace(ctx: CanvasRenderingContext2D, panel: ProjectedPanel, fit: Fit): void {
  ctx.beginPath();
  panel.points.forEach((point, index) => {
    const x = fit.ox + point.x * fit.scale;
    const y = fit.oy - point.y * fit.scale;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

/** The target silhouette: a soft fill with a dashed outline, so it reads without colour. */
export function drawGhost(ctx: CanvasRenderingContext2D, frames: readonly Frame[], fit: Fit, ink: string): void {
  ctx.save();
  ctx.lineJoin = 'round';
  for (const panel of projectPanels(frames, undefined, 1.02)) {
    trace(ctx, panel, fit);
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = ink;
    ctx.fill();
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ink;
    ctx.stroke();
  }
  ctx.restore();
}

/** The paper strip: coloured face, cream back, drawn far to near. */
export function drawStrip(
  ctx: CanvasRenderingContext2D,
  frames: readonly Frame[],
  fit: Fit,
  colors: StripColors
): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2;
  ctx.strokeStyle = colors.ink;
  for (const panel of projectPanels(frames, undefined, 0.97)) {
    trace(ctx, panel, fit);
    ctx.fillStyle = panel.facing ? colors.paper : colors.back;
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** Where a panel's centre lands on the canvas. */
export function panelCentre(frames: readonly Frame[], index: number, fit: Fit): { x: number; y: number } {
  const panel = projectPanels(frames).find((entry) => entry.index === index);
  if (!panel) return { x: 0, y: 0 };
  const sum = panel.points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: fit.ox + (sum.x / 4) * fit.scale, y: fit.oy - (sum.y / 4) * fit.scale };
}
