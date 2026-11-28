import { context } from '@devvit/web/client';
import { applyMove, isSolved, type FoldAngle, type FoldMove } from '../../shared/engine';
import { decodeMoves, movesToWire, parseMoves, replay } from '../../shared/moves';
import { parsePostWire, type PostInfo } from '../../shared/postdata';
import { toLevel } from '../../shared/puzzle';
import { shareGrid } from '../../shared/share';
import type { CompleteResponse, InitResponse } from '../../shared/api';
import { api, ApiFailure } from '../lib/api';
import { track } from '../lib/track';
import { isPendingSolve, keepsPendingSolve, pendingAction, puzzleForPlay, restoreAttempt, type PendingSolve } from './session';

export type Phase = 'loading' | 'error' | 'play' | 'solved';

export interface LocalResult {
  folds: number;
  ms: number;
  par: number;
  grid: string;
}

const pendingKey = (postId: string): string => `foldline:pending:${postId}`;

type PendingSubmission = PendingSolve & { stored: string };

function readPending(postId: string | undefined): PendingSubmission | null {
  if (!postId) return null;
  try {
    const stored = localStorage.getItem(pendingKey(postId));
    if (stored === null) return null;
    const raw = JSON.parse(stored) as unknown;
    return isPendingSolve(raw) ? { ...raw, stored } : null;
  } catch {
    return null;
  }
}

/**
 * The game state machine. React subscribes to `version`; the three.js scene
 * reports committed folds through `fold`. Scoring is always verified by the
 * server; a logged-out player's result waits in localStorage until login.
 */
export class Controller {
  version = 0;
  phase: Phase = 'loading';
  /** Whether `/api/init` has answered. The board does not wait on this. */
  initState: 'loading' | 'ready' | 'offline' = 'loading';
  error: string | null = null;
  info: PostInfo | null = null;
  init: InitResponse | null = null;
  complete: CompleteResponse | null = null;
  /** Set when the solve could not be saved (logged out or offline). */
  localResult: LocalResult | null = null;
  submitError: string | null = null;
  submittingPending = false;
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
  /** An untouched restored draft yields to a newer board or a result from another tab. */
  private restoredDraft = false;
  private readonly draftKey = context.postId ? `foldline:attempt:${context.postId}:${context.userId ?? 'guest'}` : null;
  private readonly listeners = new Set<() => void>();

  constructor() {
    const cached = parsePostWire(context.postData);
    if (!cached) return;
    this.applyFresh(cached);
    this.liveText = 'Puzzle ready. Drag a panel to fold it.';
    if (!readPending(context.postId)) this.restoreDraft(cached, false);
  }

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

  get canReconnectToSubmit(): boolean {
    return this.initState === 'offline' && this.localResult !== null && readPending(context.postId)?.rev === this.info?.rev;
  }

  /** Current server-time estimate, used by the timer and the countdown. */
  now(): number {
    return Date.now() + this.serverOffset;
  }

  /** The result to show on the end card: the server's, or the locally kept one. */
  get result(): {
    folds: number;
    ms: number;
    par: number;
    grid: string;
  } | null {
    if (this.complete) return this.complete.result;
    if (this.init?.result) return this.init.result;
    return this.localResult;
  }

  async load(): Promise<void> {
    const cached = this.info ?? parsePostWire(context.postData);
    try {
      const init = await api.init();
      const server = parsePostWire(init.post);
      const { info, replaced } = puzzleForPlay(cached, server);
      if (!info) throw new Error('This post has no puzzle.');
      const pending = readPending(context.postId);
      if (pending && pending.rev > info.rev) this.stale = true;
      this.init = init;
      this.initState = 'ready';
      this.serverOffset = init.now - Date.now();
      if (this.restoredDraft && (replaced || init.result)) {
        this.clearDraft();
        this.applyFresh(info);
      }
      const folded = this.moves.length > 0 || this.finishing || this.solved;
      if (folded) {
        if (replaced) this.stale = true;
        this.info = this.info ?? info;
        if (!this.stale && !this.solved && !this.finishing && !this.practice && init.startedAt !== null) {
          this.startedAt = init.startedAt;
          this.saveDraft();
        }
        if (!this.stale && init.user.loggedIn && !init.result && !this.complete && !this.finishing) void this.submitPending();
      } else if (init.result) {
        this.showServerResult(info, init.result.moves, init.result.folds);
        if (pending && pending.rev <= info.rev) this.clearPending(pending.stored);
        this.clearDraft();
      } else {
        this.reconcilePending(info, pending, init.user.loggedIn, init.startedAt);
      }
    } catch (error) {
      this.initState = 'offline';
      if (cached && this.phase === 'play' && !this.finishing && this.moves.length === 0) {
        const pending = readPending(context.postId);
        if (pending?.rev === cached.rev && this.showLocal(cached, pending)) this.clearDraft();
      }
      if (!this.info || this.phase === 'loading') {
        this.error = error instanceof Error && error.message ? error.message : 'The puzzle could not be loaded.';
        this.phase = 'error';
      }
    }
    this.emit();
  }

  private applyFresh(info: PostInfo): void {
    this.info = info;
    this.angles = [...info.puzzle.start];
    this.moves = [];
    this.history = [[...this.angles]];
    this.practice = false;
    this.practiceFolds = null;
    this.restoredDraft = false;
    this.phase = 'play';
  }

  private showServerResult(info: PostInfo, moves: string, folds: number): void {
    this.info = info;
    this.moves = decodeMoves(moves);
    this.angles = replay(info.puzzle, this.moves).angles;
    this.history = [[...info.puzzle.start]];
    this.localResult = null;
    this.liveText = `Solved in ${folds} folds.`;
    this.phase = 'solved';
  }

  /** Show a logged-out solve again, or send it once the player has an account. */
  private reconcilePending(info: PostInfo, pending: PendingSubmission | null, loggedIn: boolean, startedAt: number | null): void {
    const action = pendingAction({
      pending,
      rev: info.rev,
      loggedIn,
      hasServerResult: false,
      folded: false,
    });
    if (pending && action !== 'keep') {
      if (action !== 'drop' && this.showLocal(info, pending)) {
        this.clearDraft();
        if (action === 'submit') void this.submitPending();
        return;
      }
      this.clearPending(pending.stored);
    }
    if (!this.info || this.info.kind !== info.kind || this.info.rev !== info.rev || this.info.date !== info.date) this.applyFresh(info);
    this.phase = 'play';
    this.liveText = 'Puzzle ready. Drag a panel to fold it.';
    this.restoreDraft(info, true);
    this.startedAt = startedAt ?? (this.restoredDraft ? this.startedAt : null);
    if (this.restoredDraft) this.saveDraft();
  }

  private restoreDraft(info: PostInfo, authoritative: boolean): void {
    if (!this.draftKey) return;
    try {
      const raw = sessionStorage.getItem(this.draftKey);
      if (!raw) return;
      const draft = restoreAttempt(info, JSON.parse(raw) as unknown);
      if (!draft) {
        if (authoritative) this.clearDraft();
        return;
      }
      this.startedAt = draft.startedAt;
      this.moves = draft.moves;
      this.history = draft.history;
      this.angles = draft.history[draft.history.length - 1]!;
      this.restoredDraft = true;
      this.liveText = `Resumed with ${this.folds} ${this.folds === 1 ? 'fold' : 'folds'}.`;
    } catch {
      if (authoritative) this.clearDraft();
    }
  }

  private saveDraft(): void {
    if (!this.draftKey || !this.info || this.startedAt === null) return;
    try {
      const { kind, date, rev } = this.info;
      sessionStorage.setItem(this.draftKey, JSON.stringify({
        kind, date, rev, startedAt: this.startedAt, moves: movesToWire(this.moves),
      }));
    } catch {
      /* The attempt is still playable if storage is blocked. */
    }
  }

  private clearDraft(): void {
    if (!this.draftKey) return;
    try {
      sessionStorage.removeItem(this.draftKey);
    } catch {
      /* storage blocked */
    }
  }

  private showLocal(info: PostInfo, pending: PendingSolve): boolean {
    const moves = parseMoves(pending.moves);
    if (!moves) return false;
    let played: ReturnType<typeof replay>;
    try {
      played = replay(info.puzzle, moves);
    } catch {
      return false;
    }
    if (!played.solved) return false;
    this.info = info;
    this.moves = moves;
    this.angles = played.angles;
    this.history = [[...info.puzzle.start]];
    this.localResult = {
      folds: moves.length,
      ms: Math.max(0, Math.round(pending.clientMs)),
      par: info.puzzle.par,
      grid: shareGrid(info.puzzle, moves),
    };
    this.phase = 'solved';
    this.liveText = `Solved in ${moves.length} folds.`;
    return true;
  }

  private clearPending(expected: string): void {
    const postId = context.postId;
    if (!postId) return;
    try {
      const key = pendingKey(postId);
      if (localStorage.getItem(key) === expected) localStorage.removeItem(key);
    } catch {
      /* storage blocked */
    }
  }

  fold(index: number, angle: FoldAngle): void {
    const puzzle = this.puzzle;
    if (this.phase !== 'play' || !puzzle || this.finishing) return;
    const level = toLevel(puzzle);
    const attempt = this.info;
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
          if (this.info !== attempt) return;
          this.startedAt = response.startedAt;
          if (this.phase === 'play' && !this.finishing && !this.practice && !this.stale) this.saveDraft();
          this.emit();
        })
        .catch(() => undefined);
    }
    this.angles = next;
    this.restoredDraft = false;
    this.moves.push({ index, angle });
    this.history.push([...next]);
    this.liveText = `Hinge ${index} set to ${angle} degrees. ${this.folds} ${this.folds === 1 ? 'fold' : 'folds'} so far.`;

    if (!this.practice) {
      const atGoal = this.angles.filter((a, i) => i > 0 && a === puzzle.goal[i]).length;
      track('attempt_progress', {
        progress: atGoal / Math.max(1, this.angles.length - 1),
      });
    }
    if (isSolved(level, this.angles)) {
      if (this.practice) {
        this.practiceFolds = this.folds;
        this.phase = 'solved';
        this.liveText = `Practice solve in ${this.folds} folds.`;
      } else {
        void this.finish();
      }
    } else if (!this.practice && !this.stale) {
      this.saveDraft();
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
    this.clearDraft();
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
    if (!postId || !this.loggedIn || this.submittingPending) return;
    const pending = readPending(postId);
    if (!pending) return;
    if (this.info && pending.rev > this.info.rev) {
      this.stale = true;
      this.emit();
      return;
    }
    const moves = parseMoves(pending.moves);
    if (!moves) {
      this.clearPending(pending.stored);
      return;
    }
    this.submittingPending = true;
    this.emit();
    try {
      const complete = await api.complete({
        rev: pending.rev,
        moves: movesToWire(moves),
        clientMs: pending.clientMs,
      });
      this.clearPending(pending.stored);
      this.clearDraft();
      this.complete = complete;
      this.localResult = null;
      this.submitError = null;
      // Confirming the ranked result must not end a practice round already in progress.
      if (!this.practice) this.phase = 'solved';
    } catch (error) {
      const code = error instanceof ApiFailure ? error.code : null;
      if (!keepsPendingSolve(code)) {
        this.clearPending(pending.stored);
        this.localResult = null;
        this.submitError = code === 'stale' ? null : 'The server could not verify that solve. It was not saved.';
        if (code === 'stale') this.stale = true;
        if (this.info && !this.practice) this.applyFresh(this.info);
      } else {
        this.submitError = 'Your result could not be saved yet.';
      }
    } finally {
      this.submittingPending = false;
      this.emit();
    }
  }

  private async finish(): Promise<void> {
    const puzzle = this.puzzle;
    if (!puzzle || !this.info || this.finishing) return;
    this.finishing = true;
    const clientMs = Math.max(0, Math.round(Date.now() + this.serverOffset - (this.startedAt ?? Date.now() + this.serverOffset)));
    const moves = movesToWire(this.moves);
    const local: LocalResult = {
      folds: this.moves.length,
      ms: clientMs,
      par: puzzle.par,
      grid: shareGrid(puzzle, this.moves),
    };
    const rev = this.info.rev;
    const postId = context.postId;
    const pending = JSON.stringify({ rev, moves, clientMs, folds: local.folds });
    if (postId) {
      try {
        // Save before submitting so closing or reloading cannot strand the solve.
        const stored = readPending(postId);
        if (stored && stored.rev > rev) this.stale = true;
        else localStorage.setItem(pendingKey(postId), pending);
        this.clearDraft();
      } catch {
        /* The live submission can still succeed if storage is blocked. */
      }
    }
    this.liveText = `Solved in ${local.folds} folds.`;
    try {
      const complete = await api.complete({
        rev,
        moves,
        clientMs,
      });
      this.complete = complete;
      this.clearPending(pending);
      this.clearDraft();
      this.localResult = null;
      this.submitError = null;
      if (complete.scored) track('attempt_complete', { score: local.folds });
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'stale') {
        // A moderator regenerated the puzzle mid-attempt; this solve cannot be scored.
        this.stale = true;
        this.clearPending(pending);
        this.clearDraft();
        this.submitError = null;
        this.localResult = null;
      } else if (error instanceof ApiFailure && (error.code === 'invalid-moves' || error.code === 'unsolved')) {
        this.clearPending(pending);
        this.clearDraft();
        this.submitError = 'The server could not verify that solve. It was not saved.';
        this.localResult = null;
      } else {
        // Logged out or offline: keep the verified moves locally and offer a retry.
        this.localResult = local;
        this.submitError = error instanceof ApiFailure && error.code === 'login' ? null : 'Your result could not be saved yet.';
      }
    }
    this.finishing = false;
    this.phase = 'solved';
    this.emit();
  }
}
