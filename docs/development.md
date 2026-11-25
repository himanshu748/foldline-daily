# Develop Foldline Daily

Use Node 24.18 or newer.

```sh
npm ci
npm run typecheck && npm run lint && npm test && npm run build && npm run size
```

For a local browser session, run `npm run harness -- --open /src/client/game.html`.
The harness runs the game with local endpoints and does not create Reddit results.
Set `FOLDLINE_DATE` to choose a different puzzle date. The real Reddit playtest command is
`npm run dev` after signing in to the Devvit CLI.

Foldline Daily is the public name and repository name. `contrarian-daily` is the
registered Devvit identifier used by the installed app and its
[developer listing](https://developers.reddit.com/apps/contrarian-daily).

## Architecture

- [Shared](../src/shared) contains the deterministic generator, validator, fold engine,
  scoring, date logic, and wire types. Each generated or player-created board must be
  solvable, have a verified par and a unique docking state, and pass overlap and
  silhouette checks.
- [Server](../src/server) routes the Devvit scheduler, forms, and game requests through
  Hono. It replays submitted folds, uses the server clock, and atomically saves the
  first score for each player and board. The same validator gates Community Routes.
- [Client](../src/client) renders the post preview from `postData`. The expanded React
  view loads three.js and the editor on demand. Undo records a fold. The streak grace
  rule lives in [streak.ts](../src/shared/streak.ts).

`npm run size` checks the launch screen, game entry, and lazy scene bundle budgets
after the build. See [playtest notes](playtest.md) for platform-specific checks.

## Port boundary

The original WebXR engine supplied the hinge geometry, discrete fold states,
breadth-first solver, overlap checks, and fold gesture thresholds. The Reddit build
uses a new mobile interface, three.js board, daily generator and validation gate.
Devvit scheduling, per-board results, leaderboards, flair, and Community Routes were
built for the Reddit version. See the [dated changelog](../README.md#ported-from-foldline).
