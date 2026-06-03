# HeroQuest — Structured Rules Reference

> Notes for digital adaptation. Mechanics summarized in our own words from the 1989 / 2021 reissue rulebook scan. Not a reproduction.

---

## 1. Heroes

Four hero classes. Each has a Body Points (BP) pool (physical health) and Mind Points (MP) pool (mental resistance / magic resistance). Damage reduces BP; reaching 0 BP kills the hero. Heroes always roll **2d6** for movement on their turn (with the option not to move at all).

| Hero | Body Pts | Mind Pts | Attack Dice | Defense Dice | Move | Starting Equipment | Special |
|---|---|---|---|---|---|---|---|
| Barbarian | (see card) | (see card) | 3 | 2 | 2d6 | Broadsword | Cannot cast spells; strongest melee attacker |
| Dwarf | (see card) | (see card) | 2 | 2 | 2d6 | Short sword | Disarms traps without a tool kit; cannot wield the longest two-handed weapons (e.g. battle axe, broadsword) |
| Elf | (see card) | (see card) | 2 | 2 | 2d6 | Short sword | Casts spells: receives 1 of the 4 elemental spell groups |
| Wizard | (see card) | (see card) | 1 | 2 | 2d6 | Dagger, staff | Casts spells: receives 3 of the 4 elemental spell groups (the remaining group goes to the Elf); restricted from heavy weapons/armor |

**Notes**
- Exact starting BP / MP printed on the physical character cards (not visible on rulebook pages scanned). Community-standard values: Barbarian 8/2, Dwarf 7/3, Elf 6/4, Wizard 4/6 — verify against the character cards before coding.
- Movement is always 2d6 for heroes (no class modifier); some quests override this (e.g. carrying a treasure chest = 1d6).
- Heroes may move-then-act OR act-then-move on their turn. They may not split movement around an action.
- Heroes may carry items between quests; gold accumulates between quests and can be spent in the armory.

---

## 2. Combat Dice

Custom 6-sided die. Each face shows one of three symbols. Standard distribution (printed on the dice supplied with the game):

| Face | Count on die | Meaning |
|---|---|---|
| Skull | 3 | Hit (attacker) — 1 BP of damage if unblocked |
| White shield | 2 | Hero block — only heroes can use these for defense |
| Black shield | 1 | Monster block — only monsters can use these for defense |

**Resolution**
1. Attacker rolls Attack Dice equal to their weapon's value. Count skulls.
2. Defender rolls Defense Dice equal to their stat. Heroes count white shields. Monsters count black shields.
3. Damage = (attacker skulls) − (defender's matching shields), minimum 0.
4. Subtract damage from defender's Body Points. At 0 BP a monster is removed; at 0 BP a hero dies (see Dead Heroes).

Attackers must be adjacent (orthogonal) unless the weapon explicitly allows diagonal attack (some long weapons), or unless a ranged weapon / spell allows distance.

---

## 3. Movement & Action

### Turn structure (hero)
On a hero's turn, in any order: **Move then Action**, **Action then Move**, or move only / act only. May not split a single move around an action.

### Movement
- Roll 2d6. May move up to that many squares; may also choose to move zero.
- One square per square spent. Orthogonal only — **no diagonal movement**.
- Cannot end movement on a square occupied by another figure. Cannot pass through monsters. May pass through other heroes but cannot stop on them.
- Cannot move through closed doors, blocked squares, or furniture (some thin furniture allows movement but blocks line of sight).
- Opening a door does not cost movement points, but the hero must be adjacent to the doorway. Opening a door reveals the room; Zargon places monsters / furniture / treasure as listed in the Quest Book.

### The six actions (one per turn)
1. **Attack** — make one weapon attack on an adjacent enemy (or at range if weapon allows).
2. **Cast a spell** — Wizard / Elf only.
3. **Search for treasure** — only while in a room, only if no monsters are visible to the hero, once per hero per room.
4. **Search for secret doors** — only in a room or corridor with no visible monsters.
5. **Search for traps** — only in a room or corridor with no visible monsters.
6. **Disarm a trap** — requires a tool kit unless the hero is the Dwarf. Must be adjacent to the trap.

### Diagonal & line-of-sight rules
- Most weapons attack only orthogonally adjacent enemies. Long weapons (e.g. spear, broadsword) may attack diagonally adjacent enemies in some cases — check weapon card.
- Line of sight: draw an imaginary straight line from center of the attacker's square to the center of the target's square. If that line is not crossed by a wall, closed door, blocked square, or another figure, the target is visible.
- A figure blocks line of sight through its square.
- Doors block LOS when closed; once opened, you can see through the doorway.

---

## 4. Search Rules

Searches are an action. The searching hero declares the room/corridor area being searched. The Zargon player resolves.

### Treasure
- **Only in rooms** (not corridors).
- Only when no monsters are visible to the searching hero.
- **Each hero may search a given room only once for treasure** (across the whole quest).
- Some rooms have a quest-specified treasure listed in the Quest Book — that overrides the deck for the first hero who searches.
- Otherwise: draw the top card from the Treasure deck and resolve it (gold, gem, potion, hazard, or wandering monster).
- A trap revealed by a treasure search affects the searching hero immediately.

**Treasure deck composition (24 cards in this edition):**
- Gold coin cards (varying amounts)
- Gem cards
- Potion cards (e.g. Heroic Brew, Holy Water — exact list on the cards)
- Hazard cards (e.g. you stumble, lose 1 BP)
- Wandering Monster cards — Zargon spawns the quest's listed wandering monster type adjacent to the searcher
- Cards that are NOT gold / gem / potion are typically returned to the deck after use; gold / gems / potions are removed and kept

### Traps
- Action: declare "search for traps" — covers the current room or a section of corridor in line of sight.
- Zargon must reveal any unsprung traps in the area.
- Trap types: **Pit trap**, **Spear trap** (single-square one-shot), **Falling-block trap** (multi-square permanent block when sprung), **Chest / furniture trap** (triggered when searching a specific piece).
- Traps may be disarmed (action) from an adjacent square; if you fail (or step on one undetected), the trap triggers:
  - Pit: lose 1 BP, you are in the pit (cannot attack/defend normally until you climb out — costs movement next turn).
  - Spear: lose 1 BP, then the trap is spent.
  - Falling block: lose 1 BP unless you successfully jump; square is permanently blocked.
  - Chest / furniture: as specified per trap card (often lose 1–3 BP or poison effect).
- Jumping a known pit / falling-block square: spend 2 movement squares to cross; must have a free square on the far side to land.
- Disarming a falling-block requires the Dwarf or a tool kit, plus a successful roll (1 combat die — skull fails).
- The Dwarf disarms traps without a tool kit and on a more forgiving roll (still fails on black-shield result).

### Secret Doors
- Action: search the current room or corridor.
- Zargon reveals any secret-door tiles in the area; place the secret-door tile on the gameboard.
- Once revealed, treat as a normal door.

---

## 5. Spells

Spells are organized into four elemental groups of 3 spells each (12 spells total in the base game). At the start of a quest the Wizard chooses 3 of the 4 groups; the Elf gets the remaining group.

- **Wizard:** 9 spells (3 groups × 3).
- **Elf:** 3 spells (1 group × 3).
- Each spell is one-shot: discard after casting; recovered between quests.

| Group | Spells (name → effect, 1 line each) |
|---|---|
| **Air** | Genie — caster's choice: attack a monster for 1 BP, open a door, or move caster; Tempest — chosen monster skips its next turn; Swift Wind — target hero gets +bonus movement that turn (re-roll / extra squares) |
| **Water** | Veil of Mist — caster teleports to any other hero's square; Heal Body — restore Body Points to target (likely 4 BP); Water of Healing — restore some BP (likely 2 BP) |
| **Fire** | Ball of Flame — ranged 2-die attack on any target in LOS; Courage — target hero rolls 2 extra attack dice on next attack; Fire of Wrath — adjacent target takes 1 BP (no defense) |
| **Earth** | Pass Through Rock — caster moves through walls this turn; Heal Body — restore Body Points (Earth has a healing too); Rock Skin — target hero rolls 2 extra defense dice on their next defense |

> Exact effects and dice values are printed on the spell cards. Treat the table above as the structural list; verify per-spell numbers against the physical cards before coding.

**Dread (sorcerer) spells** — Zargon's spell deck, used by the Witch Lord, Balur, etc. Typical list:
- Fear — chosen hero loses 2 combat dice (att or def) on next combat
- Command — chosen hero takes one action under Zargon's control
- Ball of Flame — 2-die ranged attack on any target in LOS
- Summon Undead — Zargon places a skeleton / zombie / mummy adjacent to caster
- Tempest — chosen hero skips a turn
- Sleep — chosen hero cannot act until they roll to wake

(Specific Dread spells per villain are listed in the Quest Book per-quest.)

---

## 6. Monsters

Monsters act on Zargon's turn. Each monster moves up to its Move value then performs one action: Attack, Cast a Spell (only those that can), Search for treasure, Search for traps, Pass over heroes, Move through walls (special), Open / close a door, or Share a square with another monster on a pit trap.

| Monster | Body | Mind | Move | Atk Dice | Def Dice | Gold | Notes / Special |
|---|---|---|---|---|---|---|---|
| Goblin | 1 | 1 | 10 | 2 | 1 | 5 | Common, weak; often comes in packs |
| Orc | 1 | 2 | 8 | 3 | 2 | 10 | Standard melee enemy |
| Fimir | 2 | 3 | 6 | 3 | 3 | 20 | (Not in 2021 reissue base box — replaced by Abomination; same stats) |
| Abomination | 2 | 3 | 6 | 3 | 3 | 20 | Fimir replacement in 2021 set |
| Skeleton | 1 | 0 | 6 | 2 | 2 | 15 | Undead — immune to mind-affecting spells; takes damage from any weapon |
| Zombie | 1 | 0 | 4 | 2 | 3 | 20 | Undead; slow, tough defense |
| Mummy | 2 | 0 | 4 | 3 | 4 | 25 | Undead; very tough |
| Chaos Warrior / Dread Warrior | 3 | 2 | 6 | 3 | 3 | 35 | Heavy armor; some quests grant +1 Defend die (stone-armor variant) |
| Gargoyle | 3 | 4 | 6 | 4 | 4 | 75 | Boss-tier; can only be harmed by magic weapon in some quests |

**Named bosses (from Quest Book)**
- **Ulag** (orc warlord, Quest 3) — Move 10, Atk 4, Def 5, Body 2, Mind 3.
- **Grak** (orc, Quest 6) — Move 8, Atk 4, Def 4, Body 3, Mind 3; knows 3 Dread spells (one cast per turn): Spells are: *fear*, *sleep*, *tempest*.
- **Balur** (fire mage, Quest 8) — Move 8, Atk 2, Def 5, Body 3, Mind 7; casts fire spells: *ball of flame*, *firestorm*, *tempest*, *summon orcs*, *fear*, *escape*. Immune to fire damage.
- **Witch Lord** (final boss) — Move 6, Atk 6, Def 4, Body 6, Mind 6; knows Dread spells *summon undead* (twice/turn), *fear*, *ball of flame*, *command*, *tempest*. Only harmed by the **Spirit Blade**.

**Monster movement / combat differences**
- Monsters cannot share a square with another figure (exception: pit trap allows multiple).
- Monsters do NOT roll 2d6 for movement — they always move exactly up to their printed Move score.
- Monsters cannot search for treasure (Zargon does not draw treasure cards for them).
- Monsters defend with black shields only.

---

## 7. Equipment / Armory

Heroes visit the armory **between quests** to spend accumulated gold. The full list is on the cardboard armory reference. Standard prices and effects:

### Weapons
| Item | Cost (gold) | Attack Dice | Notes / Restrictions |
|---|---|---|---|
| Dagger | 25 | 1 | Can be thrown (one-shot) at LOS target |
| Short sword | 150 | 2 | Any hero |
| Hand axe | 150 | 2 | Any hero; can be thrown (one-shot) |
| Staff | 150 | 1 | Diagonal attack permitted; any hero |
| Crossbow | 350 | 3 | Ranged (LOS); cannot attack adjacent square; any hero |
| Spear | 250 | 2 | Diagonal attack permitted; can be thrown |
| Longsword | 350 | 3 | Not Wizard |
| Battle axe | 450 | 4 | Two-handed; cannot use shield; not Wizard, not Dwarf |
| Broadsword | 250 | 3 | Two-handed; cannot use shield; Barbarian / Elf only |

### Armor
| Item | Cost | Defense Dice | Restriction |
|---|---|---|---|
| Helmet | 125 | +1 Def | Not Wizard |
| Chain mail | 275 | +2 Def | Not Wizard; move 1d6 with chain mail in some printings — check card |
| Plate mail | 850 | +3 Def | Not Wizard, not Elf; move 1d6 |
| Shield | 150 | +1 Def | Not Wizard; cannot use with two-handed weapons |
| Bracers | 250 | +1 Def | Any hero (some printings) |

### Tools / Misc
| Item | Cost | Effect |
|---|---|---|
| Tool kit | 50 | Required for non-Dwarf to attempt disarming a trap |

Exact prices vary slightly between printings — verify against the armory card supplied in the box.

---

## 8. Quest 1 — "The Trial"

**Premise:** Mentor's first trial for the heroes. Find and destroy **Verag**, a Chaos gargoyle hiding in the catacombs.

**Map (approximate, from quest map page):**
- The board is a 26×19 grid of corridors and rooms. Heroes enter from the **stairway room** on the left edge.
- Rooms include (clockwise from entry): a small entry chamber, a guard room, two storage rooms with chests, a chamber with a tomb (Verag's lair on the east side), and several minor side rooms with tables / cupboards.
- Specific points of interest marked **A–E** in the Quest Book:
  - **A** — Weapons rack (chipped, rusted, broken — no usable item).
  - **B** — Empty chest.
  - **C** — Mummy (Verag's guardian); rolls 4 attack dice instead of 3.
  - **D** — First hero searching this treasure chest finds **84 gold**.
  - **E** — First hero searching this treasure chest finds **120 gold**.
- **No traps and no secret doors** are placed in this quest (per the Zargon note).
- **Wandering Monster:** Orc.
- **Standard monster placements** (per map icons): goblins and orcs distributed in 4–5 rooms; one abomination in a side chamber; one mummy as guardian; **Verag the Chaos Gargoyle** in the far chamber.

**Starting position:** All heroes start in the stairway room (left edge) on or adjacent to the staircase tile.

**Win condition:** Kill Verag (the gargoyle). Return any surviving heroes to the stairway to exit safely.

**Loss condition:** All four heroes reduced to 0 BP before Verag is killed.

---

## 9. Zargon (Evil Sorcerer / DM) Rules

Zargon is one player who runs all monsters, traps, and revelations. The other 1–4 players are heroes.

### Setup
- Zargon reads the **parchment text** for each quest aloud (and only that — keeps everything else secret).
- Places the **Quest Book** behind a screen; only Zargon sees the master map.
- Places only the staircase / starting room and any monsters / furniture visible from it at start.

### Reveal mechanic
- When a hero opens a door (free, must be adjacent), Zargon checks the master map and immediately places:
  - The room tile area (mentally — board is fixed; just place contents),
  - All listed furniture,
  - All monsters,
  - Any specific treasure (kept hidden until searched).
- Zargon does NOT reveal traps or secret doors except when a hero searches for them, steps on them, or springs them.

### Zargon's turn
- After all heroes have acted, Zargon takes one turn.
- Move and act each monster individually (in any order). Each monster: move up to its Move value, then perform ONE action (Attack, Cast Spell, Search, Open door, etc.).
- Monsters cannot share squares (except sharing a pit-trap square).
- Monster attack rolls use that monster's Attack Dice; defense uses black shields only.
- Zargon does not optimize ruthlessly — a "fair" Zargon plays each monster according to its nature (goblins are cowardly, orcs aggressive, undead mindless, etc.).

### Wandering Monsters
- Each quest names one **Wandering Monster** type (e.g. Orc for Quest 1).
- When a hero draws a Wandering Monster treasure card, Zargon places one monster of that type **adjacent to the searcher** (or as close as possible in LOS). It acts on Zargon's next turn.
- If the room/corridor has no adjacent free square, place as near as possible in the corridor leading to that room.

### Heroes' response to a wandering monster
- The current hero's turn ends after the card is drawn; the monster does NOT attack immediately, it acts on Zargon's next turn.

### Death and recovery
- A dead hero may be revived in the next quest with full BP / MP unless the campaign rules say otherwise. Equipment of a dead hero is lost (per base rules: returned to the box; the player may roll a new character of the same type for the next quest).
- An incapacitated hero (0 BP) drops their gold/items on the square; another hero may pick up before the quest ends.

### Ending a quest
- Heroes either complete the quest objective and exit via the stairway, or all die.
- After the quest: gold accumulated is kept and may be spent in the armory between quests; potions / artifacts kept; spells refresh; BP / MP restored to maximum.

---

## Gaps to verify with user

These items reference physical components (character cards, spell cards, treasure cards, armory card) that aren't fully transcribed in the rulebook PDF and need cross-checking before implementation:

1. **Hero starting BP / MP** — not on rulebook pages. Standard community values: Barb 8/2, Dwarf 7/3, Elf 6/4, Wizard 4/6. Confirm against the four character cards.
2. **Spell exact numbers** — Heal Body / Water of Healing exact BP amounts, Genie variant options, Swift Wind movement bonus — all printed on the 12 spell cards. The names and elemental groupings are confirmed; numeric effects need card verification.
3. **Treasure deck exact card list** — the rulebook confirms ~24 cards including gold / gems / potions / wandering monster / hazard, but exact counts per type are on the cards themselves.
4. **Armory prices and exact dice values** — the table above reflects the most common 1989 / 2021 printing; some items (bracers, helmet, chain-mail movement penalty) vary slightly between editions. Verify against the armory card in the box.
5. **Fimir vs Abomination** — the 2021 reissue uses Abomination figures (and the wandering monster slot in some quests is "Abomination"); the 1989 rules call them Fimir. Same stats. Decide which name to use in the digital adaptation.
6. **Verag (Quest 1 gargoyle) exact stats** — not given numerically in the Quest Book page text; uses the standard Gargoyle stats (Body 3, Mind 4, Move 6, Atk 4, Def 4) unless quest-modified. Confirm.
7. **Dread spell exact effects** — the per-villain spell lists are confirmed (Grak, Balur, Witch Lord), but full effect text for each Dread spell is on the 6 Dread spell cards.
8. **Diagonal attack weapon list** — staff and spear are usually listed as diagonal; broadsword in some printings. Verify against the armory card.
9. **Wizard / Dwarf weapon restrictions** — the rulebook says the Wizard cannot use most weapons / armor and the Dwarf cannot use long weapons; the precise lists are on the armory card.
10. **Quest 1 monster counts** — the map icons indicate roughly: 5–6 goblins, 4–5 orcs, 1 abomination, 1 mummy, 1 gargoyle (Verag). Exact counts should be cross-checked against the map symbols when implementing.
