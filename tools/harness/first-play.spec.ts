import { expect, test, type Page } from '@playwright/test';
import type { InitResponse } from '../../src/shared/api';

async function solveFixture(page: Page) {
  // The shortest solution for the harness board dated 2026-11-19.
  for (const key of ['1', 'ArrowUp', 'ArrowUp', '2', 'ArrowDown', '3', 'ArrowUp', '4', 'ArrowDown']) {
    await page.keyboard.press(key);
  }
}

test('keyboard help, first score, and practice at phone width', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
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

  await result.getByRole('button', { name: 'Practice this puzzle' }).click();
  await expect(result).toHaveCount(0);
  await expect(page.getByText('Practice run: your score is safe.')).toBeVisible();
  await solveFixture(page);
  await expect(result.getByText('Your score today stays 5 folds.')).toBeVisible();
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
