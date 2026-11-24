# Submission checklist — Game of the Day Hackathon 2026

Deadline: **8 Dec 2026, 6:00 PM PST**. Category: **Best Ported Daily Game**.
Do **not** publish the app; submission is the listing URL + demo post + README.

## Before submitting

- [x] App name chosen (3–20 chars, `^[a-z][a-z0-9-]*$`) and set in `devvit.json` + `package.json` — registered as `contrarian-daily`
- [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run size` all pass (21 Nov 2026, 261 tests)
- [ ] Private upload with `npm run deploy` and a full playtest on the private playtest subreddit
      (private upload v0.0.3 on 21 Nov 2026; playtest: https://www.reddit.com/r/contrarian_daily_dev/?playtest=contrarian-daily):
  - [x] Daily post created by the scheduler (or "post now" mod action), correct title + preview
  - [x] Solve → scored attempt; second solve is practice (practice end card checked by hand 21 Nov 2026)
  - [ ] Leaderboard rows + own row; distribution chart; rank text (not checked on Reddit yet)
  - [x] Streak increments; flair toggle sets flair
  - [x] Share posts a spoiler-safe comment under the results thread, as the player
  - [ ] Join button subscribes; logged-out play works end to end — consent prompt shows, but
        Reddit refuses `SUBSCRIBE_TO_SUBREDDIT` until the app is approved; the button then
        becomes a link to the subreddit. Logged-out play not checked yet.
  - [ ] Regenerate, skip, and post-a-specific-day mod actions work — skip (and undo) and
        post-a-specific-day work; regenerate not checked on Reddit yet
  - [x] Route editor validates, submits, and the route post is playable
  - [x] Journeys `track()` reaches the platform: playtest versions always return
        `JOURNEY_RECEIPT_DENIED_PLAYTEST` (seen 17 Nov 2026); `VALID` receipts need a non-playtest install
- [ ] Public test subreddit (< 200 members, or `dr-admin-approve` installed) with the app installed and at least one real puzzle post played —
      r/FoldlineDaily created 21 Nov 2026 (public), v0.0.3 installed, Day 1 posted automatically;
      still needs one real play
- [ ] Demo video (< 60 s) recorded per `VIDEO_SHOTLIST.md`
- [x] `README.md` (this repo root) present with the "Ported from Foldline" changelog
- [ ] `DEVPOST_STORY.md` copied into the Devpost write-up — brackets filled 21 Nov 2026

## Submission fields

- **App listing URL:** `https://developers.reddit.com/apps/contrarian-daily`
- **Demo post:** https://www.reddit.com/r/FoldlineDaily/comments/1y1uv2a/day_1_six_panels_two_corners_par_7/
  (Day 1; swap for a later day if that one is the one in the video)
- **Category:** Best Ported Daily Game
- **Video:** upload per shotlist
- **App status:** private (uploaded, never published)
