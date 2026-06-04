# Quest placement ruleset (DRAFT — iterating on Quest 1)

How a Quest Book quest gets laid out on our **locked board** (the 32×23 layout
with wider halls + larger rooms). The goal: one repeatable set of rules we tune
on Quest 1, then apply to all 14 so every quest places consistently.

## The locked board

9 rooms in a 3×3 grid (the right third is solid rock). Labels:

```
   TL    TC    TR
   ML    C     MR        C = the big central chamber
   BL*   BC    BR        BL* = entrance room, holds the staircase
```

- **Stairway** lives in the upper-left corner of **BL**. It occupies 4 squares
  but is **one space**: moving from any stair square to an adjacent floor square
  costs **1** movement (engine rule — pending). Heroes start on the staircase.
- Each room connects to the central halls by **one door** (auto-placed on the
  hall-facing side). Halls are 2 squares wide to avoid chokepoints.

## Placement rules (v0 — please correct)

1. **Start / exit.** Heroes start on the staircase (BL). The staircase is also
   the exit. For an *escape* quest where the book starts the party away from the
   exit, mark a **START** room (e.g. a far corner) and keep the staircase as the
   exit only.

2. **Objective.** The quest objective (boss to kill, NPC to rescue, artifact to
   grab) goes in the room the book places it relative to the entrance, mapped to
   our nearest equivalent. Default for a "far chamber" objective → **C** or the
   far corner (**TR / MR**).

3. **Monster roster.** Keep the book's monster **types and total counts**.
   Distribute **1–2 per room**, weighted heavier toward the objective room and
   the rooms between it and the entrance. (Our rooms are larger, so a couple of
   monsters per room reads right without becoming a pile-up.)

4. **Furniture.** Placed in the room its lettered note references. Against-wall
   pieces (chest, tomb, weapon rack, bookcase, cupboard) sit on a room **edge**;
   center pieces (table, throne, sorcerer's table) sit mid-room. A "first hero to
   search finds X" stays attached to that piece.

5. **Treasure chests / gold.** In the noted room, against a wall. Trap chests
   (poison needle/gas) keep their effect; the gold/▣ stays as the chest content.

6. **Traps.** Spear/pit/falling-block placed per the book's density — in halls
   and on room thresholds along the likely path. Quests with "many traps" get
   more; Quest 1 has none.

7. **Rock.** The right third is rock for every quest by default. If a quest needs
   a different playable footprint we adjust that quest's rock — but the room grid
   never moves.

## Locked decisions

- **Stairway: relocate per quest.** Each quest's staircase is placed in the room
  matching the book's printed start corner (TL/TC/TR/ML/C/MR/BL/BC/BR). Escape
  quests keep the staircase as the exit and add a separate START marker.
- **Monsters: the book's exact counts/types.** Even if that clusters several
  monsters into one of our (larger) rooms.
- **Objective room: mapped per quest** from the book's relative position (my
  judgment), e.g. a "far chamber" → the central chamber or a far corner.

## Status

- **Quest 1 — The Trial:** placement locked (matches the live game).
- **Quests 2–14:** ruleset applied — per-quest stairway relocation + the monster
  rosters from my Quest Book reading. Shown as DRAFT until the monster/furniture
  ROOMS are verified against a physical copy (my extracted counts are best-effort
  and the central-chamber vs far-corner objective mapping may want tweaks).
