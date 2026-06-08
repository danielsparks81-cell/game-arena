---
name: heroquest-vision
description: >-
  The canonical reference for HeroQuest's TWO distinct vision systems —
  "looking & revealing" vs "line of sight" — in src/lib/games/heroquest. USE
  THIS whenever you touch tile reveal/fog, room placement, opening doors,
  movement that uncovers the board, OR target visibility for attacks, ranged
  weapons, and spells. These two mechanics are easy to conflate and every time
  they have been mixed it caused real bugs (revealing whole corridors, seeing
  into unopened rooms, seeing around corners, wasting/over-permitting spell
  targets). Read this BEFORE editing revealLineOfSightForHero, doOpenDoor,
  walkPath, hasLineOfSight, revealVisible, doCastSpell, or doAttack so you keep
  the two systems separate and faithful to the rulebook.
---

# HeroQuest vision: two separate systems

HeroQuest has **two different "vision" mechanics**. They are NOT the same thing
and must never share one implementation. Keep them apart.

| | LOOKING & REVEALING | LINE OF SIGHT |
|---|---|---|
| Whose view? | the **physical player** | the **character** |
| Question it answers | "which tiles get **placed on the board**?" | "can this character **target** that figure?" |
| Used by | fog / reveal as you move + open doors | attacks, **ranged** weapons, **spells** |
| Engine fn | `revealVisible` (reveal loop) | `hasLineOfSight` |

## 1. Looking & revealing (physical-player view)

What the players are allowed to *see and place on the board* as a hero moves.

Rules:
- You **look down a hallway** in a straight, unobstructed line and reveal
  corridor / stairs / blocked-square tiles **until a wall stops the line**.
- You **cannot see through walls**, but **touching a wall corner does not block
  vision** — the same lenient rule as character LOS. `revealVisible` uses `&&`
  (BOTH flanking directions walled) to block a diagonal, not `||` (either).
  A single wall section on one side of a diagonal does not obstruct the line.
- You **never reveal a room's interior by looking.** A room is placed only when:
  - its **door is OPENED** (`doOpenDoor` reveals the room region + spawns its
    monsters/items), or
  - a hero is **standing in it** (reveal the whole room region).
- `revealVisible` also **cannot see through a room** (a room's walls stop the
  line) — looking past a room down a corridor is blocked.
- Reveal is **cumulative**: once a tile is placed it stays revealed. The board
  renders explored = fully visible, unseen = fog. There is **no torch-dimming**.

Where it lives:
- `revealLineOfSightForHero(s, h)` — reveals the hero's own room + hallway cells
  in `revealVisible`. Skips room cells. Calls `spawnRevealedRooms`.
- `walkPath` calls it at **each square** of a move and **stops** the hero the
  moment a new room comes into view (its monsters are placed) or a trap springs
  — that's how "looking" interrupts movement.
- `doOpenDoor` reveals the room(s) the door connects to.

## 2. Line of sight (character view)

Whether a character can **target** a figure for an attack / ranged weapon /
spell.

Rule of thumb (rulebook): draw a straight line from the **centre of the
caster's square** to the **centre of the target's square**. The target is
visible unless the line **crosses** a **wall, closed door, hero, or monster**.
**Grazing a corner or wall edge does NOT block** — only crossing does.

Implementation: `hasLineOfSight(s, a, b)`.
- Diagonal steps are blocked only if **BOTH** corner edges are walls (this is
  the "touching a corner is still visible" rule — do NOT make it strict like
  `revealVisible`).
- Intermediate cells block on rock / blocked / LOS-furniture / **any figure**
  (`cellOccupied`). The endpoint (the target) is not an intermediate, so a
  target figure never blocks itself.
- Open doors are see-through; closed doors block.

Must be enforced for:
- **Ranged attack** — `doAttack` allows a non-adjacent strike only when
  `allowRanged && hasLineOfSight(...)`.
- **Spells** — `doCastSpell` has a single LOS gate near the top: a `'monster'`
  target or **another-hero** target must pass `hasLineOfSight`; **self-casts**
  and `'area'` spells need none. A cast with no line of sight is **still spent**
  (the card is discarded for the quest) but the effect is **wasted** — return
  `ok(s)` with a log line, do not `err`.

## Invariants — do not break these

1. **Never use `hasLineOfSight` for reveal**, and never use `revealVisible` for
   targeting. Both use the same lenient diagonal rule (`&&`) now, but they differ
   in what they block on intermediate cells (figures block LOS but not reveal).
2. **Looking never reveals a room interior.** Rooms enter play via doors / being
   stood in — `doOpenDoor` / the room-region reveal in `revealLineOfSightForHero`.
3. **Rooms are protected by two guards, not the diagonal edge rule.** (1) The
   outer loop in `revealLineOfSightForHero` skips room tiles — they can never be
   revealed by `revealVisible`. (2) The intermediate-cell check inside
   `revealVisible` stops any path that crosses through a room region. A diagonal
   "leak" into an unopened room is a broken room guard, not a diagonal rule issue.
4. **Reveal is cumulative and explored stays fully visible.** Don't reintroduce
   a per-turn "dim/un-dim" of explored tiles.
5. **Every targeted attack/spell checks LOS in the engine** (server-authoritative),
   not just the UI. Self/area spells are exempt.
6. Both functions are pure over `HQState`; keep them deterministic (no
   `Math.random`, no `Date`).

## Quick debugging map

- "Whole corridor network lit up" → reveal flood-revealed the shared `'corridor'`
  region. Only flood-reveal **room** regions; corridors reveal per-cell via
  `revealVisible`.
- "Seeing into an unopened room" → reveal loop didn't skip `room_*` cells, or a
  spell/UI used reveal where it should use door-open.
- "Random/scattered hallway cells lit far from any hero" → reveal called
  `hasLineOfSight` instead of `revealVisible` (figures don't block reveal, but
  figures DO block LOS — mixing the two reveals too much).
- "Spell hit a target through a wall" / "ranged through a hero" → missing
  `hasLineOfSight` gate in `doCastSpell` / `doAttack`.
- "Can't target an adjacent monster in melee" → melee needs **adjacency**, not
  LOS; don't gate melee on `hasLineOfSight`.
