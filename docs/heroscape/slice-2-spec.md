# HeroScape — Slice 2 Spec: Master Turn Engine

> Implementation spec, written before the code. Sources: 02-rounds-turns-order-markers.md
> (the round structure), 04-combat-range-los-attack.md (wounds), ARCHITECTURE.md §4/§8
> (projection contract). Slice 1 (commit de8a617) is the base.

## What slice 2 changes

Slice 1 played the **Basic Game**: 6-dice roll-off, then strictly alternating
single turns with a free choice of card. Slice 2 upgrades to the **Master
Game** round structure (p. 9) and Master combat (wounds, p. 14). The Basic
roll-off is removed — initiative is a d20 every round.

IN: order markers (1/2/3/X) placed secretly each round; d20 initiative with
tie re-rolls; turns 1→2→3 in initiative order driven by the revealed marker;
unrevealed-marker loss when a card is destroyed; wounds vs Life (heroes soak,
Life-1 squad figures still die to one unblocked skull); `projectStateForViewer`.

STILL OUT (slices 3-5): elevation, water, engagement/swipes, height advantage,
special powers, glyphs, drafting, manual placement, 3+ players.

## Round flow (p. 9, faithfully)

```
playing.subPhase:
  'place_markers'  — ALL players simultaneously assign 1, 2, 3, X to their own
                     living cards (any split; all four on one card is legal; X
                     is a decoy). Ready-gated: turn advances only when every
                     player has locked in. getActivePlayerId → null.
  'turns'          — d20 initiative was rolled when the last player locked in
                     (server rolls, engine validates; ties re-roll — keep every
                     attempt for the UI). For turnNumber = 1, 2, 3: each player
                     in initiative order reveals that marker and takes a turn
                     with THAT card only (move its figures, then attack).
                     After the last player's turn 3 → round += 1, markers
                     cleared, back to 'place_markers'.
```

- Reveal is automatic at turn start (no action): the engine flips
  `revealed: true` on the current player's marker `turnNumber`.
- **Lost turn** (p. 14): if the card holding the current marker is destroyed,
  the turn is skipped with a log line. Do NOT log what the marker was placed
  on beyond the loss itself; X markers are never revealed at all.
- The X marker takes no turn — it exists only to mislead.

## Combat change: wounds (p. 14 Master rules)

- `attack` resolution: unblocked skulls (skulls − shields, min 0) become
  wounds on the TARGET figure. A figure is destroyed when its wounds reach its
  card's Life. Squad figures (Life 1) keep slice-1 behavior.
- Wounds live on `Figure.wounds: number` (0 default). Roster panel shows
  hero wounds as ♥ remaining (Life − wounds).

## State model (types.ts) — STATE_VERSION 2

```ts
type OrderMarker = { marker: '1' | '2' | '3' | 'X'; revealed: boolean };

ArmyCardInstance += { orderMarkers: OrderMarker[] };   // cleared each round
Figure          += { wounds: number };

HSState changes:
  subPhase: 'place_markers' | 'turns';      // only meaningful while playing
  round: number;                            // 1-based
  turnNumber: 1 | 2 | 3;
  initiative: number[];                     // seats, this round's order
  initiativeRolls: { seat: number; roll: number }[][]; // every attempt incl. ties
  turnPointer: number;                      // index into initiative
  markersReady: number[];                   // seats locked in this round
  // REMOVED: rollOff, activeCardUid, movedFigureIds/attackedFigureIds stay
  //          (per-turn bookkeeping unchanged; active card now = revealed card)
```

Hidden-information rule: a card's unrevealed `orderMarkers[i].marker` values
are SECRET to everyone but the owner. The X decoy must be indistinguishable.

## Actions (HSAction) — dice still server-rolled

```ts
| { kind: 'start_game' }                                  // → place_markers (no roll-off)
| { kind: 'place_markers';
    assignments: { marker: '1'|'2'|'3'|'X'; cardUid: string }[] }  // exactly 4, one each
| { kind: 'roll_initiative'; attempts: { seat: number; roll: number }[][] }
    // sent by the SERVER automatically when the last player locks in; the
    // final attempt must be tie-free; engine validates phase + shape
| { kind: 'move_figure'; figureId: string; to: HexKey }   // unchanged checks +
| { kind: 'attack'; ... }                                 //   "on the revealed card" check
| { kind: 'end_turn' }                                    // advances pointer/turnNumber/round
```

Server flow in `makeMoveHS`: `place_markers` from the final unready player
triggers an immediate `roll_initiative` (same request — roll d20s, re-roll
tied seats only… simplest faithful: re-roll ALL on any tie, matching "the
tying players re-roll" loosely is fine for 2p where any tie = both re-roll).

## Projection — `projectStateForViewer(state, viewerId)`

For every card NOT owned by the viewer: replace each unrevealed marker with
`{ marker: 'hidden', revealed: false }` (type widens to `'1'|'2'|'3'|'X'|'hidden'`).
Revealed markers keep their value (1/2/3 only — X is never revealed).
Everything else is public. Wire it in the registry entry.

**Leak test (non-negotiable):** engine test asserts
`JSON.stringify(projected)` for viewer A contains no unrevealed marker value
of B's — including after reveals, after card destruction, and in lobby/finished.

## UI (HeroScapeBoard)

- `place_markers` panel (replaces turn banner while placing): your living
  cards as rows; tap a chip (1/2/3/X) then a card to assign; chips show where
  they sit; **Lock in** button → `onPlaceMarkers(assignments)`; opponent shows
  a "placing…" / "ready ✓" status only.
- Card marker chips during turns: own cards show real numbers (revealed ones
  highlighted); enemy cards show face-down chips (count only) with revealed
  numbers face-up.
- Turn banner: `Round 2 · Turn 1/3 · Marro Warriors` + whose turn.
- Initiative panel: each round's d20 results (every attempt, ties marked).
- Hero wound pips in the roster (♥ Life − wounds) and a small wound dot on
  wounded figures on the map.

## Tests to add (engine.test.ts)

1. place_markers validation: exactly one of each 1/2/3/X, own living cards only,
   can't place twice, can't act during turns.
2. Initiative: applied order matches final attempt; tied attempt must be
   followed by another; engine rejects a final attempt containing a tie.
3. Reveal flow: turn 1 player A reveals marker 1; acting with any other card
   rejected; end_turn advances A→B turn 1, then turn 2, …; after both turn 3 →
   round 2, markers cleared, back to place_markers.
4. Lost turn: destroy a card holding an unrevealed 2; that turn is skipped and
   logged without leaking the marker placement.
5. X decoy: X never produces a turn.
6. Wounds: 2 unblocked skulls on a Life-4 hero → wounds 2, alive; reaching
   Life destroys; Life-1 squad figure dies to 1 skull (regression).
7. Projection leak test (see above).
8. computeHistory still gated on 'finished'.

## Verify + ship

`npx tsc --noEmit -p tsconfig.json` · `npx vitest run src/lib/games/heroscape`
(2×) · `npm run build` · commit · push (auto-deploys). HeroQuest's 38
pre-existing failures (task #85) are NOT in scope and don't block.
