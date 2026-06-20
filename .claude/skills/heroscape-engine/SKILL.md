---
name: heroscape-engine
description: >-
  Canonical reference for the HeroScape engine in src/lib/games/heroscape/ (engine.ts ~4.5k
  lines — the largest engine in the repo) plus its board UI and server action. USE THIS
  whenever you touch ANY HeroScape rule or board behavior: movement, engagement/adjacency,
  falling/terrain, combat/range/LOS, glyphs, order markers/initiative/turn flow, army
  draft/placement, special powers (Mind Shackle, Fire Line, Chomp, Grenade, The Drop, the Big
  Hero attacks), the move-undo, or the 3D/2D board and how clicks become actions. The engine
  has hard-won invariants that have each caused real bugs — server-rolls-all-dice,
  destination-based moves, the 2-hex `at2` footprint, the elevation-exception adjacency rule,
  clone-once immutability, and order-marker hidden-info — that are easy to violate. Read this
  BEFORE editing engine.ts / board.ts / actions.ts / HeroScapeBoard.tsx / HeroBoard3D.tsx so
  you reuse the established seams. Pair with rules-fidelity (match docs/heroscape/ exactly),
  heroscape-figures (the standee ART pipeline — different concern), and game-arena-platform.
---

# HeroScape engine

HeroScape is a multiplayer, turn-based hex-and-figure battle game on the Game Arena platform.
The implementation lives in `src/lib/games/heroscape/` with the board UI in `src/components/`.
The canonical RULES are `docs/heroscape/` (numbered rulebook references + `ARCHITECTURE.md`);
when implementing or debugging a rule, read the doc text and match it exactly — see
[[rules-fidelity]]. This skill is the code map + the invariants.

## File map

- `engine.ts` (~4454 lines) — `applyAction` (the one entry point) + every `do*` handler +
  pure helpers (movement, engagement, combat, glyphs, powers). Server-authoritative; never
  rolls dice itself.
- `types.ts` — `HSState`, the `HSAction` union, `HSResult = HSState | { error: string }`,
  `HSCardDef`, `Figure`, glyph/choice types.
- `board.ts` — PURE hex math shared by engine + UI (so they can't disagree): axial `(q,r)`
  keys `"q,r"`, `neighborKeys`, `hexDistance`, `rangeDistance`, `stepCost`, `canStepUp`,
  `reachableDestinations` (Dijkstra), `areEngaged`, `computeFall`, `tailFor`, `hexLine`.
- `content.ts` — `HS_CARDS`, `HS_DRAFT_POOL`, `SLICE1_ARMIES` (the fixed quick armies, all
  1-hex), `HS_GLYPHS`, `POWER_DESCRIPTIONS`, `CARD_IDENTITY`.
- `figureBase.ts` — board STANDEE crop/anchor math (shared with the `/heroscape-sandbox`
  gallery). The ART/cut-out pipeline is a separate concern → [[heroscape-figures]].
- `index.ts` — barrel exports.
- `engine.test.ts` / `board.test.ts` / `big-heroes.test.ts` + a self-play **fuzzer** +
  jsdom component tests (`HeroScapeBoard.*.test.tsx`). ~367 HeroScape tests total.
- `src/components/HeroScapeBoard.tsx` — the board WRAPPER: WebGL probe (`can3D`), renders
  `HeroBoard3D` (primary) or a 2D SVG fallback; owns selection + the single `clickHex` router
  + all action buttons (End turn, Undo move, power toggles).
- `src/components/HeroBoard3D.tsx` — the R3F/WebGL board (THE default). Hexes are
  `<mesh onClick>` prisms; figures are billboard standees. No pointer-move/hover yet.
- `src/app/rooms/[id]/actions.ts` — `makeMoveHS`/`gameMove`: rolls the dice a move/power needs,
  builds the engine `HSAction`, calls `applyAction`. Holds the WIRE action unions.
- `src/lib/games/boards.tsx` — `BOARD_RENDERERS.heroscape` wires every board callback
  (`onMoveFigure`, `onAttack`, `onMindShackle`, `onUndoMove`, …) to `gameMove(...)`.

## The one entry point — `applyAction(state, playerId, action): HSResult`

Returns the NEW state or `{ error }`. Structure (engine.ts ~276):
1. Seated check; reject in `lobby`/`finished`.
2. `draft` phase → draft_roll/draft_card/draft_pass only.
3. `placement` phase → place_figure/unplace_figure/placement_ready/orient_figure only.
4. **PendingChoice gate**: while `state.pendingChoice` is open, only the owning seat may act and
   only via `resolve_choice` (exception: an in-flight `grenade_throw`). NEVER auto-resolve a
   choice (rules-fidelity).
5. A switch by `action.kind`. **Turn actions** (move_figure, grapple_move, undo_move, attack,
   fire_line, grenade, berserker_charge, water_clone, mind_shackle, chomp, ice_shard, queglix,
   wild_swing, acid_breath, throw_figure, carry_move, orient_figure, end_turn) are gated by
   `subPhase === 'turns' && turnSeat === me.seat`, then dispatched to `do*`.

**Immutability:** `clone(state) = JSON.parse(JSON.stringify(state))`. Every handler clones once
at the top, mutates the clone, returns it. The input `state` is never mutated.

## Turn / round flow (docs/heroscape/02)

Round → `place_markers` (each player secretly assigns 1/2/3/X to their living cards) →
`roll_initiative` (server d20 roll-off, ties re-rolled) → `turns` (initiative order; **3 turns
per player**, one per marker number). Per-turn Action 1 = reveal marker N (auto, picks the
active card), Action 2 = move, Action 3 = attack/special. Lost-turn rule: a marker on a card
with no living figures is skipped and never revealed.

Per-turn state in `HSState`: `turnSeat`, `turnNumber (1|2|3)`, `turnPointer` (index into
`initiative`), `movedFigureIds`, `turnAttacks` (the SINGLE source of "what has attacked" — its
length > 0 means movement is over), `moveHistory` (undo stack), and one-shot power flags
(`mindShackleSpent`, `berserkerSpent`, `waterClonedThisTurn`, `chompedThisTurn`,
`queglixDiceSpent`). `getActiveCardUid(state)` = the card holding the revealed marker. These all
CLEAR at turn/round boundaries (turn start / end_turn / new active card / round rollover).

## Movement — DESTINATION-BASED (rules-correct; don't send paths)

The client sends only the target hex; the engine computes/validates the path.
- `legalDestinations`/`movementDestinations` → `reachableDestinations` (board.ts Dijkstra over
  `stepCost`). `doMove(state, figureId, to, fallRoll?, extremeFallD20?, leaveRolls?)` validates
  then calls `applyValidatedMove`.
- `moveConsequences(state, fig, to)` → `{ tier (fall band), fallDice, abandonedEnemyIds }`. The
  SERVER (actions.ts) computes the dice NEED from this and rolls them, then the engine
  RE-VALIDATES the dice shape (rejects an unneeded or missing roll).
- Costs (`stepCost`): flat/descend = 1; climb L levels = 1+L. `canStepUp`: a single step can't
  rise ≥ the figure's Height. **Water** and **glyphs** are FORCED STOPS (you can't path past
  them). Falling: `computeFall` tiers (Fall 1 die / Major 3 dice / Extreme d20). Leaving-
  engagement swipes resolve mid-move (1 unblockable die per abandoned enemy).
- **Move UNDO** (shipped): `HSState.moveHistory` = JSON snapshot stack; `applyValidatedMove`
  pushes a pre-move snapshot; `undo_move` (`doUndoMove`) pops+restores a full rewind; cleared
  on any commit. Details + the pending DRAG-PATH design are in the [[project-heroscape-movement]]
  memory.

## Engagement & adjacency (docs/heroscape/03 §8-9)

- `areEngaged(aKey, aHeightStat, bKey, bHeightStat, heightAt)` (board.ts): engaged iff
  **hex distance 1** AND the height gap **< the lower figure's Height stat** (the ELEVATION
  EXCEPTION — a figure on a column ≥ the other's Height is NOT adjacent). On flat maps (all
  height 1) neighbors are always adjacent.
- `figuresAdjacent`/`engagedPair` loop over `figureHexes` of BOTH figures; `enemiesEngagedWith`
  lists engaged enemies. **Allies never engage** (teams). Leaving-engagement = enemies engaged
  at move START who are no longer adjacent at the END (path-independent — this is rules-correct).
- ⚠⚠ **2-HEX FOOTPRINT:** `figureHexes(fig) = [fig.at, fig.at2]`. A double-space figure with a
  null `at2` silently occupies ONE hex in the engine while the board draws the full peanut →
  breaks engagement/adjacency/occupancy/range/LOS from its second lobe. Every place/move MUST
  set `at2` (`doPlaceFigure` uses `tailFor`; moves use `to2`/`moveTailFor`;
  `autoPlaceQuickArmy` was fixed 2026-06-20). Coordinate display: keys are AXIAL `(q,r)`;
  `hexLabel` prints `(col+1, row+1)` offset, so the LOG coords differ from the raw keys.

## Special powers

Each power has an **eligibility helper** (`mindShackleTargets`/`canMindShackle`,
`queglixTargets`, `iceShardTargets`, `wildSwingTargets`, `acidBreathTargets`, `chompTargets`,
`theDropHexes`, `carryPassengers`, …) computed live from positions/adjacency/range/LOS — no
tokens. The board shows the control when the helper is non-empty (or, for Mind Shackle, ALWAYS
on Ne-Gok-Sa's card with a reason — see [[project-heroscape-movement]]). The SERVER rolls all
d20s/combat dice in actions.ts; multi-step powers (grenade, the_drop→airborne_drop) use
`pendingChoice`. Verbatim card text lives in `docs/heroscape/big-heroes-powers.md` /
`content.ts POWER_DESCRIPTIONS` — implement against the text (rules-fidelity).

## Board UI → action flow

`HeroScapeBoard.tsx` probes WebGL (`can3D`) and mounts `HeroBoard3D` (primary) or the SVG
fallback; BOTH call one `clickHex(key)` that routes by current mode (placement / move /
attack / a power toggle like `shackleMode`). Action buttons live in the NOW-ACTING card panel
and the rail. Callbacks (`onMoveFigure(figureId,to)`, `onAttack`, `onMindShackle(targetId)`,
`onUndoMove`, `onEndTurn`, …) are props wired in `boards.tsx` to `gameMove(roomId, {game:
'heroscape', kind, …})`. Adding a power/action = engine `do*` + `HSAction` + the wire unions in
actions.ts (+ dice roll there) + a board callback + a UI control. The standee crop/seat math is
`figureBase.ts` (shared with the gallery); the cut-out ART is [[heroscape-figures]].

## Invariants — do not break these

1. **The SERVER rolls every die** (actions.ts), never the engine. The engine recomputes the
   need and re-validates the roll shape. Keeps multiplayer fair.
2. **Moves are destination-based**; disengagement is start-vs-end, not the path. Don't add a
   path-provokes rule (it isn't HeroScape) — see [[project-heroscape-movement]].
3. **2-hex figures must always have `at2` set** wherever placed/moved (the landmine above).
4. **Clone once per action**; never mutate the input state.
5. **Hidden info**: order markers are secret until revealed — never leak unrevealed
   assignments to other seats in the per-viewer projection (game-arena-platform).
6. **Never auto-resolve a player choice** (PendingChoice; rules-fidelity).
7. **Allies never engage / aren't swiped**; friendly-fire attacks are still allowed.

## Build / verify loop

`npx tsc --noEmit` then `npx vitest run src/lib/games/heroscape` (engine + board + big-heroes +
fuzzer) and the `HeroScapeBoard.*.test.tsx` component tests. Add a regression test that encodes
any rule you implement (rules-fidelity). The fuzzer plays hundreds of random 2-6p games and
asserts no crash + the team-elimination invariant — run it after engine changes. Then commit +
push (auto-deploys); verify per `feedback-deployment` (gh deployment status for code).
