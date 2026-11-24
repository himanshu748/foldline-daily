import { Hono } from 'hono';
import type { OnPostDeleteRequest, TriggerResponse } from '@devvit/web/shared';
import { forgetRoute } from '../core/community';
import { ensureDailyPost } from '../core/posts';

export const triggers = new Hono();

/** A fresh install is never empty: the first puzzle is posted straight away. */
const postToday = async (source: string): Promise<void> => {
  try {
    const outcome = await ensureDailyPost();
    console.log(`${source}:`, JSON.stringify(outcome));
  } catch (error) {
    console.error(`${source} could not post today's puzzle:`, error);
  }
};

triggers.post('/on-app-install', async (c) => {
  await postToday('on-app-install');
  return c.json<TriggerResponse>({});
});

triggers.post('/on-app-upgrade', async (c) => {
  await postToday('on-app-upgrade');
  return c.json<TriggerResponse>({});
});

/** A deleted Community Route leaves every index, so it can never become Sunday's puzzle. */
triggers.post('/on-post-delete', async (c) => {
  const input = (await c.req.json().catch(() => null)) as OnPostDeleteRequest | null;
  const postId = input?.postId;
  if (typeof postId === 'string') {
    try {
      if (await forgetRoute(postId)) console.log(`Forgot deleted route ${postId}`);
    } catch (error) {
      console.error('on-post-delete failed:', error);
    }
  }
  return c.json<TriggerResponse>({});
});
