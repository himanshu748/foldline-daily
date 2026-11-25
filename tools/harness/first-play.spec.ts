import { expect, test, type Page } from '@playwright/test';

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
