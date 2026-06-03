# 5. Traps (Actions 5–6)

*Rulebook pages 16–19. **Status:** pit / spear / falling-block spring effects, the in-pit
penalty, faithful disarm odds, and trap-jumping are all **shipped** (2026-06-03). Still
pending: **chest/furniture traps** (need quest-notes data). See
[open questions](./99-open-questions.md).*

## General trap rules

- **Four kinds:** **pit trap**, **falling-block trap**, **spear trap**, **chest/furniture
  trap**. Locations are marked in **gold** on the quest map (only Zargon knows them).
- Traps exist in **both rooms and corridors**.
- **Monsters never spring hidden traps** (only heroes do) — so monsters never search or
  disarm. ✓
- You **cannot search a room's traps by looking through its door** — you must be **inside
  the room**. The **first hero to enter** a room may step on a trap placed just inside the
  door. ◑
- A trap found by **searching** is *not* placed on the board (it stays concealed/unsprung)
  — Zargon just **points it out**. A discovered, unsprung trap can be **jumped** or
  **disarmed** (Action 6). Stepping onto an **undiscovered** trap **auto-springs** it. ◑

## Action 5: Search for traps (p16) ◑

- Allowed **only if no monsters are visible** to you.
- Declare the search; Zargon names the trapped squares but **places no tiles** (still
  concealed & unsprung). ✓ `doSearchTraps` reveals traps in the area.

## The four trap types (exact effects) ⚠

| Trap | Spring effect | After springing | Jump? | Disarm? |
|---|---|---|---|---|
| **Pit** | **−1 Body Point**, **turn ends**; pit tile placed under the figure (hero is now *in* the pit) | Tile stays; square is a pit | ✅ yes | ✅ if unsprung |
| **Falling block** | Roll **3 combat dice**, **−1 BP per skull** (0–3), **no defend roll**; then move ahead or back | Square is **permanently blocked** (a wall, forever — you can be cut off) | ❌ once sprung | ✅ if unsprung |
| **Spear** | Roll **1 combat die**: **shield = dodge** (no damage, **continue moving**); **skull = hit** (damage, turn ends). One-time. | **No tile** — square is safe afterward | ✅ if unsprung | ✅ if unsprung |
| **Chest/furniture** | Effect per **quest notes** (poison gas, poison needle, explosive latch, shooting dart, …); **turn ends** | — | n/a | ✅ if unsprung |

> ✓ **Implemented** in `walkPath` / `doJumpTrap` (2026-06-03): pit (−1 BP + enter pit),
> spear (1-die dodge), falling block (3-dice damage **and** a permanent `blocked` wall +
> bounce-back), and the in-pit −1 combat die. Chest/furniture traps are the remaining
> kind (quest-notes-driven — pending).

### In a pit (p17) ✓

- While in a pit you may **search it** (treasure / secret doors) as if it were its own
  room; you may **attack and defend** but roll **one fewer combat die** (this applies to
  monsters in pits too), with a **minimum of 1 die**. You **climb out** on a later turn.
  ✓ `inPit` + `climb_pit` + the **−1-die penalty** are implemented (climbing costs 2
  movement — a house value; the rulebook just says "next turn").

## Jumping a trap (p19) ✓ (`doJumpTrap`)

If a trap blocks your path you may try to jump over it:

- You need **≥ 2 squares of movement remaining** and an **unoccupied landing square** on
  the far side. (A pit can have up to **3** possible landings; a **corner pit only 1**.)
- Roll **1 combat die**: **anything but a skull (a shield) = success** — you clear the
  trap, **spending 2 squares** of movement, and may continue if movement remains. A
  **skull = you spring** the trap (take its damage, end on the square as applicable, turn
  ends).
- A sprung **pit can** still be jumped; a sprung **falling-block cannot**.
- If the only landing is occupied by a monster and you lack special gear, you must fall
  into the pit and fight from inside (at a disadvantage). Monsters with enough movement
  always clear pits and take no damage when entering voluntarily.

## Action 6: Disarm a trap (p19–20) ⚠

To disarm an **unsprung** trap you must **know its location** and either possess a **tool
kit** (bought at the armory) **or be the Dwarf**.

- **Non-dwarf (with tool kit):** before moving, announce you're moving onto the trap
  square to disarm. **Move onto the trap square** and roll **1 combat die**:
  **skull = springs it** (take damage); **black or white shield = disarmed** (trap removed,
  never placed). → success on a shield = **3-in-6 (50%)**.
- **Dwarf (no kit):** same announce + move onto the square + roll **1 die**, but
  **black shield = sprung**; **anything else (white shield *or* skull) = disarmed**. →
  success = **5-in-6 (~83%)**.
- A **disarmed** trap is gone and not placed on the board; a disarmed **pit** becomes a
  normal square.

> ✓ **Implemented** (2026-06-03): faithful **odds** (Dwarf springs only on a black shield
> ~83%; others need a Tool Kit and fail on a skull, ~50%) and the **tool-kit / Dwarf
> requirement**. ◑ Remaining nuance: we disarm from an **adjacent** square rather than by
> **moving onto** the trap square — a positional refinement deferred (low impact).
