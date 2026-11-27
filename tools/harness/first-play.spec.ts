import { expect, test, type Page } from '@playwright/test';
import type { InitResponse } from '../../src/shared/api';

async function solveFixture(page: Page) {
  // The shortest solution for the harness board dated 2026-11-19.
  for (const key of ['1', 'ArrowUp', 'ArrowUp', '2', 'ArrowDown', '3', 'ArrowUp', '4', 'ArrowDown']) {
    await page.keyboard.press(key);
  }
}

test('keyboard help, first score, private fold replay, and practice at phone width', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let submissions = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/attempt/complete') submissions++;
  });
  await page.goto('/src/client/game.html');

  const helpButton = page.locator('button[aria-label="How to play"]');
  await helpButton.click();
  const help = page.getByRole('dialog', { name: 'Fold the paper into the shape' });
  const helpHeading = help.getByRole('heading');
  await expect(helpHeading).toBeFocused();
  await helpButton.evaluate((button) => (button as HTMLElement).focus());
  await expect(helpHeading).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(help.getByRole('button', { name: 'Start folding' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await expect(helpButton).toBeFocused();

  await solveFixture(page);
  const result = page.getByRole('dialog', { name: /5 folds, par 5/ });
  const resultHeading = result.getByRole('heading', { level: 2 });
  await expect(resultHeading).toBeFocused();
  await helpButton.evaluate((button) => (button as HTMLElement).focus());
  await expect(resultHeading).toBeFocused();
  await expect(result.getByRole('region', { name: 'Leaderboard' }).getByText('harness (you)')).toBeVisible();

  const shareGrid = await result.locator('.card__grid').innerText();
  await result.getByRole('button', { name: 'Replay your folds' }).click();
  const replay = result.getByRole('region', { name: 'Private fold replay' });
  await expect(replay.getByText('Fold 0 of 5. Starting position.')).toBeVisible();
  const previous = replay.getByRole('button', { name: 'Previous fold' });
  const next = replay.getByRole('button', { name: 'Next fold' });
  await expect(previous).toBeDisabled();
  const canvas = replay.locator('canvas');
  const initial = await canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL());
  await next.click();
  await expect(replay.getByText('Fold 1 of 5. Hinge 1 set flat.')).toBeVisible();
  await expect.poll(() => canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL())).not.toBe(initial);
  for (let step = 1; step < 5; step++) await next.click();
  await expect(replay.getByText('Fold 5 of 5. Hinge 4 set down.')).toBeVisible();
  await expect(next).toBeDisabled();
  await previous.click();
  await expect(replay.getByText(/^Fold 4 of 5\./)).toBeVisible();
  await result.getByRole('button', { name: 'Hide fold replay' }).click();
  await expect(replay).toHaveCount(0);
  expect(await result.locator('.card__grid').innerText()).toBe(shareGrid);
  expect(submissions).toBe(1);

  await result.getByRole('button', { name: 'Practice this puzzle' }).click();
  await expect(result).toHaveCount(0);
  await expect(page.getByText('Practice run: your score is safe.')).toBeVisible();
  await solveFixture(page);
  await expect(result.getByText('Your score today stays 5 folds.')).toBeVisible();
  await expect(result.getByRole('button', { name: 'Replay practice folds' })).toBeVisible();
  expect(submissions).toBe(1);
  expect(errors).toEqual([]);
});

test('a signed-out solve survives reload and offers the Reddit login prompt', async ({ page }) => {
  await page.route('**/api/init', async (route) => {
    const response = await route.fetch();
    const init: InitResponse = await response.json();
    await route.fulfill({
      response,
      json: {
        ...init,
        user: { loggedIn: false, name: null },
        startedAt: null,
        result: null,
        field: { ...init.field, rank: null, standing: null },
      } satisfies InitResponse,
    });
  });
  await page.route('**/api/attempt/complete', (route) =>
    route.fulfill({
      status: 401,
      json: { status: 'error', code: 'login', message: 'Log in to Reddit to save your result.' },
    })
  );

  await page.goto('/src/client/game.html');
  const rejectedSave = page.waitForResponse('**/api/attempt/complete');
  await solveFixture(page);
  expect((await rejectedSave).status()).toBe(401);

  const result = page.getByRole('dialog', { name: /5 folds, par 5/ });
  const login = result.getByRole('button', { name: 'Log in to comment' });
  await expect(login).toBeVisible();
  await expect(result.getByRole('button', { name: 'Comment your result' })).toHaveCount(0);

  await page.reload();
  await expect(login).toBeVisible();
  const prompt = page.waitForEvent('console', (message) => message.text() === 'showLoginPrompt');
  await login.click();
  await prompt;
});

test('an unfinished attempt keeps its timer, folds and undo history across reload', async ({ page }) => {
  const startedAt = Date.now() - 30_000;
  let starts = 0;
  let submissions = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/attempt/complete') submissions++;
  });
  await page.route('**/api/attempt/start', (route) => {
    starts++;
    return route.fulfill({ json: { type: 'start', startedAt } });
  });
  await page.route('**/api/init', async (route) => {
    const response = await route.fetch();
    const init: InitResponse = await response.json();
    await route.fulfill({ response, json: { ...init, result: null, startedAt: starts ? startedAt : null } });
  });

  await page.goto('/src/client/game.html');
  await page.keyboard.press('1');
  const started = page.waitForResponse('**/api/attempt/start');
  await page.keyboard.press('ArrowUp');
  await started;
  await page.keyboard.press('ArrowUp');
  await expect(page.getByLabel('2 folds', { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('2 folds', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hinge 1, folded up' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo last fold (costs one fold)' }).click();
  await expect(page.getByRole('button', { name: 'Hinge 1, folded flat' })).toBeVisible();
  await expect(page.getByLabel('3 folds', { exact: true })).toBeVisible();
  const completed = page.waitForRequest('**/api/attempt/complete');
  const accepted = page.waitForResponse('**/api/attempt/complete');
  for (const key of ['1', 'ArrowUp', '2', 'ArrowDown', '3', 'ArrowUp', '4', 'ArrowDown']) {
    await page.keyboard.press(key);
  }
  const submission = (await completed).postDataJSON();
  expect(submission.moves).toEqual([[1, 0], [1, 90], [1, 0], [1, 90], [2, -90], [3, 0], [4, -90]]);
  expect(submission.clientMs).toBeGreaterThanOrEqual(30_000);
  expect((await accepted).status()).toBe(200);
  expect(starts).toBe(1);
  expect(submissions).toBe(1);
});
