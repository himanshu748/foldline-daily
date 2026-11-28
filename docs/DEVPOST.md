# Foldline Daily — Devpost submission draft

**Tagline:** How few folds does it take to fit today's silhouette? A paper-folding puzzle inside a Reddit post — fewest folds wins.

**Subcategory:** Best Ported Daily Game (ported from my own WebXR game Foldline — original IP owned by me)

## Inspiration

Foldline started as a WebXR paper-folding game — the tactile pleasure of folding a strip into a shape. Reddit's daily-game format is the perfect home for it: one silhouette a day, a shared leaderboard, and the quiet competition of doing it in fewer folds than everyone else.

## What it does

Every day brings a new shape. Players drag panels to fold hinges by 90°, trying to match the target silhouette in as few folds as possible — time breaks ties. Undo costs a fold. Your first solve on the daily board counts; afterwards you can practice freely, check the leaderboard, and share a spoiler-free result grid in the comments. After solving, players can build a Community Route for others.

## How we built it

Devvit Web Interactive Post: React client, server replay validation. A scheduled task publishes the daily board; the server replays every move sequence before saving results in Redis, so a score on the board is a score that was actually folded. Reddit-native integration: comments, votes, flair, streaks, Sunday Community Routes.

## Challenges we ran into

- Porting a spatial WebXR interaction into a 2D canvas inside a post without losing the feel of folding.
- Server-side replay: every input must deterministically reproduce the same folds, or leaderboards are meaningless.
- Designing daily silhouettes that are neither trivial nor impossible in the fold-count par range.

## Accomplishments we're proud of

The port preserves the physical intuition of folding inside a Reddit post. The public Day 1 post and a locally recorded five-fold solve give judges two ways to see the game.

## What's next for Foldline Daily

Player-authored puzzle chains, weekly league tables, and streak flair tiers.

## Built with

`devvit` `devvit-web` `react` `typescript` `redis` `reddit` `canvas`

## Links

- App listing: https://developers.reddit.com/apps/contrarian-daily
- Demo post: https://www.reddit.com/r/FoldlineDaily/comments/1y1uv2a/day_1_six_panels_two_corners_par_7/
- Demo subreddit: https://www.reddit.com/r/FoldlineDaily/
- Repository: https://github.com/himanshu748/foldline-daily
- [Submitted Devpost entry](https://devpost.com/software/foldline-daily)
- [Native verification checklist](playtest.md#still-to-check-on-reddit)
- Demo video: [58.5-second five-fold solve at par](https://youtu.be/WoT1h9iPjf4). The video shows the result card and private replay, with an on-screen label identifying the local harness and simulated Devvit endpoints throughout.
