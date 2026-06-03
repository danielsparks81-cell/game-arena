# HeroQuest Quest Book — raw transcription

Source: `HeroQuest Quest Book.pdf` (19 PDF pages; the harness's "68" was wrong). 1-up,
single portrait pages. Rendered to `C:/Users/Dan/Desktop/hq-render/`:
- `qb-pages/p-NN.png` — full pages (scale 2, structure/overview)
- `qb-halves/p-NN-top.png` — map half (scale 4)
- `qb-halves/p-NN-bot.png` — parchment + notes half (scale 4)

**Map symbol language** (stated on the Quest 1 map): *"Dark shaded [maroon] areas on all
quest maps are considered solid rock."* Light cells = rooms/corridors. **Green discs =
monsters** (icon inside = the monster kind, matching the monster cards). Furniture drawn
as little icons (tables, chests, racks, tombs, thrones, bookcases, fireplaces, cupboards,
weapon racks, sorcerer's/alchemist's benches). A hatched diagonal triangle = the
**stairway** (heroes' start/exit). **Capital letters A,B,C… on the map** mark locations
that the lettered NOTES describe. Later quests add symbols for **traps, secret doors, and
treasure chests** (per the rulebook map legend).

Page mapping (booklet "Page N" printed bottom-centre):
- PDF p1 = front cover · p2 = "Page 3" Mentor intro · p3 = "Page 5" Quest 1 · …
- (Working hypothesis: quests run p3–p16, back matter p17–p19. Confirmed as I read.)

---

## Quest 1 — The Trial  (PDF p3, "Page 5")  ✓ implemented

**Parchment (read aloud):** "You have learned well, my friends. Now has come the time of
your first trial. You must first enter the catacombs that contain Fellmarg's tomb. You
must seek out and destroy **Verag, a foul gargoyle** that hides in the catacombs. This
quest is not easy, and you must work together in order to survive. This is your first step
on the road to becoming true heroes. Tread carefully, my friends."

**Zargon aside (read aloud):** there are **no traps or secret doors** in this first quest;
warn the players it is a tough adventure meant to show that survival depends on teamwork.

**Notes:**
- **A.** The weapons on this weapons rack are chipped, rusted, broken — nothing the heroes
  would want.
- **B.** This treasure chest is **empty**.
- **C.** This **mummy** is the guardian of Fellmarg's tomb and was once a mighty warrior —
  it rolls **4 Attack dice instead of 3**.
- **D.** The first hero who searches for treasure finds **84 gold coins** in this chest.
- **E.** The first hero who searches for treasure finds **120 gold coins** in this chest.

**Objective:** find and destroy **Verag** (gargoyle). **Wandering Monster:** **Orc**.

**Map:** starting stairway lower-left. Rooms across the board hold goblins/orcs (green
discs), a mummy guardian (C), furniture (weapon rack A, chests B/D/E, tables, tombs).
Verag is in the far chamber. (Already built faithfully in `content.ts QUEST1`; verify the
mummy-rolls-4-dice and the 84/120 chest specifics are encoded.)

## Quest 2 — The Rescue of Sir Ragnar  (PDF p4, "Page 7")

**Parchment:** "Sir Ragnar, one of the King's most powerful knights, has been captured.
There is reason to believe that he is being held prisoner by **Ulag, the orc warlord**.
You are to find Sir Ragnar and bring him back to the stairway. Prince Magnus offers a
reward of **240 gold coins**, to be divided among the heroes, if they rescue Sir Ragnar.
**No reward** is earned if Sir Ragnar is killed during the escape."

**Notes:**
- **A.** The treasure chest has a **trap with a poison needle**. If a hero searches for
  treasure before the trap is disarmed, they lose **1 Body Point**. The chest is **empty**.
- **B.** The first hero who searches the room for treasure finds **60 gold coins** in this
  chest, and a **Potion of Healing** (restores up to **4 lost Body Points** when consumed).

**Finding Sir Ragnar (escort NPC):** when found, an **alarm sounds** → place ALL remaining
monsters, doors, and furniture on the board, and **all doors are now open** (dynamic
"dungeon wakes up" event). Sir Ragnar is represented by the **plastic Dread-sorcerer
figure**. The hero who opened his cell door escorts him: takes their normal turn, then
rolls **1 red die** to move the wounded knight. (Heroes can't search the cell for
treasure.) Ragnar **may not attack** but rolls **2 Defend dice**; he has **2 Body Points**.
He must reach the stairs **alive** for the reward.

**Objective:** rescue Sir Ragnar and escort him to the stairs alive. **Reward:** 240 gold
(divided), only if he survives. **Wandering Monster:** Orc.

**Map:** stairway centre-left (hatched). **X** marks Ragnar's cell (centre). Chest trap
**A** lower-left; treasure **B** right. ~9 monster discs (orcs; likely Ulag among them).
Furniture: chests, tables, tomb/sarcophagus (lower-left), bookshelves.

**New mechanics this quest needs:** chest/furniture trap (poison needle), escort NPC with
move/defend/no-attack + win-on-reaching-stairs, the "alarm" spawn-all/open-all event,
Potion of Healing item.

## Quest 3 — Lair of the Orc Warlord  (PDF p5, "Page 9")

**Parchment:** "Prince Magnus has ordered that the orc warlord, **Ulag**, who was
responsible for the imprisonment of Sir Ragnar, be sought out and destroyed. When Ulag is
destroyed, the heroes are to be rewarded **180 gold coins** to be divided among them. Any
treasure found in Ulag's stronghold may be kept by the finder alone."

**Notes:**
- **A.** The orc's **armory**. The first hero to search for treasure finds a **Staff**
  weapon (may keep or give to another hero) — exactly like the armory Staff.
- **B.** The first hero to search finds **24 gold coins** and a **Potion of Healing** in
  the cupboard (restores up to 4 BP).

**ULAG** (named orc, "orc figure with the large sword"): **Move 10 · Attack 4 · Defend 5 ·
Body 2 · Mind 3.**

**Objective:** destroy Ulag. **Reward:** 180 gold (divided). Treasure kept by finder alone.
**Wandering Monster:** Orc.

**Map:** playable area is the **left ~40%** (right is solid rock). Stairway top-centre.
A = orc armory (upper-left, weapon rack); B = cupboard (left-middle). ~10–12 orc discs +
Ulag, in a dense column of interconnected rooms. Furniture: weapon racks, tables, cupboard,
bookshelves.

**Mechanics:** named boss with custom stats (Ulag); "treasure kept by finder alone"
(vs divided); reward on boss kill.

## Quest 4 — Prince Magnus' Gold  (PDF p6, "Page 11")

**Parchment:** "Three treasure chests have been stolen while being taken to the King. A
reward of **240 gold coins** has been offered to any group of heroes who return the chests
and all of the gold. The thieves are a well-known band of orcs whose lair is in the Dark
Mountains. They are led by **Gulthor, a Dread warrior**."

**Notes:**
- **A.** The **three chests**, marked with the prince's royal seal. Each is **locked** and
  contains **250 gold coins** + items of value to the King. A hero can carry **only one
  chest at a time**; while carrying, the hero rolls **only 1 red die** for movement. The
  **heroes cannot keep** the gold inside the chests (returned to the King).

**Objective:** recover all 3 chests and return them (to the stairway). **Boss:** Gulthor
(Dread warrior) leads the band. **Reward:** 240 gold. **Wandering Monster:** Abomination.

**Map:** full board. Stairway lower-right. **A** (the 3 chests) centre. ~10–12 monster
discs (orcs + abominations). **Traps present** — orange diagonal marks in several cells
(upper-right, left-middle, lower-left, centre); first quest with traps. Furniture: chests,
tables, weapon racks, tombs.

**Mechanics:** carriable objective chests with movement penalty (1 die) + carry-one-limit;
multi-objective (3 chests) returned to stairs; traps on the map; named Dread-warrior boss.

## Quest 5 — Melar's Maze  (PDF p7, "Page 13")

**Parchment:** "Long ago, a powerful wizard named Melar created a **Talisman of Lore** that
enhances the wearer's understanding of magic. Melar hid the talisman in an underground
laboratory at the heart of his maze, fearing it might be stolen by the evil minions of
Zargon. As you search for the talisman, beware of many **traps** and deadly monsters."

**Notes:**
- **A.** First treasure search finds a half-filled flask on the alchemist's bench — a
  **Potion of Healing** (restores up to 2 BP).
- **B.** A **gargoyle that appears to be a stone statue**. It does **not move at first**;
  it comes to life only after a hero **opens the door into the next room**. It **cannot be
  harmed** (takes no damage) until it has moved or attacked. ← dormant/invulnerable monster.
- **C.** Chest filled with **poisonous gas — a trap!** Search before disarming → lose
  **2 BP**. Chest also holds **144 gold**. No other treasure here.
- **D.** First treasure search finds the **Talisman of Lore** (magical **artifact** —
  effect on its artifact card). ← quest objective.
- **E.** Searching for **secret doors** here finds nothing; but searching for **treasure**
  finds **Melar's key** → touching it makes the key vanish and the **throne slides aside,
  revealing a secret door**. ← unusual secret-door trigger.

**Objective:** find the **Talisman of Lore** (D). **Wandering Monster:** Zombie.

**Map:** maze; playable area mostly left ~55%. Stairway upper-left. **Many traps** (orange
diagonal marks near A/B/C/D). ~8–10 monster discs (zombies + the statue-gargoyle at B).
Furniture: alchemist's bench (A), poison chest (C), tomb (near D), throne (E).

**Mechanics:** artifact objective; dormant monster that's invulnerable until triggered by
a door-open; poison-gas chest trap (−2 BP); secret door revealed by a *treasure* search
(not a secret-door search).

## Quest 6 — Legacy of the Orc Warlord  (PDF p8, "Page 15")

**Parchment:** "Ulag's foul offspring, **Grak**, has sworn revenge… he has captured you in
an ambush. Now you are held prisoner in his dungeons… While the guard sleeps outside your
cell, you pick the lock with an old rat bone. You must find your equipment and escape to
the stairway."

**Special start:** heroes begin in the room marked **"Cell"** (cannot search the cell for
treasure). **All equipment has been taken** — heroes may not use any equipment (weapons,
armor, potions) or **cast spells** until they recover it. An unarmed/unarmored hero rolls
**1 Attack die and 2 Defend dice**.

**Notes:**
- **A.** The heroes' equipment is in the **cupboard** here. Searching the room for treasure
  finds it; **each** hero must enter to collect their belongings; spells are usable again
  once a hero enters and reclaims their powers.
- **B.** These stairs **lead out to freedom** — any hero who moves onto the **stairway tile
  has escaped**. (Grak, the boss, is placed on the board — an extra-tough orc with a Staff
  + a **Wizard's Cloak** artifact; if killed, the cloak goes to the wizard.)

**GRAK** (named orc): **Move 8 · Attack 4 · Defend 3 · Body 3 · Mind 3.** Knows **3 Dread
spells** (one/turn instead of attacking): **Fear, Sleep, Tempest**.

**Objective:** recover equipment (A) and escape via the stairway (B). **Wandering Monster:**
Abomination.

**Map:** full board. Start = **CELL** (centre-left). A = equipment cupboard (upper-left).
B = escape stairway (lower-left, hatched). ~10–12 monster discs + Grak. A few traps along
the bottom edge.

**Mechanics:** imprisoned start (no gear/spells, reduced dice); equipment recovery gate;
**escape-to-stairs** win (start ≠ stairway); named monster casting Dread spells; artifact
reward (Wizard's Cloak). Confirms 3 Dread spell names: **Fear, Sleep, Tempest**.

## Quest 7 — The Lost Wizard  (PDF p9, "Page 17")

**Parchment:** "**Wardoz**, the King's personal wizard, has disappeared… You must find out
what happened to Wardoz. You are each to be paid **100 gold coins**, upon returning to the
stairway."

**Notes:**
- **A.** All the **Dread warriors** in this quest are **made of stone** and roll **1 extra
  Defend die**. (Label A appears at each Dread-warrior location — a note applied to a
  monster *type*, placed at multiple cells.)
- **B.** The **weapons room** — first treasure search finds the artifact **Borin's Armor**.
- **C.** Chest with a **poison-needle trap** (search before disarm → **−2 BP**); then a
  flask of unidentifiable **purple liquid** — a **cursed potion**: drinking it turns the
  hero into a **stone statue, unable to move for 5 of their turns**, but **invulnerable**
  during that time, then they revive.
- **D.** The **zombie in this room is Wardoz** (in wizard's robes). After destroying it,
  first treasure search finds **144 gold** + papers proving Wardoz was consumed by Dread
  magic and turned into a mindless zombie. ← quest answer.

**Objective:** discover Wardoz's fate (D) and return to the stairway. **Wandering Monster:**
Mummy.

**Map:** full board. Stairway upper-left. **A ×4** (stone Dread warriors). B (weapons room)
right edge. C (poison chest) left-middle. D (Wardoz) lower-centre. A few traps (near C,
lower-left). Furniture: weapon racks, tables, tomb, chests.

**Mechanics:** per-quest monster modifier (stone Dread warriors +1 Defend); cursed potion
(self-petrify 5 turns, invulnerable); named monster reskin (Wardoz = a specific zombie);
artifact (Borin's Armor); a note label applied to multiple map cells.

## Quest 8 — The Fire Mage  (PDF p10, "Page 19")

**Parchment:** "The orcs of the Dark Mountains have been using Elemental fire magic in
their raids. **Balur**, the fire mage… No fire magic can harm Balur… enter his lair, deep
beneath Darkfire Crag. Reward of **100 gold each** for Balur's destruction."

**BALUR** (uses the **Dread-sorcerer figure** — the unique per-quest caster): **Move 8 ·
Attack 2 · Defend 5 · Body 3 · Mind 7.** **Immune to fire spells.** Casts (once each):
**Ball of Flame, Firestorm, Tempest, Summon Orcs, Fear, Escape**. *Escape* teleports him to
the **"XX"** square in the middle room (don't place him there until the heroes open the
door).

**Notes:**
- **A.** Treasure chest holds **150 gold** + the artifact **Wand of Magic**.

**Objective:** destroy Balur. **Reward:** 100 gold each. **Wandering Monster:** Abomination.

**Map:** full board. Stairway mid-right. **X** = Balur's start (upper-left); **XX** = his
escape target (centre, by a sorcerer's table). A = Wand of Magic chest (lower-right).
~12–14 monster discs. **Many traps** (≈8–10 orange marks). Furniture: tables, tombs,
chests, sorcerer's table.

**Mechanics:** spellcaster boss with spell immunity (fire) + teleport (escape) + summon
spell; the Dread-sorcerer figure as a named unique. Dread spells now seen: Fear, Sleep,
Tempest, Ball of Flame, Firestorm, Summon Orcs, Escape (7 of 12).

## Quest 9 — Race Against Time  (PDF p11, "Page 21")

**Parchment:** "A guide has led you into an underground maze… you find yourself in a room
with three doors. Suddenly the guide puts out his torch… 'Farewell, my heroes,' he taunts
as he makes his escape. You realize it is a **trap**! You must **escape (make it back to
the stairway)** or perish."

**Notes:**
- **A.** The room where the heroes **begin** the quest (the three-door room).
- **B.** These treasure chests each contain **100 gold**.
- **C.** Chest with a **poison-gas trap** — search before disarm → **−3 BP**. Inside is the
  artifact **Elixir of Life**.

**Objective:** **escape** back to the stairway. **Wandering Monster:** Abomination.

**Map:** stairway upper-left (escape goal). Start = **A** (lower-right). B = 100-gold chests
(centre-left). C = Elixir chest (centre). ~10 monster discs. A couple of traps (near A).
Furniture: chests, tables, weapon rack.

**Mechanics:** escape quest (start ≠ stairway); poison-gas chest trap (−3 BP — damage
scales by quest); Elixir of Life artifact.

## Quest 10 — Castle of Mystery  (PDF p12, "Page 23")

**Parchment:** "Long ago, a wizard named **Ollar** discovered the entrance to a gold mine
and built a magic castle above it… The lower chamber has many **magical doors** and is
guarded by monsters trapped inside. Can you find the entrance to the gold mine?"

**Special rule — teleporting doors:** as soon as a hero moves through **any door**, they
**stop immediately and roll 2 red dice**, then are **teleported to the square marked with
that number** (2–12 on the map). If occupied, they land on that figure: the occupant loses
**1 BP** and (if alive) re-rolls 2 dice to teleport away (re-roll on a repeat); the first
hero stays. **Only one door per turn.**

**Notes:**
- **A.** If both **Dread warriors** here are defeated, the first treasure search finds one
  wore the artifact **Ring of Return**.
- **B.** The **mine entrance** — any hero entering may take **5,000 gold**, but while
  carrying it they **cannot attack or defend**; putting it down makes it vanish. **The
  quest ends** when all monsters are killed OR all heroes leave via the stairs on a roll of
  **2 or 12**. At game end, the 5,000 "gold" is revealed as **fool's gold (worthless)**;
  any other treasure found is real.

**Objective:** puzzle — survive/explore; leave via the stairs (roll 2 or 12). **Wandering
Monster:** none (Ollar's ghost appears and vanishes — flavor only).

**Map:** grid of small doored chambers. **Numbered teleport squares 2–12** scattered
across rooms; the **"2/12"** square sits beside the **stairway (lower-left)** = the exit.
B (mine) upper-centre; A (2 Dread warriors) right. ~12 monster discs.

**Mechanics:** teleporting doors (2d6 → numbered square), numbered target squares, collision
damage, fool's-gold decoy objective, exit on a 2/12 roll, "no wandering monster" case.

## Quest 11 — Bastion of Dread  (PDF p13, "Page 25")

**Parchment:** "Lands to the east have been plagued by marauding orcs and goblins allied
with Zargon… destroy them. They are well-protected in the **Bastion of Dread**, led by a
small group of **Dread warriors**. You must **fight your way in and kill all of the
monsters**. Bounty per kill: **goblin 10 · orc 20 · abomination 30 · Dread warrior 50**
gold."

**Notes:**
- **A.** The **armory** — first treasure search finds a **Shield** (other weapons unusable).
- **B.** A **gargoyle stone statue** (immobile) tied to a **trap chest**: searching the
  chest for treasure before disarming **springs the gargoyle to life to attack**; disarm
  first and it stays inert. The gargoyle **cannot be harmed until it has moved/attacked**.
- **C.** A **Dread warrior** carries a magic sword — the artifact **Orc's Bane** (goes to
  whoever kills him).

**Objective:** **kill every monster** in the fortress. **Reward:** per-kill bounty (above).
**Wandering Monster:** Abomination.

**Map:** full board, **densely packed (~16–18 monster discs)**. Stairway centre. A (armory/
Orc's-Bane Dread warrior) lower-right; B (gargoyle statue + trap chest) centre-left; C
centre. Several traps. Furniture: tables, weapon racks, chests, tomb, cupboards.

**Mechanics:** clear-the-dungeon objective; **per-kill gold bounty scaling by monster
type**; dormant gargoyle linked to a chest trap (search→ambush).

## Quest 12 — Barak Tor, Barrow of the Witch Lord  (PDF p14, "Page 27")

**Parchment:** "War with the eastern orcs is brewing… you must find the ancient **Star of
the West**… A reward of **200 gold** (divided evenly) when the Star is returned to safety.
The Star lies in **Barak Tor**, the resting place of the evil **Witch Lord**. He was
defeated by the magical **Spirit Blade** long ago — the only weapon that could harm him."

**Notes:**
- **A.** **False doors** — cannot be opened at all (label A placed at several map cells).
- **B.** The **Star of the West** is in the **zombie's hand**. ← objective.
- **C.** A special **falling-block trap** that collapses **automatically when the last hero
  passes** onto the square; afterwards it **forever blocks that path back to the stairs**.
- **D.** The **tomb of the Witch Lord**. He is **released when the first hero enters the
  room** (use the **Dread-sorcerer figure**). Read aloud: *"You have broken the magic seal…
  Now he has awoken, and you must run. Only the Spirit Blade can harm him."*
- **E.** First treasure search finds a magical staff behind the bookcase — the artifact
  **Wizard's Staff**.

**THE WITCH LORD:** **not affected by any weapon or spell — only the Spirit Blade can harm
him** (recovered in the **next** quest). Moves **1 space/turn**, rolls **2 Attack dice**,
casts **Summon Undead, Fear, Command, Ball of Flame**.

**Objective:** grab the Star of the West (B) and **escape** (the Witch Lord can't be killed
here). **Reward:** 200 gold. **Wandering Monster:** Skeleton.

**Map:** stairway lower-left by **D** (Witch Lord tomb). **B** (Star/zombie) centre; **C**
(auto-falling-block) upper-left; **A** (false doors) several; **E** (Wizard's Staff)
lower-centre; an **X** marker left-middle (likely the Witch-Lord placement square — verify).
~8–10 undead discs.

**Mechanics:** invulnerable boss (only a specific artifact harms — multi-quest arc); false
doors; **auto-trigger falling block** that seals the exit; grab-and-flee objective. Dread
spells now seen: + Summon Undead, Command (→ 9 of 12 unique).

## Quest 13 — Quest for the Spirit Blade  (PDF p15, "Page 29")

**Parchment:** "You have awoken the Witch Lord!… He must be destroyed before he can bring
his army of undead… Your goal is to find the **Spirit Blade** and return it to safety.
Only this ancient weapon can harm the Witch Lord… The sword now lies somewhere in an
ancient ruined temple."

**Special rule — rubble field (modified falling blocks):** the falling-block squares behave
differently here. A player who **moves onto one rolls 1 red die**: a **4, 5, or 6 = −1 BP**
(with a **helmet**, only a **6** costs 1 BP). **Monsters are unaffected.** Do **not** place
falling-block tiles; heroes are **not blocked** by these squares.

**Notes:**
- **A.** First treasure search finds the **Spirit Blade** (magical artifact). ← objective.
- **B.** Treasure chest holds **200 gold**.

**Objective:** find the **Spirit Blade** (A) and return it to safety. **Wandering Monster:**
Dread Warrior.

**Map:** stairway centre-upper. A (Spirit Blade) lower-right; B (200 gold) left-centre.
~8–10 undead/Dread-warrior discs. Several **red-shaded "rubble" squares** = the special
falling-block field. Furniture: chests, tables, weapon rack, tomb.

**Mechanics:** per-quest override of a tile rule (rubble field: dice-check damage, helmet
mitigates, monsters immune, non-blocking); fetch-and-return artifact objective; sets up
Quest 14.

## Quest 14 — Return to Barak Tor  (PDF p16, "Page 31")  — FINALE

**Parchment:** "Now that you have found the **Spirit Blade**, you must return to Barak Tor
and **defeat the Witch Lord**. The King has ridden forth to meet the eastern orcs at
Darkfire Pass. If you fail, the Witch Lord will lead his army of undead and attack His
Majesty's forces from the rear. Then nothing remains to prevent the forces of Dread from
overrunning the land!"

**Notes:**
- **A.** The Witch Lord's tomb is now **empty**.

**THE WITCH LORD** (Dread-sorcerer figure; stronger now): **Move 10 · Attack 5 · Defend 6 ·
Body 4 · Mind 6.** Still **only the Spirit Blade can harm him**. Casts **Summon Undead,
Fear (twice), Ball of Flame, Command, Tempest**.

**Reward:** defeating him drops the artifact **Spell Ring**. **All surviving heroes are
awarded the title "Champion"** by the King. **Objective:** destroy the Witch Lord (now
killable with the Spirit Blade). **Wandering Monster:** Mummy.

**Map:** stairway lower-left. **A** (empty tomb) left-centre; **X** (Witch Lord placement)
upper-right. ~10–12 undead discs (skeletons/zombies/mummies/Dread warriors). A couple of
traps (upper-right).

**Mechanics:** campaign finale; the previously-invulnerable boss is now killable thanks to
the artifact recovered last quest; title reward.

---

## Dread spells seen across the quests (for the 12-card Dread deck)
Fear, Sleep, Tempest, Ball of Flame, Firestorm, Summon Orcs, Escape, Summon Undead,
Command (9 unique). The rulebook noted several Dread spells are unused in the first 14
quests, so the remaining ~3 cards are not referenced by these quests.

## Recurring quest mechanics (superset to support)
- Objectives: **kill named boss** (1,3,8,11,14), **rescue/escort NPC** (2), **recover
  carriable objects** (4), **find artifact** (5,13), **investigate** (7), **escape to
  stairs** (6,9), **puzzle/leave** (10), **grab-and-flee** (12).
- **Named/unique monsters** with custom stats (Verag, Ulag, Grak, Balur, Wardoz, Witch
  Lord) — several use the **Dread-sorcerer figure** as a placeholder. Per-quest **monster
  modifiers** (mummy +1 atk; stone Dread warriors +1 def).
- **Dormant monsters** (gargoyle statues) — immobile + invulnerable until triggered by a
  door-open or a chest-search ambush.
- **Chest/furniture traps** with quest-defined effects (poison needle/gas, −1/−2/−3 BP;
  cursed potion → self-petrify).
- **Special tiles/rules per quest**: teleporting doors (Q10), false doors (Q12), auto
  falling block sealing the exit (Q12), rubble field (Q13).
- **Artifacts** as rewards/objectives: Talisman of Lore, Borin's Armor, Wand of Magic,
  Ring of Return, Orc's Bane, Elixir of Life, Wizard's Cloak, Wizard's Staff, Spirit
  Blade, Spell Ring. (Effects on artifact cards — still awaiting those scans.)
- **Reward models**: flat gold, per-kill bounty (Q11), divided vs finder-keeps, artifact,
  title.
- **Start ≠ stairway** and **escape/return-to-stairs** win conditions.

---

## Map symbol legend  (PDF p17, "Page 33" — "Design Your Own Quest Adventures")
The book includes a blank 26×19 map template (photocopy-permitted) and the full symbol key:
- **Monsters** = green discs, one icon per kind: **Goblins, Orcs, Skeletons, Zombies,
  Abominations, Mummies, Dread warriors** (the row counts mirror the box roster: ~8 goblin,
  ~8 orc, ~4 skeleton, ~2 zombie, ~3 abomination, ~2 mummy, ~4 Dread warrior).
- **Falling-block traps** = **red-shaded squares** (a hatched red tile).
- **Blocked squares** / **double-blocked squares** = red brick-pattern tiles.
- **Secret doors** = small **orange diagonal slash** ON a wall edge.
- **Spear traps** = **orange diagonal slash** WITHIN a floor cell (looks similar to a secret
  door — distinguish by wall-edge vs in-cell).
- **Pit traps** = a **framed-square** icon in a cell.
- **Stairs** = the hatched fan/triangle (start/exit).
- **Tables, Chests, Doors** = brown furniture/door icons.
- **Furniture (right column):** Bookcase, Sorcerer's table, Alchemist's bench, Throne,
  Fireplace, Cupboard, Tomb, Rack, Weapons rack.
> ⚠ Map-reading caveat: secret-door and spear-trap marks are both orange diagonals; pit vs
> falling-block vs blocked are all reddish tiles. Zoom each quest map and apply this key
> when extracting exact placements for implementation.

## The Monsters  (PDF p18, "Page 34" — bestiary, flavor)
- **Goblin** — small, quick, weak but dangerous in numbers.
- **Orc** — larger, more powerful; rank-and-file of Zargon's armies.
- **Abomination** — hulking amphibious humanoids; Zargon's enforcers; dangerous even alone.
- **Dread Warriors** — humans turned monster; heavily armored, weapons enchanted with Dread
  magic.
- **Skeletons** — animated dead; slow but relentless; bulk of the undead armies.
- **Zombies** — magically animated corpses; slow, awkward, reeking of the grave.
- **Mummies** — embalmed by magic; very hard to overcome in single combat.
- **Gargoyles** — stone statues of great monsters brought to life; stone skin = very hard
  to wound.
- **Dread Sorcerer** — *"This figure will be used as several different characters (both good
  and bad) in various quests."* ← confirms the per-quest unique-character placeholder
  (Sir Ragnar, Balur, Witch Lord, …).

## Closing narrative (Page 35) + back matter
Page 35 = Mentor's closing narrative (the King's army, Darkfire Pass, Kalix Karn, the
Witch Lord arc, foreshadowing future quests). p19 = back cover (Avalon Hill). No rules.

## Quest Book structure
p1 cover · p2 "Page 3" intro · **p3–p16 = Quests 1–14** ("Page 5"–"Page 31", odd numbers) ·
p17 "Page 33" symbol legend + blank template · p18 "Page 34–35" bestiary + closing · p19
back cover.
