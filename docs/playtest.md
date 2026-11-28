# Foldline Daily playtest

- [Public demo post](https://www.reddit.com/r/FoldlineDaily/comments/1y1uv2a/day_1_six_panels_two_corners_par_7/)
- [Private playtest](https://www.reddit.com/r/contrarian_daily_dev/?playtest=contrarian-daily)
- [Devvit app listing](https://developers.reddit.com/apps/contrarian-daily)
- [Original Foldline game for the port field](https://foldline-meta-start-2026.vercel.app/)

The repo records a private v0.0.3 upload on Nov 21, 2026. That playtest covered the
daily post and preview, first scored solve and practice end card, streak and flair,
spoiler-free result comment, Community Route validation and a playable route post,
and the skip, undo-skip, and specific-date moderator actions. The public subreddit
was created and Day 1 posted on the same date.

## Repeatable local playthrough

From a fresh checkout with Node 24.18 or newer:

```sh
npm ci
npx playwright install chromium
npm run test:e2e
```

At phone width, the browser tests open the help with keyboard focus, solve a fixed
board in five folds, check the player's leaderboard row, and verify that a practice
solve leaves the first score in place. They also simulate a signed-out visit and check
that the solved board survives a reload and the login button calls the Reddit prompt.
These tests use the local harness with simulated Reddit endpoints. The public Reddit
checks below cover the actual platform.

## Still to check on Reddit

- [ ] Play and solve a public puzzle from a regular Reddit account.
- [ ] Check a populated leaderboard, the player's row, rank, and distribution chart.
- [ ] Check signed-out play through the result screen and the sign-in prompt.
- [ ] Confirm the Join fallback opens the subreddit. Reddit blocks in-app subscription
      until the app is approved.
- [ ] Verify that the regenerate moderator action replaces the right daily puzzle.

Devvit Journeys calls were observed in playtest, which returns
`JOURNEY_RECEIPT_DENIED_PLAYTEST`. A valid receipt requires a non-playtest install.

## Native regenerate verification

Use a private playtest for the moderator action. Save the current post URL,
puzzle date, revision and at least one scored solve before changing it.

1. Open **Foldline: regenerate today's puzzle** and cancel once. Reopen the
   post and confirm that the silhouette and revision stayed the same.
2. Open the action again, confirm it, then follow the post that opens. The new
   silhouette should differ and its revision should advance. Depending on the
   title, the action may update the post in place or open a replacement.
3. Confirm the earlier solver kept their streak, then finish the new board and
   check that this revision starts its own leaderboard. Record the app version,
   both post URLs, and before/after puzzle identifiers in [issue #19](https://github.com/himanshu748/foldline-daily/issues/19).

The server unit tests exercise these transitions with a fake Reddit context.
The checklist above is for collecting native evidence. Use [issue #16](https://github.com/himanshu748/foldline-daily/issues/16) for the separate public-player check.

## Record the demo

The [submitted 58.5-second video](https://youtu.be/WoT1h9iPjf4) shows the labeled local harness. For a native replacement, the 45-second shot list is [demo-shot-list.md](demo-shot-list.md). Record it from the
public demo post on a phone-sized viewport. The private playtest URL uses the
registered slug `contrarian-daily`. Say Foldline in the recording.
