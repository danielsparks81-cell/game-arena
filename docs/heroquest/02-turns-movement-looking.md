# 2. Turn structure, movement & looking

*Rulebook pages 9–12, 20. The single most important section for engine fidelity.*

## Order of play (p11)

- Play starts with the hero seated **to Zargon's left** and proceeds **clockwise**.
- After **all heroes** have taken their turns, it is **Zargon's turn** (he may move every
  monster on the board — see [section 6](./06-zargon-monsters-defeat.md)).
- Repeat until the quest is **won** or the **heroes leave** the underworld. ✓

## On a hero's turn — the move/action rule ★ (p11, p20)

A hero (and likewise each monster) does **one** of:

- **Move, then perform an action**, or
- **Perform an action, then move.**

> ★ **You may NOT move part of your movement, act, and then move the rest.** No splitting
> movement around the action. ✓ Enforced by `markActed()` in the engine (once you act,
> any unused movement is forfeited unless you hadn't moved yet).

- **Exactly one action per turn** (p10). The action is **optional** — you may move only,
  or act only.
- Movement itself need not be used in full (see below).

### The six actions (one per turn) (p11)

1. **Attack** — [section 3](./03-combat-line-of-sight.md)
2. **Cast a spell** — [section 4](./04-actions-search-spells-treasure.md)
3. **Search for treasure** — section 4
4. **Search for secret doors** — section 4
5. **Search for traps** — [section 5](./05-traps.md)
6. **Disarm a trap** — section 5

### Free, non-action things (any time on your turn) (p12, p16)

These do **not** consume your action: **looking**, **opening a door**, **drinking a
potion** (any number), **picking things up / handing items to an ally**, and **getting
caught in / springing a trap**. ✓ Looking & opening doors are free in our engine.

## Movement rules (p11–12) ★

- 🎲 Distance = **roll 3d4** (house rule; printed game rolls 2 red d6). Move **square by
  square**. You do **not** have to move the full rolled distance. ✓
- **No diagonal movement.** ✓
- **Cannot move through walls** or **blocked-square tiles** (extra walls). ✓
- **Cannot pass over / through monsters.** ✓
- **May pass over other heroes** (but may not *end* on a shared square). ✓ `findPath`
  routes through friendly heroes; `walkPath` snaps off a shared final square.
- **May only enter a room through a door** (or a revealed secret door). ✓
- **May not share a square** with a hero or monster, **except** when **on the stairs** or
  **in a pit trap**. ✓
- Corridors are 1–2 squares wide; rooms are bounded by walls. (Cosmetic.)

### Note on monster movement (p20)

Monsters move under the **same move/act-or-act/move, no-split** rule, but their movement
is a **fixed maximum** from the monster chart (they never roll). They additionally may
**not** pass over heroes, move through walls, open/close doors, or share a square. ✓ See
[section 6](./06-zargon-monsters-defeat.md).

## Looking & revealing (p9, p12) — the "physical player" view

This is the **reveal/fog** mechanic. It is *not* one of the six actions.

- While moving, a hero may **look down a corridor or through an open door**.
- Looking reveals what is **directly in the hero's line of sight**: closed doors,
  blocked-square tiles, monsters, furniture.
- **If the sight line passes through a wall or a closed door, nothing beyond is visible.**
- **You never see into an unopened room.** A room's interior is placed on the board only
  when its **door is opened** (or a hero is standing in it).
- Reveal is **cumulative** — once placed, tiles stay visible (explored = visible, unseen =
  fog; there is **no torch-dimming**).
- ✓ Implemented as `revealVisible` / `revealLineOfSightForHero`. During a move, `walkPath`
  reveals at **each square** and **stops the hero** the instant a **new room** comes into
  view or a **trap** springs.

> 📐 **Design refinement (intentional):** the rulebook uses a **single** line-of-sight
> "rule of thumb" for both looking and targeting (lenient: grazing a corner does not
> block — see [section 3](./03-combat-line-of-sight.md)). We deliberately use a **stricter
> diagonal rule for *revealing*** (a diagonal is blocked if **either** corner edge is a
> wall) so the fog doesn't "leak around corners" and reveal stray hallway cells, while
> keeping the rulebook's **lenient** rule for **targeting** spells/attacks. This matches
> the user's request to treat *looking* from the physical player's perspective and *line
> of sight* from the character's perspective. Full detail in the **heroquest-vision**
> skill. (Open question Q7 asks whether to keep this split.)

## Opening doors (p12)

- All doors **start closed**; once opened, a door **can never be closed again**. ✓
- Opening is free: move **adjacent** to a closed door and open it. Opening **reveals the
  room behind it** — place its monsters, treasure chests, and items. ✓ `doOpenDoor`.
- Secret doors are invisible to looking and are revealed only by **searching** (section 4).
