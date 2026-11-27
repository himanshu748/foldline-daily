import { useEffect, useMemo, useRef, useState } from 'react';
import { applyMove, calculateFrames, type FoldMove } from '../../shared/engine';
import { toLevel, type Puzzle } from '../../shared/puzzle';
import { CREAM, INK } from '../../shared/theme';
import { drawGhost, drawMat, drawStrip, fitPoses } from '../lib/draw2d';

const directions = { [-90]: 'down', 0: 'flat', 90: 'up' } as const;

interface SolveReplayProps {
  puzzle: Puzzle;
  moves: readonly FoldMove[];
  paper: string;
}

export function SolveReplay({ puzzle, moves, paper }: SolveReplayProps) {
  const [step, setStep] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const replay = useMemo(() => {
    const level = toLevel(puzzle);
    let angles = [...puzzle.start];
    const frames = [calculateFrames(level, angles).frames];
    for (const move of moves) {
      angles = applyMove(level, angles, move);
      frames.push(calculateFrames(level, angles).frames);
    }
    return { frames, target: calculateFrames(level, puzzle.goal).frames };
  }, [puzzle, moves]);
  const current = Math.min(step, moves.length);
  const move = moves[current - 1];
  const label = move ? `Hinge ${move.index} set ${directions[move.angle]}.` : 'Starting position.';

  useEffect(() => {
    const canvas = canvasRef.current;
    const frames = replay.frames[current];
    if (!canvas || !frames) return;
    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      const fit = fitPoses([...replay.frames, replay.target], width, height, 12);
      drawMat(ctx, width, height);
      drawGhost(ctx, replay.target, fit, CREAM);
      drawStrip(ctx, frames, fit, { paper, back: CREAM, ink: INK });
    };
    draw();
    const resize = new ResizeObserver(draw);
    resize.observe(canvas);
    return () => resize.disconnect();
  }, [current, paper, replay]);

  return (
    <section className="solve-replay" id="solve-replay" aria-label="Private fold replay">
      <canvas ref={canvasRef} className="solve-replay__canvas" aria-hidden="true" />
      <p className="card__note" aria-live="polite">
        Fold {current} of {moves.length}. {label}
      </p>
      <div className="solve-replay__controls">
        <button className="btn" onClick={() => setStep(current - 1)} disabled={current === 0}>
          Previous fold
        </button>
        <button className="btn" onClick={() => setStep(current + 1)} disabled={current === moves.length}>
          Next fold
        </button>
      </div>
    </section>
  );
}
