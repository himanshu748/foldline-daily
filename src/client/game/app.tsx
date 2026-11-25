import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { markHowToSeen } from '../lib/howto-seen';
import { sound } from '../lib/sound';
import type { BoardScene } from '../scene/board';
import { Controller } from './controller';
import { EndCard } from './endcard';
import { HowTo } from './howto';
import { HingeBar, Hud } from './hud';
import { Stage } from './stage';

export function App() {
  const [controller] = useState(() => new Controller());
  useSyncExternalStore(controller.subscribe, () => controller.version);
  const sceneRef = useRef<BoardScene | null>(null);
  const [soundOn, setSoundOn] = useState(sound.enabled);
  const [progress, setProgress] = useState({ inPlace: 0, total: 0 });
  const updateProgress = useCallback((inPlace: number, total: number) => {
    setProgress((current) => (current.inPlace === inPlace && current.total === total ? current : { inPlace, total }));
  }, []);
  // The rules stay one tap away. They do not cover the board, so the first fold can happen immediately.
  const [helpOpen, setHelpOpen] = useState(false);
  const openHelp = useCallback(() => setHelpOpen(true), []);
  const closeHelp = useCallback(() => {
    markHowToSeen();
    setHelpOpen(false);
  }, []);

  useEffect(() => {
    void controller.load();
  }, [controller]);

  // Fold and solve sounds follow state changes, never the first paint.
  const heardFolds = useRef<number | null>(null);
  useEffect(() => {
    if (heardFolds.current === null) {
      heardFolds.current = controller.folds;
      return;
    }
    if (controller.folds > heardFolds.current) sound.fold();
    heardFolds.current = controller.folds;
  });
  const heardSolve = useRef(false);
  useEffect(() => {
    if (controller.solved && !heardSolve.current) {
      heardSolve.current = true;
      if (controller.complete) sound.solve();
    }
  });

  const toggleSound = () =>
    setSoundOn((on) => {
      sound.set(!on);
      return !on;
    });

  const flipView = () => {
    sceneRef.current?.flip();
    window.dispatchEvent(new Event('foldline:viewchange'));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (helpOpen || controller.solved) return;
      if (event.key === '?' || event.key === 'h' || event.key === 'H') {
        openHelp();
      } else if (/^[1-7]$/.test(event.key)) {
        controller.selectHinge(Number(event.key));
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
        if (!controller.foldSelected(1)) sound.blocked();
        event.preventDefault();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
        if (!controller.foldSelected(-1)) sound.blocked();
        event.preventDefault();
      } else if (event.key === 'z' || event.key === 'Z') {
        controller.undo();
      } else if (event.key === 'v' || event.key === 'V') {
        flipView();
      } else if (event.key === 'm' || event.key === 'M') {
        toggleSound();
      } else {
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller, helpOpen, openHelp]);

  if (controller.phase === 'loading')
    return (
      <div className="game game--center">
        <p className="game__loading">Unfolding today&rsquo;s puzzle&hellip;</p>
      </div>
    );

  if (controller.phase === 'error')
    return (
      <div className="game game--center">
        <p>{controller.error}</p>
        <button className="btn btn--primary" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );

  return (
    <div className="game">
      <Hud controller={controller} progress={progress} soundOn={soundOn} onToggleSound={toggleSound} onFlip={flipView} onHelp={openHelp} />
      {controller.practice && controller.phase === 'play' && <p className="banner">Practice run: your score is safe.</p>}
      {controller.stale && (
        <p className="banner banner--warn">
          This puzzle changed while you played.{' '}
          <button className="banner__link" onClick={() => window.location.reload()}>
            Load the new puzzle
          </button>
        </p>
      )}
      <Stage controller={controller} sceneRef={sceneRef} onProgress={updateProgress} />
      <HingeBar controller={controller} />
      <div className="sr-only" aria-live="polite">
        {controller.liveText}
      </div>
      {controller.solved && <EndCard controller={controller} />}
      {helpOpen && <HowTo par={controller.puzzle?.par ?? null} onClose={closeHelp} />}
    </div>
  );
}
