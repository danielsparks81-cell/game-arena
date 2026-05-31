---
name: game-arena-platform
description: >-
  Architecture, cross-cutting invariants, and the build/verify/deploy loop for
  the Game Arena multiplayer game site (Next.js + Supabase + Vercel). USE THIS
  whenever you add or modify a game, the lobby, rooms, realtime sync, history/
  stats, or any shared room machinery — and ALWAYS when adding a new game,
  because the platform is designed so 40-60 games and ~20 users running up to 5
  simultaneous games "just work" through shared contracts (the game registry,
  server-authoritative actions, hidden-info projection, the computeHistory
  contract, realtime broadcast, turn order). Several concerns — randomized
  starting player, projection of secret state, no-phantom-history, abandon/
  resign — apply to NEARLY EVERY game and must be handled by default rather than
  rediscovered each time. Read this before writing room/game code so you plug
  into the existing seams instead of special-casing.
---

# Game Arena platform

A Next.js (App Router) + Supabase (Postgres + RLS + Realtime) site deployed to
Vercel, hosting many turn-based and co-op games behind one lobby/room shell.
Live at https://game-arena-ten-gamma.vercel.app. The design goal: adding the
40th game should be a registry entry + an engine + a board, not a rewrite — and
20 people playing 5 concurrent games should never step on each other.

> Note: `AGENTS.md` warns this is a non-standard Next.js with breaking changes —
> read `node_modules/next/dist/docs/` before writing framework code.

## How a game plugs in (the registry seam)

`src/lib/games/registry.ts` is the single source of truth. One `GameDef` entry
wires a game into the lobby tiles, room header, turn-order display, member
panel, kick/join bookkeeping, and history — with **no `switch (game_type)`
scattered elsewhere**. The contract:

```ts
type GameDef = {
  id, name, description, minPlayers, maxPlayers, addedOn, beta?, categories?,
  initialState: () => unknown,
  createInitialStateForHost: (host) => unknown,
  getActivePlayerId: (state) => string | null,   // null = no single active player
  getOrderedPlayerIds: (state) => string[],       // stable turn order
  addPlayer?, removePlayer?,                       // multi-player engines only
  computeHistory?: (state) => { winnerId, playerIds, meta? } | null,
  projectStateForViewer?: (state, viewerId) => unknown,  // strip secrets
};
```

Two seating models coexist: **2-player abstract games** key off `state.seats`
(`{ X, O }` etc.) and omit `addPlayer`; **multi-player engines** (Long Shot,
Legendary, HeroQuest, …) keep `state.players[]` and register `addPlayer` /
`removePlayer`. The dispatch helpers (`getProjectedState`, `getTurnInfo`,
`recordHistoryIfFinished`) read the registry, so new games inherit all of it.

## Action dispatch (server-authoritative)

Every in-game move funnels through `gameMove(roomId, action)` in
`src/app/rooms/[id]/actions.ts` — a `'use server'` action whose `action` is a
discriminated union (`{ game, kind, ... }`). It delegates to a per-game
`makeMove<Game>` that: reads the room, calls the **pure engine**
`applyAction(state, userId, action)`, persists the next state to the `rooms`
table, records history if finished, and broadcasts. The engine is the only place
that validates turn ownership and rules — **never trust the client**. The board
sends intent; the server decides.

After mutating, the server calls `notifyRoom(roomId)` which POSTs a
`room-changed` event to Supabase Realtime broadcast (more reliable than
`postgres_changes` under RLS). Connected clients refetch via `fetchRoom`, which
returns state **already projected for the caller** — so secret bytes never cross
the wire even at the network layer.

## Cross-cutting invariants — handle these by DEFAULT for every game

These are the concerns the user specifically called out: things that apply to
nearly every game and must not be re-thought from scratch each time. Full
detail + the new-game checklist in `references/per-game-checklist.md`.

1. **Randomize the starting player.** A game must NOT let the host (always seat
   0) go first every time. In `startGame`/`createInitialStateForHost`, pick the
   first mover at random (`Math.floor(Math.random() * players.length)` for
   array-seat engines; a coin flip for 2-player seat maps — see how `joinRoom`
   swaps `seats.X`/`seats.O`). This was a real bug in Legendary: `currentPlayerIdx`
   was hard-coded to 0. Treat "who goes first is random" as table stakes.

2. **Project hidden state.** Any game with private information (hands, decks,
   face-down piles, hidden ships) MUST implement `projectStateForViewer` to
   replace secrets with hidden placeholders before state leaves the server.
   Forgetting this leaks data to every client AND bloats Realtime payloads.

3. **`computeHistory` returns null until truly finished.** `recordHistoryIfFinished`
   inserts a `game_history` row with **no dedupe** every time it returns
   non-null. Gate on the game-over condition (`phase === 'finished'` / a winner).
   Long Shot shipped phantom W/L because `computeHistory` lacked the finished
   gate and fired on every dice roll; the fix + a cleanup migration followed.
   Arm the win mid-turn if rules require finishing the turn, but only *commit*
   (return the row) when the game is actually over.

4. **Turn order is stable.** `getOrderedPlayerIds` must return seats in a fixed
   order for the whole match (the member panel and hourglass depend on it).
   `getActivePlayerId` returns `null` when there's no single active player
   (simultaneous play, between rounds, game over).

5. **Abandon / resign / inactivity are shared.** Mid-game exits go through the
   existing `voteAbandon` (unanimous → end with NO history) and `resignGame`
   (2-player, opponent credited). Games auto-end after ~15 min idle. Don't
   reinvent these; they live in `actions.ts` and the TopBar.

6. **Clear `rematch_votes` / `abandon_votes` on every real move** so a stray
   vote doesn't linger across a fresh action (the per-game `makeMove` updates
   set `abandon_votes: []`).

## Scaling posture (why these contracts matter at 40-60 games / 20 users)

- **State is one JSONB column per room.** Keep it lean: project away secrets,
  trim logs (engines cap their event log; e.g. Spellduel `trimLog`, Legendary
  `LOG_MAX`), and don't store heavy derived data (the Legendary undo snapshot is
  stored server-side but stripped by projection so it never hits the wire).
- **Realtime is broadcast-per-room** (`room-<id>` topic). Subscribe once per
  client; double-subscribing the same channel crashed the lobby once. Presence
  uses a separate `lobby-presence` channel.
- **The engine is pure and deterministic**, so it's cheap to run server-side on
  every action and trivially unit-testable. RNG (shuffle, dice) is the only
  nondeterminism and is isolated — server actions roll dice (`rollDiceLS` rolls
  in the action, not the engine) so fairness is server-controlled.
- **Adding a game is O(1) on the platform**: registry entry + engine + board
  renderer (`src/lib/games/boards.tsx`). Everything else dispatches.

## The build / verify / deploy loop

The exact, repeatable cycle for every change is in
`references/verify-and-deploy.md`. The short version, always from the repo root:

```bash
cd /c/Users/Dan/Desktop/game-arena
npx tsc --noEmit -p tsconfig.json     # must be from root — WindowsApps python/tsc shim errors otherwise
npx vitest run                        # run 2-3x for engines with random setup (flakiness)
npm run build                         # Next production build
git add -A && git commit -m "..."     # branch first if on main; co-author line
vercel --prod                         # deploy; confirm "Aliased … ten-gamma" + readyState READY
```

## Supabase / migrations

Schema changes are hand-authored SQL in `supabase/migrations/NNN_*.sql`, applied
manually in the Supabase SQL editor (there's no automated migrate step). Code
that depends on a new column should degrade gracefully if it isn't applied yet
(e.g. `recordHistoryIfFinished` retries the insert without `meta` if the column
is missing; `/legendary-stats` shows a "run the migration" hint instead of
crashing). When you add a migration, tell the user it must be applied manually.

## References

- `references/per-game-checklist.md` — the full "every game must handle" list and the step-by-step for registering a new game.
- `references/verify-and-deploy.md` — the environment quirks (Windows shim, LF→CRLF), the exact verify commands, commit/deploy conventions, and how to read a successful deploy.

For the worked example of building a multiplayer game end-to-end, see the
separate **building-a-new-game** skill (anchored on Long Shot).
