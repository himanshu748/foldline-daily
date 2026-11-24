# AGENTS.md — Foldline Daily

A daily paper-folding puzzle for Reddit, built on Devvit Web (Interactive Posts).
Ported from the user's own Foldline (WebXR). See `PLAN.md` for the full design.

## Commands

Always use Node 24 (`export PATH="$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"`); the
system default is older and will fail.

- `npm run typecheck` — project-referenced `tsc --build` (client, server, shared, vite)
- `npm run lint` — eslint over `src/**`
- `npm test` — Vitest, shared + server (uses `@devvit/test` harness)
- `npm run build` — Vite production build to `dist/`
- `npm run size` — bundle budgets, run after a build (`tools/check-bundle.mjs`)
- `npm run dev` — Devvit playtest (needs `npx devvit login`)
- `npm run deploy` — **private** upload only (`devvit upload`)

**Never** run `npm run launch`, `devvit publish`, or anything that submits the app for
review. The `launch` script was deleted from `package.json` on purpose.

## Hard rules

- **Verify every Devvit API before using it** (Devvit MCP `devvit_search` or
  developers.reddit.com/docs). Docs beat memory; several "obvious" APIs do not exist.
- Daily content must stay deterministic (seeded generator + ported solver). No runtime
  LLM calls, no paid APIs, free tiers only.
- Never fabricate numbers in UI or docs. Empty states are intentional ("Be the first
  today").
- Do not commit secrets or generated `dist/` output.
- `app/` and `.kiro/specs/` belong to another tool working in this repo. Do not modify,
  lint, format, or delete them; keep them out of every glob (`.prettierignore` already
  excludes them).

## Architecture

- `src/shared/` — pure TypeScript, no Devvit or DOM imports. The ported Foldline engine
  (`engine.ts`, `gesture.ts`), the seeded generator, the validator/solver gate
  (`validate.ts` — every puzzle, generated or player-made, must pass it), dates, streak,
  scoring, share grid, the `postData` wire format (`postdata.ts`) and the API types.
- `src/server/` — Hono app. `core/` holds the Redis model (`keys.ts`), the posting job
  (`posts.ts`), scoring (`results.ts`), Community Routes (`community.ts`), post metadata
  (`postinfo.ts`), sharing, flair, tracking. `routes/` maps HTTP: `/api/*` for the
  client, `/internal/*` for the scheduler, triggers, menu actions, forms, settings.
- `src/client/` — two entry points. `splash.html`/`splash.ts` is the inline launch
  screen (framework-free, renders from `postData` only, budget 25 KB gz). `game.html`/
  `game.tsx` is the expanded game (React 19). `scene/board.ts` is the three.js fold
  scene and `editor/route-editor.tsx` the route editor; both are lazy chunks.

## Invariants that tests protect

- `generate(dateUTC, rev)` is deterministic and every generated puzzle passes
  `validatePuzzle` (solvable, par proven twice, one docking state, no overlaps on the
  solution path, no look-alike silhouette within 10%). 120 consecutive days are tested.
- Scoring is server-verified: the client sends the fold list, the server replays it
  (`replay` in `shared/moves.ts`) and rejects anything illegal or unsolved.
- One scored attempt per player per board: `hSetNX` on `fl:<board>:result`; everything
  later is practice. No read-modify-write on shared keys.
- Undo is allowed and **counts as a fold** (it is appended as an ordinary move).
- Streak grace rule lives in `shared/streak.ts`: one missed day forgiven per six-day
  window; moderator-skipped days never break a streak.

## Bundle budgets (CI-enforced)

- launch screen JS ≤ 25 KB gz, no framework
- game entry (React shell) ≤ 130 KB gz
- three.js scene chunk ≤ 220 KB gz, always lazy
