# Tech — Foldline Daily

## Stack

Devvit Web 0.15.x (`@devvit/web`, `@devvit/start`, `@devvit/analytics`), React 19,
three.js (lazy), Hono server, Vitest + `@devvit/test`, TypeScript strict
(`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Vite 8 (rolldown).
Node 24.18+ required. No Tailwind; hand-written CSS with design tokens
(`src/client/tokens.css`).

## Layout

- `src/shared/` pure logic + tests (no Devvit/DOM imports)
- `src/server/` Hono: `routes/` thin, `core/` logic; entry `index.ts`
- `src/client/` `splash.{html,ts,css}` (inline), `game.{html,tsx}` + `game/`, `scene/`,
  `editor/` (lazy), `lib/`
- `tools/` tsconfigs + `check-bundle.mjs`
- `devvit.json` entrypoints `default`→splash, `game`→game; scheduler `daily-post`
  (every 15 min); 4 moderator menu items; 3 forms; 4 settings; install/upgrade/delete
  triggers.

## Key decisions

- **Server-authoritative scoring**: client sends folds, server replays and verifies.
  Time comes from the server clock (`attempt/start` HSETNX).
- **Atomic Redis only**: `hSetNX` claims/results/shares, `zAdd` leaderboard, `hIncrBy`
  counters. No key scans (keys are records in hashes), no transactions on the hot path.
- **`postData` carries the whole puzzle** (`PostWire`, < 2 KB): the launch screen needs
  zero server calls. `fl:post:<postId>` keeps an authoritative copy.
- **One palette** (Okabe-Ito derived) in `shared/theme.ts`, consumed by client CSS
  tokens, post background styles and flair colours.
- **One `track()` call site** on the client; the server maps events to Devvit Journeys
  (views never start a journey) and keeps its own funnel counters.
- **User actions are explicit and separate**: share, subscribe, flair, route submit are
  individual buttons; results reply to one stickied app comment.
- **Local fallback for logged-out players**: result is kept in localStorage per post
  and submitted after login (note: Reddit clears localStorage per app version).

## Verification

`npm run typecheck && npm run lint && npm test && npm run build && npm run size` must
all pass before any upload. CI runs the same sequence.
