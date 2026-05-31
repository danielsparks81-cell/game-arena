# Long Shot — structural reference

Concrete tour of `src/lib/games/longshot.ts` (+ `longshotAbilities.ts`) so you
have real code to mirror when building a new turn/dice game. File is ~85KB; this
is the load-bearing skeleton, not every rule.

## State (`LSState`)

```ts
type LSState = {
  version?: number;                         // STATE_VERSION; see registry.migrateState
  phase: 'lobby' | 'playing' | 'finished';
  round: number;
  activePlayerSeat: number;                 // whose turn
  currentTurnSeat: number | null;
  step: 'roll' | 'action' | 'done';         // intra-turn state machine
  horseDie: number | null;                  // the rolled values, stored for the action step
  movementDie: number | null;
  horses: LSHorse[];                        // the board
  finishedCount: number;
  finalRound?: boolean;                     // armed when 3rd horse finishes; everyone gets one last turn
  market: number[];
  players: LSPlayer[];                      // seats, money, inventory, marks
  log: string[];                            // capped event log
  rollId: number;
  concessionGrid: number[];                 // shared layout, generated once at start
  assignedAbilities: Record<number, string>;// per-race ability assignment, fixed at start
  pendingBonus: { playerId; count } | null; // interactive gate 1
  pendingChoice: PendingChoice | null;      // interactive gate 2 (ability-driven)
};
```

Patterns worth copying:

- **Intra-turn state machine (`step`).** A turn is `roll → action → done`. The
  server only accepts a roll in the `roll` step and an action in the `action`
  step. This keeps the turn legible and lets the board show the right controls.
- **Store the dice in state** (`horseDie`/`movementDie`) between the roll and the
  action so the action can reference what was rolled.
- **"Final round" arming.** When the win condition is met (3rd horse finishes)
  it sets `finalRound = true` but the game keeps running so everyone takes a last
  turn; `phase` flips to `'finished'` only after the last player acts. This is
  the general "arm now, commit at end" pattern — mirror it for any game where the
  triggering player isn't necessarily last.
- **Two ordered interactive gates.** `pendingChoice` (ability) resolves first,
  then `pendingBonus` (concession). Round can't advance while either is set. If
  your game has multiple kinds of mid-turn prompts, give them a defined
  resolution order rather than letting them race.
- **Shared randomized layout generated once** (`concessionGrid` via a constrained
  shuffle with a hand-built fallback after N attempts). When every player needs
  the *same* random arrangement, generate it at `startRace` and store it — don't
  regenerate per client.

## Setup / lifecycle functions

- `initialState()` → empty lobby (`phase: 'lobby'`, no players).
- `addPlayer(state, playerId, username, seat, accent_color?)` /
  `removePlayer(state, playerId)` → seat bookkeeping; the registry's
  `createInitialStateForHost` calls `addPlayer(initialState(), host, …, 0)`.
- `startRace(state)` → host-start: validate min players, generate the shared
  grid + assign abilities, deal starting money, flip to `playing`. **Randomize
  the first mover here.**

## The roll (server-authoritative dice)

`rollDice(state, horseDie, movementDie)` takes the die values as **arguments**.
The engine never rolls. The server action does:

```ts
// rollDiceLS in actions.ts
const horseDie = 1 + Math.floor(Math.random() * 8);                       // d8
const movementDie = MOVEMENT_DIE_FACES[Math.floor(Math.random()*6)];      // weighted d6: [1,2,2,2,3,3]
const next = lsRollDice(state, horseDie, movementDie);
```

Why: the engine stays pure/deterministic (unit-testable by passing fixed dice),
and the randomness is server-side so a client can't influence its own roll. Copy
this split for any randomness a player could benefit from biasing.

## Actions (`takeAction` + `ActionPayload`)

One entry point, a discriminated-union payload, validated server-side:

```ts
type ActionPayload = (
  | { type: 'bet'; amount: number; strungAlong?: boolean }
  | { type: 'buy' }
  | { type: 'helmet' }
  | { type: 'jersey'; markHorse: number }
  | { type: 'concession'; cellIdx: number }
  | { type: 'refresh_wild' }
  | { type: 'claim_bonus'; bonusId: string; horse?: number; horse2?: number; markHorse?: number }
  | { type: 'resolve_choice'; choice: PendingChoiceResolution }
) & { wild?: number };   // shared modifier across most actions
```

- A **shared modifier** (`wild?`) rides on the intersection type so it applies to
  many action variants without repeating it in each — clean way to model a
  cross-cutting option.
- `resolve_choice` carries a `PendingChoiceResolution` whose `kind` must match
  the active `pendingChoice.kind`; `null` fields mean "skip". This is the same
  shape as Legendary's resolve flow — the engine drives multi-call choices
  (e.g. `inventory_check` prompts twice) by re-seeding the pending choice.
- Helper predicates like `hasValidActionOnHorse(state, player, horseNum)` are
  exported so the **board mirrors the engine's legality check** to enable/disable
  controls — the engine remains the authority, but the UI doesn't offer illegal
  moves. Export these rather than duplicating logic in the component.

## History (the finished-gate — see SKILL.md)

```ts
computeHistory: (s) => {
  if (s.phase !== 'finished') return null;   // mandatory gate
  // derive winner from final standings; null for a tie
  return { winnerId, playerIds };
}
```

## Data/engine split

`longshotAbilities.ts` holds the horse abilities as data + small handlers,
keyed by id (`ABILITY_BY_ID`), assigned into `state.assignedAbilities` at start.
The engine dispatches to them; it doesn't hard-code each ability inline. Use this
whenever a game has many similar content entities so the content is auditable and
the engine stays a thin dispatcher.

## What to lift for a new game

- The `phase` + `step` + intra-turn state machine.
- Server-rolled dice passed into a pure engine.
- One `takeAction` + discriminated `ActionPayload`, validated server-side.
- `PendingChoice` for any mid-turn decision, with a defined resolution order if
  there are several.
- `computeHistory` gated on `phase === 'finished'`, with "arm now / commit at
  end" if a player finishes their turn after the winning move.
- Constants and content tables as named exports; bulky content in a sibling file.
- Exported legality predicates the board can mirror.
