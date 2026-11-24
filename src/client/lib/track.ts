import type { TrackEvent } from '../../shared/api';
import { api } from './api';

let journeyId: string | undefined;
let queue: Promise<void> = Promise.resolve();
const sentOnce = new Set<TrackEvent>();
const ONCE: ReadonlySet<TrackEvent> = new Set(['post_view', 'first_interaction', 'attempt_start']);

/**
 * The one analytics call site. Every funnel step goes through here; the server
 * forwards it to Devvit Journeys and keeps its own counter. Calls are queued so
 * a journey's start is always known before its progress. Never throws.
 */
export function track(event: TrackEvent, data: { progress?: number; score?: number } = {}): void {
  if (ONCE.has(event)) {
    if (sentOnce.has(event)) return;
    sentOnce.add(event);
  }
  queue = queue
    .then(async () => {
      const response = await api.track({ event, ...(journeyId ? { journeyId } : {}), ...data });
      if (response.journeyId) journeyId = response.journeyId;
      if (event === 'attempt_complete') journeyId = undefined;
    })
    .catch(() => undefined);
}
