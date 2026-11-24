import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import type { CompleteRequest, FieldView, ResultView, StreakView } from '../../src/shared/api';
import { encodeMoves, parseMoves, replay } from '../../src/shared/moves';
import { bucketFor, DIST_BUCKETS } from '../../src/shared/score';
import { shareGrid } from '../../src/shared/share';
import { harnessPuzzle } from './puzzle';

const date = process.env.FOLDLINE_DATE ?? '2026-11-19';
const { puzzle, post } = harnessPuzzle(date);
const emptyStreak: StreakView = { current: 0, best: 0, tier: null, nextTier: null };
const emptyField: FieldView = { total: 0, rank: null, dist: Array(DIST_BUCKETS).fill(0), standing: null };
let startedAt: number | null = null;
let result: ResultView | null = null;

function mockApi(): Plugin {
  return {
    name: 'foldline-harness-api',
    configureServer(server) {
      server.middlewares.use('/favicon.ico', (_req, res) => {
        res.writeHead(204);
        res.end();
      });
      server.middlewares.use('/api', (req, res) => {
        void (async () => {
          let body = '';
          for await (const chunk of req) body += String(chunk);
          const data = body ? JSON.parse(body) : {};
          const path = req.url?.split('?')[0];
          let response: unknown;
          let status = 200;
          const streak = result ? { ...emptyStreak, current: 1, best: 1 } : emptyStreak;
          const field = result
            ? { total: 1, rank: 0, dist: emptyField.dist.map((_, i) => Number(i === bucketFor(result!.folds, result!.par))), standing: null }
            : emptyField;
          switch (path) {
            case '/init':
              response = {
                type: 'init', post, postId: 't3_harness', subreddit: 'foldline',
                user: { loggedIn: true, name: 'harness' }, today: date, now: Date.now(),
                isToday: true, skipped: false, nextPuzzleInMs: 86400000, startedAt,
                result, streak, field, flair: { enabled: false, optedIn: false },
                routes: { enabled: false, submitted: false }, subscribed: false, shared: false,
              };
              break;
            case '/attempt/start':
              startedAt ??= Date.now();
              response = { type: 'start', startedAt };
              break;
            case '/attempt/complete': {
              const request = data as CompleteRequest;
              const moves = parseMoves(request.moves);
              let solved = false;
              try {
                solved = request.rev === post.r && moves !== null && replay(puzzle, moves).solved;
              } catch {
                solved = false;
              }
              if (!solved || !moves) {
                status = 400;
                response = { status: 'error', code: 'invalid_moves', message: 'Moves do not solve the puzzle.' };
                break;
              }
              const attempt = { folds: moves.length, ms: Math.max(0, Math.round(request.clientMs)) };
              const scored = result === null;
              result ??= { ...attempt, par: puzzle.par, moves: encodeMoves(moves), grid: shareGrid(puzzle, moves) };
              const dist = Array(DIST_BUCKETS).fill(0);
              dist[bucketFor(result.folds, result.par)] = 1;
              response = {
                type: 'complete', scored, ...(scored ? {} : { reason: 'practice' }),
                result, attempt, streak: { ...emptyStreak, current: 1, best: 1 },
                field: { total: 1, rank: 0, dist, standing: null },
                streakExtended: scored, newTier: null, flairStatus: 'off',
              };
              break;
            }
            case '/leaderboard':
              response = { type: 'leaderboard', total: 0, rows: [], me: null };
              break;
            case '/track':
              response = { type: 'track' };
              break;
            case '/share':
              response = { type: 'share', status: 'posted', asUser: true };
              break;
            case '/subscribe':
              response = { type: 'subscribe', subscribed: true };
              break;
            case '/flair':
              response = { type: 'flair', optedIn: Boolean(data.optIn), status: 'off' };
              break;
            case '/routes':
              response = { type: 'routes', sunday: date, routes: [] };
              break;
            case '/route/submit':
              response = { type: 'route', postId: 't3_harness', url: '/r/foldline', par: puzzle.par, asUser: true };
              break;
            default:
              status = 404;
              response = { status: 'error', code: 'not_found', message: 'Unknown harness endpoint.' };
          }
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(response));
        })().catch(() => {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', code: 'invalid_request', message: 'Invalid request.' }));
        });
      });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [react(), mockApi()],
  resolve: {
    alias: { '@devvit/web/client': fileURLToPath(new URL('./devvit.ts', import.meta.url)) },
  },
  define: { __HARNESS_DATE__: JSON.stringify(date) },
  server: { host: '127.0.0.1', port: 5173 },
});
