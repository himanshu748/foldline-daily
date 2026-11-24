import { Hono } from 'hono';
import type { TaskResponse } from '@devvit/web/server';
import { ensureDailyPost } from '../core/posts';

export const schedulerRoutes = new Hono();

/** Runs every 15 minutes. Idempotent: it posts only when today's puzzle is missing. */
schedulerRoutes.post('/daily-post', async (c) => {
  try {
    const outcome = await ensureDailyPost();
    if (outcome.status !== 'exists') console.log('daily-post:', JSON.stringify(outcome));
  } catch (error) {
    // The claim was released, so the next run tries again.
    console.error('daily-post failed:', error);
  }
  return c.json<TaskResponse>({});
});
