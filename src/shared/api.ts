import type { MoveWire } from './moves';
import type { PostWire } from './postdata';

/** Request and response shapes shared by the client and the server. */

export interface ResultView {
  folds: number;
  ms: number;
  par: number;
  /** Encoded fold list (see `encodeMoves`). */
  moves: string;
  /** Spoiler-safe share grid. */
  grid: string;
}

export interface StreakView {
  current: number;
  best: number;
  tier: string | null;
  nextTier: { name: string; days: number } | null;
}

export interface FieldView {
  /** Players who have finished this puzzle. */
  total: number;
  /** 0-based rank of the current player, if they have a scored result. */
  rank: number | null;
  /** Players per "folds over par" bucket: 0, 1, … and a final "6 or more". */
  dist: number[];
  standing: string | null;
}

export type FlairStatus = 'set' | 'unchanged' | 'unavailable' | 'off';

export interface InitResponse {
  type: 'init';
  post: PostWire;
  postId: string;
  subreddit: string;
  user: { loggedIn: boolean; name: string | null };
  today: string;
  /** Server clock at the time of the response, so the client timer can follow the server's. */
  now: number;
  /** True when this post is the current day's puzzle. */
  isToday: boolean;
  skipped: boolean;
  nextPuzzleInMs: number;
  /** Server time of the player's first fold on this puzzle, if any. The clock never restarts. */
  startedAt: number | null;
  result: ResultView | null;
  streak: StreakView;
  /** Null when the leaderboard comparison could not be loaded. */
  field: FieldView | null;
  flair: { enabled: boolean; optedIn: boolean };
  routes: { enabled: boolean; submitted: boolean };
  subscribed: boolean;
  shared: boolean;
}

export interface StartResponse {
  type: 'start';
  startedAt: number;
}

export interface CompleteRequest {
  /** The puzzle revision the player solved, so a regenerated puzzle is never mis-scored. */
  rev: number;
  moves: MoveWire[];
  clientMs: number;
  journeyId?: string;
}

export type UnscoredReason = 'practice' | 'skipped';

export interface CompleteResponse {
  type: 'complete';
  /** True only for the player's first completion of this puzzle. */
  scored: boolean;
  reason?: UnscoredReason;
  /** The scored result (the stored one when this completion was practice). */
  result: ResultView;
  /** This attempt's own numbers, for practice feedback. */
  attempt: { folds: number; ms: number };
  /** Null when the streak could not be confirmed. */
  streak: StreakView | null;
  /** Null when the leaderboard comparison could not be loaded. */
  field: FieldView | null;
  streakExtended: boolean;
  newTier: string | null;
  flairStatus: FlairStatus;
}

export interface LeaderboardRow {
  rank: number;
  name: string;
  folds: number;
  ms: number;
  avatar: string | null;
  me: boolean;
}

export interface LeaderboardResponse {
  type: 'leaderboard';
  total: number;
  rows: LeaderboardRow[];
  /** The player's own row when it is outside the top rows. */
  me: LeaderboardRow | null;
}

export interface ShareResponse {
  type: 'share';
  status: 'posted' | 'already';
  /** False when the platform posted from the app account instead of the player's. */
  asUser: boolean;
}

export interface SubscribeResponse {
  type: 'subscribe';
  subscribed: boolean;
}

export interface FlairRequest {
  optIn: boolean;
}

export interface FlairResponse {
  type: 'flair';
  optedIn: boolean;
  status: FlairStatus;
}

export type TrackEvent =
  | 'post_view'
  | 'first_interaction'
  | 'attempt_start'
  | 'attempt_progress'
  | 'attempt_complete'
  | 'share_comment'
  | 'return_next_day';

export const TRACK_EVENTS: readonly TrackEvent[] = [
  'post_view',
  'first_interaction',
  'attempt_start',
  'attempt_progress',
  'attempt_complete',
  'share_comment',
  'return_next_day',
];

export interface TrackRequest {
  event: TrackEvent;
  journeyId?: string;
  /** 0 to 1, for `attempt_progress`. */
  progress?: number;
  /** Fold count, for `attempt_complete`. */
  score?: number;
}

export interface TrackResponse {
  type: 'track';
  journeyId?: string;
  /** Journeys receipt status, for diagnostics. */
  receipt?: string;
}

export interface RouteSubmitRequest {
  t: string;
  s: string;
  g: string;
}

export interface RouteSubmitResponse {
  type: 'route';
  postId: string;
  url: string;
  par: number;
  asUser: boolean;
}

export interface RouteRow {
  postId: string;
  author: string;
  par: number;
  panels: number;
  url: string;
  mine: boolean;
}

export interface RoutesResponse {
  type: 'routes';
  /** The Sunday these routes compete for. */
  sunday: string;
  routes: RouteRow[];
}

export interface ErrorResponse {
  status: 'error';
  code: string;
  message: string;
}
