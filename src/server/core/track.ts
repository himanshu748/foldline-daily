import { telemetry } from '@devvit/analytics/server/reddit';
import { redis } from '@devvit/web/server';
import { TRACK_EVENTS, type TrackEvent, type TrackResponse } from '../../shared/api';
import { K } from './keys';

/** Adds one to a funnel counter for the day. */
export const countEvent = async (date: string, event: string): Promise<void> => {
  await redis.hIncrBy(K.funnel(date), event, 1);
};

/** Counts an event at most once per player per day. Returns true when it counted. */
export async function countOnce(date: string, userId: string, event: string): Promise<boolean> {
  if ((await redis.hSetNX(K.seen(date), `${userId}:${event}`, '1')) !== 1) return false;
  await countEvent(date, event);
  return true;
}

/** Events whose funnel count is taken where the action really happens, not from the client. */
const SERVER_COUNTED: ReadonlySet<TrackEvent> = new Set([
  'attempt_progress',
  'attempt_complete',
  'share_comment',
  'return_next_day',
]);

const isEvent = (value: unknown): value is TrackEvent =>
  typeof value === 'string' && (TRACK_EVENTS as readonly string[]).includes(value);

const clamp01 = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

async function sendJourney(
  event: TrackEvent,
  journeyId: string | undefined,
  body: Record<string, unknown>
): Promise<Pick<TrackResponse, 'journeyId' | 'receipt'>> {
  switch (event) {
    case 'post_view':
      // A view must never start a journey; App.Ready is the event for it.
      return { receipt: (await telemetry.appReady()).receipt.status };
    case 'first_interaction': {
      const sent = await telemetry.journeyInteraction({
        journeyId: journeyId ?? '',
        action: 'first_interaction',
        actionDetails: '',
      });
      return { receipt: sent.receipt.status };
    }
    case 'attempt_start': {
      const started = await telemetry.startJourney();
      return { journeyId: started.journeyId, receipt: started.receipt.status };
    }
    case 'attempt_progress': {
      if (!journeyId) return {};
      const sent = await telemetry.journeyProgress({ journeyId, progress: clamp01(body.progress) });
      return { receipt: sent.receipt.status };
    }
    case 'attempt_complete': {
      if (!journeyId) return {};
      const score = typeof body.score === 'number' && Number.isFinite(body.score) ? body.score : 0;
      const sent = await telemetry.endJourney({
        journeyId,
        complete: true,
        game: { win: true, score },
      });
      return { receipt: sent.receipt.status };
    }
    default:
      // share_comment and return_next_day happen after the journey ends; a
      // Journeys call here would start a false one, so they are counters only.
      return {};
  }
}

/**
 * The server half of the client's single `track()` call: forwards the event to
 * Devvit Journeys and keeps a funnel counter in Redis. Journeys drops events
 * until Reddit allowlists the app, so the counters are what can be checked now.
 */
export async function track(
  body: unknown,
  userId: string | undefined,
  today: string
): Promise<TrackResponse> {
  const request = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const response: TrackResponse = { type: 'track' };
  if (!isEvent(request.event)) return response;
  const event = request.event;
  const journeyId =
    typeof request.journeyId === 'string' && request.journeyId.length > 0 && request.journeyId.length <= 128
      ? request.journeyId
      : undefined;

  try {
    const sent = await sendJourney(event, journeyId, request);
    if (sent.journeyId) response.journeyId = sent.journeyId;
    if (sent.receipt) {
      response.receipt = sent.receipt;
      if (event !== 'attempt_progress') console.log(`journeys ${event}: ${sent.receipt}`);
    }
  } catch (error) {
    console.warn(`journeys ${event} failed:`, error);
  }

  if (!SERVER_COUNTED.has(event)) {
    if (userId) await countOnce(today, userId, event);
    else await countEvent(today, `${event}_logged_out`);
  }
  return response;
}
