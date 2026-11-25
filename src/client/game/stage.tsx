import { useEffect, useRef, useState } from 'react';
import { calculateFrames } from '../../shared/engine';
import { CREAM, INK, paperColor } from '../../shared/theme';
import { drawGhost, drawMat, drawStrip, fitPoses } from '../lib/draw2d';
import type { BoardScene } from '../scene/board';
import type { Controller } from './controller';
import { separateHinges } from './stage-hinges';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface StageProps {
  controller: Controller;
  sceneRef: { current: BoardScene | null };
  onProgress: (inPlace: number, total: number) => void;
}

function positions(scene: BoardScene, canvas: HTMLCanvasElement | null) {
  return canvas ? separateHinges(scene.hingeScreenPositions(), canvas.clientWidth, canvas.clientHeight) : [];
}

export function Stage({ controller, sceneRef, onProgress }: StageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [handPos, setHandPos] = useState<{ x: number; y: number } | null>(null);
  const [hingePositions, setHingePositions] = useState<Array<{ index: number; x: number; y: number }>>([]);
  const info = controller.info;

  // The three.js scene is a lazy chunk; a static 2D strip covers the load.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !info) return;
    let disposed = false;
    let scene: BoardScene | null = null;
    void import('../scene/board').then((mod) => {
      if (disposed) return;
      scene = new mod.BoardScene(canvas, {
        turns: info.puzzle.turns,
        angles: controller.angles,
        start: info.puzzle.start,
        goal: info.puzzle.goal,
        colors: { paper: paperColor(info.tier), back: CREAM, ink: INK },
        reducedMotion,
        onCommit: (index, angle) => controller.fold(index, angle),
      });
      sceneRef.current = scene;
      onProgress(scene.inPlaceCount(), scene.movableCount);
      setReady(true);
      setHandPos(scene.panelScreenPosition(1));
      setHingePositions(positions(scene, canvasRef.current));
    });
    return () => {
      disposed = true;
      scene?.dispose();
      sceneRef.current = null;
    };
  }, [controller, info, onProgress, sceneRef]);

  useEffect(() => {
    if (ready || !info) return;
    const canvas = fallbackRef.current;
    const stage = canvas?.parentElement;
    if (!canvas || !stage) return;
    const draw = () => {
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
      const fit = fitPoses([startFrames, goalFrames], width, height, Math.min(width, height) * 0.16);
      drawGhost(ctx, goalFrames, fit, CREAM);
      drawStrip(ctx, startFrames, fit, { paper: paperColor(info.tier), back: CREAM, ink: INK });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [ready, info]);

  // Push committed states into the scene (covers buttons, keyboard and undo).
  const sentAngles = useRef(controller.angles);
  const pulseSent = useRef(false);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (sentAngles.current !== controller.angles) {
      sentAngles.current = controller.angles;
      scene.setAngles(controller.angles, true);
      onProgress(scene.inPlaceCount(), scene.movableCount);
    }
    if (controller.solved && !pulseSent.current) {
      pulseSent.current = true;
      scene.solvePulse();
    }
  });

  useEffect(() => {
    const scene = sceneRef.current;
    if (ready && scene) setHingePositions(positions(scene, canvasRef.current));
  }, [controller.version, ready, sceneRef]);

  const showHand = ready && !reducedMotion && controller.phase === 'play' && controller.folds === 0;
  // Position updates come from event callbacks only (resize, view flip, scene load).
  useEffect(() => {
    const update = () => {
      setHandPos(sceneRef.current?.panelScreenPosition(1) ?? null);
      const scene = sceneRef.current;
      setHingePositions(scene ? positions(scene, canvasRef.current) : []);
    };
    window.addEventListener('resize', update);
    window.addEventListener('foldline:viewchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('foldline:viewchange', update);
    };
  }, [sceneRef]);

  return (
    <main className="stage">
      {!ready && <canvas ref={fallbackRef} className="stage__canvas" aria-hidden="true" />}
      <canvas
        ref={canvasRef}
        className="stage__canvas stage__canvas--3d"
        role="img"
        aria-label={`Paper strip puzzle. ${controller.liveText}`}
      />
      {controller.phase === 'play' &&
        hingePositions.map(({ index, x, y }) => (
          <span
            key={index}
            className={`stage__hinge${index === controller.selectedHinge ? ' stage__hinge--selected' : ''}`}
            style={{ left: x, top: y }}
            aria-hidden="true"
          >
            {index}
          </span>
        ))}
      {showHand && handPos && (
        <div
          className="stage__hand"
          style={{ transform: `translate(${handPos.x}px, ${handPos.y}px)` }}
          aria-hidden="true"
        >
          <svg className="stage__hand-inner" viewBox="0 0 32 40">
            <path
              d="M12 2a3 3 0 0 1 3 3v13l8.5 2.2A4 4 0 0 1 26.4 25L25 34a4 4 0 0 1-4 3.4h-7.2a4 4 0 0 1-3.2-1.6l-6.9-9.3a2.6 2.6 0 0 1 3.9-3.4L10 26V5a3 3 0 0 1 2-3z"
              fill="#fff"
              stroke="#14201e"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}
    </main>
  );
}
