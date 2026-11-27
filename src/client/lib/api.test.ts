import { afterEach, expect, test, vi } from 'vitest';
import { api } from './api';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('a stalled solve request returns to local recovery without resubmitting', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn((_path: string, init: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    });
  });
  vi.stubGlobal('fetch', fetch);

  const response = api.complete({ rev: 1, moves: [], clientMs: 5200 });
  expect(fetch).toHaveBeenCalledWith('/api/attempt/complete', expect.objectContaining({
    method: 'POST',
    signal: expect.any(AbortSignal),
  }));
  const served = expect(response).rejects.toMatchObject({ code: 'offline' });
  await vi.advanceTimersByTimeAsync(8_000);
  await served;
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('a stalled comment request stops waiting without reposting', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn((_path: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    })
  );
  vi.stubGlobal('fetch', fetch);

  const response = api.share();
  expect(fetch).toHaveBeenCalledWith('/api/share', expect.objectContaining({
    method: 'POST',
    signal: expect.any(AbortSignal),
  }));
  const served = expect(response).rejects.toMatchObject({ code: 'offline' });
  await vi.advanceTimersByTimeAsync(8_000);
  await served;
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('a stalled leaderboard read times out so the player can retry', async () => {
  vi.useFakeTimers();
  const result = { type: 'leaderboard', rows: [], total: 0, me: null };
  const fetch = vi.fn((_path: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    })
  );
  fetch.mockResolvedValueOnce(new Response(JSON.stringify(result)));
  vi.stubGlobal('fetch', fetch);

  await expect(api.leaderboard()).resolves.toEqual(result);
  const response = api.leaderboard();
  expect(fetch).toHaveBeenLastCalledWith('/api/leaderboard', expect.objectContaining({
    method: 'GET',
    signal: expect.any(AbortSignal),
  }));
  const served = expect(response).rejects.toMatchObject({ code: 'offline' });
  await vi.advanceTimersByTimeAsync(4_000);
  await served;
  expect(fetch).toHaveBeenCalledTimes(2);
});
