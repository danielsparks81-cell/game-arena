# Dread spell cards (Zargon's 12 spells)

Faithful transcription of the 12 Dread spell cards (photos, 2026-06-03). Dread spells belong
to **Zargon** and are assigned to specific monsters per the quest notes. A monster casts one
**instead of attacking**, only on a hero **it can see** (LOS), **once per quest**, then the
card is discarded.

> ⚠ Several Dread spells **share a name** with a *hero* spell but **target a hero** (the
> hero versions target a monster). Keep them separate: Dread **Tempest/Ball of Flame/Sleep**
> hit heroes; the hero ones hit monsters.

## The recurring "Mind save"
Many control spells (Fear, Sleep, Command, Cloud of Dread) can be broken: the affected hero
rolls **1 red die per Mind Point**, immediately or on a future turn — **a 6 breaks the
spell**.

## The 12 cards

- **Fear** — one hero becomes so fearful they may use **only 1 Attack die**. Mind-save to
  break.
- **Firestorm** — a roomful of fire: **3 Body Points** of damage to **all heroes and
  monsters in the spellcaster's room** (caster unaffected). Each victim rolls **2 red dice**;
  each **5 or 6 reduces** their damage by 1. **Not used in corridors.**
- **Lightning Bolt** — cast **horizontally, vertically, or diagonally**; the bolt travels in
  a straight line until it hits a **wall or closed door**, dealing **2 Body Points** to
  **every hero or monster in its path**.
- **Rust** — destroys any one **metal sword or helmet** permanently (brittle/useless). **Not
  effective against artifacts.**
- **Sleep** — one hero falls into a deep sleep (cannot move/attack/defend). Mind-save to
  break (immediately or later).
- **Summon Orcs** — conjures orcs around the caster. Roll 1 die: **1–3 = 4 orcs · 4–5 = 5
  orcs · 6 = 6 orcs.**
- **Summon Undead** — conjures undead around the caster. Roll 1 die: **1–2 = 4 skeletons ·
  3–4 = 3 skeletons + 2 zombies · 5–6 = 2 zombies + 2 mummies.**
- **Tempest** — a whirlwind envelops **one hero** of choice; that hero **misses their next
  turn**.
- **Ball of Flame** — cast on **one hero**: **2 Body Points** of damage; the hero rolls **2
  red dice**, each **5 or 6 reduces** the damage by 1.
- **Command** — puts one hero under **Zargon's control**. Mind-save to break; **until broken,
  Zargon moves the hero like a monster and may attack other heroes.**
- **Cloud of Dread** — **paralyzes all heroes in the same room or corridor** (cannot move/
  attack/defend). Each victim Mind-saves to free themself.
- **Escape** — the caster **disappears and teleports** to a secret destination known only to
  Zargon, **marked on the quest map** (the "XX"/"X" squares, e.g. Balur in Q8, Witch Lord).

## Implementation notes

- Quest-referenced (so needed first): Fear, Sleep, Tempest, Ball of Flame, Firestorm, Summon
  Orcs, Summon Undead, Command, Escape. **Not referenced in the 14 quests:** Lightning Bolt,
  Rust, Cloud of Dread (the rulebook said some Dread spells are unused early).
- These power the **automated-Zargon magic** layer (named casters Grak/Balur/Witch Lord, per
  the quest notes). Build as a dedicated pass with the Mind-save, summon, AoE, and teleport
  mechanics + tests.
