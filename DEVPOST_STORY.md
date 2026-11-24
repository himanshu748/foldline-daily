# Foldline Daily — Devpost story

> Draft for the Devpost write-up. Everything below is true of the code in this
> repository. Category: **Best Ported Daily Game**. Play it at
> [r/FoldlineDaily](https://www.reddit.com/r/FoldlineDaily/).

## Inspiration

Foldline started as my WebXR paper-folding puzzle: a strip of hinged square panels you
fold in 3D until the last panel docks into a target pose. The daily-game format fits it
perfectly — one shape a day, fewest folds wins — and Reddit's Game of the Day hackathon
was the excuse to bring it to the feed.

## What it does

One puzzle post per day, per subreddit. The feed preview already shows the day's
silhouette, paper colour and difficulty. Inside, you drag panels to fold them; release
snaps to a 90° stop. Solve in as few folds as you can — one scored attempt a day, then
unlimited practice. The end card shows your folds against par, how the whole field did,
your rank and your streak, and lets you share a spoiler-safe result grid as a comment.

Solving players can build their own puzzle in the in-post editor. Every route is
verified by the same solver that proves the daily puzzles, becomes its own playable
post, and the week's top-upvoted route becomes Sunday's puzzle, credited to its author.

## It's a port — and what that means

The engine is my own Foldline code, ported: hinge geometry, discrete fold states, the
breadth-first solver, the overlap check, the fold-gesture thresholds. The WebXR layer
is gone. What replaced it is new: deterministic daily generation, a flat-screen
mobile-first drag control, a three.js presentation, and everything Reddit — scheduler,
comments, votes, flair, leaderboards, snoovatars. (The README carries the dated
before/after changelog required for ported entries.)

## How I built it

- **Deterministic daily content.** `generate(date)` seeds a PRNG from the date and a
  weekday difficulty tier, then every candidate must pass one gate: solvable by the
  ported solver, par proven two independent ways, exactly one docking state, no panel
  overlaps on the solution path, and no other fold state whose silhouette could be
  confused with the target under the game's fixed camera. A test generates 120
  consecutive days and asserts all of it plus the difficulty curve.
- **Server-verified scoring.** The client sends its fold list; the server replays it
  with the same ported engine and rejects anything illegal. The first completion wins
  an atomic `HSETNX`; every later one is practice. No read-modify-write anywhere.
- **A real Reddit game.** Scheduled posts, a stickied results thread with opt-in
  result comments, upvote-driven Sunday routes, opt-in streak flair (Crease, Pleat,
  Origami), per-day leaderboards with snoovatars, and a Journeys funnel behind one
  `track()` call site.
- **Restraint.** Sound is synthesised and off by default. The launch screen is 1.4 KB
  of gzipped framework-free JavaScript that renders from `postData` alone. The palette
  is colour-blind safe; the distribution chart marks your bar with a pattern, not just
  colour. Keyboard play, reduced motion, light and dark.

## Challenges

- Making "no look-alike goals" testable: the answer was a raster silhouette signature
  under the game's one camera, so the validator can prove no other fold state reads
  the same on screen.
- Reddit's rules for user actions: every comment, subscribe and post is a separate,
  explicit tap, and result comments reply to one stickied thread.
- Playtesting inside Reddit found bugs the unit tests never reached: a practice solve
  showed no end card, the route editor's Submit button could fall below the fold in a
  short post, and first-time players had no explanation of the controls. Each one is now
  fixed (a practice end card, a pinned verdict bar, a one-time how-to-play card).
- Subscribing on the player's behalf needs a consent prompt (`canRunAsUser`), and even
  with consent Reddit refuses it until the app is approved. The Join button now falls
  back to a plain link to the subreddit instead of failing silently.

## What I learned

- Test in the real client early. The local harness proved the logic; only the Reddit
  playtest showed the layout and permission problems.
- Keep one gate for all content. Generated puzzles and player-made routes go through
  the same validator, so a route is held to exactly the same rules as a daily puzzle.
- Platform permissions shape the design. Every write a player makes (comment, post,
  subscribe) is a separate tap with a clear label, and each one has a fallback when the
  platform says no.

## What's next

- More route families in the generator, so the weekly difficulty curve has more variety.
- A weekly recap comment in the results thread.
- Icons for the streak flair tiers.
- Submit the app for review after the hackathon, so Join can subscribe directly.
