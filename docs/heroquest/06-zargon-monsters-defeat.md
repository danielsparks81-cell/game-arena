# 6. Zargon's turn, monsters & defeat

*Rulebook pages 20–22 (page 22 is **outside this PDF** — see gaps below).*

## Zargon's turn (p20)

- Comes **after all four heroes** have acted. Zargon may move **every monster** on the
  board on this single turn. ✓
- Each monster follows the **move-then-act OR act-then-move, no-split** rule (same as
  heroes). ✓
- **Monsters do not roll for movement.** Each monster has a **fixed maximum movement**
  from the monster chart; it need not move the full distance. ✓

### Monsters may NOT (p20) ◑

- Search for treasure or secret doors.
- **Move or attack diagonally.** ✓
- **Pass over heroes.** ◑ Confirm monster pathing forbids passing heroes (heroes may pass
  heroes, but monsters may **not** pass heroes).
- Move through walls / blocked squares. ✓
- **Open or close doors.** ✓ → monsters are effectively **contained** behind closed doors
  until a hero opens them. (Important for automated Zargon.)
- Share a square. ✓
- They also never spring, search for, or disarm traps. ✓

## Monster actions

A monster may take **one** action: **Attack** or **Cast a Dread spell**.

### Monster attack (p20) ✓

- Attack an **adjacent** hero (orthogonal), **once per turn**; innate attack strength.
- Roll the monster's Attack dice; no skulls = failed attack; the hero defends (white
  shields).

### Cast a Dread spell (p21) ◑

- Zargon may cast a **Dread spell** instead of having a monster attack. Dread spells are
  assigned to **specific monsters** per the **quest notes**. A monster may only cast on a
  hero **it can see** (line of sight). **Once per quest**, then discarded.
- Several Dread spells are unused in the first 14 quests (reserved for later / custom
  quests).
- ❓ The 12 Dread spell faces are not in this PDF; needed for the Zargon magic layer.

## The monster chart ✓ (`MONSTER_STATS`)

Our values (Move / Attack / Defend / Body / Mind). The chart on the GM screen isn't in
this PDF, but these are the standard values and match the contents roster:

| Monster | Move | Attack | Defend | Body | Mind |
|---|---|---|---|---|---|
| Goblin | 10 | 2 | 1 | 1 | 1 |
| Orc | 8 | 3 | 2 | 1 | 2 |
| Skeleton | 6 | 2 | 2 | 1 | 0 |
| Zombie | 5 | 2 | 3 | 1 | 0 |
| **Abomination** | 6 | 3 | 3 | 2 | 3 |
| Mummy | 4 | 3 | 4 | 2 | 0 |
| **Dread Warrior** | 4 | 4 | 4 | 3 | 3 |
| Gargoyle | 6 | 4 | 5 | 3 | 4 |

- The **Dread Sorcerer** (1 in the box) is **not** a base-stat monster. Per the user it's
  used almost exclusively as a **unique, per-quest named character** (like Verag) with
  stats defined in that quest's notes — so it belongs in **quest data**, not
  `MONSTER_STATS`. Model it the way we model Verag (a named instance with custom stats +
  its own art/token).
- **Verag** (Quest 1's boss) is a **named gargoyle**. ✓ Spawned via quest notes.

## How a hero defends / dies (p21)

- Hero defends with **2 dice** (white shields). Damage = attacker skulls − blocked hits.
- A hero at **0 Body Points is dead** unless saved.

### Escaping death (p21) ◑

At 0 BP a hero may save themselves **two** ways:
1. **Immediately drink a life-restoring potion** (e.g., a healing potion) — potions are
   usable at any time.
2. If a **spellcaster with a healing spell who has not yet acted** this turn, cast it on
   themselves.

◑ This "death save" isn't implemented; relevant for the campaign layer.

### A dead hero (p21)

- Out for the **rest of that quest**. May **rename and return as a new character** next
  quest (campaign).
- Possessions are picked up by another hero **in the same room/corridor**; if the hero
  **dies alone**, a monster there **claims** them (removed from the game, unusable).
- ◑ Roadmap (campaign / item handling).

## Gaps not in this PDF (page 22 +) ❓

- **"What happens if you run out of monsters?"** — the rule for when Zargon has no
  monsters left on the board.
- **Ending the Quest** — winning condition recap, what happens **between quests**, **lost
  artifacts**, and **unfinished quests**.
- These are required for **campaign**, **store-between-quests**, and **automated Zargon**
  end-of-quest handling. Need the page-22 scan (or we design house rules and mark them).
