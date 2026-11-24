# Foldline Daily: implementation plan

Status: **approved by the owner on 2026-11-15 with three changes** (three.js rendering, undo allowed, app name to be chosen before the first upload). Implementation in progress.
Written 2026-11-15. Hackathon: Reddit's Game of the Day (deadline 8 Dec 2026, 6:00 pm PST). Category: **Best Ported Daily Game**.

## 1. What we are building

Foldline Daily is a port of my WebXR game Foldline to a Reddit interactive post (Devvit Web).

- One fold puzzle per day. A paper strip of square panels is hinged edge to edge. Each hinge has three stops: down, flat, up.
- The post shows a **target silhouette**. Fold the strip until it fills the silhouette.
- **Fewest folds wins. Time breaks ties.** Every puzzle has a par computed by the solver.
- One scored attempt per player per day. Practice afterwards is unscored.
- Sunday's puzzle is the week's top-upvoted **Community Route**, built by a player in an in-post editor and credited to them.

It is not trivia, not a clone, has no lobby, and never needs two players online together. A latecomer can open any day's post and play it.

## 2. Port scope (what moves, what stays behind)

Source: `/Users/himanshujha/Documents/ChatGPT/meta hack/freeze-v3/foldline-freeze-2026-11-12-deps-1b50631287c1.tar.gz` (the working folder holds only evidence files and partial snapshots; the full source is in this archive). I read it without modifying anything in that folder.

| Original file | Decision | Notes |
|---|---|---|
| `src/game/engine.ts` + `engine.test.ts` | **Port** to `src/shared/engine.ts` | Geometry, `applyMove`, `isSolved`, BFS `solveLevel`, `findPanelOverlaps`, `interpolateFrames`. The `Level` type loses its story fields (title, hint, chapter). |
| `src/game/levels.ts` | **Port as test fixtures only** | The nine authored puzzles keep the engine tests meaningful. They are not shipped as content. |
| `src/game/edge-coverage.test.ts` | **Port** | Shortest-path proof from every legal arrangement. |
| `src/game/fold-gesture.ts` + test | **Port and retune** | Preview, release threshold and hysteresis. Units change from metres of hand travel to a fraction of on-screen panel size. |
| `src/game/daily.ts` + test | **Port date-key validation only** | The 24-entry curated rotation is replaced by a seeded generator. Its six route families become the generator's fallback bank. |
| `src/game/progress.ts` + test | **Port date helpers** | Streak logic is rewritten for the server with a grace rule. |
| WebXR / IWSDK, three.js scene, village, courier, letters, garden, audio, `ui.ts`, `play.ts`, `save.ts`, co-op server, coach | **Dropped** | Nothing XR-related is carried over. |

Measured puzzle space with the original engine (exhaustive enumeration, run today): usable targets (exactly one docking state, no panel overlap) number 88 / 603 / 3,306 / 16,049 / 67,333 for 3 / 4 / 5 / 6 / 7 panels, with pars available up to 4 / 6 / 8 / 10 / 12. That is enough variety for a calibrated week.

## 3. Devvit APIs, confirmed against the docs

Everything below was read from `developers.reddit.com/docs` today (Devvit 0.15.3). I will not use an API that is not in this table without checking the docs first.

| Need | Documented API | Doc page |
|---|---|---|
| Project layout, limits | `src/client`, `src/server`, `devvit.json`; endpoints under `/api/`; 30 s request limit; no websockets; client cannot call external hosts; `localStorage` is cleared on each app version | `capabilities/devvit-web/devvit_web_overview` |
| Config | `post.entrypoints` (with `inline: true`), `server`, `permissions`, `triggers`, `menu`, `forms`, `scheduler`, `settings`, `scripts` | `capabilities/devvit-web/devvit_web_configuration` |
| Create the daily post | `reddit.submitCustomPost({ title, entry, postData, textFallback, styles })` | `capabilities/creating_custom_post`, `capabilities/server/post-data`, `capabilities/server/text_fallback` |
| Per-post data | `postData` (2 KB max, sent to the client), `post.setPostData()`, `context.postData` | `capabilities/server/post-data` |
| Launch screen and expanded mode | Inline entry HTML, `requestExpandedMode(event, entry)`, `getWebViewMode()`, `exitExpandedMode(event)` from `@devvit/web/client` | `capabilities/server/launch_screen_and_entry_points/*` |
| Inline rules | Tap or click only, no scroll traps, `touch-action: pan-y`, no `preventDefault` on arrows or space, load under 1 s, Lighthouse above 80 | `view_modes_entry_points`, `guides/best-practices/scroll-traps` |
| Scheduler | `scheduler.tasks.<name> = { endpoint: "/internal/...", cron }`, handler returns `TaskResponse`; `scheduler.runJob`, `listJobs`, `cancelJob` | `capabilities/server/scheduler` |
| Redis | `get/set/mGet/mSet/del/expire`, `hGet/hSet/hSetNX/hIncrBy/hGetAll/hLen/hDel`, `zAdd/zRange/zRank/zScore/zCard/zIncrBy/zRem`, `watch/multi/exec`. No lists, no plain sets, no key scan, no pipelining | `capabilities/server/redis` |
| Comment as the player | `reddit.submitComment({ id, text, runAs: 'USER' })` with `permissions.reddit.asUser: ["SUBMIT_COMMENT"]`; score comments must reply to one stickied comment (`comment.distinguish(true)`) | `capabilities/server/userActions`, `api/redditapi/models/classes/Comment` |
| Post as the player (Community Route) | `reddit.submitCustomPost({ runAs: 'USER', userGeneratedContent: { text }, ... })` with `asUser: ["SUBMIT_POST"]` | `capabilities/server/userActions` |
| Subscribe | `reddit.subscribeToCurrentSubreddit()` with `asUser: ["SUBSCRIBE_TO_SUBREDDIT"]`. No API to read subscription state, so we remember it in Redis | `capabilities/server/userActions` |
| User flair | `reddit.setUserFlair({ subredditName, username, text, backgroundColor, textColor })`, `reddit.removeUserFlair(subredditName, username)` | `api/redditapi/RedditClient`, `SetUserFlairOptions`, `SetFlairOptions` |
| Read votes | `post.score`, `post.isRemoved()`, `post.isSpam()` via `reddit.getPostById()` | `api/redditapi/models/classes/Post` |
| Snoovatars | `reddit.getSnoovatarUrl(username)` | `api/redditapi/RedditClient` |
| Current user | `context.userId` (absent when logged out), `reddit.getCurrentUsername()` | `guides/logged-out-users`, `api/redditapi/RedditClient` |
| Menu actions and forms | `menu.items[]` with `forUserType: "moderator"`, handler returns `UiResponse` (`showToast`, `showForm`, `navigateTo`); `forms` map | `capabilities/client/menu-actions` |
| Settings | `settings.subreddit.<key>` with `type`, `label`, `helpText`, `defaultValue`, `validationEndpoint`; `settings.get(key)` | `capabilities/server/settings-and-secrets` |
| Triggers | `onAppInstall`, `onAppUpgrade`, `onPostDelete` | `capabilities/devvit-web/devvit_web_configuration` |
| **Journeys (exists)** | `permissions.journeys: true`; client `telemetry` from `@devvit/analytics/client/reddit`; server `telemetry` and `createTelemetryRouter()` from `@devvit/analytics/server/reddit`. Events: `App.Ready`, `Journey.Start`, `Journey.Progress`, `Journey.Interaction`, `Journey.End`. Every call returns a receipt. Events are dropped until Reddit allowlists the app | `capabilities/analytics/devvit-journeys`, `journeys-receipts` |
| Tests | `createDevvitTest()` from `@devvit/test/server/vitest` (in-memory Redis, scheduler, settings) | `guides/tools/devvit_test` |
| CLI | `devvit login`, `whoami`, `playtest`, `upload`, `install`, `logs`. `devvit publish` submits for review and is banned here | `guides/tools/devvit_cli` |

Documented behaviours that shape the design:

1. **`runAs: 'USER'` in an unpublished app acts as the player only for the app owner.** For everyone else it falls back to the app account. Because we must not publish, a judge's "Share result" comment will be posted by the app account. The server checks the returned comment's author and, when it is the app account, prefixes the text with `u/<player>'s result`. Community Route posts carry the author's name in the title and post data for the same reason. The README will state this plainly.
2. **Journeys events are dropped until the app is allowlisted** (a review step). The code ships fully instrumented, logs receipts in playtest, and keeps its own funnel counters in Redis so the funnel is verifiable now.
3. **Push notifications are a gated beta** for established games. Not used.

Three details the docs show inconsistently. I will read the installed package typings at scaffold time and follow them: the Redis import path (`@devvit/web/server` in the template, `@devvit/redis` in the Redis page), the exact `telemetry` method names, and the import path of `showLoginPrompt`.

## 4. Architecture

```
/                         app root (this repo)
├── devvit.json           entrypoints, permissions, scheduler, menu, forms, settings, triggers
├── src/shared/           pure logic, no Devvit or DOM imports, fully unit tested
│   ├── engine.ts         ported: geometry, moves, solver, overlap check
│   ├── generator.ts      generate(dateUTC, rev) -> DailyPuzzle (seeded, deterministic)
│   ├── validate.ts       validatePuzzle(): solvable, par, unique solution, no overlaps, no look-alike
│   ├── view.ts           fixed orthographic projection + raster silhouette signature
│   ├── difficulty.ts     weekday tiers and difficulty score
│   ├── gesture.ts        ported fold-gesture, retuned for screen drags
│   ├── dates.ts          date keys, weekday, ISO week, day number, current key for a timezone
│   ├── streak.ts         streak transition with the grace rule, flair tiers
│   ├── score.ts          leaderboard score encoding, percentile, distribution buckets
│   ├── share.ts          spoiler-safe fold-sequence grid
│   └── api.ts            request/response types shared by client and server
├── src/server/           Hono app (template default), serverless
│   ├── routes/api.ts     /api/init, attempt/start, attempt/complete, leaderboard, share, subscribe, flair, track, route/*
│   ├── routes/scheduler.ts  /internal/scheduler/daily-post
│   ├── routes/menu.ts, forms.ts, settings.ts, triggers.ts
│   └── core/             keys.ts, config.ts, errors.ts, users.ts, flair.ts, postinfo.ts, posts.ts, results.ts, share.ts, community.ts, track.ts
└── src/client/
    ├── splash.html + splash.ts   inline launch screen, framework-free, canvas 2D (no WebGL in the feed)
    ├── game.html + game.tsx      expanded game, end card, leaderboard (React, from the template)
    ├── scene/                    three.js fold scene (board.ts), lazy chunk
    ├── editor/                   Community Route editor, lazy chunk
    ├── game/                     React shell: app, stage, hud, endcard, leaderboard, controller
    └── lib/                      api, canvas 2D drawing, track(), WebAudio sound
```

Decisions:

- **Template:** the official React template (`devvit-template-react`: React 19, Vite 8, Hono, TypeScript 6, Node 24.18+). Tailwind was removed in favour of one hand-written stylesheet per entry point. Tests switch from the template's `node --test` to **Vitest** plus `@devvit/test`.
- **Rendering: three.js in the expanded game** (owner's choice at approval). The strip is real 3D geometry with a two-toned paper material (coloured face, cream back) and the target is a translucent ghost of the folded shape that the paper must fill. three.js loads as a lazy chunk after the React shell paints, so first paint does not wait for it. The **inline launch screen stays on 2D canvas**: the docs require inline views to load in under a second, and a WebGL context per feed post is too heavy.
- **Two entry points.** `default` (inline) is a tiny framework-free launch screen. `game` (expanded) holds the drag-to-fold game. Inline mode allows taps only, so dragging lives in expanded mode, which the docs reserve for full gestures.
- **Server is authoritative.** The client sends the list of folds. The server replays it with the ported `applyMove`, checks `isSolved`, counts folds itself and measures time from its own clock.
- `npm run launch` is **removed** from `package.json`. Allowed scripts: `dev`, `build`, `deploy` (private upload), `test`, `typecheck`, `lint`.

## 5. Daily content pipeline

### 5.1 Generator

`generate(dateUTC: string, rev = 0): DailyPuzzle` in `src/shared/generator.ts`.

1. Seed a small PRNG (mulberry32) from an FNV-1a hash of `foldline:v1:<date>:<rev>`. No `Math.random`, no clock, no network.
2. Take the tier for the date's UTC weekday (table below).
3. Draw a turn sequence, a target fold state and a start state at the tier's par distance.
4. Run `validatePuzzle`. On failure draw again with the same PRNG (bounded attempts).
5. If every attempt fails, fall back to a curated bank built from the original six route families. Tests prove every bank entry validates.

The generator version is part of the seed. Each day's puzzle is also stored in the post's `postData` when the post is created, so old posts never change if the generator is improved later.

### 5.2 Validator and solver

`validatePuzzle(p)` returns `{ ok, par, path, reasons[] }` and requires all of:

- Shape is legal (ported `validateAngles`); the start is not already solved.
- **Solvable:** ported `solveLevel` (breadth-first over at most 3^6 = 729 states) returns a path.
- **Par is proven twice:** BFS length equals the independent Manhattan lower bound over all docking states (the cross-check the original tests use).
- **One answer:** exactly one fold state docks, so the silhouette shown is the only winning shape.
- **No overlaps** in the start, the target, or any state on the solver's path (ported `findPanelOverlaps`).
- **No look-alikes:** under the game's fixed camera, every other fold state's silhouette differs from the target's by at least 10% of the target's area (`LOOKALIKE_MIN_MARGIN = 0.1` in `shared/validate.ts`). This uses a deterministic coarse raster signature and is frozen by `validate.test.ts`.

The same function gates Community Route submissions, on the client for instant feedback and again on the server before anything is stored.

### 5.3 Difficulty curve

| UTC weekday | Panels | Par | Turns in the strip | Start |
|---|---|---|---|---|
| Monday | 3 | 2 | 0 to 2 | flat |
| Tuesday | 4 | 3 | 0 to 1 | flat |
| Wednesday | 4 | 4 | 1 to 2 | folded |
| Thursday | 5 | 5 | 1 to 2 | folded |
| Friday | 5 | 6 | 2 to 3 | folded |
| Saturday | 6 | 7 | 2 to 4 | folded |
| Sunday | 7 | 9 to 10 (generated fallback) or the Community Route (6 to 7 panels, par 8 or more) | 3 to 5 | folded |

`difficultyScore(p)` combines par, panel count, turn count and a folded-start bonus into one number; the tier bands never overlap, which is what the 120-day test asserts.

### 5.4 Posting job

- `scheduler.tasks["daily-post"]` runs every 15 minutes (`*/15 * * * *`) and calls `/internal/scheduler/daily-post`. Fifteen minutes covers timezones with 30 and 45 minute offsets.
- The job computes the current date key, returns at once if that day already has a post or is marked skipped, and otherwise claims the day with `hSetNX fl:posts <date> pending`. Only the winner creates the post, so overlapping runs cannot double-post. A failed creation releases the claim for the next run.
- On Sundays it first selects the Community Route (section 7).
- The post is created with:
  - **Title:** `Day N · <hook>`. Hooks are assembled from the puzzle's own traits by `puzzleHook` in `src/shared/hooks.ts`, for example `Day 12 · Five panels, two corners · par 5`. Sunday: `Day 14 · Community Route by u/<author> · par 8`. No model writes text at runtime.
  - **`postData`:** a compact JSON wire (`v, k, d, n, r, w, t, s, g, p, src`, plus `a`/`rid` for routes): kind, date, day number, rev, tier, turns, start and goal fold angles, par, source, author and route post id if any. The goal angles let the client render the ghost and run the validator offline; scoring is still replay-verified on the server (a determined player could read the answer out of `postData` — the accepted trade-off in §16).
  - **`styles`:** light and dark background colours matching the day's paper colour, so the frame is on-palette before the iframe loads.
  - **`textFallback`:** day, par and how to open the game, for old Reddit and search.
- The job then posts one app comment, "Results thread", distinguishes and stickies it (`comment.distinguish(true)`), and stores its id. Shared results reply to it, as the docs require. If stickying fails the comment still works as the reply target.
- **Feed preview:** the inline launch screen draws the day's silhouette, paper colour (a seven-swatch set, one per weekday), day number, par and difficulty pips from `postData` with no server call. Every day looks different in the feed.
- `onAppInstall` stores the install date and creates the first post so a fresh install is never empty.

### 5.5 Dates and the timezone setting

- Every key is a `yyyy-mm-dd` calendar date. The generator, weekday tier, streak arithmetic and day number treat it as a UTC date.
- The moderator **timezone** setting (IANA name, default `UTC`) decides only one thing: the moment a date's puzzle is released, which is midnight of that date in the chosen zone. With the default, release is 00:00 UTC and keys are exactly UTC dates.
- The moderator **start date** setting defines Day 1. Empty means the install date.

## 6. Redis data model

All keys are prefixed `fl:`. Day keys include the date and the puzzle revision (`r<rev>`), so regenerating a day starts a clean board. Related records live in hashes and sorted sets because Devvit Redis cannot list keys.

A *board* is `day:<date>:r<rev>` for a daily post and `route:<postId>` for a Community Route post, so every post scores on its own board and regenerating a day starts a clean one.

| Key | Type | Contents | Written by |
|---|---|---|---|
| `fl:posts` | hash | date → postId or `pending:<ms>` | `hSetNX` claim, then `hSet` |
| `fl:claims` | hash | date → claim time, for stale-claim takeover after 120 s | job |
| `fl:day:<date>` | hash | `postId`, `rev`, `day` | job, mod tools |
| `fl:post:<postId>` | string | the post's full `PostWire` JSON (authoritative copy) | `savePostInfo` |
| `fl:threads` | hash | postId → stickied results-thread comment id | job |
| `fl:<board>:start` | hash | userId → server start time (ms) | `hSetNX` on first fold |
| `fl:<board>:result` | hash | userId → `{folds, ms, moves}` | **`hSetNX`**: the first completion is the only scored one |
| `fl:<board>:lb` | sorted set | username → `folds * 10,000,000 + min(ms, 9,999,999)` | `zAdd` after winning the `hSetNX` |
| `fl:<board>:dist` | hash | `0`…`6` buckets (folds over par) and `n` → counts | `hIncrBy` |
| `fl:<board>:shared` | hash | userId → 1 once their result comment is posted | `hSetNX` |
| `fl:funnel:<date>` | hash | event → count | `hIncrBy` |
| `fl:seen:<date>` | hash | `userId:event` → 1, for once-per-day events | `hSetNX` |
| `fl:user:<userId>` | hash | `cur`, `best`, `last`, `grace`, `flairOptIn`, `flairTier`, `subscribed`, `name` | streak update, opt-ins |
| `fl:avatars` | hash | username → snoovatar URL | filled lazily for leaderboard rows |
| `fl:routes:<week>` | hash | route postId → `{author, authorId, puzzle, par, createdAt}`; week is its Monday's date | Community Route submit |
| `fl:routes:<week>:by` | hash | authorId → route postId | `hSetNX`: one route per player per week |
| `fl:routes:sig` | hash | puzzle signature → route postId | `hSetNX`: no duplicate puzzles |
| `fl:routes:post` | hash | route postId → week | lookup for delete handling |
| `fl:skip` | hash | date → 1 | mod tool |
| `fl:config` | hash | `installDate` | install trigger |

Concurrency, designed for thousands of simultaneous finishes:

- A completion is `hSetNX` (result) and then, only for the winner, `zAdd`, two `hIncrBy` calls and the streak write. Each is a single atomic command. There is no read-modify-write on shared keys and no transaction on the hot path.
- A second completion from the same player (double tap, two tabs) loses the `hSetNX` and receives the stored result.
- The streak hash is per player and is written only by the request that won that player's `hSetNX` for the current day, so it has one writer.
- Rank and percentile come from `zRank` and `zCard`. The chart comes from one `hGetAll` on `dist`.
- `/api/init` needs no Redis read for the puzzle (it is in `postData`) and two reads for the player.
- Per-day keys get a 400-day expiry, set by the daily job on the previous day's keys, so storage stays bounded under the 100 MB unpublished limit.

**Streak and grace rule** (pure function in `shared/streak.ts`): solving the current day's puzzle extends the streak if the last solve was yesterday. One missed day is forgiven if no grace was used in the previous six days. Days a moderator skipped never break a streak. Anything else resets the streak to 1. Best streak is kept forever. Old posts can still be played and scored on their own board, but only the current day counts toward the streak.

## 7. Community Route (user-made Sunday puzzle)

1. **Unlock:** the end card offers "Build a Community Route" after the player has solved the day.
2. **Editor** (expanded mode, lazy-loaded): choose 6 or 7 panels, set each joint straight / left / right and pick the start and goal fold angles on segmented controls, with a live 2D preview. The full validator runs on every change and shows either the proven par or plain-language reasons it fails (solvable, one answer, no overlaps, no look-alike, par 8 or more).
3. **Submit** (explicit button, a separate action): the server re-validates, enforces one route per player per ISO week and no duplicate signature, then calls `submitCustomPost({ runAs: 'USER', userGeneratedContent, title: "Community Route · Seven panels · par 8 · by u/<author>", postData })`. The route is its own playable post. There is no free-text field, so there is nothing to moderate beyond the puzzle itself.
4. **Voting:** ordinary Reddit upvotes on the route posts. The app never votes (the platform forbids it) and only reads `post.score`.
5. **Selection:** when the daily job creates Sunday's post it loads the week's routes (weeks are keyed by their Monday's date; a route submitted on a Sunday competes for the *following* Sunday; capped at the 100 newest), drops removed, spam and deleted posts, re-validates each puzzle, and takes the highest score. Ties go to the earliest submission. With no valid route, Sunday uses the generated tier-7 puzzle.
6. **Credit:** Sunday's title, launch screen and end card name the author and link to the original route post. The author's snoovatar is shown where available.
7. **Deletion:** `onPostDelete` removes the route from every index, per the Devvit rule on respecting deletions.

Empty state in the editor list: "No routes yet this week. Yours could be Sunday's puzzle."

## 8. Screens and interaction

**Launch screen (inline, in the feed).** Day number, weekday pips, par, the day's silhouette, and the paper strip. A ghost hand loops the drag for a first fold. The whole board is one large tap target, plus a labelled Play button, both calling `requestExpandedMode`. No scrolling, no drag handlers, `touch-action: pan-y`. Returning players see their result and streak here instead of the hint.

**Game (expanded).**
- Drag a panel: the nearest hinge is picked, the paper follows the finger with a continuous preview (`interpolateFrames`), and release snaps to at most one stop (ported gesture thresholds). The fold direction is whichever stop's on-screen motion best matches the drag, so it works at any strip orientation. Small drags cancel.
- Alternatives with targets of 48 px or more: tap a hinge then tap fold up / fold down. Keyboard on desktop: `1`–`7` choose a hinge, arrow keys fold, `Z` undo, `V` flip view, `M` sound.
- Heads-up row: folds so far, par, timer. The timer starts on the first fold, because the puzzle is already visible in the feed.
- **Undo is allowed** (owner's choice at approval). Undo reverses the last fold and **counts as a fold**, so it is a convenience and never a way to lower a score. The server sees it as an ordinary move in the replayed list.
- A ghost hand shows on the first hinge until the first fold. There is no text tutorial.

**End card (one screen, the most important one).**
- Result: folds against par, time.
- Field: a distribution chart of folds over par with the player's bar marked by pattern as well as colour, and rank or percentile from the leaderboard.
- Streak: current and best, with progress to the next tier (Crease 3, Pleat 7, Origami 30).
- Actions, each separate and optional: **Share result as comment**, **Join r/<sub>**, **Wear streak flair** toggle, **Build a Community Route**, **Practice**.
- Countdown to the next puzzle.
- Honest empty states: "Be the first today" when nobody else has finished; rank as "2nd of 3 so far" until there are enough players for a percentile to mean anything. No invented numbers anywhere.

**Shared comment** (posted only on tap, as a reply to the stickied results thread):

```
Foldline Day 12 · 6 folds (par 5) · 0:42
🟦🟦🟧🟦🟦🟦
```

Blue means that fold moved closer to the answer, orange means it moved away (measured by solver distance). No hinge numbers and no directions, so it spoils nothing. Blue and orange stay distinct for colour-blind readers.

**Leaderboard.** Top 10 plus the player's own row, with snoovatars.

**Logged-out players** can play. Their result is kept in `localStorage` for that post. The end card offers login to save the streak, and the result is submitted and re-verified after login.

**Art direction.** Paper on a cutting mat. One palette derived from the Okabe-Ito colour-blind-safe set (ink, cream, indigo, vermilion, gold) with light and dark variants. One type scale: the system serif stack (ui-serif, Iowan Old Style, Palatino, Georgia) for numerals and titles — shipping no font files keeps the launch screen under its one-second budget — with the system sans for body text. Micro-animations: crease snap, silhouette fill on solve, bar growth on the end card. `prefers-reduced-motion` replaces motion with cross-fades and a static hint. Sound is synthesised with WebAudio, off by default, with a toggle, and muted on `visibilitychange`.

## 9. Reddit features

| Feature | Use |
|---|---|
| Scheduled posts | A new puzzle post per day |
| Comments | Opt-in result grid under a stickied results thread |
| Votes | Upvotes on Community Route posts pick Sunday's puzzle |
| User-made content | Community Route editor and posts |
| User flair | Opt-in streak tiers: Crease, Pleat, Origami |
| Leaderboard | Per-day sorted set, shown on the end card |
| Snoovatars | Leaderboard rows and route author credit |
| Subscribe | Optional join button on the end card |
| Journeys | Funnel instrumentation |

**Flair details.** Opt-in on the end card. When the tier changes, the server calls `setUserFlair` with the tier name. A failure (flair disabled by moderators, missing permission) is caught, the game continues, and the toggle shows "Flair isn't available in this community". Tiers only go up. Opting out removes the flair only if the app set it.

## 10. Journeys and analytics

One client function, `track(event, data?)`, is the only call site. It does two things: sends the Journeys event where one fits, and posts to `/api/track`, which increments the Redis funnel counter (once per player per day where that applies).

| Funnel event | Fires when | Journeys call |
|---|---|---|
| `post_view` | Launch screen is interactive | `App.Ready` (views must not start a journey) |
| `first_interaction` | First committed tap or fold | `Journey.Interaction` (`action: "first_interaction"`) |
| `attempt_start` | First committed fold of the scored attempt | `Journey.Start` |
| (progress) | Each fold | `Journey.Progress` (share of hinges at their target stop) |
| `attempt_complete` | Server accepts the solve | `Journey.End` (`complete: true`, `game: { win: true, score: folds }`) |
| `share_comment` | Share comment posted | Redis counter only (the journey has ended; a new call would start a false one) |
| `return_next_day` | `/api/init` sees a player who solved yesterday | Redis counter only, server-side |

All events fire on release (`pointerup`), never on press, and carry no personal data. Receipts are logged in playtest. Until Reddit allowlists the app the receipts will read "not allowlisted"; the README will say so.

## 11. Moderator tools

Menu items (subreddit menu, moderators only):

- **Foldline: post today's puzzle now.** Runs the same idempotent job.
- **Foldline: regenerate today's puzzle.** Opens a confirm form that shows how many players have finished. On confirm it bumps `rev` and tries up to 24 revisions for a validated puzzle whose hook keeps the post's title true, updating the post in place (`setPostData`); if none fits, it publishes a new post and deletes the old one. Either way the board starts clean, the old board expires after 30 days, and players who already solved keep their streak credit.
- **Foldline: skip a day.** A form to skip today or tomorrow. A skipped day gets no post (or turns an existing post into practice-only) and never breaks a streak.
- **Foldline: post a specific day.** A form to post the puzzle for any date up to 7 days ahead (or to backfill a missed day), running the same idempotent job for that date.

Settings (per subreddit): `startDate` (validated `yyyy-mm-dd`), `timezone` (validated IANA name, default `UTC`), `communityRoutes` (on by default), `streakFlair` (on by default).

## 12. Accessibility and performance

- Colour-blind-safe palette. Nothing is conveyed by colour alone (patterns on chart bars, glyphs on controls). Contrast of at least 4.5:1 for text.
- Full keyboard play in expanded mode with visible focus. Inline mode leaves arrow keys and space alone.
- `prefers-reduced-motion` and `prefers-color-scheme` respected. Canvas has a live text description of the strip state for screen readers.
- Budgets, checked by a script after `npm run build`: launch screen JS at most 25 KB gzipped with no framework; game entry (React shell) at most 130 KB gzipped; three.js scene chunk at most 220 KB gzipped and always lazy; the editor is a lazy chunk too. Target: launch screen painted under 1 s (the docs' inline requirement) and Lighthouse mobile above 80.
- The launch screen renders from `postData` without waiting for the server.

## 13. Test plan

Unit tests (Vitest, `src/shared`):

- Ported engine, edge-coverage and gesture tests, passing unchanged in substance.
- **120 consecutive days:** every puzzle validates, `solveLevel` length equals stored par, replaying the path solves it, par sits in its weekday band, each week's difficulty score never decreases from Monday to Sunday, weekday means rise strictly, no two days in the window share a signature.
- Determinism: same date and rev give a deep-equal puzzle; a different rev gives a different one; golden snapshots for fixed dates catch accidental generator changes.
- Validator rejects: unsolvable, already solved, multiple answers, overlapping, look-alike, out-of-range panels.
- Streak table tests (consecutive, grace used, grace exhausted, skipped day, replay of the same day, month and year boundaries).
- Score encoding orders by folds then time; share grid contains no hinge index or direction.
- Date keys and timezone release times, including half-hour zones.

Server tests (`@devvit/test`): one scored attempt under 50 concurrent completions by one user; leaderboard and distribution totals under many users; forged or illegal move lists rejected; job idempotency under concurrent runs; regenerate and skip; route submit limits, duplicate rejection, selection order and fallback; flair failure does not fail the request.

Checks: `tsc --build` in strict mode, ESLint, bundle-size script.

Playtest verification (each required system, on the dev subreddit, recorded in the README): scheduled post appears with the right title and preview; scored attempt then practice; end card numbers match Redis; share comment lands under the sticky; subscribe; flair set, and graceful message with flair disabled; mod regenerate and skip; settings validation; Community Route submit, vote, Sunday selection (triggered through the mod menu for a test date); Journeys receipts logged; iOS app, Android app, desktop web; light and dark; reduced motion; keyboard only; logged out; no console errors.

## 14. Milestones

| # | Work | Done when |
|---|---|---|
| M0 | Scaffold the React template in this repo on Node 24, remove `launch`, write `AGENTS.md` and `.kiro/steering/product.md` + `tech.md`, check typings for the three open API details | `npm run build` and `npm test` pass on the empty app |
| M1 | `src/shared`: port engine and tests, generator, validator, silhouette, difficulty, streak, score, share | All shared tests pass, including the 120-day run |
| M2 | Server: Redis layer, API, scheduler job, post creation, menu, forms, settings, triggers | Server tests pass |
| M3 | Client: launch screen, game, end card, leaderboard, sound, themes, accessibility | Playable end to end in playtest |
| M4 | Community Route: editor, submit, selection | Sunday selection verified in playtest |
| M5 | Flair, Journeys, subscribe, logged-out flow | Each verified in playtest |
| M6 | Polish, size budgets, full playtest matrix, deliverable docs | Checklist complete |

M3 onward needs `devvit login` on this machine and a playtest subreddit. If the CLI is not logged in I will stop and give you the exact command.

## 15. Deliverables

- `README.md`: what it is, how to play, the daily loop, Reddit features, how content is generated and validated, how to run, moderator guide, and the section **"Ported from Foldline"**.
- `DEVPOST_STORY.md`: marked as a port in the first lines. Inspiration, what it does, how it was built, challenges, what's next. No invented numbers.
- `VIDEO_SHOTLIST.md`: under 60 seconds, shot by shot, from the real demo post.
- `SUBMISSION_CHECKLIST.md`: app listing URL (`developers.reddit.com/apps/<name>`), demo post in a public test subreddit under 200 members, README present, **not published**, category "Best Ported Daily Game", port noted on the form.
- `AGENTS.md`, `.kiro/steering/product.md`, `.kiro/steering/tech.md`: the hard rules for later sessions.

**"Ported from Foldline" section, facts I can support from the archive's file timestamps:**

- Before 11 Nov 2026: a WebXR tabletop puzzle built on Meta's Immersive Web SDK, hosted on Vercel (public revision `2026-10-25-first-five-v4`). Nine authored puzzles, a 24-entry curated daily rotation by UTC date, local-only saves, desktop, touch and XR hand input. No accounts, backend, leaderboards or user content. Puzzle engine last changed 29 Sep 2026; daily rotation and levels 21 Oct 2026; scene and UI 25 Oct 2026.
- 12 Nov 2026: a dependency-only patch to the WebXR build, never published. Not part of this port.
- After 11 Nov 2026, 12:00 pm PT (dated changelog, filled in as each lands): new platform (Devvit Web), new input model (flat-screen drag-to-fold), seeded daily generator with validator and weekday difficulty curve, silhouette targets, server-scored attempts, leaderboards and distribution, streaks with grace, Community Route editor and weekly vote, streak flair, share comments, Journeys, moderator tools.

The owner confirmed these dates on 2026-11-15.

## 16. Risks

| Risk | Mitigation |
|---|---|
| `runAs: 'USER'` posts as the app account for non-owners until the app is published | Detect the author on the returned object, add the player's name to the text, document it |
| Journeys events dropped until allowlisted | Redis funnel counters, receipts logged, documented |
| Puzzles feel too easy because hinges are independent | Silhouette is a flat shape, look-alike margin tightens through the week, longer strips with more turns, time tiebreak; tune tiers after the first playtest |
| The answer can be derived from client data | Accepted, as with any client-rendered daily puzzle. Scores are still server-verified |
| Fixed camera hides part of a shape | Flip-view button; validator checks distinctness in the default view |
| Inline review rules (taps only, under 1 s) | Framework-free launch screen with no drag handlers and a size budget in CI |
| Scheduler misses a run | Job runs every 15 minutes and is idempotent; mod menu can post manually |
| Flair disabled or app lacks permission | Caught and shown as a quiet message |
| Community Route spam | One per player per week, must solve the day first, solver-validated, no free text, removed posts excluded |
| Redis 100 MB limit while unpublished | Compact records, 400-day expiry on day keys |
| Low disk space on this machine (about 9 GB free) | One `npm install` (roughly 0.5 GB); nothing else large |
| Demo subreddit must be public with fewer than 200 members, and the auto-created playtest subreddit is private | You create a public test subreddit, or install `dr-admin-approve`, before submission |

## 17. Decisions and their status

1. **App root is this repository** (`/Users/himanshujha/.t3/projects/this`), replacing the placeholder README. Confirmed.
2. **App name:** to be chosen by the owner before the first upload. `foldline-daily` is a local placeholder in `devvit.json` until then.
3. **three.js** for the expanded game (changed at approval). 2D canvas only for the inline launch screen.
4. **Community Routes are their own posts** (voted with normal upvotes), not comments. Kept.
5. **Timezone setting changes only the release time**; keys stay calendar dates and default to UTC. Kept.
6. **Timer starts on the first fold**, not when the post opens. Kept.
7. **Undo is allowed and counts as a fold** (changed at approval).
8. **Flair tiers never downgrade** when a streak breaks. Kept.

Port dates in section 15 were confirmed by the owner on 2026-11-15.

Other plans found in this folder from other tools are kept untouched in `docs/plans/` and `.kiro/specs/`. They describe different games and do not apply to this app.
