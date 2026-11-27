import { afterEach, expect, it, vi } from 'vitest';
import type { CompleteResponse } from '../../shared/api';
import { api, ApiFailure } from '../lib/api';
import { Controller } from './controller';

vi.mock('@devvit/web/client', () => ({ context: { postId: 't3_retry' } }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const completed: CompleteResponse = {
  type: 'complete',
  scored: true,
  result: { folds: 1, par: 1, ms: 2000, moves: '1+', grid: '' },
  attempt: { folds: 1, ms: 2000 },
  streak: { current: 1, best: 1, tier: null, nextTier: null },
  field: null,
  streakExtended: true,
  newTier: null,
  flairStatus: 'unchanged',
};

function pendingSolve() {
  const storage = new Map([
    ['foldline:pending:t3_retry', JSON.stringify({ rev: 1, moves: [[1, 90]], clientMs: 2000, folds: 1 })],
  ]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
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
