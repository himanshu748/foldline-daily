# Foldline Daily

A daily paper-folding puzzle for Reddit, built as a Devvit Web Interactive Post. Fold a
strip of hinged paper panels until it fills the day's silhouette. Fewest folds wins;
time breaks ties. One scored attempt per player per day — then practice is free.

**Ported from my own WebXR game Foldline** (see [Ported from Foldline](#ported-from-foldline)).

Play it at [r/FoldlineDaily](https://www.reddit.com/r/FoldlineDaily/).

## How it plays

- A new puzzle post appears in the subreddit every day, titled `Day N · <hook>`, with a
  feed preview that shows the day's silhouette, paper colour and difficulty pips.
- Tap to open, drag any panel to fold it. Release snaps to a 90° stop; small drags
  cancel. Undo is allowed and costs one fold.
- The end card shows your folds against par, the field's distribution, your rank, and
  your streak — plus optional actions: share a spoiler-safe result grid as a comment,
  join the subreddit, wear streak flair, build a Community Route, or keep practicing.
- Difficulty ramps through the week: Monday is three panels at par 2, Sunday is seven
  panels at par 9–10.

## Community Route

After solving, any player can build a puzzle in the in-post editor (6–7 panels, par 8
or more). Every submission is verified by the ported solver — on the device for instant
feedback and again on the server — and becomes its own playable post. The week's
top-upvoted valid route becomes Sunday's puzzle, credited to its author.

## Reddit features

Scheduled daily posts · opt-in result comments under a stickied results thread ·
upvotes pick the Sunday route · user-made puzzles · opt-in streak flair (Crease 3 days,
Pleat 7, Origami 30) · per-day leaderboards with snoovatars · subscribe button ·
Devvit Journeys funnel instrumentation.

## Ported from Foldline

Foldline Daily is a port of **Foldline**, my own WebXR paper-folding puzzle. Only the
pure puzzle logic moved; the WebXR presentation was dropped entirely.

**State of the original project before 11 Nov 2026 12:00 PM PT (hackathon start):**

- **29 Sep 2026** — fold engine: edge-hinged panel geometry, discrete fold states,
  breadth-first solver, panel-overlap check, docking test.
- **21 Oct 2026** — daily level rotation and the level set.
- **25 Oct 2026** — flat-screen play UI and styles. Last public hosted revision:
  `2026-10-25-first-five-v4` on Vercel.
- **12 Nov 2026** — dependency-only patch `2026-11-12-dependency-patch-v5`, no gameplay
  changes, never published.

**Changelog after 11 Nov 2026 12:00 PM PT (the port itself):**

- **15 Nov 2026** — everything in this repository: ported the pure logic (`engine.ts`,
  `gesture.ts`, solver, overlap check) and its tests into `src/shared/`; built the
  deterministic daily generator and validator on top of the ported solver; new
  mobile-first drag-to-fold controls; three.js presentation; Devvit server (scheduler,
  Redis state model, verified scoring, leaderboards, streaks, flair); Community Route
  editor and selection; all Reddit integrations; splash screen, end card, accessibility
  and moderation tooling.

## Development

Requires Node 24.18+.

```sh
npm install
npm run typecheck   # strict TypeScript, project references
npm run lint
npm test            # shared logic + server (256 tests)
npm run build       # production build
npm run size        # bundle budgets, runs after build
npm run dev         # Devvit playtest (needs: npx devvit login)
npm run deploy      # PRIVATE upload only — never publish
```

`npm run launch` does not exist on purpose: nothing here may be submitted for review.

### Layout

- `src/shared/` — pure puzzle logic, generator, validator, scoring, streaks, wire
  formats. No Devvit or DOM imports; fully unit-tested.
- `src/server/` — Hono app: posting job, Redis state model, verified scoring,
  leaderboard, streaks, flair, sharing, Community Routes, moderator tools.
- `src/client/` — inline launch screen (framework-free, renders from `postData`),
  expanded game (React 19 + lazy three.js scene), lazy Community Route editor.
- `PLAN.md` — the approved design. `AGENTS.md` — working rules for coding agents.

### How a puzzle is proven

Every puzzle — generated or player-made — passes one gate (`validatePuzzle`): solvable
by the ported BFS solver, par proven two independent ways, exactly one docking fold
state, no overlapping panels on the solution path, and no other state whose silhouette
could be mistaken for the target under the game's fixed camera. A test generates 120
consecutive days and asserts all of it, plus the Monday-to-Sunday difficulty curve.

### Honesty notes

- Scoring is verified on the server (the fold list is replayed), but the puzzle's goal
  state ships in `postData` so the launch screen needs no server call — a determined
  player could read it, the same trade-off most daily web games make.
- Journeys events report "not allowlisted" receipts until Reddit allowlists the app;
  the client logs receipts during playtest.
- Reddit has no API to read subscription state, so the join button's state is
  remembered in Redis after a successful subscribe.
