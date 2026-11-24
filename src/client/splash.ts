import { context, requestExpandedMode } from '@devvit/web/client';
import { calculateFrames, type FoldAngle } from '../shared/engine';
import { puzzleHook } from '../shared/hooks';
import { parsePostWire } from '../shared/postdata';
import { formatTime } from '../shared/score';
import { CREAM, INK, paperColor } from '../shared/theme';
import { api } from './lib/api';
import { drawGhost, drawMat, drawStrip, fitPoses, panelCentre } from './lib/draw2d';
import { track } from './lib/track';

const el = <T extends Element>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing`);
  return node as unknown as T;
};

const launch = el<HTMLButtonElement>('launch');
const canvas = el<HTMLCanvasElement>('board');
const hand = el<SVGElement>('hand');
const dayEl = el('day');
const pipsEl = el('pips');
const summaryEl = el('summary');
const playLabel = el('playLabel');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const info = parsePostWire(context.postData);

// The launch screen renders from postData alone; nothing here waits on the server.
track('post_view');

if (info) {
  dayEl.textContent = info.kind === 'daily' ? `Day ${info.day}` : 'Route';
  summaryEl.textContent = puzzleHook(info.puzzle, info.author).replaceAll(' · ', ', ');
  launch.setAttribute(
    'aria-label',
    `Play Foldline ${info.kind === 'daily' ? `day ${info.day}` : 'community route'}, par ${info.puzzle.par}`
  );
  for (let day = 0; day < 7; day++) {
    const pip = document.createElement('i');
    if (day <= info.tier) pip.className = 'on';
    pipsEl.append(pip);
  }
} else {
  dayEl.textContent = 'Foldline';
  summaryEl.textContent = 'Open the post to play.';
  playLabel.textContent = 'Open';
}

let handAnimation: Animation | null = null;

function animateHand(from: { x: number; y: number }, to: { x: number; y: number }): void {
  handAnimation?.cancel();
  handAnimation = hand.animate(
    [
      { transform: `translate(${from.x}px, ${from.y}px)`, opacity: 0 },
      { transform: `translate(${from.x}px, ${from.y}px)`, opacity: 1, offset: 0.16 },
      { transform: `translate(${to.x}px, ${to.y}px)`, opacity: 1, offset: 0.6 },
      { transform: `translate(${to.x}px, ${to.y}px)`, opacity: 0, offset: 0.82 },
      { transform: `translate(${from.x}px, ${from.y}px)`, opacity: 0 },
    ],
    { duration: 2600, iterations: Infinity, easing: 'ease-in-out' }
  );
}

function redraw(): void {
  if (!info) return;
  const stage = canvas.parentElement;
  if (!stage) return;
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (width === 0 || height === 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawMat(ctx, width, height);

  const level = { turns: info.puzzle.turns };
  const startFrames = calculateFrames(level, info.puzzle.start).frames;
  const goalFrames = calculateFrames(level, info.puzzle.goal).frames;
  const fit = fitPoses([startFrames, goalFrames], width, height, Math.min(width, height) * 0.14);
  drawGhost(ctx, goalFrames, fit, CREAM);
  drawStrip(ctx, startFrames, fit, { paper: paperColor(info.tier), back: CREAM, ink: INK });

  if (reducedMotion || hand.style.display === 'none') return;
  // The hint loops the first fold: where panel 1's centre travels for its nearest stop.
  const start = info.puzzle.start;
  const hingeAngle: FoldAngle = start[1] === 90 ? -90 : 90;
  const folded = [...start];
  folded[1] = hingeAngle;
  const foldedFrames = calculateFrames(level, folded).frames;
  animateHand(panelCentre(startFrames, 1, fit), panelCentre(foldedFrames, 1, fit));
}

if (canvas.parentElement) new ResizeObserver(redraw).observe(canvas.parentElement);
redraw();

// Returning players swap the hint for their result as soon as the server answers.
void api
  .init()
  .then((init) => {
    if (init.result) {
      handAnimation?.cancel();
      hand.style.display = 'none';
      summaryEl.textContent = '';
      const bold = document.createElement('b');
      bold.textContent = `Solved in ${init.result.folds} (par ${init.result.par})`;
      const streak =
        init.streak.current > 1 ? `, ${init.streak.current}-day streak` : '';
      summaryEl.append(bold, document.createTextNode(`, ${formatTime(init.result.ms)}${streak}`));
      playLabel.textContent = 'Review';
    } else if (info && init.streak.current > 1) {
      summaryEl.textContent = `${puzzleHook(info.puzzle, info.author).replaceAll(' · ', ', ')}, ${init.streak.current}-day streak`;
    }
  })
  .catch(() => undefined);

launch.addEventListener('click', (event) => {
  track('first_interaction');
  requestExpandedMode(event, 'game');
});
