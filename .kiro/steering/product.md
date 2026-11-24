# Product — Foldline Daily

## What it is

A daily paper-folding puzzle as a Reddit Interactive Post (Devvit Web). A strip of
hinged square panels must be folded until it fills the day's target silhouette. Fewest
folds wins; time breaks ties. One scored attempt per player per day; practice is free
after that. Ported from the user's own WebXR game Foldline.

## The daily loop

- A scheduler posts one puzzle per day ("Day N · <hook>") with a visually distinct
  feed preview (weekday paper colour, silhouette, pips).
- Difficulty ramps Monday (3 panels, par 2) to Sunday (7 panels, par 9–10).
- The end card shows folds vs par, the field's distribution, rank/percentile, streak,
  and opt-in actions: share a spoiler-safe result comment, join the subreddit, wear
  streak flair, build a Community Route, practice.
- Countdown to the next puzzle; streaks (with a documented grace rule) drive return.

## Community Route

Solving players can build a puzzle in an in-post editor (6–7 panels, par ≥ 8,
solver-validated on device and again on the server). It becomes its own playable post;
the week's top-upvoted valid route becomes Sunday's puzzle, credited to its author.

## Why it fits the hackathon (Game of the Day, Best Ported Daily Game)

- Delightful UX: first interaction in under 3 s, ghost-hand hint, no text tutorial,
  mobile-first drag-to-fold with 48 px tap targets.
- Polish: one colour-blind-safe palette, one type scale, light + dark, reduced motion,
  sound off by default, micro-animations, strict bundle budgets.
- Reddit-y: scheduled posts, comments (opt-in result grids under a stickied thread),
  votes (route selection), UGC (routes), user flair tiers (Crease/Pleat/Origami),
  per-day leaderboards with snoovatars.
- Daily content: deterministic generator + solver proof, 120-day solvability tests,
  moderator regenerate/skip tools.
