import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { addDays } from '../../shared/dates';
import { isSkipped } from '../core/config';
import { ensureDailyPost, finishersToday, type PostOutcome } from '../core/posts';
import { postUrl } from '../core/postinfo';

export const menu = new Hono();

export function outcomeResponse(outcome: PostOutcome): UiResponse {
  switch (outcome.status) {
    case 'created':
      return {
        showToast: { text: `Posted the puzzle for ${outcome.date}.`, appearance: 'success' },
        navigateTo: postUrl(context.subredditName, outcome.postId),
      };
    case 'exists':
      return {
        showToast: `The puzzle for ${outcome.date} is already posted.`,
        navigateTo: postUrl(context.subredditName, outcome.postId),
      };
    case 'skipped':
      return { showToast: `${outcome.date} is marked as skipped. Undo the skip first.` };
    case 'before-start':
      return { showToast: `${outcome.date} is before the start date in the app settings.` };
    default:
      return { showToast: 'Another run is creating that post right now. Try again in a minute.' };
  }
}

menu.post('/post-now', async (c) => {
  try {
    return c.json<UiResponse>(outcomeResponse(await ensureDailyPost()));
  } catch (error) {
    console.error('post-now failed:', error);
    return c.json<UiResponse>({ showToast: 'Reddit did not accept the post. Please try again.' });
  }
});

menu.post('/regenerate', async (c) => {
  const { date, count, posted } = await finishersToday();
  if (!posted)
    return c.json<UiResponse>({ showToast: `There is no puzzle post for ${date} yet.` });
  const finished =
    count === null
      ? 'The finish count could not be confirmed.'
      : count === 0
      ? 'Nobody has finished it yet.'
      : `${count} ${count === 1 ? 'player has' : 'players have'} finished it. They keep their streak credit.`;
  return c.json<UiResponse>({
    showForm: {
      name: 'regenerateForm',
      form: {
        title: "Regenerate today's puzzle?",
        description: `${finished} The leaderboard for ${date} starts clean.`,
        acceptLabel: 'Regenerate',
        fields: [
          {
            type: 'boolean',
            name: 'confirm',
            label: "Yes, replace today's puzzle",
            defaultValue: false,
          },
        ],
      },
    },
  });
});

menu.post('/skip', async (c) => {
  const { date: today } = await finishersToday();
  const tomorrow = addDays(today, 1);
  const [todaySkipped, tomorrowSkipped] = await Promise.all([
    isSkipped(today),
    isSkipped(tomorrow),
  ]);
  const option = (date: string, label: string, skipped: boolean) =>
    skipped
      ? { label: `Undo the skip for ${label} (${date})`, value: `clear:${date}` }
      : { label: `Skip ${label} (${date})`, value: `skip:${date}` };
  return c.json<UiResponse>({
    showForm: {
      name: 'skipForm',
      form: {
        title: 'Skip a day',
        description:
          'A skipped day gets no puzzle post and never breaks a streak. If the post already exists it becomes practice only.',
        acceptLabel: 'Apply',
        fields: [
          {
            type: 'select',
            name: 'action',
            label: 'Day',
            required: true,
            options: [
              option(today, 'today', todaySkipped),
              option(tomorrow, 'tomorrow', tomorrowSkipped),
            ],
          },
        ],
      },
    },
  });
});

menu.post('/post-date', async (c) => {
  const { date } = await finishersToday();
  return c.json<UiResponse>({
    showForm: {
      name: 'postDateForm',
      form: {
        title: 'Post a specific day',
        description:
          'Backfill a missed day, or post an upcoming day early (up to 7 days ahead). A Sunday uses the top Community Route of its week.',
        acceptLabel: 'Post',
        fields: [
          {
            type: 'string',
            name: 'date',
            label: 'Date (YYYY-MM-DD)',
            defaultValue: date,
            required: true,
          },
        ],
      },
    },
  });
});
