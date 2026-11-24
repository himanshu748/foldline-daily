import { context } from '@devvit/web/client';
import { applyMove, isSolved, type FoldAngle, type FoldMove } from '../../shared/engine';
import { decodeMoves, movesToWire, replay } from '../../shared/moves';
import { parsePostWire, type PostInfo } from '../../shared/postdata';
import { toLevel } from '../../shared/puzzle';
import { shareGrid } from '../../shared/share';
import type { CompleteResponse, InitResponse } from '../../shared/api';
import { api, ApiFailure } from '../lib/api';
import { track } from '../lib/track';

export type Phase = 'loading' | 'error' | 'play' | 'solved';

export interface LocalResult {
  folds: number;
  ms: number;
  par: number;
  grid: string;
}

const pendingKey = (postId: string): string => `foldline:pending:${postId}`;

interface PendingSubmission {
  rev: number;
  moves: ReturnType<typeof movesToWire>;
  clientMs: number;
  folds: number;
}

/**
 * The game state machine. React subscribes to `version`; the three.js scene
 * reports committed folds through `fold`. Scoring is always verified by the
 * server; a logged-out player's result waits in localStorage until login.
 */
export class Controller {
  version = 0;
  phase: Phase = 'loading';
  error: string | null = null;
  info: PostInfo | null = null;
  init: InitResponse | null = null;
  complete: CompleteResponse | null = null;
  /** Set when the solve could not be saved (logged out or offline). */
  localResult: LocalResult | null = null;
  submitError: string | null = null;
  stale = false;
  practice = false;
  /** Folds in the latest finished practice run; the scored result never changes. */
  practiceFolds: number | null = null;
  angles: FoldAngle[] = [];
  moves: FoldMove[] = [];
  selectedHinge = 1;
  startedAt: number | null = null;
  liveText = '';
  private serverOffset = 0;
  private history: FoldAngle[][] = [];
  private finishing = false;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  get puzzle() {
    return this.info?.puzzle ?? null;
  }

  get folds(): number {
    return this.moves.length;
  }

  get hingeCount(): number {
    return Math.max(0, (this.info?.puzzle.turns.length ?? 1) - 1);
  }

  get loggedIn(): boolean {
    return this.init?.user.loggedIn ?? false;
  }

  get solved(): boolean {
    return this.phase === 'solved';
  }

  /** Current server-time estimate, used by the timer and the countdown. */
  now(): number {
    return Date.now() + this.serverOffset;
  }

  /** The result to show on the end card: the server's, or the locally kept one. */
  get result(): { folds: number; ms: number; par: number; grid: string } | null {
    if (this.complete) return this.complete.result;
    if (this.init?.result) return this.init.result;
    return this.localResult;
  }

  async load(): Promise<void> {
    const fromPost = parsePostWire(context.postData);
    try {
      const init = await api.init();
      const info = fromPost ?? parsePostWire(init.post);
      if (!info) throw new Error('This post has no puzzle.');
      this.init = init;
      this.info = info;
      this.serverOffset = init.now - Date.now();
      if (init.result) {
        this.moves = decodeMoves(init.result.moves);
        this.angles = replay(info.puzzle, this.moves).angles;
        this.history = [[...info.puzzle.start]];
        this.liveText = `Solved in ${init.result.folds} folds.`;
        this.phase = 'solved';
      } else {
        this.angles = [...info.puzzle.start];
        this.history = [[...this.angles]];
        this.startedAt = init.startedAt;
        this.liveText = 'Puzzle ready. Drag a panel to fold it.';
        this.phase = 'play';
        if (init.user.loggedIn) void this.submitPending();
      }
    } catch (error) {
      this.error =
        error instanceof Error && error.message
          ? error.message
          : 'The puzzle could not be loaded.';
      this.phase = 'error';
    }
    this.emit();
  }

  fold(index: number, angle: FoldAngle): void {
    const puzzle = this.puzzle;
    if (this.phase !== 'play' || !puzzle || this.finishing) return;
    const level = toLevel(puzzle);
    let next: FoldAngle[];
    try {
      next = applyMove(level, this.angles, { index, angle });
    } catch {
      return;
    }
    if (this.moves.length === 0 && !this.practice) {
      track('first_interaction');
      track('attempt_start');
      this.startedAt ??= Date.now() + this.serverOffset;
      void api
        .start()
        .then((response) => {
          this.startedAt = response.startedAt;
          this.emit();
        })
        .catch(() => undefined);
    }
    this.angles = next;
    this.moves.push({ index, angle });
    this.history.push([...next]);
    this.liveText = `Hinge ${index} set to ${angle} degrees. ${this.folds} ${
      this.folds === 1 ? 'fold' : 'folds'
    } so far.`;

    if (!this.practice) {
      const atGoal = this.angles.filter((a, i) => i > 0 && a === puzzle.goal[i]).length;
      track('attempt_progress', { progress: atGoal / Math.max(1, this.angles.length - 1) });
    }
    if (isSolved(level, this.angles)) {
      if (this.practice) {
        this.practiceFolds = this.folds;
        this.phase = 'solved';
        this.liveText = `Practice solve in ${this.folds} folds.`;
      } else {
        void this.finish();
      }
    }
    this.emit();
  }

  /** Reverses the last fold. It is appended as an ordinary fold, so it always costs one. */
  undo(): void {
    if (this.phase !== 'play' || this.moves.length === 0 || this.finishing) return;
    const last = this.moves[this.moves.length - 1]!;
    const before = this.history[this.history.length - 2]!;
    this.fold(last.index, before[last.index]!);
  }

  selectHinge(index: number): void {
    if (index >= 1 && index <= this.hingeCount) {
      this.selectedHinge = index;
      this.emit();
    }
  }

  /** Keyboard and fold-button entry point. `direction` is +1 (up) or -1 (down). */
  foldSelected(direction: 1 | -1): boolean {
    if (this.phase !== 'play') return false;
    const angle = this.angles[this.selectedHinge];
    if (angle === undefined) return false;
    const next = angle + direction * 90;
    if (next < -90 || next > 90) return false;
    this.fold(this.selectedHinge, next as FoldAngle);
    return true;
  }

  /** Start an unscored run from the flat start state. */
  practiceReset(): void {
    const puzzle = this.puzzle;
    if (!puzzle) return;
    this.practice = true;
    this.practiceFolds = null;
    this.angles = [...puzzle.start];
    this.moves = [];
    this.history = [[...this.angles]];
    this.phase = 'play';
    this.liveText = 'Practice run. Your score is safe.';
    this.emit();
  }

  /** Retry a result that could not be saved earlier (after login, or after a network error). */
  async submitPending(): Promise<void> {
    const postId = context.postId;
    if (!postId) return;
    let pending: PendingSubmission | null;
    try {
      pending = JSON.parse(localStorage.getItem(pendingKey(postId)) ?? 'null') as PendingSubmission | null;
    } catch {
      pending = null;
    }
    if (!pending || !this.loggedIn) return;
    try {
      const complete = await api.complete({
        rev: pending.rev,
        moves: pending.moves,
        clientMs: pending.clientMs,
      });
      localStorage.removeItem(pendingKey(postId));
      this.complete = complete;
      this.localResult = null;
      this.submitError = null;
      this.phase = 'solved';
      this.emit();
    } catch (error) {
      if (error instanceof ApiFailure && (error.code === 'invalid-moves' || error.code === 'unsolved'))
        localStorage.removeItem(pendingKey(postId));
    }
  }

  private async finish(): Promise<void> {
    const puzzle = this.puzzle;
    if (!puzzle || !this.info || this.finishing) return;
    this.finishing = true;
    const clientMs = Math.max(
      0,
      Math.round(Date.now() + this.serverOffset - (this.startedAt ?? Date.now() + this.serverOffset))
    );
    const moves = movesToWire(this.moves);
    const local: LocalResult = {
      folds: this.moves.length,
      ms: clientMs,
      par: puzzle.par,
      grid: shareGrid(puzzle, this.moves),
    };
    this.liveText = `Solved in ${local.folds} folds.`;
    try {
      const complete = await api.complete({ rev: this.info.rev, moves, clientMs });
      this.complete = complete;
      this.localResult = null;
      this.submitError = null;
      if (complete.scored) track('attempt_complete', { score: local.folds });
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'stale') {
        // A moderator regenerated the puzzle mid-attempt; this solve cannot be scored.
        this.stale = true;
        this.submitError = null;
        this.localResult = null;
      } else if (
        error instanceof ApiFailure &&
        (error.code === 'invalid-moves' || error.code === 'unsolved')
      ) {
        this.submitError = 'The server could not verify that solve. It was not saved.';
        this.localResult = null;
      } else {
        // Logged out or offline: keep the verified moves locally and offer a retry.
        this.localResult = local;
        this.submitError =
          error instanceof ApiFailure && error.code === 'login'
            ? null
            : 'Your result could not be saved yet.';
        const postId = context.postId;
        if (postId) {
          try {
            localStorage.setItem(
              pendingKey(postId),
              JSON.stringify({ rev: this.info.rev, moves, clientMs, folds: local.folds })
            );
          } catch {
            /* storage blocked; the result is lost on reload, nothing more */
          }
        }
      }
    }
    this.finishing = false;
    this.phase = 'solved';
    this.emit();
  }
}
