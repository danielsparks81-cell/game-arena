# 1. Components, setup & heroes

*Rulebook pages 4–8. See also [`_raw-transcription.md`](./_raw-transcription.md).*

## Players & roles

- **2–5 players.** One player is always **Zargon** (the evil sorcerer / Game Master);
  the rest are the **heroes**.
- The four heroes are the **Barbarian, Dwarf, Elf, Wizard**.
- With **fewer than 5 players**, hero players control **more than one hero**. Quests are
  **harder with fewer than 4 heroes**. ◑ Our build always fields 4 heroes (seats can be
  shared); fine.
- Zargon is the GM: sits behind the screen, controls all monsters/traps, alone reads the
  Quest Book. In our digital version Zargon is **automated** (no human GM by default).
  ❓ Automated Zargon is on the roadmap — this wiki is what it must obey.

## Components (printed game)

- 1 gameboard.
- **31 monster miniatures**: 8 orcs, 6 goblins, **3 abominations**, **4 Dread warriors**,
  **1 Dread sorcerer**, **1 gargoyle**, 4 skeletons, 2 zombies, 2 mummies. ✓ Matches our
  `MONSTER_STATS` kinds after the rename (`abomination`, `dread_warrior`). The **Dread
  sorcerer** is a distinct spellcasting monster we may still need to add (see open
  questions).
- 4 hero miniatures.
- **15 furniture pieces**: 2 tables, throne, alchemist's bench, 3 treasure chests, tomb,
  sorcerer's table, 2 bookcases, rack, fireplace, weapons rack, cupboard.
- 10 skull pieces (track damage on multi-hit monsters), 4 plastic rats.
- 21 dungeon doors (5 closed, 16 open).
- **97 cards**: 24 treasure, 23 equipment, 14 artifact, 12 Dread spell, 12 spell,
  8 monster, 4 turn-order.
- Cardboard tiles: stairs, blocked squares, secret doors, pit traps, falling-block traps,
  skulls.
- Quest Book, 4 character cards, GM screen, character-sheet pad.
- **6 white combat dice** (skull/shield dice) + **2 red dice** (movement). 🎲 We replace
  the 2 red movement dice with **3d4**.

## Hero stats ✓ (all faithful in `HERO_DEFAULTS`)

| Hero | Attack | Defend | Body | Mind | Starting weapon | Special |
|---|---|---|---|---|---|---|
| **Barbarian** | 3 | 2 | **8** | **2** | Broadsword | Strongest fighter; **no spells** |
| **Dwarf** | 2 | 2 | 7 | 3 | Shortsword | **Disarms traps without a tool kit** |
| **Elf** | 2 | 2 | 6 | 4 | Shortsword | Good fighter **+ 1 spell group (3 spells)** |
| **Wizard** | 1 | 2 | **4** | **6** | Dagger (+ staff) | **3 spell groups (9 spells)**; no heavy armor/large weapons |

- **Body Points** = physical strength / health (you die at 0). **Mind Points** = wisdom,
  intelligence, and **resistance to magic**.
- Attack/Defend dice are how many **white combat dice** you roll to attack/defend; they
  change with weapons, armor, spells, and being in a pit.
- All heroes **defend with 2 dice** by default (p21).
- Body/Mind/treasure/gold are tracked on the character sheet and **persist between
  quests** (campaign). ◑ Persistence across quests is roadmap.

## Setup sequence (Zargon, pages 5–8)

The printed game lists 10 setup steps; the ones that matter for our digital build:

1. **Read Quest 1 "The Trial" first** (must be the first quest). Each quest has three
   parts: **parchment text** (read aloud to players), **quest map** (secret), **quest
   notes** (secret, revealed as play unfolds).
2. Place the gameboard; spread the 4 character cards; players fill character sheets with
   starting Body/Mind (may name their hero).
3. Separate pieces; **only place the starting room's pieces** (usually the stairway
   room). ⚠ **Do not pre-place traps, secret doors, or treasure** — reveal only as heroes
   look/move. ✓ Our reveal engine enforces this.
4. Card setup: shuffle treasure facedown; artifacts & Dread spells behind the screen;
   8 monster cards faceup for reference. Sort spells into the 4 element groups.
5. **Spell distribution** (see below).
6. Place dice within reach.

## Spell distribution (pages 7–8) ◑

- Hero spells come in **4 element groups** (Air, Fire, Water, Earth), **3 spells each**
  (12 total).
- **Division order:** the **Wizard chooses one group first**, then the **Elf chooses one**
  of the remaining three, then the **last two groups go to the Wizard**. → Wizard ends
  with **3 groups (9 spells)**, Elf with **1 group (3 spells)**.
- **First-quest suggestion:** Wizard takes **Fire**, Elf takes **Earth**, and the
  remaining **Air + Water** go to the Wizard.
- The **12 Dread spells** belong to Zargon (assigned to specific monsters per quest
  notes). Several Dread spells are unused in the first 14 quests.
- ❓ We need the actual spell card faces (names + effects) — not in this PDF.

## The armory (between quests) ◑

- Heroes earn **gold** during quests; **between quests** they spend it at the **armory**
  (the equipment deck) on weapons & armor. **Unlimited stock**, buy any number.
- Gold can be **shared** between heroes. Tracked on the character sheet.
- ❓ Store-between-quests is roadmap; needs the equipment card list.
