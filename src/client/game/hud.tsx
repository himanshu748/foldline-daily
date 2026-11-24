import { exitExpandedMode } from '@devvit/web/client';
import type { Controller } from './controller';

interface HudProps {
  controller: Controller;
  progress: { inPlace: number; total: number };
  soundOn: boolean;
  onToggleSound: () => void;
  onFlip: () => void;
  onHelp: () => void;
}

export function Hud({ controller, progress, soundOn, onToggleSound, onFlip, onHelp }: HudProps) {
  const puzzle = controller.puzzle;
  return (
    <header className="hud">
      <div className="hud__stats">
        <span className="hud__count num" aria-label={`${controller.folds} folds`}>{controller.folds}</span>
        {puzzle && <span className="hud__par">par <span className="num">{puzzle.par}</span></span>}
        <span className="hud__progress">{progress.inPlace} of {progress.total} in place</span>
      </div>
      <div className="hud__actions">
        <button className="icon-btn" onClick={onHelp} aria-label="How to play" title="How to play (?)">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M7.6 7.6a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <circle cx="10" cy="14.6" r="1.1" fill="currentColor" />
          </svg>
        </button>
        <button
          className="icon-btn"
          onClick={() => controller.undo()}
          disabled={controller.folds === 0 || controller.phase !== 'play'}
          aria-label="Undo last fold (costs one fold)"
          title="Undo (Z): costs one fold"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M8 4L3 9l5 5M3 9h9a5 5 0 0 1 0 10h-2"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button className="icon-btn" onClick={onFlip} aria-label="Flip the view" title="Flip view (V)">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M4 7h9l-2.5-2.5M16 13H7l2.5 2.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          className="icon-btn"
          onClick={onToggleSound}
          aria-pressed={soundOn}
          aria-label={soundOn ? 'Turn sound off' : 'Turn sound on'}
          title="Sound (M)"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M4 8v4h3l4 3.5v-11L7 8H4z"
              fill="currentColor"
              strokeLinejoin="round"
            />
            {soundOn ? (
              <path
                d="M14 7.5a4 4 0 0 1 0 5M16 5.5a7 7 0 0 1 0 9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            ) : (
              <path
                d="M14 8l5 5m0-5l-5 5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            )}
          </svg>
        </button>
        <button
          className="icon-btn"
          onClick={(event) => exitExpandedMode(event.nativeEvent)}
          aria-label="Close the game"
          title="Close"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M5 5l10 10M15 5L5 15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}

const ANGLE_TEXT: Record<number, string> = { [-90]: 'down', 0: 'flat', 90: 'up' };

export function HingeBar({ controller }: { controller: Controller }) {
  const puzzle = controller.puzzle;
  if (!puzzle) return null;
  const hinges: number[] = [];
  for (let index = 1; index < puzzle.turns.length; index++) hinges.push(index);
  const selectedAngle = controller.angles[controller.selectedHinge] ?? 0;
  const playable = controller.phase === 'play';
  return (
    <footer className="dock" role="group" aria-label="Fold controls">
      <div className="dock__hinges">
        {hinges.map((index) => {
          const angle = controller.angles[index] ?? 0;
          return (
            <button
              key={index}
              className="chip"
              aria-pressed={index === controller.selectedHinge}
              aria-label={`Hinge ${index}, folded ${ANGLE_TEXT[angle]}`}
              onClick={() => controller.selectHinge(index)}
            >
              <b className="num">{index}</b>
              <i aria-hidden="true">{ANGLE_TEXT[angle]}</i>
            </button>
          );
        })}
      </div>
      <div className="dock__fold">
        <button
          className="btn btn--primary"
          disabled={!playable || selectedAngle >= 90}
          onClick={() => controller.foldSelected(1)}
          aria-label={`Fold hinge ${controller.selectedHinge} up`}
        >
          Fold up
        </button>
        <button
          className="btn btn--primary"
          disabled={!playable || selectedAngle <= -90}
          onClick={() => controller.foldSelected(-1)}
          aria-label={`Fold hinge ${controller.selectedHinge} down`}
        >
          Fold down
        </button>
      </div>
    </footer>
  );
}
