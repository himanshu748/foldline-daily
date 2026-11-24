import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { addDays, diffDays, isDateKey } from '../../shared/dates';
import { loadConfig, setSkipped, todayKey } from '../core/config';
import { ensureDailyPost, regenerateToday } from '../core/posts';
import { postUrl } from '../core/postinfo';
import { outcomeResponse } from './menu';

export const forms = new Hono();

const MAX_DAYS_AHEAD = 7;

forms.post('/regenerate', async (c) => {
  const values = (await c.req.json().catch(() => ({}))) as { confirm?: unknown };
  if (values.confirm !== true)
    return c.json<UiResponse>({ showToast: "Nothing changed. Today's puzzle was kept." });
  try {
    const outcome = await regenerateToday();
    if (outcome.status === 'no-post')
      return c.json<UiResponse>({ showToast: 'There is no puzzle post for today yet.' });
    return c.json<UiResponse>({
      showToast: {
        text: outcome.reposted
          ? "Today's puzzle was replaced with a new post."
          : "Today's puzzle was replaced. Players see it when they reopen the post.",
        appearance: 'success',
      },
      navigateTo: postUrl(context.subredditName, outcome.postId),
    });
  } catch (error) {
    console.error('regenerate failed:', error);
    return c.json<UiResponse>({ showToast: 'The puzzle could not be replaced. Please try again.' });
  }
});

forms.post('/skip', async (c) => {
  const values = (await c.req.json().catch(() => ({}))) as { action?: unknown };
  const choice = Array.isArray(values.action) ? values.action[0] : values.action;
  const [verb, date] = typeof choice === 'string' ? choice.split(':') : [];
  const today = todayKey(await loadConfig(), Date.now());
  if ((verb !== 'skip' && verb !== 'clear') || !isDateKey(date))
    return c.json<UiResponse>({ showToast: 'Choose a day first.' });
  if (date !== today && date !== addDays(today, 1))
    return c.json<UiResponse>({ showToast: 'Only today or tomorrow can be skipped.' });
  await setSkipped(date, verb === 'skip');
  return c.json<UiResponse>({
    showToast: {
      text:
        verb === 'skip'
          ? `${date} is skipped. Streaks are safe.`
          : `${date} is no longer skipped.`,
      appearance: 'success',
    },
  });
});

forms.post('/post-date', async (c) => {
  const values = (await c.req.json().catch(() => ({}))) as { date?: unknown };
  const date = typeof values.date === 'string' ? values.date.trim() : '';
  if (!isDateKey(date))
    return c.json<UiResponse>({ showToast: 'Use a real date in YYYY-MM-DD format.' });
  const now = Date.now();
  const today = todayKey(await loadConfig(), now);
  if (diffDays(today, date) > MAX_DAYS_AHEAD)
    return c.json<UiResponse>({
      showToast: `You can post at most ${MAX_DAYS_AHEAD} days ahead.`,
    });
  try {
    return c.json<UiResponse>(outcomeResponse(await ensureDailyPost(now, date)));
  } catch (error) {
    console.error('post-date failed:', error);
    return c.json<UiResponse>({ showToast: 'Reddit did not accept the post. Please try again.' });
  }
});
