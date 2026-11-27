import type {
  CompleteRequest,
  CompleteResponse,
  ErrorResponse,
  FlairResponse,
  InitResponse,
  LeaderboardResponse,
  RoutesResponse,
  RouteSubmitRequest,
  RouteSubmitResponse,
  ShareResponse,
  StartResponse,
  SubscribeResponse,
  TrackRequest,
  TrackResponse,
} from '../../shared/api';

export class ApiFailure extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      ...(signal ? { signal } : {}),
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiFailure(0, 'offline', 'No connection. Check your network and try again.');
  }
  const data = (await response.json().catch(() => null)) as T | ErrorResponse | null;
  if (!response.ok || data === null || (data as ErrorResponse).status === 'error') {
    const error = data as ErrorResponse | null;
    throw new ApiFailure(
      response.status,
      error?.code ?? 'server',
      error?.message ?? 'Something went wrong. Please try again.'
    );
  }
  return data as T;
}

export const api = {
  init: async () => {
    const request = new AbortController();
    const timeout = setTimeout(() => request.abort(), 4_000);
    try {
      return await call<InitResponse>('/api/init', undefined, request.signal);
    } finally {
      clearTimeout(timeout);
    }
  },
  start: () => call<StartResponse>('/api/attempt/start', {}),
  complete: (request: CompleteRequest) => call<CompleteResponse>('/api/attempt/complete', request),
  leaderboard: () => call<LeaderboardResponse>('/api/leaderboard'),
  share: () => call<ShareResponse>('/api/share', {}),
  subscribe: () => call<SubscribeResponse>('/api/subscribe', {}),
  flair: (optIn: boolean) => call<FlairResponse>('/api/flair', { optIn }),
  track: (request: TrackRequest) => call<TrackResponse>('/api/track', request),
  submitRoute: (request: RouteSubmitRequest) => call<RouteSubmitResponse>('/api/route/submit', request),
  routes: () => call<RoutesResponse>('/api/routes'),
};
