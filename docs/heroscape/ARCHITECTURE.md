# HeroScape — Digital Adaptation Architecture

> How HeroScape 2nd Edition maps onto the Game Arena platform. Companion to the
> rules reference in this folder. Written before any code exists — update as the
> engine takes shape.

---

## 1. What kind of game this is (and why it fits the platform)

- 2–5 players (boxed scenarios use 2–4, including 2v2 teams and 1v3 asymmetric).
- Point-budget armies of **Army Cards**; each card controls 1 figure (Hero) or
  several (Squad).
- A hex battlefield with **3D elevation** (stacked tiles, per-hex height).
- Rounds driven by **secret order markers** + a **d20 initiative roll** each round.
- Combat = attack dice vs defense dice with height advantage, range, and
  line-of-sight.

This is a multi-player engine in the Long Shot/HeroQuest mold: registry entry +
pure engine + board renderer. Nothing about it requires new platform machinery —
but it exercises **every** cross-cutting invariant at once: hidden info
(order markers), server dice (d20 + combat dice), stable turn order vs
per-round initiative, and team play.

## 2. File layout (mirror HeroQuest's)

```
src/lib/games/heroscape/
  types.ts        — HSState, HSAction union, Figure, ArmyCard, HexCell, PendingChoice
  engine.ts       — applyActionHS dispatcher + do* functions (pure, deterministic)
  content.ts      — ARMY_CARDS, GLYPHS, TERRAIN, SCENARIOS, point costs
  maps.ts         — battlefield definitions (hex layout, heights, terrain, glyph spots, start zones)
  board.ts        — hex-grid helpers: neighbors, range counting, LOS, height math
  index.ts        — public barrel
src/components/HeroScapeBoard.tsx        — top-level UI (lobby/draft/placement/play/finished)
src/components/heroscape/HexBoard.tsx    — SVG hex renderer with elevation
```

Engine stays a dispatcher; card powers live in content/data files
(`longshotAbilities.ts` pattern — same as HQ spells and Legendary heroes).

## 3. State model (sketch)

```ts
export const STATE_VERSION = 1;

type HexKey = string;                    // "q,r"
type HexCell = { q: number; r: number; height: number; terrain: Terrain };
// Terrain: 'grass' | 'rock' | 'sand' | 'water' | 'swamp' | ... (from battlefield key, p.17)

type Figure = {
  id: string;
  cardUid: string;            // which army-card instance owns this figure
  ownerSeat: number;
  at: HexKey | null;          // null = not yet placed / destroyed
  wounds: number;             // heroes track wounds; squad figures die at 1 unblocked hit (Life 1)
};

type ArmyCardInstance = {
  uid: string;                // instance id (Commons can repeat)
  cardId: string;             // -> ARMY_CARDS in content.ts
  ownerSeat: number;
  orderMarkers: ('1'|'2'|'3'|'X')[];   // markers currently ON this card (secret!)
  destroyed: boolean;
};

type HSPlayer = { seat: number; playerId: string; username: string;
                  team?: number;        // scenario team play
                  army: ArmyCardInstance[]; pointsUsed: number; ready: boolean };

type HSState = {
  version: number;
  phase: 'lobby' | 'draft' | 'placement' | 'order_markers' | 'playing' | 'finished';
  players: HSPlayer[];
  scenarioId: string;
  round: number;                       // scenarios have round limits w/ printed tracks
  turnNumber: 1 | 2 | 3;               // which order marker is being revealed
  initiative: number[];                // seat order for THIS round (d20, rerolled each round)
  activeSeat: number | null;
  map: { cells: Record<HexKey, HexCell>; glyphs: GlyphOnMap[] };
  figures: Figure[];
  pendingChoice?: PendingChoice;       // swipes, glyph effects, power roll-offs
  log: HSLogEntry[];                   // capped (LOG_MAX pattern)
  lastRoll?: ...;                      // for dice animation, same as HQ
};
```

### Phase flow

```
lobby → draft → placement → ┌─ order_markers ─ playing(turn 1..3 × players) ─┐ → finished
                            └────────────── next round ←─────────────────────┘
```

- **`draft`** — players build armies to the scenario's point budget (or take the
  scenario's fixed armies). Snake draft for 3+ players per p.8.
- **`placement`** — players place figures in their start zones (simultaneous;
  `getActivePlayerId` returns null, per-player `ready` flags like HQ intermission).
- **`order_markers`** — ALL players secretly place 1/2/3/X on their cards
  (simultaneous, ready-gated). This is the projection-critical phase.
- **`playing`** — d20 initiative once at round start (server-rolled), then for
  turnNumber 1→2→3: each player in initiative order reveals that marker and takes
  the turn (move the card's figures up to Move, then attack with up to its
  Attack count). After turn 3, back to `order_markers`, round+1.
- **`finished`** — destruction or scenario end-of-round victory check / round-limit
  timeout. Scoring by full card value of destroyed enemies (p.14) for point-based
  scenarios.

## 4. Platform contract mapping

| Contract | HeroScape answer |
|---|---|
| `getOrderedPlayerIds` | **Stable seat order** for the whole match (platform invariant #4). Initiative is per-round *engine* state, displayed on the board — it does NOT reorder the registry's notion of seating. |
| `getActivePlayerId` | The revealed-marker player during `playing`; **null** during `order_markers`/`placement` (simultaneous phases). |
| `projectStateForViewer` | **Required.** Strip opponents' unrevealed order markers (replace with counts: "3 markers placed"), face-down/hidden glyphs, and scenario secrets (e.g. which Hero is the secret Scout in Under Tempest's Cover). Your own markers stay visible to you. |
| `computeHistory` | Gate on `phase === 'finished'`. Handle: win by elimination, scenario victory conditions, round-limit timeout (points comparison), and the simultaneous-wipeout **draw** (winnerId null / meta). Team scenarios credit a team. |
| `addPlayer`/`removePlayer` | Standard multi-seat registration; stable seats. |
| Random start | Initiative d20 already randomizes per-round order; first DRAFT pick still must be randomized at game start. |
| Abandon/resign/idle | Inherited from the platform; nothing custom. |

## 5. Server-authoritative randomness

All dice are rolled in the server action and passed into the engine
(Long Shot's `rollDiceLS` pattern):

- **d20** — initiative each round; LOS disputes do NOT exist digitally (see §7);
  scenario uses (reinforcements in Winter Holdout: 16+/11+ once per player).
- **Combat dice** — attack skulls vs defense shields. ⚠ The rulebook never
  states the face distribution (see 99-open-questions). Community-standard
  HeroScape dice are 3 skull / 2 shield / 1 blank faces — verify against
  physical dice before coding `rollCombatDice`.
- **Fall damage** — tiered dice by fall height (p.10).

## 6. The hex/elevation model (the new hard part)

HeroQuest gave us square-grid + wall edges. HeroScape needs:

- **Axial hex coordinates** (`q,r`) with the standard 6-neighbor function.
- **Per-hex height** (integer levels from stacked tiles). Movement cost +1 per
  level climbed; climb limit = the figure's Height stat (can't climb a wall
  taller than the figure); descent free; falls beyond thresholds roll damage.
- **Same-level adjacency is not enough for engagement**: elevation difference
  and ruins break engagement (p.12) — adjacency must be computed as
  `hexAdjacent && heightDelta within limit && no ruin between`.
- **Double-space figures** occupy 2 hexes; movement/water/glyph rules special-case
  them (p.11, p.15).
- **Range** counted hex-by-hex along shortest path of spaces, vertical free,
  but **around** gaps in the map (p.13) — i.e. pathfind over existing hexes,
  not straight-line hex distance.

Keep all of this in `board.ts` as pure helpers over `map.cells`
(HQ's `board.ts` precedent), with the engine calling them.

## 7. Line of sight — the one place we deviate deliberately

Tabletop LOS is literally "lean down and look from the attacker's Target Point
to any part of the defender's Hit Zone", with a d20 roll-off to settle table
disputes (p.13). A digital version must replace this with a **deterministic
geometric check** — there are no disputes when geometry is exact, so the d20
dispute rule is dropped (it's a tabletop artifact, not a game rule).

Proposed: 3D ray from attacker eye-point (hex center, `height + figure height`)
to a set of sample points on the target's hit zone; blocked by terrain columns
(`cell.height`) and intervening figures. This mirrors HQ's `hasLineOfSight`
lenient-targeting philosophy: **grazing doesn't block, crossing does**. Document
chosen sample points so behavior is reproducible. (HeroQuest lesson: keep
"reveal vision" and "targeting vision" separate — HeroScape has no fog, so
there is only targeting LOS. See the heroquest-vision skill for the scars.)

## 8. Order markers — hidden info done right

The single most projection-sensitive feature:

- Placement is **simultaneous and secret** (all players, ready-gated, like HQ
  intermission's ready flags).
- `projectStateForViewer` replaces other players' `orderMarkers` arrays with
  `{ count: n }` placeholders. The X decoy must be indistinguishable from 1/2/3
  in projected state — leak the X and you leak strategy.
- On reveal (turn N), the engine moves that marker to a public `revealed` field.
- When a card is destroyed, its unrevealed markers are lost (p.14) — log it,
  but do not reveal what they were (decoy included).

## 9. Player choices — never auto-resolve (rules-fidelity)

Run through `PendingChoice` (Long Shot/Legendary pattern):

- **Leaving-engagement swipes** (p.12) — the swiping player chooses to take it.
- **Glyph effects with options**, scenario glyph pickups.
- **Simultaneous special powers** — roll-off then ordered resolution (p.15-16).
- **Multi-target special attacks** — attacker orders the targets (p.15).
- Squad activations: the player chooses WHICH figures of the card move/attack.

## 10. Content pipeline (the real blocker)

What this rulebook does NOT contain:

1. **The Army Card roster.** Only Agent Carr is shown in full (p.7); Syvarris and
   a Marro stat leak through examples. The master set's cards (stats, point
   values, special-power text) must come from card scans/photos — `content.ts`
   cannot be written without them. **Ask Dan for card photos or the official
   card PDF before engine work on powers begins.**
2. **Battlefield map data.** The build diagrams (pp.18-27) are illegible at scan
   resolution. Options: higher-res scans, or community map formats (VirtualScape
   `.hsc` files exist for all official maps) → write a small importer into
   `maps.ts` format.
3. **Combat die face distribution** — see §5.

## 11. Build order (vertical slices, Long Shot discipline)

The rulebook's own Basic→Master split is the slice plan:

1. **Basic Game, fixed armies, flat-ish demo map.** Hex board renders, figures
   move with correct costs, basic attack/defense, elimination win,
   `computeHistory` gated. Deploy, playtest. (No order markers — basic game
   alternates single turns.)
2. **Master turn engine.** Order markers + projection, d20 initiative, rounds,
   X decoy, marker loss on destruction.
3. **Terrain depth.** Elevation costs, climb limit, falling, water stops,
   engagement + swipes, height advantage, real LOS.
4. **Glyphs + special powers.** Glyph set from p.15; powers as per-card data
   handlers (needs card roster — §10).
5. **Army draft + scenarios.** Point-budget draft UI, scenario special rules
   (round tracks, end-of-round checks, reinforcements, truce, hidden roles),
   team play.
6. **Polish.** Dice animations (HQ kit), elevation shading, sounds, GAME_GUIDES
   lobby entry.

Each slice ships: `npx tsc --noEmit` → `npx vitest run` → `npm run build` →
commit → `npx vercel --prod`.

## 12. Open architecture questions

- Hex rendering: flat-top vs pointy-top SVG, and how to draw elevation
  convincingly in 2D (offset + shadow per level is the cheap, readable option).
- Squad figure selection UX on a phone-width screen.
- Whether `order_markers` phase should have a timer to keep multiplayer games
  moving (platform has 15-min idle auto-end; probably sufficient).
- Map storage: precompute `cells` in `maps.ts` (authored/imported), not runtime
  tile assembly — the digital game doesn't need the physical build steps.
