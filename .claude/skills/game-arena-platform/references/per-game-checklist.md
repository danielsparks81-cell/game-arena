# Per-game checklist + registering a new game

Two parts: (A) the cross-cutting concerns every game must satisfy regardless of
genre, and (B) the mechanical steps to register a new game into the platform.

## A. Every-game checklist (the "don't rediscover this each time" list)

Run through this for any new game AND when reviewing an existing one:

- [ ] **Random starting player.** Host (seat 0) must not always go first.
  Array-seat engines: `currentPlayerIdx = Math.floor(Math.random() * n)` at
  start. 2-player seat maps: coin-flip which user gets `seats.X` vs `seats.O`
  (`joinRoom` already does this for TTT/C4/Checkers/RPS when seat 1 joins —
  match that pattern). Log who goes first.
- [ ] **Hidden-info projection.** Private state (hands, decks, face-down piles)
  scrubbed in `projectStateForViewer` before it leaves the server. Decks hidden
  even from their owner where appropriate. Test it.
- [ ] **`computeHistory` finished-gate.** Returns `null` until the game is truly
  over; never mid-game (phantom W/L). Returns `{ winnerId, playerIds, meta? }`.
  `winnerId: null` for a draw/tie. `meta` only if you want analytics rows.
- [ ] **Stable turn order.** `getOrderedPlayerIds` fixed for the match;
  `getActivePlayerId` returns `null` when nobody is uniquely "up".
- [ ] **Server-authoritative.** All validation (turn ownership, legality, cost)
  in the pure engine `applyAction`/`applyMove`. Client sends intent only.
- [ ] **Pure + deterministic engine.** No `Date.now()`/`Math.random()` in the
  engine except isolated shuffle/dice; for fairness, roll dice in the *server
  action*, not the client, and pass the result into the engine.
- [ ] **Clear vote arrays on real moves.** `abandon_votes: []` (and
  `rematch_votes: []` on finish) in the per-game `makeMove` update.
- [ ] **Min/max players + categories** set on the `GameDef` so the lobby filters
  and seat grid behave.
- [ ] **Lobby "How to play" guide.** Add a `GAME_GUIDES[<id>]` entry in
  `registry.ts` (`{ theme, objective, rules[] }`). The lobby's per-game info
  modal renders it and only shows the ⓘ button when it exists. Write `objective`
  from the engine's real win condition (fidelity), `rules` as ~3–6 bullets.
- [ ] **Lean state.** Trim logs, project away secrets, avoid storing heavy
  derived data in the room JSONB.
- [ ] **Graceful with unapplied migrations** if the game reads a new column.
- [ ] **Regression test** for every rule and every bug fixed.

## B. Registering a new game

1. **Engine** — `src/lib/games/<game>.ts` (or a `<game>/` dir for large ones
   like Legendary/HeroQuest). Export the pure functions: `initialState()`,
   `addPlayer`/`removePlayer` (if multi-player), a host-start (`startGame`/
   `startRace`) where applicable, and the action entry (`applyAction` or
   `applyMove`) returning the next state or `{ error }`. Model `phase` as
   `'lobby' | 'playing' | 'finished'`. Carry a `STATE_VERSION` for future
   migrations of stored state.

2. **Registry entry** — add to `GAMES` in `registry.ts`. Wire
   `createInitialStateForHost`, `getActivePlayerId`, `getOrderedPlayerIds`,
   `computeHistory`, and (multi-player) `addPlayer`/`removePlayer` +
   `projectStateForViewer`. Reuse the shared `seatBasedHistory` /
   `playerIdWinnerHistory` helpers if they fit.

3. **Server dispatch** — extend the `GameAction` union and the `gameMove`
   switch in `actions.ts` with your game's action kinds, each delegating to a
   `makeMove<Game>` that reads room → `applyAction` → persist → record history
   if finished → `notifyRoom`. Mirror an existing game's `makeMove` (e.g.
   `makeMoveLG`) for the persist/finish/broadcast boilerplate.

4. **Board** — a `<Game>Board` client component, registered in
   `src/lib/games/boards.tsx` (`BOARD_RENDERERS[game_type]`). It reads the
   projected state, renders, and calls `gameMove`. The room shell, TopBar
   actions (resign/abandon/undo), member panel, and chat are inherited.

5. **Lobby/metadata** — the `GameDef` fields drive the tile, beta badge,
   categories, and player-count filter automatically. Also add a
   `GAME_GUIDES[<id>]` entry (theme / objective / rules) so the lobby's
   "How to play" info modal works for the new game. No other lobby edits needed.

6. **Verify + deploy** — see `verify-and-deploy.md`.

The point of this structure: steps 1 and 4 are the only meaningfully novel work;
2-3-5 are plug-in. If you find yourself editing lobby/room/member code to add a
game, stop — there's probably an existing seam you're meant to use instead.
