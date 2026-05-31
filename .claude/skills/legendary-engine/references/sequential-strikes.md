# Sequential per-player interactive resolution (the "Master Strike" pipeline)

This is the pattern for any effect where **each player must make an interactive
choice, in turn order, at the moment the effect triggers** — before the new
active player begins their turn. It exists because four separate effects
(Magneto, Red Skull, Dr. Doom Master Strikes; Juggernaut Ambush/Escape; plus
Deadpool's Random Acts pass-left) all hit the same two traps and each shipped a
bug before being routed through this single mechanism.

## Why the naive approaches fail

These effects fire during the **end-of-turn villain reveal** inside `doEndTurn`.

1. **Setting `state.thisTurn.pendingChoice` directly fails.** Right after the
   reveal, `doEndTurn` advances the turn and calls `emptyTurnState()`, which
   replaces `thisTurn` wholesale. The prompt is wiped before any client sees it,
   so the player keeps playing as if nothing happened. (This was the visible
   symptom: "the Master Strike didn't force me to put cards on my deck.")

2. **Deferring via a per-player flag (`pendingMagnetoStrike` etc.) fails the
   rules.** It makes each player resolve on *their own* next turn, not in turn
   order now. Marvel Legendary's rule is "each player resolves, starting with
   the player whose turn it is, then proceeding in turn order" — all before the
   next turn actually begins. The per-player flag also auto-resolved
   non-active players (auto-discarding their cheapest cards) instead of letting
   them choose.

## The mechanism

State carries the queue (in `LegendaryState` / `TurnState`, types.ts):

```ts
// LegendaryState
pendingStrike?: {
  kind: 'magneto' | 'doom' | 'redskull' | 'juggernaut' | 'pass_left';
  revealerSeat: number;
  zone?: 'discard' | 'hand';   // juggernaut: which pile to KO from
  amount?: number;             // juggernaut: how many
};
strikeQueue?: number[];        // seats still to resolve, head-first

// TurnState
choiceOwnerSeat?: number;      // seat that currently OWNS the pendingChoice (out of turn)
```

`pendingStrike` is **state-level**, so it survives `emptyTurnState()`.
`choiceOwnerSeat` is the bridge that lets a player who is NOT at
`currentPlayerIdx` act.

### Flow

1. **Reveal detects the strike** (in `revealOneVillainCard`'s `master_strike`
   case for Master Strikes, or `setJuggernautStrike` / `setPassLeftStrike` for
   ambush/escape/pass-left). It sets `state.pendingStrike` ONCE with
   `revealerSeat = state.players[state.currentPlayerIdx].seat`. It does NOT loop
   over players and does NOT set any pendingChoice yet.

2. **`doEndTurn` finishes normally** — advances `currentPlayerIdx`, calls
   `emptyTurnState()`. `pendingStrike` rides through untouched.

3. **`driveSequentialStrike(result)`** runs at the tail of `applyAction` after
   every action. Two cases:
   - A fresh strike was flagged (queue not yet built) → `startSequentialStrike`.
   - The current owner just cleared their `pendingChoice` → `advanceStrikeQueue`.

4. **`startSequentialStrike`** builds `strikeQueue` = revealer seat first, then
   the remaining seats in turn order, and calls `processStrikeQueue`.

5. **`processStrikeQueue`** walks the queue. For each head seat it calls
   `applyStrikeToPlayer(state, player)`:
   - returns `false` → that player needs no prompt (auto-skip with a log line);
     pop and continue.
   - returns `true` → it set `state.thisTurn.pendingChoice`; set
     `state.thisTurn.choiceOwnerSeat = seat` and **return** (wait for input).
   When the queue drains, run any finisher (pass-left distributes all chosen
   cards simultaneously) and call `finishSequentialStrike` to clear all three
   fields. Control returns to the real `currentPlayerIdx`.

6. **`applyAction` authorizes the owner, not just the active player.** Near the
   top:

   ```ts
   const ownerSeat = state.thisTurn.choiceOwnerSeat;
   const outOfTurn = ownerSeat !== undefined;
   const actor = outOfTurn
     ? state.players.find(p => p.seat === ownerSeat)
     : state.players[state.currentPlayerIdx];
   if (!actor || actor.playerId !== playerId) return { error: ... };
   if (outOfTurn && action.kind is not a choice-resolution kind) return { error: ... };
   ```

7. **`getActivePlayerId` returns the owner during a strike**, so the platform
   (turn highlight, notifications) and the board's pending-choice UI point at the
   right player:

   ```ts
   const ownerSeat = state.thisTurn.choiceOwnerSeat;
   if (ownerSeat !== undefined) return state.players.find(p => p.seat === ownerSeat)?.playerId ?? null;
   return state.players[state.currentPlayerIdx]?.playerId ?? null;
   ```

8. **The board** resolves the effective actor from `choiceOwnerSeat` and shows a
   "⚡ Master Strike — waiting for X…" banner to non-owners (LegendaryBoard.tsx,
   `strikeOwnerSeat` / `strikeInProgress`).

## Adding a new strike kind — checklist

1. Add the literal to `pendingStrike.kind` in types.ts.
2. In the `master_strike` reveal (engine.ts), extend the `seqKind` dispatcher:
   ```ts
   const seqKind =
     mmDef.strike.some(e => e.kind === 'magneto_master_strike') ? 'magneto' :
     mmDef.strike.some(e => e.kind === 'each_player_ko_hero_from_hand') ? 'redskull' :
     mmDef.strike.some(e => e.kind === 'doom_master_strike') ? 'doom' :
     /* your kind */ null;
   ```
   (For an ambush/escape, special-case the effect kind in the ambush/escape loop
   and call a `set<Name>Strike` helper instead — see `setJuggernautStrike`.)
3. Make the underlying `Effect` case in `resolveEffect` a **no-op** (it's only
   kept to keep the switch exhaustive — resolution happens via the pipeline).
4. Add a branch in `applyStrikeToPlayer`: return `false` for players who need no
   prompt (with a log line), else set the appropriate `pendingChoice` (mandatory)
   and return `true`.
5. Remove any obsolete `pending<Name>Strike` flag from `PlayerState` and its
   handling in `resolvePendingStrikes`.
6. Add a 2-player regression test: end a turn into the reveal, assert
   `pendingStrike.kind`, assert `choiceOwnerSeat` is the revealer, resolve each
   player in order, assert the queue drains and control returns to
   `currentPlayerIdx`.

## What stays on the simpler path

Loki's Master Strike (`loki_master_strike`) resolves **immediately** and is NOT
in the pipeline — because it has no interactive prompt (reveal a Strength Hero,
else gain a Wound; fully automatic). Only effects that need a per-player
*choice* need the queue. `resolvePendingStrikes` still handles the truly
deferred, non-interactive carryovers (e.g. Super-Skrull's Fight sets
`pendingMasterStrikeKO` to resolve against the player's freshly-drawn hand).
