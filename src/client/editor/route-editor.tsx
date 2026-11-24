import { useEffect, useMemo, useRef, useState } from 'react';
import { navigateTo, showLoginPrompt } from '@devvit/web/client';
import type { RouteSubmitResponse, RoutesResponse } from '../../shared/api';
import { ROUTE_RULES } from '../../shared/difficulty';
import { calculateFrames, type FoldAngle, type Turn } from '../../shared/engine';
import { encodeAngles, encodeTurns } from '../../shared/puzzle';
import { CREAM, INK } from '../../shared/theme';
import { validatePuzzle, type ValidationReason } from '../../shared/validate';
import { ApiFailure, api } from '../lib/api';
import { drawGhost, drawStrip, fitPoses } from '../lib/draw2d';

const REASON_TEXT: Record<ValidationReason, string> = {
  shape: 'The strip shape is invalid.',
  'already-solved': 'The goal matches the start. Fold the goal into a different shape.',
  unsolvable: 'No fold sequence reaches that goal.',
  'par-mismatch': 'The par could not be proven two ways.',
  'multiple-answers': 'Another fold state reaches the same docking pose. Change the goal.',
  'overlap-start': 'Panels overlap in the start state.',
  'overlap-goal': 'Panels overlap in the goal state.',
  'overlap-path': 'Every solution passes through overlapping panels.',
  'look-alike': 'Another fold state looks too much like the goal from the player’s view.',
  'par-range': `Sunday routes need a par of at least ${ROUTE_RULES.minPar}.`,
};

const TURN_OPTIONS: ReadonlyArray<{ value: Turn; label: string; name: string }> = [
  { value: 'straight', label: 'S', name: 'straight' },
  { value: 'left', label: 'L', name: 'left' },
  { value: 'right', label: 'R', name: 'right' },
];

const ANGLE_OPTIONS: ReadonlyArray<{ value: FoldAngle; label: string; name: string }> = [
  { value: -90, label: '▼', name: 'down' },
  { value: 0, label: '◆', name: 'flat' },
  { value: 90, label: '▲', name: 'up' },
];

interface EditorProps {
  onClose: () => void;
  onSubmitted: (response: RouteSubmitResponse) => void;
}

function makeState(panels: number): { turns: Turn[]; start: FoldAngle[]; goal: FoldAngle[] } {
  return {
    turns: Array.from({ length: panels }, (): Turn => 'straight'),
    start: Array.from({ length: panels }, (): FoldAngle => 0),
    goal: Array.from({ length: panels }, (): FoldAngle => 0),
  };
}

export function RouteEditor({ onClose, onSubmitted }: EditorProps) {
  const [panels, setPanels] = useState<number>(ROUTE_RULES.minPanels);
  const [{ turns, start, goal }, setPuzzle] = useState(() => makeState(ROUTE_RULES.minPanels));
  const [routes, setRoutes] = useState<RoutesResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RouteSubmitResponse | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    void api
      .routes()
      .then(setRoutes)
      .catch(() => setRoutes(null));
  }, []);

  // Full solver validation runs on the device; the server re-checks on submit.
  const validation = useMemo(
    () =>
      validatePuzzle(
        { turns, start, goal },
        {
          minPanels: ROUTE_RULES.minPanels,
          maxPanels: ROUTE_RULES.maxPanels,
          minPar: ROUTE_RULES.minPar,
        }
      ),
    [turns, start, goal]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = canvas?.parentElement;
    if (!canvas || !stage) return;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (width === 0 || height === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const level = { turns };
    const startFrames = calculateFrames(level, start).frames;
    const goalFrames = calculateFrames(level, goal).frames;
    const fit = fitPoses([startFrames, goalFrames], width, height, 18);
    drawGhost(ctx, goalFrames, fit, INK);
    drawStrip(ctx, startFrames, fit, { paper: '#CC79A7', back: CREAM, ink: INK });
  }, [turns, start, goal]);

  const setPanelsAndReset = (count: number) => {
    setPanels(count);
    setPuzzle(makeState(count));
  };

  const setTurn = (index: number, turn: Turn) =>
    setPuzzle((state) => ({
      ...state,
      turns: state.turns.map((value, i) => (i === index ? turn : value)),
    }));

  const setAngle = (field: 'start' | 'goal', index: number, angle: FoldAngle) =>
    setPuzzle((state) => ({
      ...state,
      [field]: state[field].map((value, i) => (i === index ? angle : value)),
    }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.submitRoute({
        t: encodeTurns(turns),
        s: encodeAngles(start),
        g: encodeAngles(goal),
      });
      setDone(response);
      onSubmitted(response);
    } catch (cause) {
      if (cause instanceof ApiFailure) {
        if (cause.code === 'login') {
          showLoginPrompt();
          setError('Log in to submit your route.');
        } else {
          setError(cause.message);
        }
      } else {
        setError('Could not submit right now. Try again.');
      }
    }
    setBusy(false);
  };

  const hinges: number[] = [];
  for (let index = 1; index < panels; index++) hinges.push(index);

  if (done)
    return (
      <div className="sheet sheet--top" role="dialog" aria-modal="true" aria-label="Route submitted">
        <div className="sheet__card">
          <h2 className="card__title">Route submitted</h2>
          <p>
            Par <span className="num">{done.par}</span>. It is in the running for Sunday&rsquo;s
            puzzle. The community&rsquo;s top upvoted route wins.
          </p>
          <div className="card__actions">
            <button className="btn btn--primary" onClick={() => navigateTo(done.url)}>
              View your route post
            </button>
            <button className="btn" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="sheet sheet--top" role="dialog" aria-modal="true" aria-label="Build a Community Route">
      <div className="sheet__card">
        <header className="card__head">
          <h2 className="card__title">Build a Community Route</h2>
          <p className="card__muted">
            Sunday&rsquo;s puzzle is player-made. Rules: {ROUTE_RULES.minPanels} to{' '}
            {ROUTE_RULES.maxPanels} panels, par {ROUTE_RULES.minPar} or more, verified by the
            solver. The week&rsquo;s top upvoted route becomes Sunday&rsquo;s puzzle, credited to
            you.
          </p>
        </header>

        <div className="editor__group" role="group" aria-label="Number of panels">
          <span className="editor__label">Panels</span>
          <div className="seg">
            {[ROUTE_RULES.minPanels, ROUTE_RULES.maxPanels].map((count) => (
              <button
                key={count}
                aria-pressed={panels === count}
                onClick={() => setPanelsAndReset(count)}
              >
                {count}
              </button>
            ))}
          </div>
        </div>

        <div className="editor__group" role="group" aria-label="Strip corners">
          <span className="editor__label">Corners (S straight, L left, R right)</span>
          <div className="editor__turns">
            {turns.slice(0, -1).map((turn, index) => (
              <div className="seg seg--small" key={index}>
                {TURN_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    aria-pressed={turn === option.value}
                    aria-label={`Panel ${index + 1} turns ${option.name}`}
                    onClick={() => setTurn(index, option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {(['start', 'goal'] as const).map((field) => (
          <div className="editor__group" key={field} role="group" aria-label={`${field} folds`}>
            <span className="editor__label">
              {field === 'start' ? 'Start (what players see first)' : 'Goal (the target silhouette)'}
            </span>
            <div className="editor__turns">
              {hinges.map((index) => (
                <div className="seg seg--small" key={index}>
                  {ANGLE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      aria-pressed={(field === 'start' ? start : goal)[index] === option.value}
                      aria-label={`${field} hinge ${index} ${option.name}`}
                      onClick={() => setAngle(field, index, option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="editor__preview">
          <canvas ref={canvasRef} aria-label="Preview: the coloured strip is the start, the grey outline is the goal" />
        </div>

        <section className="routes" aria-label="This week's routes">
          <h3 className="board__title">
            Up for Sunday{routes ? `, ${routes.sunday}` : ''}
          </h3>
          {!routes && <p className="board__empty">Loading routes…</p>}
          {routes && routes.routes.length === 0 && (
            <p className="board__empty">No routes yet this week. Yours could be Sunday’s puzzle.</p>
          )}
          {routes && routes.routes.length > 0 && (
            <ul className="routes__list">
              {routes.routes.map((route) => (
                <li key={route.postId}>
                  <button className="routes__row" onClick={() => navigateTo(route.url)}>
                    <span className="routes__author">
                      u/{route.author}
                      {route.mine ? ' (you)' : ''}
                    </span>
                    <span className="num routes__meta">
                      {route.panels} panels, par {route.par}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="editor__footer">
          {validation.ok ? (
            <p className="editor__verdict editor__verdict--ok">
              Solver-verified, par <span className="num">{validation.par}</span>
            </p>
          ) : (
            <ul className="editor__reasons">
              {validation.reasons.map((reason) => (
                <li key={reason}>{REASON_TEXT[reason]}</li>
              ))}
            </ul>
          )}
          {error && <p className="card__error">{error}</p>}

          <div className="card__actions editor__actions">
            <button
              className="btn btn--primary"
              disabled={!validation.ok || busy}
              onClick={() => void submit()}
            >
              {busy ? 'Submitting…' : 'Submit route for Sunday'}
            </button>
            <button className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
