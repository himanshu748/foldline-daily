import { lazy, Suspense, useEffect, useState } from 'react';
import { canRunAsUser, navigateTo, showLoginPrompt, showToast } from '@devvit/web/client';
import { bucketFor, DIST_BUCKETS, formatTime, resultNote } from '../../shared/score';
import { paperColor } from '../../shared/theme';
import { ApiFailure, api } from '../lib/api';
import type { Controller } from './controller';
import { Leaderboard } from './leaderboard';
import { ModalSheet } from './modal-sheet';
import { SolveReplay } from './solve-replay';

const RouteEditor = lazy(() => import('../editor/route-editor').then((mod) => ({ default: mod.RouteEditor })));

type ShareState = 'idle' | 'posting' | 'posted' | 'already' | 'failed';

function Countdown({ controller }: { controller: Controller }) {
  const init = controller.init;
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!init) return null;
  const left = init.now + init.nextPuzzleInMs - controller.now();
  if (left <= 0)
    return (
      <p className="card__count">
        The next puzzle is live.{' '}
        <button className="card__link" onClick={() => window.location.reload()}>
          Reload to play
        </button>
      </p>
    );
  const total = Math.floor(left / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    <p className="card__count">
      Next puzzle in{' '}
      <span className="num">
        {hours}:{pad(minutes)}:{pad(seconds)}
      </span>
      {init.isToday ? '' : ' (you are replaying an older puzzle)'}
    </p>
  );
}

export function EndCard({ controller }: { controller: Controller }) {
  const init = controller.init;
  const [shareChoice, setShare] = useState<ShareState | null>(null);
  const [joinedChoice, setJoined] = useState<boolean | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinFailed, setJoinFailed] = useState(false);
  const [flairChoice, setFlairOptIn] = useState<boolean | null>(null);
  const [flairNote, setFlairNote] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const [routeChoice, setRouteDone] = useState<boolean | null>(null);
  const share = shareChoice ?? (init?.shared ? 'already' : 'idle');
  const joined = joinedChoice ?? init?.subscribed ?? false;
  const flairOptIn = flairChoice ?? init?.flair.optedIn ?? false;
  const routeDone = routeChoice ?? init?.routes.submitted ?? false;

  const result = controller.result;
  if (!result) return null;

  const complete = controller.complete;
  const streak = complete?.streak ?? init?.streak ?? { current: 0, best: 0, tier: null, nextTier: null };
  const field = complete ? complete.field : (init?.field ?? null);
  const storedServerSide = Boolean(complete ?? init?.result);
  const canReconnect = controller.canReconnectToSubmit;
  const practiceFolds = controller.practiceFolds;
  const shownFolds = practiceFolds ?? result.folds;
  const overPar = shownFolds - result.par;
  const reason = complete && !complete.scored ? (complete.reason ?? 'practice') : null;
  const myBucket = bucketFor(result.folds, result.par);
  const standing = field && practiceFolds === null ? resultNote(field.standing, field.total) : null;
  const peak = Math.max(1, ...(field?.dist ?? []));

  const onShare = async () => {
    setShare('posting');
    try {
      const response = await api.share();
      setShare(response.status === 'already' ? 'already' : 'posted');
      showToast(response.asUser ? 'Your result was posted as a comment.' : 'Posted by the app account on your behalf.');
    } catch (error) {
      setShare('failed');
      if (error instanceof ApiFailure && error.code === 'login') showLoginPrompt();
    }
  };

  // Reddit only lets the app subscribe as the player after its consent prompt, which needs
  // the trusted click event, so canRunAsUser must be the first await in the handler.
  const onJoin = async (event: Event) => {
    setJoining(true);
    try {
      if (!(await canRunAsUser(event))) {
        setJoinFailed(true);
        showToast('No problem. You can join from the community page instead.');
        return;
      }
      await api.subscribe();
      setJoined(true);
      if (init) showToast(`Welcome to r/${init.subreddit}!`);
    } catch {
      setJoinFailed(true);
      showToast('Reddit could not join you from here. Open the community to join.');
    } finally {
      setJoining(false);
    }
  };

  const onFlair = async () => {
    const want = !flairOptIn;
    setFlairOptIn(want);
    try {
      const response = await api.flair(want);
      if (response.status === 'unavailable') {
        setFlairOptIn(false);
        setFlairNote("Flair isn't available in this community.");
      } else {
        setFlairNote(null);
      }
    } catch {
      setFlairOptIn(!want);
      setFlairNote('Could not update flair right now.');
    }
  };

  return (
    <ModalSheet titleId="result-title">
      <div className="sheet__card">
        <header className="card__head">
          <p className="card__kicker">
            {controller.info?.kind === 'daily' ? `Foldline · Day ${controller.info.day}` : 'Foldline · Community Route'}
            {reason === 'skipped' && ', skipped day, practice only'}
            {(reason === 'practice' || practiceFolds !== null) && ', practice run'}
          </p>
          <h2 className="card__title" id="result-title" tabIndex={-1}>
            <span className="num">{shownFolds}</span> {shownFolds === 1 ? 'fold' : 'folds'}
            <span className="card__par">, par {result.par}</span>
          </h2>
          <p className="card__sub">
            <span className="card__delta">{overPar === 0 ? 'Right on par' : `+${overPar} over par`}</span>{' '}
            {practiceFolds !== null ? (
              <>
                Your score today stays <span className="num">{result.folds}</span> {result.folds === 1 ? 'fold' : 'folds'}.
              </>
            ) : (
              <>
                in <span className="num">{formatTime(result.ms)}</span>.
              </>
            )}
            {standing && <> {standing}</>}
          </p>
        </header>

        {controller.info && controller.moves.length > 0 && (
          <div className="card__actions">
            <button className="btn" aria-expanded={replayOpen} aria-controls="solve-replay" onClick={() => setReplayOpen(!replayOpen)}>
              {replayOpen ? 'Hide fold replay' : practiceFolds !== null ? 'Replay practice folds' : 'Replay your folds'}
            </button>
            {replayOpen && (
              <SolveReplay puzzle={controller.info.puzzle} moves={controller.moves} paper={paperColor(controller.info.tier)} />
            )}
          </div>
        )}

        {result.grid && (
          <div className="card__share">
            <p className="card__note">This is the comment. It does not show which hinges you folded.</p>
            <pre className="card__grid">{result.grid}</pre>
          </div>
        )}

        <div className="card__actions">
          {controller.initState === 'loading' && <p className="card__note">Saving your Foldline result…</p>}
          {canReconnect && (
            <div className="card__login">
              <p>Your result is saved here. Reconnect to submit it.</p>
              <button className="btn btn--primary" onClick={() => window.location.reload()}>
                Reconnect
              </button>
            </div>
          )}
          {!canReconnect && controller.initState !== 'loading' && !init?.user.loggedIn && (
            <div className="card__login">
              <p>Log in to comment this result, keep your streak, and join the leaderboard.</p>
              <button className="btn btn--primary" onClick={() => showLoginPrompt()}>
                Log in to comment
              </button>
            </div>
          )}
          {!canReconnect && controller.submitError && (init?.user.loggedIn || controller.initState === 'offline') && (
            <p className="card__error">
              {controller.submitError}{' '}
              <button className="card__link" onClick={() => void controller.submitPending()}>
                Try again
              </button>
            </p>
          )}
          {init && init.user.loggedIn && storedServerSide && (
            <button
              className="btn btn--primary"
              onClick={() => void onShare()}
              disabled={share === 'posting' || share === 'posted' || share === 'already'}
            >
              {share === 'posting'
                ? 'Posting the comment…'
                : share === 'posted' || share === 'already'
                  ? 'Commented on this post'
                  : share === 'failed'
                    ? 'Comment failed. Try again'
                    : 'Comment your result'}
            </button>
          )}
        </div>

        {field ? (
          <div
            className="dist"
            role="img"
            aria-label={`How today's players did. You finished ${myBucket === 0 ? 'right on par' : `${myBucket} over par`}.`}
          >
            {field.dist.map((count, index) => (
              <div className="dist__col" key={index}>
                <span className="dist__count num">{count > 0 ? count : ''}</span>
                <div
                  className={index === myBucket ? 'dist__bar dist__bar--me' : 'dist__bar'}
                  style={{
                    height: `${Math.max(4, Math.round((count / peak) * 72))}px`,
                  }}
                />
                <span className="dist__label">{index === 0 ? 'par' : index === DIST_BUCKETS - 1 ? `+${DIST_BUCKETS - 1}` : `+${index}`}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="card__muted">Leaderboard comparison is unavailable.</p>
        )}

        <p className="card__streak">
          Streak <b className="num">{streak.current}</b>, best <b className="num">{streak.best}</b>
          {streak.nextTier && (
            <span className="card__muted">
              {' '}
              , {streak.nextTier.days - streak.best} {streak.nextTier.days - streak.best === 1 ? 'day' : 'days'} to {streak.nextTier.name}
            </span>
          )}
        </p>
        {complete?.streakExtended && <p className="card__tier">Streak extended!</p>}
        {complete?.newTier && <p className="card__tier">New flair tier earned: {complete.newTier}</p>}

        <div className="card__actions">
          {init && init.user.loggedIn && storedServerSide && (
            <>
              {!joined &&
                (joinFailed ? (
                  <button className="btn" onClick={() => navigateTo(`https://www.reddit.com/r/${init.subreddit}/`)}>
                    Open r/{init.subreddit} to join
                  </button>
                ) : (
                  <button className="btn" onClick={(event) => void onJoin(event.nativeEvent)} disabled={joining}>
                    {joining ? 'Joining…' : `Join r/${init.subreddit}`}
                  </button>
                ))}
              {init.flair.enabled && (
                <button className="toggle" role="switch" aria-checked={flairOptIn} onClick={() => void onFlair()}>
                  <span className="toggle__track" aria-hidden="true">
                    <span className="toggle__thumb" />
                  </span>
                  Wear streak flair{streak.tier ? ` (${streak.tier})` : ''}
                </button>
              )}
              {flairNote && <p className="card__muted">{flairNote}</p>}
              {init.routes.enabled &&
                (routeDone ? (
                  <p className="card__muted">Your Community Route is in the running for Sunday.</p>
                ) : (
                  <button className="btn" onClick={() => setEditorOpen(true)}>
                    Build a Community Route
                  </button>
                ))}
            </>
          )}
          <button className="btn" onClick={() => controller.practiceReset()}>
            {practiceFolds !== null ? 'Practice again' : 'Practice this puzzle'}
          </button>
        </div>

        <Countdown controller={controller} />
        <Leaderboard key={controller.complete ? 'scored' : 'local'} />
      </div>
      {editorOpen && (
        <Suspense
          fallback={
            <div className="sheet sheet--top">
              <div className="sheet__card">
                <p>Loading the editor…</p>
              </div>
            </div>
          }
        >
          <RouteEditor
            onClose={() => setEditorOpen(false)}
            onSubmitted={() => {
              setRouteDone(true);
              showToast('Route submitted. It is in the running for Sunday!');
            }}
          />
        </Suspense>
      )}
    </ModalSheet>
  );
}
