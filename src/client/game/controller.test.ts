import { afterEach, expect, it, vi } from 'vitest';
import type { CompleteResponse, InitResponse } from '../../shared/api';
import { toPostWire } from '../../shared/postdata';
import { api, ApiFailure } from '../lib/api';
import { Controller } from './controller';

vi.mock('@devvit/web/client', () => ({ context: { postId: 't3_retry' } }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const completed = {
  type: 'complete',
  scored: true,
  result: { folds: 1, par: 1, ms: 2000, moves: '1+', grid: '' },
  attempt: { folds: 1, ms: 2000 },
  streak: { current: 1, best: 1, tier: null, nextTier: null },
  field: null,
  streakExtended: true,
  newTier: null,
  flairStatus: 'unchanged',
} satisfies CompleteResponse;

function pendingSolve() {
  const storage = new Map([
    ['foldline:pending:t3_retry', JSON.stringify({ rev: 1, moves: [[1, 90]], clientMs: 2000, folds: 1 })],
  ]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => storage.delete(key),
  });
  const controller = new Controller();
  vi.spyOn(controller, 'loggedIn', 'get').mockReturnValue(true);
  return { controller, storage };
}

it('submits a pending solve only once while a save is in progress', async () => {
  const { controller, storage } = pendingSolve();
  let finish!: (response: CompleteResponse) => void;
  const waiting = new Promise<CompleteResponse>((resolve) => { finish = resolve; });
  const complete = vi.spyOn(api, 'complete').mockReturnValue(waiting);

  const first = controller.submitPending();
  const second = controller.submitPending();
  const submitting = controller.submittingPending;
  finish(completed);
  await Promise.all([first, second]);

  expect(complete).toHaveBeenCalledTimes(1);
  expect(submitting).toBe(true);
  expect(controller.submittingPending).toBe(false);
  expect(controller.complete).toEqual(completed);
  expect(storage.size).toBe(0);
});

it('allows another save after a pending solve request fails', async () => {
  const { controller, storage } = pendingSolve();
  const complete = vi.spyOn(api, 'complete')
    .mockRejectedValueOnce(new ApiFailure(0, 'offline', 'Offline'))
    .mockResolvedValueOnce(completed);

  await controller.submitPending();
  expect(controller.submittingPending).toBe(false);
  expect(storage.size).toBe(1);
  await controller.submitPending();
  expect(complete).toHaveBeenCalledTimes(2);
  expect(controller.complete).toEqual(completed);
  expect(storage.size).toBe(0);
});

it.each(['success', 'stale'])('keeps a newer local solve when an older retry returns %s', async (outcome) => {
  const { controller, storage } = pendingSolve();
  let resolve!: (response: CompleteResponse) => void;
  let reject!: (error: ApiFailure) => void;
  vi.spyOn(api, 'complete').mockReturnValue(new Promise((success, failure) => {
    resolve = success;
    reject = failure;
  }));

  const retrying = controller.submitPending();
  const newer = JSON.stringify({ rev: 2, moves: [[2, -90]], clientMs: 4000, folds: 1 });
  storage.set('foldline:pending:t3_retry', newer);
  if (outcome === 'success') resolve(completed);
  else reject(new ApiFailure(409, 'stale', 'This puzzle changed'));
  await retrying;

  expect(storage.get('foldline:pending:t3_retry')).toBe(newer);
});

function olderInit(result: InitResponse['result']): InitResponse {
  return {
    type: 'init',
    post: toPostWire({
      kind: 'daily', date: '2026-11-28', day: 1, rev: 1, tier: 1, source: 'generated',
      puzzle: { turns: ['straight', 'straight', 'straight'], start: [0, 0, 0], goal: [0, 90, 0], par: 1 },
    }),
    postId: 't3_retry', subreddit: 'foldline', user: { loggedIn: true, name: 'pilot' },
    today: '2026-11-28', now: 4000, isToday: true, skipped: false, nextPuzzleInMs: 1000, startedAt: null,
    result, streak: completed.streak, field: null, flair: { enabled: false, optedIn: false },
    routes: { enabled: false, submitted: false }, subscribed: false, shared: false,
  };
}

const newerSolve = JSON.stringify({ rev: 2, moves: [[1, 90]], clientMs: 3000, folds: 1 });

it.each([null, completed.result])('keeps a newer local solve when a delayed init returns an older revision (%j)', async (result) => {
  const { controller, storage } = pendingSolve();
  let respond!: (response: InitResponse) => void;
  vi.spyOn(api, 'init').mockReturnValue(new Promise((resolve) => { respond = resolve; }));
  const complete = vi.spyOn(api, 'complete');
  const waiting = controller.load();
  storage.set('foldline:pending:t3_retry', newerSolve);
  respond(olderInit(result));
  await waiting;

  expect(storage.get('foldline:pending:t3_retry')).toBe(newerSolve);
  expect(complete).not.toHaveBeenCalled();
  expect(controller.stale).toBe(true);
});

it('does not overwrite a newer stored solve when an older open board finishes', async () => {
  const { controller, storage } = pendingSolve();
  storage.clear();
  vi.spyOn(api, 'init').mockResolvedValue(olderInit(null));
  vi.spyOn(api, 'start').mockResolvedValue({ type: 'start', startedAt: 2000 });
  vi.spyOn(api, 'complete').mockRejectedValue(new ApiFailure(409, 'stale', 'This puzzle changed'));
  await controller.load();
  storage.set('foldline:pending:t3_retry', newerSolve);
  controller.fold(1, 90);
  await vi.waitFor(() => expect(controller.phase).toBe('solved'));

  expect(storage.get('foldline:pending:t3_retry')).toBe(newerSolve);
});

it('does not retry a newer solve from an older open board', async () => {
  const { controller, storage } = pendingSolve();
  storage.clear();
  vi.spyOn(api, 'init').mockResolvedValue(olderInit(null));
  const complete = vi.spyOn(api, 'complete');
  await controller.load();
  storage.set('foldline:pending:t3_retry', newerSolve);

  await controller.submitPending();

  expect(complete).not.toHaveBeenCalled();
  expect(storage.get('foldline:pending:t3_retry')).toBe(newerSolve);
  expect(controller.stale).toBe(true);
});

it('keeps an active practice round open when a saved solve is confirmed', async () => {
  const { controller, storage } = pendingSolve();
  let respond!: (response: CompleteResponse) => void;
  vi.spyOn(api, 'init').mockResolvedValue(olderInit(null));
  vi.spyOn(api, 'complete').mockReturnValue(new Promise((resolve) => { respond = resolve; }));

  await controller.load();
  expect(controller.submittingPending).toBe(true);
  controller.practiceReset();
  controller.fold(2, 90);

  respond(completed);
  await vi.waitFor(() => expect(controller.submittingPending).toBe(false));

  expect(controller.phase).toBe('play');
  expect(controller.moves).toEqual([{ index: 2, angle: 90 }]);
  expect(controller.complete).toEqual(completed);
  expect(storage.size).toBe(0);
});

it.each(['invalid-moves', 'stale'])('keeps practice open when a pending ranked solve is rejected as %s', async (code) => {
  const { controller, storage } = pendingSolve();
  let reject!: (failure: ApiFailure) => void;
  vi.spyOn(api, 'init').mockResolvedValue(olderInit(null));
  vi.spyOn(api, 'complete').mockReturnValue(new Promise((_, fail) => { reject = fail; }));

  await controller.load();
  expect(controller.submittingPending).toBe(true);
  controller.practiceReset();
  controller.fold(2, 90);

  reject(new ApiFailure(code === 'stale' ? 409 : 400, code, 'Ranked solve rejected'));
  await vi.waitFor(() => expect(controller.submittingPending).toBe(false));

  expect(controller.phase).toBe('play');
  expect(controller.moves).toEqual([{ index: 2, angle: 90 }]);
  expect(controller.practice).toBe(true);
  expect(controller.stale).toBe(code === 'stale');
  expect(storage.size).toBe(0);
});
