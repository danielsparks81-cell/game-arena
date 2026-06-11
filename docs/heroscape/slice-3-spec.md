# HeroScape — Slice 3 Spec: Terrain Depth

> Implementation spec, written before the code. This is the "new hard part"
> (ARCHITECTURE.md §6): real 3D terrain on a non-flat map. Sources:
> 03-movement-elevation-terrain.md (movement/elevation/water/engagement),
> 04-combat-range-los-attack.md (height advantage), the resolved thresholds in
> 99-open-questions §4 and extraction/resolutions.md. Base: slice 2 (6124304).

## What slice 3 adds

Slice 2 played the full Master round on a FLAT map (all height 1). Slice 3
turns on elevation and terrain so the Knoll and Ford maps (test-maps.md) play
correctly. The order/turn engine and projection are unchanged.

IN: climb cost, climb limit, free descent, falling damage, water forced stop,
engagement + leaving-engagement swipes, height advantage, elevation-aware LOS,
selectable map at game start (Training Field / The Knoll / Ford Crossing).

STILL OUT (slices 4-5): special powers (incl. card Flying — Marro/most figures
have no power, so slice 3 is fully playable without it), glyphs, drafting,
3+ players. NOTE: figures with a Flying/leaping power would bypass climb/fall;
since slice-3 armies (Vikings, Marro) have no such power, ignore it — but leave
a `// slice 4: Flying bypasses this` marker at each climb/fall site.

## Movement & elevation (03-movement §1-4)

Replace the flat `reachableDestinations` cost model (currently 1/hex) with
level-aware stepping. Moving from cell A (height hA) to adjacent cell B (hB):

- **Step cost** = 1 (the move into the space) + extra for going UP:
  - up: cost = 1 + (hB − hA)  [each level climbed costs 1 extra]
  - level or down: cost = 1  [descent is free of extra cost]
- **Climb limit (per single step)**: a figure cannot step up if
  (hB − hA) ≥ its card Height. Max legal single climb = Height − 1 levels.
  (Resolutions: "cannot move up a number of levels equal to or higher than its
  Height number all at once.")
- Water: see below (forced stop). Voids (`.`): impassable, as in slice 2.
- Pass-through-friendly / never-enemy / can't-end-on-occupied: unchanged.

`reachableDestinations(cells, from, move, occupancy, heightOf, cardHeight)`
becomes a Dijkstra/uniform-cost search (costs now vary per edge), not BFS.
Keep it pure in board.ts; the board calls the same helper for highlights.

## Falling (03-movement §4; thresholds resolved in 99-open-questions §4)

When a figure ENDS a move (or is otherwise placed) on a cell whose height is
LOWER than the cell it left, compute drop = hFrom − hTo:

- drop ≥ Height → **Fall**: roll 1 combat die; 1 wound per skull.
- (drop − Height) ≥ 10 → **Major Fall**: roll 3 dice total instead.
- (drop − Height) ≥ 20 → **Extreme Fall**: roll d20; 19-20 unharmed, 1-18
  the figure is DESTROYED outright.
- **Water exemption**: NO fall damage if the figure lands on a water space,
  from any height (03-movement §4 intro).

Banded reading (resolutions): use drop−Height for the major/extreme bands; base
Fall triggers at drop ≥ Height (equal counts). Falls are SERVER-rolled like all
dice — the move action carries an optional `fallRoll: CombatFace[]` and
`extremeFallD20?: number`, supplied only when the destination triggers a fall.
The engine recomputes whether a fall is due and validates the roll shape; an
unneeded roll is rejected, a missing-but-required roll is rejected (server
computes need before rolling — see actions.ts flow).

Slice-3 maps: Knoll's R4 summit (drop 3) only triggers a fall for Height ≤ 3
figures; Vikings/Marro are Height 4-5, so on these maps falls rarely fire — but
the rule and tests must be correct (test with a synthetic low-Height figure or
a deeper drop).

## Water (03-movement §5)

- A figure entering a water space must **STOP** (movement ends there) — water
  costs the figure all remaining movement that step. It may still attack.
- Exception (03-movement §5): a figure may move THROUGH a single water space if
  it has the movement to reach a non-water space immediately beyond — i.e.
  water stops you only if you would END there. Implement as: stepping onto
  water is allowed but cannot be a pass-through node UNLESS the next step off it
  is taken in the same move and there's a legal non-water landing. Simplest
  faithful model: water tiles are valid endpoints (forced stop) AND valid
  pass-through only when leaving immediately to non-water. Encode in the
  search: entering water zeroes remaining budget for ending, but a transition
  water→non-water is permitted if budget remains.
- Climbing OUT of water onto a higher bank uses the normal climb cost.
- No fall damage landing in water (above).

## Engagement & leaving-engagement (03-movement §6, Example 14)

- Two figures are **engaged** when they are adjacent (hex-adjacent) AND the
  height difference does NOT break adjacency. Adjacency is BROKEN (not engaged)
  when the higher figure stands on a cell whose height exceeds the lower
  figure's by ≥ the lower figure's Height (Example 14: ledge 5 levels = Finn's
  Height 5 → NOT adjacent). So: engaged iff hexAdjacent AND
  |hA − hB| < max(HeightA, HeightB)... use the rulebook's exact test —
  not adjacent when the height gap ≥ the *lower* figure's Height. Encode a pure
  `areEngaged(state, figA, figB)` and unit-test the Example 14 boundary (gap = 5,
  Height 5 → not engaged; gap 4 → engaged).
- **Leaving engagement**: when a figure STARTS its move adjacent to (engaged
  with) an enemy and moves to a non-adjacent space, EACH enemy it was engaged
  with at the start of the move rolls ONE attack die against it ("leaving
  engagement"): each skull = 1 wound (can destroy). This is automatic per the
  rulebook ("will take any leaving engagement attacks") — not a player choice —
  so the move action carries `leaveRolls: { enemyFigureId, roll: CombatFace }[]`
  supplied by the server for each engaged enemy the path abandons. Engine
  validates the set matches exactly the enemies engaged at move start and left
  by the destination.
- A figure may move BETWEEN engaged enemies; only enemies it's no longer
  adjacent to AT THE DESTINATION trigger the swipe (slice 3: judge by start vs
  end adjacency, not per-step — the per-step "passing swipe" nuance is a
  documented simplification; note it).

## Height advantage (04-combat §height advantage; resolved +2 rule)

When resolving an attack, compare attacker base height vs defender base height
(the cell each stands on):

- attacker cell height > defender cell height → attacker rolls **+1 attack die**.
- defender cell height > attacker cell height → defender rolls **+1 defense die**.
- The "+2" case (resolutions / 04-combat): if the higher figure's base is 10 or
  more levels above the lower figure's Height, +2 dice instead of +1. (On
  slice-3 maps this never fires; implement and unit-test it anyway.)

This changes `attackDiceRequirements`: it must add the height bonus to the
attacker's attack count and/or the defender's defense count. The server rolls
exactly that many dice. Keep the bonus computed in ONE place (the requirements
helper) so the board's preview and the engine's resolution can't disagree
(rules-fidelity: single source of truth for a displayed+enforced number).

## LOS with elevation (04-combat; ARCHITECTURE §7)

Slice 2's LOS was a flat center-to-center segment blocked by figures. Slice 3
adds terrain columns: a hex with height > both endpoints' "eye height" can
block. Keep it deterministic (no d20 dispute). Slice-3 model:

- Eye height of a figure = its cell height + (figure Height as a small constant,
  e.g. use cell height + 1 as the sightline elevation so a figure on a taller
  column sees over a shorter one). Terrain blocks if an intervening cell's
  height ≥ the interpolated sightline height at that cell AND ≥ both endpoints.
- Figures still block as in slice 2 (intervening occupied cell).
- This is an APPROXIMATION of the tabletop 3D line; document it. The full Target
  Point→Hit Zone model is out of scope. Grazing stays non-blocking.

Implement `hasLineOfSight3D(cells, from, to, occupied, eyeOf)` in board.ts;
keep the slice-2 flat version available or generalize it. Unit-test: a tall
rock column between two low figures blocks; the same figures both atop equal
columns see each other; a figure on a hill sees a figure in a pit it couldn't
see if reversed (asymmetry is fine — both directions computed independently).

## Map selection

`createInitialStateForHost` + a lobby control: host picks the battlefield
(training_field default, the_knoll, ford_crossing). Add The Knoll and Ford
Crossing to maps.ts (parse from test-maps.md token grids; they include heights
2-4 and water/void). Add a `start_game` payload `{ mapId }` (validated against
MAPS) OR a separate `set_map` lobby action — choose the lighter wiring;
document which. Armies stay fixed (slice 4 brings drafting).

## State / actions deltas

```ts
// types.ts
HexCell already has height/terrain — no change.
HSAction:
  move_figure += { fallRoll?: CombatFace[]; extremeFallD20?: number;
                   leaveRolls?: { enemyFigureId: string; roll: CombatFace }[] }
  start_game  += { mapId?: string }   // default training_field
LastAttack    += { heightBonusAttacker?: number; heightBonusDefender?: number } // for the dice panel caption
// new log tags ok: 'fall', 'engage' can reuse 'move'/'attack'
```

## Tests (engine.test.ts / board.test.ts)

- Climb cost: stepping up 2 levels costs 3 movement; down is 1; a Move-5 figure
  can crest the Knoll only where the cumulative cost allows.
- Climb limit: a Height-4 figure cannot step up 4+ levels in one step; can do 3.
- Fall: Height-3 figure dropping 3 → 1 die, wounds per skull; dropping into
  water → no roll; synthetic drop 14 → 3 dice; drop 25 → d20, 1-18 destroys.
- Water: entering water ends movement; through-water-to-land allowed with budget;
  no fall into water.
- Engagement: Example 14 boundary (gap 5 vs Height 5 → not engaged; gap 4 →
  engaged); leaving-engagement swipe fires for exactly the abandoned enemies,
  each one die, skull = wound, can destroy; moving while staying adjacent → no
  swipe.
- Height advantage: higher attacker +1 attack die in requirements AND in the
  resolved roll count; higher defender +1 defense; the +2 band; equal height → 0.
- LOS 3D: tall column blocks; equal columns see; pit asymmetry.
- Map selection: host picks the_knoll; figures placed in its start zones; cells
  carry heights 1-4.
- Regression: all slice-2 tests still pass (flat map unaffected — costs reduce
  to 1/hex, no falls, no height bonus).

## Verify + ship

tsc · vitest (heroscape, 2×) · build · commit · push (auto-deploys). Keep the
single-source-of-truth rule for the height bonus. Review the falling + leaving-
engagement server-roll flow (those are the new "server computes need, then
rolls, engine re-validates" seams) before commit.
