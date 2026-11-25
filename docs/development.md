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

## Devvit app name

Foldline Daily is the public name. Players see Foldline on the splash, the board, and the result card.

`contrarian-daily` in `devvit.json` is the app account name and the community URL slug. The [config schema](https://developers.reddit.com/schema/config-file.v1.json) describes `name` that way, and the pattern is a lowercase slug of at most 20 characters. `foldline-daily` would fit that pattern for a brand-new app. It does not rename this one.

Reddit's docs say changing the name in the config file does not change an app that has already been uploaded. The display name is edited with "Edit app details" on the app page ([Update your app](https://developers.reddit.com/docs/app_update_details)). The app account username cannot be changed. A different account name means creating a new app and moving the code ([App accounts](https://developers.reddit.com/docs/0.9/app_accounts)). The same limit is what developers report on r/Devvit: the display name can change, the slug cannot.

This app is already installed and has posted puzzles as `contrarian-daily`:

- Listing: https://developers.reddit.com/apps/contrarian-daily
- Private playtest: https://www.reddit.com/r/contrarian_daily_dev/?playtest=contrarian-daily
- Public subreddit: https://www.reddit.com/r/FoldlineDaily/

Uploading a second app named `foldline-daily` would start a new install with empty storage. The posts already on r/FoldlineDaily would stay on `contrarian-daily`. Leave the slug as it is. In the developer portal, set the display name to **Foldline Daily**. Do not publish the app for the hackathon.

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
