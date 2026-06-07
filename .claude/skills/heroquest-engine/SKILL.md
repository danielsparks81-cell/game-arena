---
name: heroquest-engine
description: >-
  Canonical reference for the HeroQuest engine in src/lib/games/heroquest/.
  USE THIS whenever you touch combat, movement, Zargon AI, searching, traps,
  doors, regions, the wall-edge system, or any game rule. The engine has many
  non-obvious invariants that have caused real bugs when missed — most notably
  the region/wall-edge system (room boundaries are not wall tiles), party-wide
  vs per-hero search tracking, and the Manhattan-1 + edgeBlocksMove requirement
  for melee adjacency. Read this before editing engine.ts, content.ts, board.ts,
  or any component that calls applyAction.
---

# HeroQuest engine reference

All game logic lives in `src/lib/games/heroquest/engine.ts`. The engine is
**pure and server-authoritative**: `applyAction(state, playerId, action)` takes
the current `HQState`, validates the action, and returns a new `HQState`. The
client sends intent; the server decides. Never trust the client for rule
enforcement.

---

## Key files

| File | Role |
|---|---|
| `engine.ts` | All game rules — the only file that mutates HQState |
| `board.ts` | ASCII-map parser → tile grid + region IDs |
| `content.ts` | Quest definitions, monster stats, hero templates |
| `types.ts` | HQState, Hero, Monster, Tile, Door, Trap, Coord |
| `index.ts` | Public exports (applyAction, hasLineOfSight, …) |

---

## Data model

### HQState (the whole game)

```ts
{
  phase: 'heroes' | 'zargon' | 'finished';
  turnIndex: number;           // index into heroes[] — whose turn it is
  heroes: Hero[];
  monsters: Monster[];
  tiles: HQTile[][];           // [y][x] — the full board grid
  doors: Door[];
  traps: Trap[];
  treasureDeck: TreasureCard[];
  log: LogEntry[];
  lastRoll: DiceRoll | null;
  lastDefenseRoll: DiceRoll | null;
  lastMoveRoll: number[] | null;
  lastSpellFx: SpellFx | null; // drives board animation
}
```

### Hero

```ts
{
  seat: number;           // 0-3, stable for the whole game
  playerId: string;       // Supabase user ID
  class: HeroClass;       // 'barbarian' | 'dwarf' | 'elf' | 'wizard'
  body: number;           // current BP (0 = dead)
  bodyMax: number;
  mind: number;           // current MP
  mindMax: number;
  attack: number;         // attack dice count
  defense: number;        // defense dice count
  move: number;           // base move allowance (unused — heroes roll 2d4+2d6)
  moveLeft: number;       // dice remaining this turn
  at: Coord;
  hasActed: boolean;      // true once the hero's action is used this turn
  spells: Spell[];
  items: Item[];
  searchedRooms: string[];    // region IDs where treasure has been searched (per-hero)
  searchedTraps: string[];    // region IDs searched for traps (party-wide check — see Search)
  searchedSecrets: string[];  // region IDs searched for secret doors (party-wide check)
  inPit: boolean;
  phaseWalls: boolean;    // true while Pass Through Rock spell is active
  attackBonus: number;    // Courage spell bonus dice (cleared after attack)
  potionAtkBonus: number; // Potion of Strength bonus (cleared at turn end)
  defenseBonus: number;   // Rock Skin bonus (cleared at hero's next turn start)
  potionDefBonus: number; // Potion of Defense bonus (cleared on first hit)
  extraAttack: boolean;   // Courage grants one bonus attack after hasActed
}
```

### Monster

```ts
{
  id: string;
  kind: MonsterKind;      // 'goblin' | 'orc' | 'chaos_warrior' | 'gargoyle' | 'zargon'
  at: Coord;
  body: number;
  attack: number;
  defense: number;
  move: number;
  gold: number;
  roomId: string;         // region the monster was spawned from (used for monstersInMyRoom check)
  stunned: boolean;       // Tempest spell — skips next Zargon step
}
```

### Tile

```ts
{
  kind: 'floor' | 'wall' | 'stairs' | 'blocked';
  region: string;     // 'corridor', 'room_0' … 'room_N', or '' for out-of-bounds
  revealed: boolean;
}
```

---

## The region / wall-edge system

**This is the most important non-obvious invariant in the engine.** Get this wrong and monsters walk through walls, heroes attack through walls, and searches break.

### How regions are assigned (board.ts)

- Every corridor tile gets region `'corridor'` — one shared string for ALL corridors.
- Every room tile gets a unique flood-filled region: `'room_0'`, `'room_1'`, … `'room_N'`.
- Stairway tiles join the room they sit in (or `'corridor'` if free-standing).
- Wall tiles outside rooms get `''` (empty string).

### Wall edges (not wall tiles)

Room boundaries are **not wall tiles**. The floor tile at the entrance of a room and the corridor tile just outside it are both passable. The boundary between them is a **wall edge** — detected by `isWallEdge(s, p, q)`:

```ts
function isWallEdge(s, p, q): boolean {
  const rp = regionOf(s, p), rq = regionOf(s, q);
  if (rp === rq) return false;           // same region → open
  return rp.startsWith('room_') || rq.startsWith('room_');
}
```

Two tiles on opposite sides of a room boundary are wall-edge-separated even though both are passable floor tiles.

### edgeBlocksMove — the gate that enforces walls

```ts
function edgeBlocksMove(s, p, q, phaseWalls): boolean {
  if (phaseWalls) return false;
  if (!isWallEdge(s, p, q)) return false;
  const d = doorOnEdge(s, p, q);
  if (d) return d.secret && !d.found ? true : !d.open;
  return true; // solid wall edge — no door
}
```

**Must be called on every orthogonal step** — movement, attacks, trap jumps. Forgetting it lets figures pass through or attack through closed room walls.

### Invariants

- Every orthogonal movement step calls `edgeBlocksMove`.
- Every melee attack (hero→monster AND monster→hero) calls `edgeBlocksMove`.
- `edgeBlocksMove` is only meaningful for **orthogonal** pairs (it checks one shared wall segment). For diagonal pairs it is not defined — diagonal melee is a rare weapon trait and skips the edge check.

---

## Combat

### Hero attacks monster (`doAttack`)

```ts
const orthoAdj = dx + dy === 1 && !edgeBlocksMove(state, hero.at, mon.at, false);
const diagAdj  = allowDiag && dx === 1 && dy === 1;   // special weapon trait only
const adj = orthoAdj || diagAdj;
const ranged = allowRanged && hasLineOfSight(state, hero.at, mon.at);
if (!adj && !ranged) return err('Target is out of reach.');
```

- Melee = **Manhattan 1** AND **no wall edge**. Diagonal melee requires a weapon with `diagonal: true`.
- Ranged = weapon with `ranged: true` AND `hasLineOfSight`.
- Attack roll: `hero.attack + attackBonus + potionAtkBonus − (inPit ? 1 : 0)` dice (min 1). Count skulls.
- Defense roll: `monster.defense` dice. Count shields. Damage = max(0, skulls − shields).

### Monster attacks hero (Zargon AI)

```ts
const mdist = Math.abs(m.at.x - target.at.x) + Math.abs(m.at.y - target.at.y);
if (mdist === 1 && !edgeBlocksMove(s, m.at, target.at, false)) { /* attack */ }
```

Same rules: **Manhattan 1**, **no wall edge**. Monsters cannot attack diagonally. Monsters cannot attack through room-boundary walls.

### Defense bonuses that stack

| Source | Field | Cleared when |
|---|---|---|
| Rock Skin spell | `defenseBonus` | Hero's next turn starts |
| Potion of Defense | `potionDefBonus` | First time hero is hit |

Both stack. `Math.max(1, hero.defense + defenseBonus + potionDefBonus − (inPit ? 1 : 0))`.

---

## Zargon AI (`doZargonStep`)

Each monster acts once per Zargon turn (monsters are stepped one at a time on a timer so each move is visible). Per monster:

1. **Skip if stunned** (Tempest spell). Clear `stunned`.
2. **Find nearest living hero** by Chebyshev distance. Tie-break: lowest BP.
3. **Walk toward target** up to `m.move` steps:
   - Each step: evaluate all 4 orthogonal neighbours. Filter to passable + no-edge-block + unoccupied.
   - Sort by Manhattan distance to target (Chebyshev as tie-break).
   - Take the step that brings the monster closest. If no step available, stop.
   - Loop exits when Manhattan distance to target reaches 1 (attack range).
4. **Attack** if `manhattan(m.at, target.at) === 1 && !edgeBlocksMove(...)`.

**Critical**: the old code used directional fallbacks `[0, dx], [dy, 0]` that could produce steps AWAY from the target when both primary axes were blocked (running-away bug). The current code uses the sorted-neighbours approach, which never increases distance.

---

## Search

### Treasure (`doSearchTreasure`)

- **Per-hero, per-room.** Each hero can search each room once.
- Corridor treasure search is never allowed (`heroInRoom` check in UI).
- Tracks in `hero.searchedRooms` (region ID pushed on success).

### Traps (`doSearchTraps`) and Secret Doors (`doSearchSecrets`)

- **Party-wide, per-region.** Once ANY hero searches a region, no hero can search it again.
- Engine check: `state.heroes.some(h => h.searchedTraps.includes(region))`.
- UI check (greying buttons): `state.heroes.some(h => (h.searchedTraps ?? []).includes(heroRegion))`.
- Tracking stored in individual `hero.searchedTraps` arrays (all corridors share `'corridor'`).
- Blocked while any monster is visible to the searching hero (`monstersVisibleToHero`).

### UI: monstersInMyRoom vs monstersVisibleToHero

- Engine uses `monstersVisibleToHero` (LOS-based — more precise).
- UI uses `monstersInMyRoom` (region-based + `monster.roomId` fallback for wandering monsters that spawned outside the strict region).
- Both are needed: engine is the rule; UI greys the button proactively so `optimisticActed` doesn't freeze the UI on a rejected action.

---

## Turn structure

### Hero turn

1. Roll move (`doRollMove`) — sets `hero.moveLeft`.
2. Move (`doMovePath` / `doMoveTo`) — decrements `moveLeft`, triggers reveal.
3. **One action** (sets `hero.hasActed = true`): attack, search treasure/traps/secrets, open door, cast spell, disarm trap, climb pit.
4. Pass potion (free action — does NOT set `hasActed`).
5. End turn (`doEndTurn`) — clears `attackBonus`, `potionAtkBonus`, `extraAttack`, `phaseWalls`. Advances `turnIndex` to next living hero.

### Zargon turn

`beginZargonTurn` → `doZargonStep` (called once per monster on a timer) → `endZargonTurn` → back to heroes.

`state.phase` cycles: `'heroes'` → `'zargon'` → `'heroes'`.

---

## Wandering monster (treasure draw)

Wandering monster cards in the treasure deck trigger `doWanderingMonster`. Spawn logic:

1. Prefer a same-region adjacent cell.
2. Fall back to any adjacent cell.
3. If all adjacent cells are occupied: BFS outward through passable tiles to find the nearest free cell.
4. Monster spawns and attacks immediately (no movement roll — ambush attack).

`monster.roomId` is always set to the triggering hero's region at spawn time, even if the monster ends up in a different tile (used by `monstersInMyRoom` check in the UI).

---

## Debugging map

| Symptom | Likely cause |
|---|---|
| Monster attacks through a closed room wall | Missing `edgeBlocksMove` in attack check |
| Monster "runs away" or moves in wrong direction | Greedy directional fallback; fix: sorted-neighbours approach |
| Monster permanently stuck diagonally adjacent, never attacks | Attack check used `chebyshev` instead of `manhattan` |
| Search button re-enables after another hero searched same area | UI/engine used `focusHero.searchedTraps` instead of `state.heroes.some(...)` |
| Search button stays disabled in a different region | Region string mismatch — corridors all share `'corridor'`; room tiles use `'room_N'` |
| Hero can walk through a room wall | Missing `edgeBlocksMove` in `findPath` or `walkPath` |
| Spell FX stays on screen | Timer held by React effect cleanup — use `useRef` for the timer, no cleanup return in the main effect |
| Wandering monster spawns on hero's tile | BFS fallback missing; old code fell back to `h.at` directly |
| Board shows pre-attack state after dice animate | Use `boardState` ref pattern: hold visual snapshot during animation, switch to live state after |

---

## See also

- `heroquest-vision` skill — the two vision systems (reveal vs LOS). Read before touching reveal, fog, or spell targeting.
- `game-arena-platform` skill — server-authoritative action dispatch, Supabase realtime, deploy loop.
