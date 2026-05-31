---
name: building-a-new-game
description: >-
  Step-by-step playbook for building a NEW multiplayer turn-based game on the
  Game Arena platform, using Long Shot (the horse-racing game) as the proven,
  battle-tested reference implementation. USE THIS whenever the user wants to add
  a new game, scaffold a game engine, design a multiplayer/dice/turn-based game
  for the arena, or asks "how did we build Long Shot / can we reuse that
  pattern". It distills the engine shape (phase model, addPlayer, host-start,
  server-rolled dice for fairness, the PendingChoice pattern for in-turn
  choices, computeHistory with the finished-gate), the data/engine separation,
  and the order of operations that worked. Pair with the game-arena-platform
  skill for the registry/dispatch/projection contracts; this skill is the
  worked example that makes those contracts concrete.
---

# Building a new game (Long Shot as the template)

Long Shot (`src/lib/games/longshot.ts` + `longshotAbilities.ts`) is the most
complete multiplayer engine in the arena and the best pattern to copy for a new
turn-based or dice game: 2-8 players, a host-started match, server-rolled dice,
per-turn interactive choices, money/scoring, and per-entity special abilities.
Mirror its shape and you inherit the platform's scaling guarantees.

> Read the **game-arena-platform** skill first for the registry/dispatch/
> projection/history contracts. This skill shows how Long Shot satisfies them so
> you can pattern-match for your game.

## Order of operations (the build that worked)

The arena's games were built in **vertical slices**, each shippable, not
big-bang. Long Shot's phases (visible in this repo's task history) were:

1. **Core loop, no actions.** Get `lobby → playing → finished` working: seat
   players, host start, the central mechanic (the race advancing on dice),
   detect game-over, record history. Deploy. Now you have a playable skeleton.
2. **Player actions.** Add the action layer (`takeAction` + an `ActionPayload`
   union) one action at a time — Bet, Buy, etc. Each is a pure engine function
   with validation.
3. **Scoring depth.** Layer the richer rules (bonuses, sets, multipliers) on top
   of the working loop.
4. **Per-entity abilities.** Special behaviors (horse abilities) factored into a
   **separate data file** (`longshotAbilities.ts`) so the engine stays a
   dispatcher and the content is editable in isolation.
5. **Polish.** Animations, sounds, end-game UI (last, optional).

Build this way. A working thin slice you can deploy and playtest beats a large
unverified engine — the bugs you'll actually hit surface in play.

## The engine shape to copy

From `longshot.ts` (the load-bearing patterns):

```ts
export const STATE_VERSION = 1;                 // bump when stored-state shape changes

export type LSState = {
  version: number;
  phase: 'lobby' | 'playing' | 'finished';      // the universal phase model
  players: LSPlayer[];                            // multi-player: array of seats
  // ... board state, current-turn bookkeeping, a capped log ...
  pendingChoice?: PendingChoice;                  // interactive in-turn choices
};

export function initialState(): LSState { ... }   // empty lobby
export function addPlayer(state, playerId, username, seat, accent_color?) { ... }
export function removePlayer(state, playerId) { ... }
export function startRace(state): LSState | { error } { ... }   // host-start; validates min players
export function rollDice(state, horseDie, movementDie): LSState | { error } { ... }  // dice PASSED IN
export function takeAction(state, playerId, payload: ActionPayload): LSState | { error } { ... }
```

Key decisions encoded here, each worth copying:

- **`phase: 'lobby' | 'playing' | 'finished'`** — the platform's turn-order and
  history helpers expect this vocabulary.
- **`players: PlayerState[]` with a stable `seat`** — register joiners via
  `addPlayer`; never reshuffle seats mid-game (turn order must be stable).
- **Host-start is a separate function** (`startRace`) with a min-player check;
  the server action enforces host-only. Randomize who moves first here (see the
  platform skill's #1 invariant) — don't default to seat 0.
- **Dice are parameters, not rolled in the engine.** `rollDice(state, horseDie,
  movementDie)` takes the die values; the *server action* (`rollDiceLS`) rolls
  them (`MOVEMENT_DIE_FACES` is a weighted d6) and passes them in. This keeps the
  engine pure/deterministic/testable AND makes the roll server-authoritative so
  a client can't cheat the dice.
- **Actions are a discriminated union** (`ActionPayload`) resolved by one
  `takeAction` switch — same shape as Legendary's `LegendaryAction`. Each action
  validates turn ownership and legality and returns `{ error }` on a bad move.
- **In-turn interactive choices use `PendingChoice`** (Long Shot has its own
  `PendingChoice` / `PendingChoiceResolution` pair) — exactly the Legendary
  pattern: park the turn until the player resolves, chain multi-step choices.
- **Constants/odds/board tables live as named `export const`s** at the top
  (`PURSE`, `BET_ODDS`, `CONCESSION_BONUSES`, `HORSE_COSTS`…) — readable,
  tweakable, and importable by the board and the server action.

## The history lesson Long Shot taught us (don't repeat it)

Long Shot's first `computeHistory` lacked a finished-gate and ran after **every
dice roll** — and `recordHistoryIfFinished` inserts a row with no dedupe each
time `computeHistory` returns non-null. Result: every roll wrote a W/L row, so
players racked up hundreds of phantom wins/losses. The fix:

```ts
computeHistory: (s) => {
  if (s.phase !== 'finished') return null;   // THE GATE — non-negotiable
  // ... derive winner from final standings ...
  return { winnerId, playerIds };
}
```

A cleanup migration then deleted the phantom rows. **Any new game's
`computeHistory` must gate on the true game-over condition.** If your rules let a
player finish their turn after the winning move, *arm* the result mid-turn but
only return the history row once `phase === 'finished'`.

## Data / engine separation

`longshotAbilities.ts` holds the per-horse special abilities as data + small
handlers, kept out of the main engine. When your game has many similar
content-y entities (units, cards, horses, monsters), put them in a sibling data
file and keep the engine a dispatcher. It makes the content auditable and
editable without wading through turn logic — and it's how Legendary
(`heroes/`, `villains/`, `schemes/`) and HeroQuest are organized too.

## Wiring it into the platform

Follow `references/per-game-checklist.md` in the **game-arena-platform** skill:
registry entry, `gameMove` dispatch + a `makeMove<Game>`, a board renderer in
`boards.tsx`, and the every-game checklist (random start, projection if there's
hidden info, the history gate, stable turn order, abandon/resign inheritance).

**Don't forget the lobby "How to play" entry.** Every game needs a
`GAME_GUIDES[<id>]` entry in `registry.ts` ( `{ theme, objective, rules[] }` )
— the lobby renders it as the per-game info modal (the ⓘ/"?" button on the
tile), and only shows that button when the entry exists. Write the `objective`
(win condition) from the engine's actual finished/winner logic, not from memory
(rules-fidelity), and keep `rules` to ~3–6 short bullets covering the core loop.

## References

- `references/longshot-reference.md` — a deeper tour of Long Shot's structure (state fields, the action set, the choice flow, scoring) for when you want concrete code to mirror.
