# HeroQuest Quest Book — internal wiki

Faithful transcription of the user's **Quest Book** (`HeroQuest Quest Book.pdf`, 19 pages:
cover, intro, **14 quests**, a symbol legend, a monster bestiary, back cover). The detailed
per-quest write-ups (parchment, every lettered note, named-monster stats, map summary, and
the new mechanics each quest needs) live in [`_raw-quests.md`](./_raw-quests.md). This file
is the **index + overview + what we must build**.

Rendered images: `C:/Users/Dan/Desktop/hq-render/qb-pages/p-NN.png` (full) and
`qb-halves/p-NN-(top|bot).png` (map / notes at scale 4).

## The 14 quests at a glance

| # | Title | Objective | Named monster(s) | Reward | Wandering | Headline new mechanic |
|---|---|---|---|---|---|---|
| 1 | The Trial | Destroy **Verag** (gargoyle) | Verag; mummy guardian (4 atk) | 84+120 gold in chests | **Orc** | (baseline) |
| 2 | The Rescue of Sir Ragnar | Escort **Sir Ragnar** to the stairs alive | Ragnar (NPC); Ulag | 240 gold | Orc | Escort NPC; "alarm" spawn-all event; chest trap |
| 3 | Lair of the Orc Warlord | Kill **Ulag** | Ulag (10/4/5/2/3) | 180 gold | Orc | Named boss; finder-keeps treasure |
| 4 | Prince Magnus' Gold | Recover **3 chests**, return them | Gulthor (Dread warrior) | 240 gold | **Abomination** | Carriable objects (move penalty); traps appear |
| 5 | Melar's Maze | Find the **Talisman of Lore** | statue-gargoyle | artifact | **Zombie** | Dormant monster; trap-heavy; throne secret door |
| 6 | Legacy of the Orc Warlord | Recover gear, **escape** | **Grak** (8/4/3/3/3, Dread spells) | (gear/artifact) | Abomination | Imprisoned start (no gear/spells); escape win |
| 7 | The Lost Wizard | Discover **Wardoz**'s fate | Wardoz (a zombie); stone Dread warriors | 100 ea | **Mummy** | Per-quest monster mods; cursed potion |
| 8 | The Fire Mage | Kill **Balur** | Balur (8/2/5/3/7, fire-immune, teleports) | 100 ea | Abomination | Spellcaster boss; immunity; summon/teleport |
| 9 | Race Against Time | **Escape** to the stairs | — | (Elixir of Life) | Abomination | Escape; start ≠ stairway |
| 10 | Castle of Mystery | Puzzle; leave on a 2/12 | 2 Dread warriors | fool's gold | none (ghost) | **Teleporting doors** (2d6→numbered square) |
| 11 | Bastion of Dread | **Kill every monster** | Dread warriors | per-kill bounty | Abomination | Clear-dungeon; bounty scales by kind |
| 12 | Barak Tor | Grab **Star of the West**, flee | **Witch Lord** (invulnerable here) | 200 gold | **Skeleton** | Invulnerable boss; false doors; auto falling block |
| 13 | Quest for the Spirit Blade | Find **Spirit Blade**, return | — | artifact | **Dread Warrior** | Rubble field (dice-check falling blocks) |
| 14 | Return to Barak Tor | Kill the **Witch Lord** | Witch Lord (10/5/6/4/6) | Spell Ring; "Champion" | Mummy | Finale; artifact unlocks the kill |

(Named-monster stats are Move/Attack/Defend/Body/Mind. Several named characters use the
**Dread-sorcerer figure** as a placeholder — the bestiary confirms it is *"used as several
different characters (both good and bad) in various quests."*)

## Map symbol legend (Page 33)

Maps are a 26×19 grid. **Maroon = solid rock.** Light cells = rooms/corridors.
- **Monsters** = green discs, one icon per kind (goblin/orc/skeleton/zombie/abomination/
  mummy/Dread warrior).
- **Secret doors** = orange diagonal slash **on a wall edge**.
- **Spear traps** = orange diagonal slash **inside a cell** (looks like a secret door —
  distinguish by wall-vs-cell).
- **Pit traps** = framed-square icon in a cell.
- **Falling-block traps** = red-shaded (hatched) tile. **Blocked / double-blocked squares**
  = red brick tiles.
- **Stairs** = hatched fan/triangle (start/exit).
- **Furniture** icons: table, chest, bookcase, sorcerer's table, alchemist's bench, throne,
  fireplace, cupboard, tomb, rack, weapons rack.

> ⚠ When extracting a quest's exact placements, zoom its `p-NN-top.png` and apply this key
> carefully — secret-door vs spear-trap and pit vs falling-block vs blocked are easy to
> confuse.

## ✅ Quest 1 fidelity — DONE (2026-06-03)

`makeQuest1` now matches the book's content (adapted to our larger board):
- **Orc** wandering monster ✓
- **Mummy guardian of Fellmarg's tomb** rolling **4 Attack dice** (note C) ✓
- Roster = **goblins + orcs** + the mummy + **Verag** the gargoyle ✓
- Chests: **empty** (B), **84 gold** (D), **120 gold** (E) ✓
- **Useless weapons rack** (A) ✓
- Book **parchment** text ✓
- **No traps or secret doors** ✓
- Fellmarg's tomb furniture in the central catacomb beside Verag ✓

Locked by 5 fidelity tests. (Positions are adapted to our board's rooms — faithful content,
not cell-for-cell, per the larger-board house rule.)

## Recurring mechanics we must build to support the 14 quests

Grouped, with the quests that need them:

- **Varied objectives**: kill named boss (1,3,8,11,14); escort NPC (2); recover carriable
  objects (4); find/return artifact (5,13); investigate (7); escape to stairs (6,9);
  grab-and-flee (12); puzzle/leave (10).
- **Named/unique monsters** with custom stats + the Dread-sorcerer placeholder (Verag,
  Ulag, Grak, Balur, Wardoz, Witch Lord, Sir Ragnar). Per-quest **stat modifiers**
  (mummy +1 atk; stone Dread warriors +1 def).
- **NPC allies** (Sir Ragnar): own move/defend, no attack, escorted, win-on-reaching-stairs.
- **Dormant monsters**: immobile + invulnerable until triggered (door-open or chest-search
  ambush) — gargoyle statues (5, 11).
- **Chest/furniture traps** with quest-defined effects (poison needle/gas; −1/−2/−3 BP;
  cursed potion → self-petrify) → ties into engine task #65.
- **Special per-quest tile rules**: teleporting doors (10), false doors (12), auto-trigger
  falling block sealing the exit (12), rubble field with dice-check + helmet mitigation (13).
- **Dynamic events**: the "alarm" that spawns all remaining monsters + opens all doors (2).
- **Artifacts** (objective/reward): Talisman of Lore, Borin's Armor, Wand of Magic, Ring of
  Return, Orc's Bane, Elixir of Life, Wizard's Cloak, Wizard's Staff, Spirit Blade, Spell
  Ring. (Effects are on the **artifact cards** — still needed.)
- **Reward models**: flat gold, divided vs finder-keeps, **per-kill bounty by monster kind**
  (11), artifact, title ("Champion").
- **Start ≠ stairway** and **escape/return** win conditions; multi-quest arc (12→13→14).
- **Dread spells referenced** (9 of 12): Fear, Sleep, Tempest, Ball of Flame, Firestorm,
  Summon Orcs, Escape, Summon Undead, Command. (Effects on the Dread spell cards — needed.)

## Still missing (not in this PDF)

The Quest Book gives quests + the monster bestiary, but **not** the card faces. To finish
the quest layer faithfully we still need: **artifact cards** (10 named above), **Dread spell
cards** (effects), **treasure deck** faces (wandering monsters/hazards split), and the
**equipment/armory** list (Staff, Shield, Helmet, Tool Kit, Potion of Healing, etc.). Plus
the rulebook **page 22** (Ending the Quest / between-quests) still applies to the campaign.

## 🗺️ Board: keep our larger board (intentional — not the printed 26×19)

**Design decision (house rule):** we keep our **larger 32×23 board with bigger rooms and
double-wide hallways**. The printed HeroQuest board's narrow 1-wide corridors and small
rooms create **chokepoints a clever side can exploit**; our wider layout prevents that. So
we do **NOT** rebuild to the book's exact geometry.

**What "fidelity" means here:** faithfully adapt each quest's **content** — monster kinds &
counts, named/unique monsters and their stats, furniture, treasure (gold/artifacts), traps,
secret doors, objective, reward, wandering monster, and the lettered notes — laid out
**sensibly on our board's rooms**, matching the book's room-by-room *design* rather than its
cell coordinates.

**Plan to reach faithful quests:**
1. **Quest 1 (#70):** adapt the book's Quest 1 onto our board — goblins + orcs + the
   4-attack mummy guardian (Fellmarg's tomb) + Verag; the broken weapons rack (A); an empty
   chest (B), an 84-gold chest (D), a 120-gold chest (E); Orc wandering monster; the book
   parchment; no traps/secret doors.
2. **Quest-engine mechanics (#71):** objective/win-condition types, named/unique monsters,
   chest traps, NPC allies, dormant monsters, special tiles, dynamic events — the
   non-card-dependent parts now; artifact/spell/treasure/store bits as the card scans
   arrive (the **Armory** is now in hand — see `../equipment.md`).
